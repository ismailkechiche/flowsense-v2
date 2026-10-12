'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('../helpers/testApp');
const { paxWeightedAvg } = require('../../src/domain/metrics');
const { SECURITY, PASSPORT, FLAT, seed } = require('../helpers/analyticsFixture');

const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} ≠ ${expected}`);

describe('pivot', () => {
  let t;
  let analyst;
  const pivot = (body) => t.as(analyst).post('/api/pivot').send(body);

  before(() => {
    t = createTestApp();
    const admin = t.createUser({ role: 'admin' });
    analyst = t.createUser({ role: 'analyst' });
    seed(t, admin);
  });

  test('options list the whitelist', async () => {
    const res = await t.as(analyst).get('/api/pivot/options');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.dimensions.map((d) => d.key), ['checkpoint', 'date', 'hour', 'shift', 'flight_no', 'counter']);
    assert.deepEqual(res.body.metrics.map((m) => m.key),
      ['avg_wait', 'avg_processing', 'avg_total', 'throughput', 'sla_compliance', 'pax_total', 'group_count', 'breach_pax']);
    assert.equal(res.body.max_cells, 1000);
  });

  test('injection attempts as a dimension or metric name get 400 and run nothing', async () => {
    const attacks = [
      { rows: "hour; DROP TABLE users; --", metrics: ['avg_wait'] },
      { rows: "c.name) FROM users --", metrics: ['avg_wait'] },
      { rows: 'checkpoint', columns: "1 UNION SELECT password_hash FROM users", metrics: ['avg_wait'] },
      { rows: 'checkpoint', metrics: ['avg_wait', "(SELECT password_hash FROM users LIMIT 1)"] },
      { rows: '__proto__', metrics: ['avg_wait'] },
      { rows: 'constructor', metrics: ['toString'] },
      { rows: ['checkpoint'], metrics: ['avg_wait'] },
    ];
    for (const body of attacks) {
      const res = await pivot(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'unknown_pivot_key', JSON.stringify(res.body));
    }
    // Filter values are validated too, and would only ever be bound parameters.
    for (const filters of [{ checkpoint_id: '1 OR 1=1' }, { from: "2026-01-01' OR '1'='1" }, { session_id: '1; DELETE FROM sessions' }, { evil: 1 }]) {
      const res = await pivot({ rows: 'checkpoint', metrics: ['avg_wait'], filters });
      assert.equal(res.status, 400, JSON.stringify(filters));
      assert.equal(res.body.error.code, 'validation_error');
    }
    assert.ok(t.db.prepare('SELECT COUNT(*) FROM users').pluck().get() >= 2, 'users table untouched');
    assert.equal(t.db.prepare('SELECT COUNT(*) FROM sessions').pluck().get(), 3, 'sessions untouched');
  });

  test('other configuration mistakes are 400 validation errors', async () => {
    for (const body of [
      { metrics: ['avg_wait'] },
      { rows: 'checkpoint', metrics: [] },
      { rows: 'checkpoint', columns: 'checkpoint', metrics: ['avg_wait'] },
      { rows: 'checkpoint', metrics: ['avg_wait', 'avg_wait'] },
      { rows: 'checkpoint', metrics: ['avg_wait'], visualization: 'pie' },
      { rows: 'checkpoint', metrics: ['avg_wait'], visualization: 'line' }, // line needs date or hour
      { rows: 'date', metrics: ['avg_wait'], filters: { from: '2026-05-02', to: '2026-05-01' } },
      { rows: 'date', metrics: ['avg_wait'], extra: true },
    ]) {
      const res = await pivot(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'validation_error', JSON.stringify(res.body));
    }
  });

  test('cells are pax-weighted and match the shared formula', async () => {
    const res = await pivot({ rows: 'checkpoint', metrics: ['avg_wait', 'avg_processing', 'pax_total', 'group_count', 'breach_pax', 'sla_compliance'] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.row_values, ['Passport Control', 'Security']);
    assert.equal(res.body.column_values, null);
    const security = res.body.cells.find((c) => c.row === 'Security').values;
    const rows = FLAT.filter((r) => r.checkpoint_id === SECURITY);
    close(security.avg_wait, paxWeightedAvg(rows, 'wait'), 'avg wait');
    close(security.avg_processing, paxWeightedAvg(rows, 'processing'), 'avg processing');
    assert.notEqual(security.avg_wait, rows.reduce((s, r) => s + r.wait, 0) / rows.length);
    assert.equal(security.pax_total, 14);
    assert.equal(security.group_count, 5);
    assert.equal(security.breach_pax, 10);
    // Avg wait 17.1 min against an SLA of 10: flagged as a breach.
    assert.equal(res.body.cells.find((c) => c.row === 'Security').breach, true);
    assert.equal(res.body.cells.find((c) => c.row === 'Passport Control').breach, false);
    assert.equal(res.body.config.title, 'Avg wait, Avg processing, Passengers, Groups, Breach pax, SLA compliance by checkpoint');
  });

  test('rows × columns, throughput per cell from session windows, and filters', async () => {
    const res = await pivot({ rows: 'hour', columns: 'checkpoint', metrics: ['throughput', 'pax_total'], visualization: 'line', title: 'Hourly by checkpoint' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.row_values, [8, 9, 14]);
    assert.deepEqual(res.body.column_values, ['Passport Control', 'Security']);
    assert.equal(res.body.cell_count, 3);
    const at = (row, column) => res.body.cells.find((c) => c.row === row && c.column === column).values;
    // Security 08:xx: 8 pax over one window 08:00 → 08:36.
    close(at(8, 'Security').throughput, (8 * 60) / 36, '08h throughput');
    close(at(9, 'Passport Control').throughput, (3 * 60) / 5, '09h throughput');
    assert.equal(res.body.config.title, 'Hourly by checkpoint');

    const filtered = await pivot({ rows: 'date', metrics: ['pax_total'], filters: { checkpoint_id: [PASSPORT] } });
    assert.deepEqual(filtered.body.cells.map((c) => [c.row, c.values.pax_total]), [['2026-05-01', 3]]);
  });

  test('missing values are their own row; more than 1,000 cells is refused with a clear error', async () => {
    const flights = await pivot({ rows: 'flight_no', metrics: ['pax_total'] });
    assert.deepEqual(flights.body.row_values, [null, 'AF200', 'TU100']);

    const t2 = createTestApp();
    const admin = t2.createUser({ role: 'admin' });
    const session = t2.services.sessions.create(admin, { name: 'Big', date: '2026-06-01', checkpoint_id: SECURITY });
    const insert = t2.db.prepare(`INSERT INTO observations (session_id, passenger_group_code, pax, flight_no, arrival_time, service_start, service_end, wait_minutes, processing_minutes, total_minutes)
      VALUES (?, ?, 1, ?, '2026-06-01T08:00:00', '2026-06-01T08:01:00', '2026-06-01T08:02:00', 1, 1, 2)`);
    t2.db.transaction(() => { for (let i = 0; i < 1001; i += 1) insert.run(session.id, `G${i}`, `FL${i}`); })();
    const tooMany = await t2.as(admin).post('/api/pivot').send({ rows: 'flight_no', metrics: ['pax_total'] });
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.body.error.code, 'too_many_cells');
    assert.match(tooMany.body.error.message, /more than 1,000 cells/);
    t2.db.prepare("DELETE FROM observations WHERE flight_no = 'FL0'").run();
    assert.equal((await t2.as(admin).post('/api/pivot').send({ rows: 'flight_no', metrics: ['pax_total'] })).body.cell_count, 1000);
  });
});
