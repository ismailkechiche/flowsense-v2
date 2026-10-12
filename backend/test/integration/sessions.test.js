'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('../helpers/testApp');

function setup() {
  const t = createTestApp();
  return {
    t,
    admin: t.createUser({ role: 'admin' }),
    collector: t.createUser({ role: 'collector' }),
    other: t.createUser({ role: 'collector' }),
    analyst: t.createUser({ role: 'analyst' }),
  };
}

const obs = (time, extra = {}) => ({
  pax: 2,
  arrival_time: `2026-05-01T${time}`,
  service_start: `2026-05-01T${time.slice(0, 3)}${String(Number(time.slice(3, 5)) + 10).padStart(2, '0')}:00`,
  service_end: `2026-05-01T${time.slice(0, 3)}${String(Number(time.slice(3, 5)) + 12).padStart(2, '0')}:00`,
  ...extra,
});

async function createSession(t, user, body = {}) {
  const res = await t.as(user).post('/api/sessions').send({ name: 'Security AM', date: '2026-05-01', checkpoint_id: 2, ...body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.session;
}

describe('sessions', () => {
  test('create, read, list with summary columns', async () => {
    const { t, collector, analyst } = setup();
    const session = await createSession(t, collector, { observer: 'Sami' });
    assert.equal(session.checkpoint_name, 'Security');
    assert.equal(session.shift, null);
    assert.equal(session.group_count, 0);
    assert.equal(session.avg_wait_minutes, null);
    assert.equal(session.sla_breached, false);

    const list = await t.as(analyst).get('/api/sessions');
    assert.equal(list.status, 200);
    assert.deepEqual(Object.keys(list.body).sort(), ['items', 'page', 'page_size', 'total', 'total_pages']);
    assert.equal(list.body.items[0].id, session.id);
  });

  test('validation: date format, unknown or inactive checkpoint', async () => {
    const { t, admin, collector } = setup();
    assert.equal((await t.as(collector).post('/api/sessions').send({ name: 'x', date: '01/05/2026', checkpoint_id: 1 })).status, 400);
    assert.equal((await t.as(collector).post('/api/sessions').send({ name: 'x', date: '2026-05-01', checkpoint_id: 99 })).status, 400);
    await t.as(admin).patch('/api/checkpoints/4').send({ active: false });
    const inactive = await t.as(collector).post('/api/sessions').send({ name: 'x', date: '2026-05-01', checkpoint_id: 4 });
    assert.equal(inactive.status, 400);
    assert.match(inactive.body.error.message, /inactive/);
  });

  test('pagination, default sort by date descending, filters', async () => {
    const { t, collector } = setup();
    for (let day = 1; day <= 30; day += 1) {
      await createSession(t, collector, { name: `S${day}`, date: `2026-04-${String(day).padStart(2, '0')}`, checkpoint_id: day % 2 ? 1 : 2 });
    }
    const page1 = (await t.as(collector).get('/api/sessions')).body;
    assert.equal(page1.total, 30);
    assert.equal(page1.total_pages, 2);
    assert.equal(page1.items.length, 25);
    assert.equal(page1.items[0].date, '2026-04-30');
    const page2 = (await t.as(collector).get('/api/sessions?page=2&page_size=25')).body;
    assert.equal(page2.items.length, 5);
    assert.equal(page2.items.at(-1).date, '2026-04-01');

    assert.equal((await t.as(collector).get('/api/sessions?page_size=101')).status, 400);
    assert.equal((await t.as(collector).get('/api/sessions?page=0')).status, 400);

    const filtered = (await t.as(collector).get('/api/sessions?checkpoint_id=1&from=2026-04-10&to=2026-04-20')).body;
    assert.equal(filtered.total, 5);
    assert.ok(filtered.items.every((s) => s.checkpoint_id === 1 && s.date >= '2026-04-10' && s.date <= '2026-04-20'));
  });

  test('shift filter', async () => {
    const { t, collector } = setup();
    const am = await createSession(t, collector, { name: 'AM' });
    const pm = await createSession(t, collector, { name: 'PM' });
    await t.as(collector).post(`/api/sessions/${am.id}/observations`).send(obs('08:00:00'));
    await t.as(collector).post(`/api/sessions/${pm.id}/observations`).send(obs('15:00:00'));
    const res = (await t.as(collector).get('/api/sessions?shift=afternoon')).body;
    assert.deepEqual(res.items.map((s) => s.name), ['PM']);
    assert.equal((await t.as(collector).get('/api/sessions?shift=evening')).status, 400);
  });

  test('collectors edit only their own sessions; admins edit any', async () => {
    const { t, admin, collector, other } = setup();
    const session = await createSession(t, collector);
    const denied = await t.as(other).patch(`/api/sessions/${session.id}`).send({ name: 'Mine now' });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, 'not_session_owner');
    assert.equal((await t.as(collector).patch(`/api/sessions/${session.id}`).send({ notes: 'busy' })).body.session.notes, 'busy');
    assert.equal((await t.as(admin).patch(`/api/sessions/${session.id}`).send({ name: 'Renamed' })).body.session.name, 'Renamed');
  });

  test('moving a session date away from its observations is refused', async () => {
    const { t, collector } = setup();
    const session = await createSession(t, collector);
    await t.as(collector).post(`/api/sessions/${session.id}/observations`).send(obs('08:00:00'));
    const res = await t.as(collector).patch(`/api/sessions/${session.id}`).send({ date: '2026-05-03' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'date_mismatch');
    // The day before is fine: the observation becomes its overnight tail.
    assert.equal((await t.as(collector).patch(`/api/sessions/${session.id}`).send({ date: '2026-04-30' })).status, 200);
  });

  test('admin delete cascades to observations and is audited in the same transaction', async () => {
    const { t, admin, collector } = setup();
    const session = await createSession(t, collector);
    await t.as(collector).post(`/api/sessions/${session.id}/observations`).send(obs('08:00:00'));
    await t.as(collector).post(`/api/sessions/${session.id}/observations`).send(obs('08:20:00', { pax: 4 }));

    assert.equal((await t.as(collector).delete(`/api/sessions/${session.id}`)).status, 403);
    assert.equal((await t.as(admin).delete(`/api/sessions/${session.id}`)).status, 204);
    assert.equal(t.db.prepare('SELECT COUNT(*) FROM observations').pluck().get(), 0);
    const [entry] = t.repos.audit.listByAction('session_deleted');
    assert.equal(entry.target_id, session.id);
    assert.equal(entry.details.observation_count, 2);
    assert.equal(entry.details.pax_total, 6);
    assert.equal((await t.as(admin).get(`/api/sessions/${session.id}`)).status, 404);
  });

  test('analysts can read but not write', async () => {
    const { t, collector, analyst } = setup();
    const session = await createSession(t, collector);
    assert.equal((await t.as(analyst).get(`/api/sessions/${session.id}`)).status, 200);
    assert.equal((await t.as(analyst).get(`/api/sessions/${session.id}/observations`)).status, 200);
    assert.equal((await t.as(analyst).post('/api/sessions').send({ name: 'x', date: '2026-05-01', checkpoint_id: 1 })).status, 403);
    assert.equal((await t.as(analyst).post(`/api/sessions/${session.id}/observations`).send(obs('08:00:00'))).status, 403);
  });
});

describe('observations (manual entry)', () => {
  test('derived minutes are computed and stored; group codes are generated', async () => {
    const { t, collector } = setup();
    const session = await createSession(t, collector);
    const res = await t.as(collector).post(`/api/sessions/${session.id}/observations`).send(obs('08:00:00', { flight_no: 'TU712', counter: 'L3' }));
    assert.equal(res.status, 201);
    const o = res.body.observation;
    assert.equal(o.wait_minutes, 10);
    assert.equal(o.processing_minutes, 2);
    assert.equal(o.total_minutes, 12);
    assert.equal(o.passenger_group_code, 'G001');
    assert.equal(o.import_batch_id, null);
    const second = await t.as(collector).post(`/api/sessions/${session.id}/observations`).send(obs('08:05:00'));
    assert.equal(second.body.observation.passenger_group_code, 'G002');
    const custom = await t.as(collector).post(`/api/sessions/${session.id}/observations`).send(obs('08:06:00', { passenger_group_code: 'FAM-7' }));
    assert.equal(custom.body.observation.passenger_group_code, 'FAM-7');
  });

  test('invalid rows are rejected with human-readable reasons', async () => {
    const { t, collector } = setup();
    const session = await createSession(t, collector);
    const url = `/api/sessions/${session.id}/observations`;
    const cases = [
      [obs('08:00:00', { pax: 7 }), /pax must be a whole number from 1 to 6/],
      [obs('08:00:00', { service_start: '2026-05-01T07:59:00' }), /service start is before arrival/],
      [obs('08:00:00', { service_end: '2026-05-01T08:09:00' }), /service end is before service start/],
      [obs('08:00:00', { service_end: '2026-05-01T14:01:00' }), /over 6 hours/],
      [obs('08:00:00', { arrival_time: 'yesterday' }), /not a valid date and time/],
      [{ pax: 1, service_start: '2026-05-01T08:00:00', service_end: '2026-05-01T08:01:00' }, /arrival_time is missing/],
      [obs('08:00:00', { arrival_time: '2026-05-03T08:00:00', service_start: '2026-05-03T08:01:00', service_end: '2026-05-03T08:02:00' }), /not the session date/],
    ];
    for (const [body, reason] of cases) {
      const res = await t.as(collector).post(url).send(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, 'invalid_observation');
      assert.match(res.body.error.details.map((d) => d.message).join(' | '), reason);
    }
    assert.equal((await t.as(collector).get(url)).body.total, 0);
  });

  test('shift is re-detected as observations change (pax-weighted)', async () => {
    const { t, collector } = setup();
    const session = await createSession(t, collector);
    const url = `/api/sessions/${session.id}/observations`;
    const first = (await t.as(collector).post(url).send(obs('12:00:00', { pax: 5 }))).body.observation;
    await t.as(collector).post(url).send(obs('14:00:00', { pax: 1 }));
    assert.equal((await t.as(collector).get(`/api/sessions/${session.id}`)).body.session.shift, 'morning');

    await t.as(collector).patch(`/api/observations/${first.id}`).send({ pax: 1 });
    assert.equal((await t.as(collector).get(`/api/sessions/${session.id}`)).body.session.shift, 'afternoon');

    await t.as(collector).delete(`/api/observations/${first.id}`);
    assert.equal((await t.as(collector).get(`/api/sessions/${session.id}`)).body.session.shift, 'afternoon');
  });

  test('a partial update re-validates the whole row', async () => {
    const { t, collector } = setup();
    const session = await createSession(t, collector);
    const created = (await t.as(collector).post(`/api/sessions/${session.id}/observations`).send(obs('08:00:00'))).body.observation;
    const bad = await t.as(collector).patch(`/api/observations/${created.id}`).send({ service_start: '2026-05-01T07:00:00' });
    assert.equal(bad.status, 400);
    const ok = await t.as(collector).patch(`/api/observations/${created.id}`).send({ service_end: '2026-05-01T08:20:00', counter: null });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.observation.processing_minutes, 10);
    assert.equal(ok.body.observation.total_minutes, 20);
  });

  test('session summary is pax-weighted and flags SLA breaches', async () => {
    const { t, collector } = setup();
    const session = await createSession(t, collector); // Security, SLA 10 min
    const url = `/api/sessions/${session.id}/observations`;
    // 6 pax wait 30 min, 1 + 1 pax wait 0 min: row avg 10 (no breach), pax-weighted 22.5 (breach).
    await t.as(collector).post(url).send({ pax: 6, arrival_time: '2026-05-01T08:00:00', service_start: '2026-05-01T08:30:00', service_end: '2026-05-01T08:35:00' });
    await t.as(collector).post(url).send({ pax: 1, arrival_time: '2026-05-01T08:40:00', service_start: '2026-05-01T08:40:00', service_end: '2026-05-01T08:42:00' });
    await t.as(collector).post(url).send({ pax: 1, arrival_time: '2026-05-01T08:50:00', service_start: '2026-05-01T08:50:00', service_end: '2026-05-01T08:52:00' });
    const s = (await t.as(collector).get(`/api/sessions/${session.id}`)).body.session;
    assert.equal(s.avg_wait_minutes, 22.5);
    assert.equal(s.sla_breached, true);
    assert.equal(s.pax_total, 8);
    assert.equal(s.group_count, 3);
    assert.equal(s.breach_pax, 6);
    assert.equal(s.breach_groups, 1);
  });

  test('observation list is paginated and ordered by arrival', async () => {
    const { t, collector } = setup();
    const session = await createSession(t, collector);
    const url = `/api/sessions/${session.id}/observations`;
    for (let i = 29; i >= 0; i -= 1) {
      await t.as(collector).post(url).send(obs(`09:${String(i).padStart(2, '0')}:00`.replace(/^09:(\d\d)/, (_, mm) => `09:${mm}`), { pax: 1 }));
    }
    const page = (await t.as(collector).get(`${url}?page=2&page_size=10`)).body;
    assert.equal(page.total, 30);
    assert.equal(page.total_pages, 3);
    assert.equal(page.items[0].arrival_time, '2026-05-01T09:10:00');
  });

  test('ownership applies to observations too', async () => {
    const { t, collector, other, admin } = setup();
    const session = await createSession(t, collector);
    const created = (await t.as(collector).post(`/api/sessions/${session.id}/observations`).send(obs('08:00:00'))).body.observation;
    assert.equal((await t.as(other).post(`/api/sessions/${session.id}/observations`).send(obs('08:01:00'))).status, 403);
    assert.equal((await t.as(other).patch(`/api/observations/${created.id}`).send({ pax: 1 })).status, 403);
    assert.equal((await t.as(other).delete(`/api/observations/${created.id}`)).status, 403);
    assert.equal((await t.as(admin).delete(`/api/observations/${created.id}`)).status, 204);
    assert.equal((await t.as(admin).delete(`/api/observations/${created.id}`)).status, 404);
  });
});
