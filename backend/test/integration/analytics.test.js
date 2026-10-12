'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('../helpers/testApp');
const { paxWeightedAvg, paxWeightedPercentile, slaCompliancePct } = require('../../src/domain/metrics');
const { mmc } = require('../../src/domain/queueing');

const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} ≠ ${expected}`);
const rowAverage = (rows, key) => rows.reduce((sum, r) => sum + r[key], 0) / rows.length;

const { SECURITY, PASSPORT, GATE, SLA, SESSIONS, FLAT, seed } = require('../helpers/analyticsFixture');

describe('analytics', () => {
  let t;
  let analyst;
  const get = (path) => t.as(analyst).get(path);

  before(() => {
    t = createTestApp();
    const admin = t.createUser({ role: 'admin' });
    analyst = t.createUser({ role: 'analyst' });
    seed(t, admin, SESSIONS);
  });

  test('overview KPIs are pax-weighted, and differ from row averages on this fixture', async () => {
    const res = await get('/api/analytics/summary');
    assert.equal(res.status, 200);
    const s = res.body;
    assert.equal(s.pax_total, 17);
    assert.equal(s.group_count, 6);
    for (const [field, key] of [['avg_wait_minutes', 'wait'], ['avg_processing_minutes', 'processing'], ['avg_total_minutes', 'total']]) {
      close(s[field], paxWeightedAvg(FLAT, key), field);
      assert.notEqual(s[field].toFixed(6), rowAverage(FLAT, key).toFixed(6), `${field} must not be the row average`);
    }
    close(s.sla_compliance_pct, slaCompliancePct(FLAT, 'wait', 'sla'), 'SLA %');
    assert.equal(s.breach_pax, 10);   // the family of 6 (30 min) and the group of 4 (12 min)
    assert.equal(s.breach_groups, 2);
    assert.equal(s.p50_wait_minutes, paxWeightedPercentile(FLAT, 'wait', 50));
    assert.equal(s.p90_wait_minutes, paxWeightedPercentile(FLAT, 'wait', 90));
    assert.equal(s.p90_wait_minutes, 30);
    // Throughput: 17 pax over the sum of session windows 36 + 40 + 5 minutes.
    assert.equal(s.observed_minutes, 81);
    close(s.throughput_per_hour, (17 * 60) / 81, 'throughput');
    assert.equal(s.sla_wait_minutes, SLA);
  });

  test('bottlenecks: λ, μ, c per checkpoint from per-session windows, fed into M/M/c', async () => {
    const res = await get('/api/analytics/bottlenecks');
    assert.equal(res.status, 200);
    const security = res.body.items.find((x) => x.checkpoint_id === SECURITY);
    const secRows = FLAT.filter((r) => r.checkpoint_id === SECURITY);
    close(security.avg_wait_minutes, paxWeightedAvg(secRows, 'wait'), 'security avg wait');
    assert.notEqual(security.avg_wait_minutes, rowAverage(secRows, 'wait'));
    close(security.lambda, 14 / 30, 'λ');           // arrival windows 10 + 20 min
    close(security.mu, 14 / 22, 'μ');               // processing 6+2+2+4+8 min
    assert.equal(security.c, 3);                      // (2 counters × 8 pax + 4 servers × 6 pax) / 14 = 2.86
    assert.equal(security.c_source, 'mixed');
    const expected = mmc(14 / 30, 14 / 22, 3);
    close(security.model.wq, expected.wq, 'Wq');
    close(security.model.p_wait, expected.p_wait, 'P(wait)');
    assert.equal(security.sla_status, 'ok');
    assert.equal(security.recommended_servers, 1);

    // Passport Control has a single group: no arrival window, so no model.
    const passport = res.body.items.find((x) => x.checkpoint_id === PASSPORT);
    assert.equal(passport.lambda, null);
    assert.equal(passport.model, null);
    assert.equal(passport.sla_status, 'not_enough_data');
    assert.equal(res.body.items.at(-1).checkpoint_id, PASSPORT);
  });

  test('hourly, breakdown and trend are pax-weighted per bucket', async () => {
    const hourly = (await get('/api/analytics/hourly')).body.items;
    assert.deepEqual(hourly.map((h) => h.hour), [8, 9, 14]);
    for (const h of hourly) {
      const rows = FLAT.filter((r) => r.hour === h.hour);
      close(h.avg_wait_minutes, paxWeightedAvg(rows, 'wait'), `hour ${h.hour}`);
      close(h.sla_compliance_pct, slaCompliancePct(rows, 'wait', 'sla'), `hour ${h.hour} SLA`);
    }
    assert.equal(hourly[0].pax_total, 8);
    assert.equal(hourly[0].throughput_per_hour, 8);
    assert.notEqual(hourly[0].avg_wait_minutes, rowAverage(FLAT.filter((r) => r.hour === 8), 'wait'));

    const breakdown = (await get('/api/analytics/breakdown')).body;
    assert.deepEqual(breakdown.flights.map((f) => [f.value, f.pax_total]), [['TU100', 10], ['AF200', 4]]);
    close(breakdown.flights[0].avg_wait_minutes, paxWeightedAvg(FLAT.filter((r) => r.flight === 'TU100'), 'wait'), 'TU100');
    assert.deepEqual(breakdown.counters.map((c) => c.value).sort(), ['P1', 'S1', 'S2']);
    assert.equal(breakdown.counters_total, 3);

    const trend = (await get('/api/analytics/trend')).body.items;
    assert.deepEqual(trend.map((d) => d.date), ['2026-05-01', '2026-05-02']);
    for (const d of trend) close(d.avg_wait_minutes, paxWeightedAvg(FLAT.filter((r) => r.date === d.date), 'wait'), d.date);
  });

  test('wait distribution: 5-minute bins in passengers, last bin open-ended, SLA threshold included', async () => {
    const res = await get('/api/analytics/distribution');
    assert.equal(res.status, 200);
    const { bins, bin_minutes: width, sla_thresholds: sla } = res.body;
    assert.equal(width, 5);
    assert.equal(bins.length, 25);
    assert.deepEqual([bins[0].from_minutes, bins[0].to_minutes], [0, 5]);
    assert.deepEqual([bins[24].from_minutes, bins[24].to_minutes], [120, null]);
    assert.equal(bins[0].pax, 7);     // waits 0, 0, 4, 2
    assert.equal(bins[2].pax, 4);     // 12 min
    assert.equal(bins[6].pax, 6);     // 30 min
    assert.equal(bins.reduce((sum, b) => sum + b.pax, 0), 17);
    assert.deepEqual(sla, [SLA]);
  });

  test('filters: checkpoint list, date range, session; bad values are 400', async () => {
    const passportOnly = (await get(`/api/analytics/summary?checkpoint_id=${PASSPORT}`)).body;
    assert.equal(passportOnly.pax_total, 3);
    const both = (await get(`/api/analytics/summary?checkpoint_id=${SECURITY}&checkpoint_id=${PASSPORT}`)).body;
    assert.equal(both.pax_total, 17);
    assert.equal((await get(`/api/analytics/summary?checkpoint_id=${SECURITY},${PASSPORT}`)).body.pax_total, 17);
    assert.equal((await get('/api/analytics/summary?from=2026-05-02&to=2026-05-02')).body.pax_total, 6);
    const sessionId = t.db.prepare("SELECT id FROM sessions WHERE name = 'Security day 1'").pluck().get();
    assert.equal((await get(`/api/analytics/trend?session_id=${sessionId}`)).body.items.length, 1);

    const empty = (await get('/api/analytics/summary?from=2030-01-01')).body;
    assert.equal(empty.pax_total, 0);
    assert.equal(empty.avg_wait_minutes, null);
    assert.equal(empty.throughput_per_hour, null);

    for (const query of ['checkpoint_id=1%20OR%201%3D1', 'checkpoint_id=abc', 'from=01/05/2026', 'from=2026-05-02&to=2026-05-01', 'session_id=0']) {
      const res = await get(`/api/analytics/hourly?${query}`);
      assert.equal(res.status, 400, query);
      assert.equal(res.body.error.code, 'validation_error');
    }
  });

  test('an overloaded checkpoint (ρ ≥ 1) is reported first, with null waits and a staffing figure', async () => {
    const t2 = createTestApp();
    const admin = t2.createUser({ role: 'admin' });
    seed(t2, admin, [...SESSIONS, { name: 'Gate', date: '2026-05-01', checkpoint_id: GATE, rows: [
      [2, '10:00', '10:00', '10:05', 'G1', null],
      [2, '10:01', '10:05', '10:10', 'G1', null],
      [2, '10:02', '10:10', '10:15', 'G1', null],
    ] }]);
    const res = await t2.as(admin).get('/api/analytics/bottlenecks');
    const [first] = res.body.items;
    assert.equal(first.checkpoint_id, GATE);
    assert.equal(first.sla_status, 'overloaded');
    assert.equal(first.model.overloaded, true);
    close(first.model.rho, 7.5, 'ρ');                 // λ = 6/2 = 3, μ = 6/15 = 0.4, c = 1
    assert.equal(first.model.wq, null);
    assert.equal(first.recommended_servers, 8);       // a = 7.5, so c ≥ 8; c = 8 waits 4.0 min ≤ SLA 15
  });

  test('simulator: defaults come from the observed data; runs return the M/M/c result', async () => {
    const defaults = await get(`/api/simulator/defaults?checkpoint_id=${SECURITY}`);
    assert.equal(defaults.status, 200);
    close(defaults.body.lambda, 14 / 30, 'λ');
    close(defaults.body.mu, 14 / 22, 'μ');
    assert.equal(defaults.body.c, 3);
    assert.equal(defaults.body.sla_wait_minutes, SLA);
    assert.equal((await get('/api/simulator/defaults?checkpoint_id=999')).status, 404);
    assert.equal((await get('/api/simulator/defaults')).status, 400);

    const run = (await get('/api/simulator/run?lambda=2&mu=1&c=3&sla_minutes=1')).body;
    close(run.wq, 4 / 9, 'Wq');
    assert.equal(run.recommended_servers, 3);
    const overloaded = (await get('/api/simulator/run?lambda=5&mu=1&c=3&sla_minutes=10')).body;
    assert.equal(overloaded.overloaded, true);
    assert.equal(overloaded.wq, null);
    assert.equal(overloaded.recommended_servers, 6);
    for (const query of ['lambda=-1&mu=1&c=1&sla_minutes=5', 'lambda=1&mu=0&c=1&sla_minutes=5', 'lambda=1&mu=1&c=1.5&sla_minutes=5', 'lambda=1&mu=1&c=101&sla_minutes=5', 'lambda=1&mu=1&c=1']) {
      assert.equal((await get(`/api/simulator/run?${query}`)).status, 400, query);
    }
  });
});
