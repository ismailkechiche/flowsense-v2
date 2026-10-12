'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('../helpers/testApp');

function setup() {
  const t = createTestApp();
  const admin = t.createUser({ role: 'admin', email: 'boss@example.com' });
  return { t, admin };
}

test('list users, filterable by status, without password hashes', async () => {
  const { t, admin } = setup();
  t.createUser({ status: 'pending' });
  t.createUser({ status: 'approved' });
  const all = await t.as(admin).get('/api/users');
  assert.equal(all.body.items.length, 3);
  assert.ok(all.body.items.every((u) => !('password_hash' in u)));
  const pending = await t.as(admin).get('/api/users?status=pending');
  assert.equal(pending.body.items.length, 1);
  assert.equal((await t.as(admin).get('/api/users?status=bogus')).status, 400);
});

test('approve sets role and writes user_approved in the audit log', async () => {
  const { t, admin } = setup();
  const pending = t.createUser({ role: 'collector', status: 'pending' });
  const res = await t.as(admin).post(`/api/users/${pending.id}/approve`).send({ role: 'analyst' });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.role, 'analyst');
  const [entry] = t.repos.audit.listByAction('user_approved');
  assert.equal(entry.actor_user_id, admin.id);
  assert.equal(entry.target_id, pending.id);
  assert.deepEqual(entry.details, { role: 'analyst', requested_role: 'collector', previous_status: 'pending' });
});

test('reject only works on pending accounts and is audited', async () => {
  const { t, admin } = setup();
  const pending = t.createUser({ status: 'pending' });
  assert.equal((await t.as(admin).post(`/api/users/${pending.id}/reject`).send()).status, 200);
  assert.equal((await t.as(admin).post(`/api/users/${pending.id}/reject`).send()).status, 409);
  assert.equal(t.repos.audit.listByAction('user_rejected').length, 1);
});

test('role change is audited with from/to', async () => {
  const { t, admin } = setup();
  const user = t.createUser({ role: 'collector' });
  await t.as(admin).patch(`/api/users/${user.id}/role`).send({ role: 'analyst' });
  const [entry] = t.repos.audit.listByAction('user_role_changed');
  assert.deepEqual(entry.details, { from: 'collector', to: 'analyst' });
});

test('disable and re-enable are audited', async () => {
  const { t, admin } = setup();
  const user = t.createUser();
  assert.equal((await t.as(admin).post(`/api/users/${user.id}/disable`).send()).body.user.status, 'disabled');
  assert.equal(t.repos.audit.listByAction('user_disabled').length, 1);
  assert.equal((await t.as(admin).post(`/api/users/${user.id}/enable`).send()).body.user.status, 'approved');
  const reenabled = t.repos.audit.listByAction('user_approved').at(-1);
  assert.equal(reenabled.details.reenabled, true);
});

test('an admin cannot disable or re-role themselves', async () => {
  const { t, admin } = setup();
  const disable = await t.as(admin).post(`/api/users/${admin.id}/disable`).send();
  assert.equal(disable.status, 400);
  assert.equal(disable.body.error.code, 'self_action');
  assert.equal((await t.as(admin).patch(`/api/users/${admin.id}/role`).send({ role: 'analyst' })).status, 400);
});

test('the last active admin cannot be removed', () => {
  const { t, admin } = setup();
  const other = t.createUser({ role: 'admin' });
  // Disabling one of two admins is fine; the remaining one is then the last.
  t.services.users.disable(admin, other.id);
  assert.throws(() => t.services.users.disable(other, admin.id), /last active administrator/);
});

test('unknown user ids give 404, bad ids give 400', async () => {
  const { t, admin } = setup();
  assert.equal((await t.as(admin).post('/api/users/424242/disable').send()).status, 404);
  assert.equal((await t.as(admin).post('/api/users/abc/disable').send()).status, 400);
});

test('audit entry and change are written together (rolled back as one)', () => {
  const { t, admin } = setup();
  const user = t.createUser();
  const originalInsert = t.repos.audit.insert;
  t.repos.audit.insert = () => { throw new Error('audit write failed'); };
  try {
    assert.throws(() => t.services.users.disable(admin, user.id), /audit write failed/);
  } finally {
    t.repos.audit.insert = originalInsert;
  }
  assert.equal(t.repos.users.findById(user.id).status, 'approved');
});
