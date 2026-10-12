'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('../helpers/testApp');

function setup() {
  const t = createTestApp();
  return { t, admin: t.createUser({ role: 'admin' }), collector: t.createUser({ role: 'collector' }) };
}

test('everyone signed in can list the seeded checkpoints', async () => {
  const { t, collector } = setup();
  const res = await t.as(collector).get('/api/checkpoints');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((c) => c.name), ['Check-in', 'Security', 'Passport Control', 'Boarding Gate']);
  assert.equal(res.body.items[0].active, true);
});

test('admin creates a checkpoint; checkpoint_created is audited', async () => {
  const { t, admin } = setup();
  const res = await t.as(admin).post('/api/checkpoints').send({ name: 'Fast Track', area: 'Departures', servers: 2, sla_wait_minutes: 5 });
  assert.equal(res.status, 201);
  assert.equal(res.body.checkpoint.servers, 2);
  const [entry] = t.repos.audit.listByAction('checkpoint_created');
  assert.equal(entry.target_id, res.body.checkpoint.id);
  assert.equal(entry.details.after.name, 'Fast Track');
});

test('names are unique regardless of case', async () => {
  const { t, admin } = setup();
  const res = await t.as(admin).post('/api/checkpoints').send({ name: 'security', sla_wait_minutes: 5 });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'checkpoint_name_taken');
});

test('validation: SLA must be > 0, servers ≥ 1, no unknown fields', async () => {
  const { t, admin } = setup();
  for (const body of [
    { name: 'A', sla_wait_minutes: 0 },
    { name: 'A', sla_wait_minutes: -3 },
    { name: 'A', sla_wait_minutes: 5, servers: 0 },
    { name: 'A', sla_wait_minutes: 5, servers: 1.5 },
    { name: 'A', sla_wait_minutes: 5, colour: 'red' },
    { sla_wait_minutes: 5 },
  ]) {
    const res = await t.as(admin).post('/api/checkpoints').send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, 'validation_error');
    assert.ok(Array.isArray(res.body.error.details));
  }
});

test('SLA change is audited with before and after values', async () => {
  const { t, admin } = setup();
  const res = await t.as(admin).patch('/api/checkpoints/2').send({ sla_wait_minutes: 12, area: 'Departures' });
  assert.equal(res.status, 200);
  assert.equal(res.body.checkpoint.sla_wait_minutes, 12);
  const [entry] = t.repos.audit.listByAction('checkpoint_updated');
  assert.deepEqual(entry.details, { changed: ['sla_wait_minutes'], before: { sla_wait_minutes: 10 }, after: { sla_wait_minutes: 12 } });
});

test('deactivating is an update; a no-op update writes no audit entry', async () => {
  const { t, admin } = setup();
  assert.equal((await t.as(admin).patch('/api/checkpoints/4').send({ active: false })).body.checkpoint.active, false);
  await t.as(admin).patch('/api/checkpoints/4').send({ active: false });
  assert.equal(t.repos.audit.listByAction('checkpoint_updated').length, 1);
  assert.equal((await t.as(admin).patch('/api/checkpoints/4').send({})).status, 400);
});

test('unknown checkpoint → 404; collectors cannot change checkpoints', async () => {
  const { t, admin, collector } = setup();
  assert.equal((await t.as(admin).patch('/api/checkpoints/999').send({ servers: 3 })).status, 404);
  assert.equal((await t.as(collector).patch('/api/checkpoints/1').send({ servers: 3 })).status, 403);
  assert.equal(t.repos.checkpoints.findById(1).servers, 8);
});
