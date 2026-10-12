'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTestApp } = require('../helpers/testApp');
const { AUDIT_ACTIONS } = require('../../src/domain/auditActions');

const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', name));

/** Entries for one action through the admin API. */
async function entries(t, admin, action) {
  const res = await t.as(admin).get(`/api/audit?action=${action}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.items;
}

describe('every audited action (spec §12.2) is written and listed', () => {
  test('user, checkpoint, session, import and backup actions', async () => {
    const t = createTestApp();
    const admin = t.createUser({ role: 'admin', name: 'Ada Admin' });
    const collector = t.createUser({ role: 'collector' });

    // Users.
    const pendingA = t.createUser({ status: 'pending' });
    const pendingB = t.createUser({ status: 'pending' });
    assert.equal((await t.as(admin).post(`/api/users/${pendingA.id}/approve`).send({ role: 'analyst' })).status, 200);
    assert.equal((await t.as(admin).post(`/api/users/${pendingB.id}/reject`).send({})).status, 200);
    assert.equal((await t.as(admin).patch(`/api/users/${pendingA.id}/role`).send({ role: 'collector' })).status, 200);
    assert.equal((await t.as(admin).post(`/api/users/${pendingA.id}/disable`).send({})).status, 200);

    // Checkpoints.
    const created = await t.as(admin).post('/api/checkpoints').send({ name: 'Transfer', sla_wait_minutes: 12, servers: 2 });
    assert.equal(created.status, 201);
    const cpId = created.body.checkpoint.id;
    assert.equal((await t.as(admin).patch(`/api/checkpoints/${cpId}`).send({ sla_wait_minutes: 8 })).status, 200);

    // Sessions.
    const session = (await t.as(collector).post('/api/sessions').send({ name: 'To delete', date: '2026-05-01', checkpoint_id: 2 })).body.session;
    assert.equal((await t.as(admin).delete(`/api/sessions/${session.id}`)).status, 204);

    // Imports.
    const preview = await t.as(collector).post('/api/imports/preview?filename=two-checkpoints-one-date.xlsx')
      .set('Content-Type', 'application/octet-stream').send(fixture('two-checkpoints-one-date.xlsx'));
    assert.equal(preview.status, 201, JSON.stringify(preview.body));
    const batch = (await t.as(collector).post(`/api/imports/previews/${preview.body.preview.preview_id}/commit`).send({})).body.batch;
    assert.ok(batch?.id);
    assert.equal((await t.as(admin).post(`/api/imports/${batch.id}/rollback`).send({})).status, 200);

    // Backups: one that works, then one that fails because BACKUP_DIR is a file.
    assert.equal((await t.as(admin).post('/api/admin/backups').send({})).status, 201);
    fs.rmSync(t.config.backupDir, { recursive: true });
    fs.writeFileSync(t.config.backupDir, 'not a directory');
    assert.equal((await t.as(admin).post('/api/admin/backups').send({})).status, 500);

    const expected = {
      [AUDIT_ACTIONS.USER_APPROVED]: (e) => e.target_type === 'user' && e.target_id === pendingA.id,
      [AUDIT_ACTIONS.USER_REJECTED]: (e) => e.target_id === pendingB.id,
      [AUDIT_ACTIONS.USER_ROLE_CHANGED]: (e) => e.target_id === pendingA.id,
      [AUDIT_ACTIONS.USER_DISABLED]: (e) => e.target_id === pendingA.id,
      [AUDIT_ACTIONS.CHECKPOINT_CREATED]: (e) => e.target_type === 'checkpoint' && e.target_id === cpId,
      [AUDIT_ACTIONS.CHECKPOINT_UPDATED]: (e) => e.details.before.sla_wait_minutes === 12 && e.details.after.sla_wait_minutes === 8,
      [AUDIT_ACTIONS.SESSION_DELETED]: (e) => e.target_type === 'session' && e.target_id === session.id,
      [AUDIT_ACTIONS.IMPORT_COMMITTED]: (e) => e.target_type === 'import_batch' && e.target_id === batch.id,
      [AUDIT_ACTIONS.IMPORT_ROLLED_BACK]: (e) => e.target_id === batch.id,
      [AUDIT_ACTIONS.BACKUP_CREATED]: (e) => e.target_type === 'backup' && e.details.trigger === 'manual',
      [AUDIT_ACTIONS.BACKUP_FAILED]: (e) => e.details.trigger === 'manual' && typeof e.details.error === 'string',
    };
    assert.deepEqual(Object.keys(expected).sort(), Object.values(AUDIT_ACTIONS).sort(), 'the test covers every action');

    for (const [action, matches] of Object.entries(expected)) {
      const items = await entries(t, admin, action);
      assert.equal(items.length, 1, `${action}: one entry`);
      const [entry] = items;
      assert.equal(entry.action, action);
      assert.ok(matches(entry), `${action}: ${JSON.stringify(entry)}`);
      const actor = action === AUDIT_ACTIONS.IMPORT_COMMITTED ? collector : admin;
      assert.equal(entry.actor_user_id, actor.id, `${action}: actor`);
      assert.equal(typeof entry.created_at, 'string');
    }
    const adminEntry = (await entries(t, admin, AUDIT_ACTIONS.USER_APPROVED))[0];
    assert.equal(adminEntry.actor_name, 'Ada Admin');
    assert.equal(adminEntry.actor_email, admin.email);
    assert.equal(adminEntry.target_name, pendingA.name);
    assert.equal((await entries(t, admin, AUDIT_ACTIONS.CHECKPOINT_UPDATED))[0].target_name, 'Transfer');
    assert.equal((await entries(t, admin, AUDIT_ACTIONS.SESSION_DELETED))[0].target_name, 'To delete');
    assert.equal((await entries(t, admin, AUDIT_ACTIONS.IMPORT_ROLLED_BACK))[0].target_name, 'two-checkpoints-one-date.xlsx');
    assert.match((await entries(t, admin, AUDIT_ACTIONS.BACKUP_CREATED))[0].target_name, /^flowsense-\d{4}-\d{2}-\d{2}-\d{4}\.db$/);
  });

  test('the actions endpoint lists every action', async () => {
    const t = createTestApp();
    const admin = t.createUser({ role: 'admin' });
    const res = await t.as(admin).get('/api/audit/actions');
    assert.deepEqual(res.body.items, Object.values(AUDIT_ACTIONS));
  });
});

describe('audit writes share the action transaction', () => {
  test('a failing audit insert rolls the action back', async () => {
    const t = createTestApp();
    const admin = t.createUser({ role: 'admin' });
    const insert = t.repos.audit.insert;
    t.repos.audit.insert = () => { throw new Error('audit unavailable'); };
    try {
      const before = t.db.prepare('SELECT COUNT(*) FROM checkpoints').pluck().get();
      const res = await t.as(admin).post('/api/checkpoints').send({ name: 'Ghost', sla_wait_minutes: 10 });
      assert.equal(res.status, 500);
      assert.equal(t.db.prepare('SELECT COUNT(*) FROM checkpoints').pluck().get(), before);

      const pending = t.createUser({ status: 'pending' });
      assert.equal((await t.as(admin).post(`/api/users/${pending.id}/approve`).send({ role: 'analyst' })).status, 500);
      assert.equal(t.repos.users.findById(pending.id).status, 'pending');
    } finally {
      t.repos.audit.insert = insert;
    }
  });
});

describe('GET /api/audit', () => {
  function seeded() {
    const t = createTestApp();
    const admin = t.createUser({ role: 'admin' });
    const add = (action, createdAt) => {
      const id = t.repos.audit.insert({ actorUserId: admin.id, action, targetType: 'user', targetId: 1 });
      t.db.prepare('UPDATE audit_log SET created_at = ? WHERE id = ?').run(createdAt, id);
      return id;
    };
    const ids = [];
    for (let day = 1; day <= 30; day += 1) {
      const date = `2026-04-${String(day).padStart(2, '0')}`;
      ids.push(add(day % 3 === 0 ? AUDIT_ACTIONS.USER_DISABLED : AUDIT_ACTIONS.USER_APPROVED, `${date}T23:59:59`));
    }
    return { t, admin, ids };
  }

  test('newest first, paginated', async () => {
    const { t, admin, ids } = seeded();
    const first = (await t.as(admin).get('/api/audit?page_size=10')).body;
    assert.equal(first.total, 30);
    assert.equal(first.total_pages, 3);
    assert.deepEqual(first.items.map((e) => e.id), ids.slice(-10).reverse());
    const last = (await t.as(admin).get('/api/audit?page_size=10&page=3')).body;
    assert.deepEqual(last.items.map((e) => e.id), ids.slice(0, 10).reverse());
    assert.equal((await t.as(admin).get('/api/audit?page=4&page_size=10')).body.items.length, 0);
  });

  test('filters by action and by inclusive local date range', async () => {
    const { t, admin } = seeded();
    const disabled = (await t.as(admin).get(`/api/audit?action=${AUDIT_ACTIONS.USER_DISABLED}`)).body;
    assert.equal(disabled.total, 10);
    assert.ok(disabled.items.every((e) => e.action === AUDIT_ACTIONS.USER_DISABLED));

    const range = (await t.as(admin).get('/api/audit?from=2026-04-10&to=2026-04-12')).body;
    assert.deepEqual(range.items.map((e) => e.created_at.slice(0, 10)), ['2026-04-12', '2026-04-11', '2026-04-10']);

    const both = (await t.as(admin).get(`/api/audit?from=2026-04-10&to=2026-04-12&action=${AUDIT_ACTIONS.USER_DISABLED}`)).body;
    assert.deepEqual(both.items.map((e) => e.created_at.slice(0, 10)), ['2026-04-12']);
  });

  test('rejects unknown actions, bad dates and from after to', async () => {
    const { t, admin } = seeded();
    for (const query of ['action=user_deleted', 'from=12/04/2026', 'from=2026-04-12&to=2026-04-10', 'page=0']) {
      const res = await t.as(admin).get(`/api/audit?${query}`);
      assert.equal(res.status, 400, query);
      assert.equal(res.body.error.code, 'validation_error', query);
    }
  });

  test('the log cannot be changed or deleted over HTTP', async () => {
    const { t, admin, ids } = seeded();
    for (const method of ['put', 'patch', 'delete']) {
      assert.equal((await t.as(admin)[method](`/api/audit/${ids[0]}`).send({ action: 'x' })).status, 404, method);
      assert.equal((await t.as(admin)[method]('/api/audit').send({})).status, 404, method);
    }
    assert.equal((await t.as(admin).post('/api/audit').send({ action: 'user_approved' })).status, 404);
    assert.equal(t.db.prepare('SELECT COUNT(*) FROM audit_log').pluck().get(), 30);
  });

  test('non-admins are refused', async () => {
    const { t } = seeded();
    for (const role of ['collector', 'analyst']) {
      assert.equal((await t.as(t.createUser({ role })).get('/api/audit')).status, 403, role);
    }
    assert.equal((await t.as(null).get('/api/audit')).status, 401);
  });
});
