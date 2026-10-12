'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createTestApp } = require('../helpers/testApp');
const { createBackupService } = require('../../src/services/backupService');
const { startBackupScheduler } = require('../../src/jobs/backupScheduler');
const { createLogger } = require('../../src/logger');

const tempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const quiet = createLogger('silent');

/** A test app on a real WAL-mode database file, like production. */
function fileApp(env = {}) {
  const dir = tempDir('flowsense-db-');
  return createTestApp({ env: { DB_PATH: path.join(dir, 'flowsense.db'), ...env } });
}

describe('backups', () => {
  test('manual backup uses the online backup API and produces a consistent copy', async () => {
    const t = fileApp();
    assert.equal(t.db.pragma('journal_mode', { simple: true }), 'wal');
    const admin = t.createUser({ role: 'admin', name: 'Backup Admin' });
    t.services.sessions.create(admin, { name: 'Before backup', date: '2026-05-01', checkpoint_id: 2 });

    let onlineApiCalls = 0;
    const original = t.db.backup.bind(t.db);
    t.db.backup = (...args) => { onlineApiCalls += 1; return original(...args); };

    const res = await t.as(admin).post('/api/admin/backups').send({});
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(onlineApiCalls, 1);
    assert.match(res.body.backup.name, /^flowsense-\d{4}-\d{2}-\d{2}-\d{4}\.db$/);
    const file = path.join(t.config.backupDir, res.body.backup.name);
    assert.ok(fs.existsSync(file));
    assert.equal(fs.statSync(file).size, res.body.backup.size_bytes);

    const copy = new Database(file, { readonly: true });
    assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(copy.prepare("SELECT name FROM sessions").pluck().get(), 'Before backup');
    assert.equal(copy.prepare('SELECT COUNT(*) FROM users').pluck().get(), t.db.prepare('SELECT COUNT(*) FROM users').pluck().get());
    copy.close();

    const [entry] = t.repos.audit.listByAction('backup_created');
    assert.equal(entry.actor_user_id, admin.id);
    assert.equal(entry.details.file, res.body.backup.name);
    assert.equal(entry.details.trigger, 'manual');

    const list = await t.as(admin).get('/api/admin/backups');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.items.map((b) => b.name), [res.body.backup.name]);
    assert.equal(list.body.retention_count, 30);
  });

  test('backups are not downloadable over HTTP', async () => {
    const t = fileApp();
    const admin = t.createUser({ role: 'admin' });
    const { body } = await t.as(admin).post('/api/admin/backups').send({});
    for (const url of [`/api/admin/backups/${body.backup.name}`, `/backups/${body.backup.name}`, `/${body.backup.name}`]) {
      const res = await t.as(admin).get(url);
      assert.notEqual(res.status, 200, url);
      assert.ok(!Buffer.isBuffer(res.body) || !res.body.subarray(0, 15).toString().startsWith('SQLite format'), url);
    }
    // The list shows names, sizes and dates only.
    const list = await t.as(admin).get('/api/admin/backups');
    assert.deepEqual(Object.keys(list.body.items[0]).sort(), ['created_at', 'name', 'size_bytes']);
  });

  test('file names use local time to the minute; a second backup in the same minute gets -2', async () => {
    const t = fileApp();
    const fixed = new Date(2026, 4, 1, 9, 5, 30); // local time 2026-05-01 09:05
    const backups = createBackupService({ db: t.db, repos: t.repos, config: t.config, logger: quiet, now: () => fixed });
    assert.equal((await backups.create(null, 'manual')).name, 'flowsense-2026-05-01-0905.db');
    assert.equal((await backups.create(null, 'manual')).name, 'flowsense-2026-05-01-0905-2.db');
    assert.deepEqual(backups.list().map((b) => b.name), ['flowsense-2026-05-01-0905-2.db', 'flowsense-2026-05-01-0905.db']);
  });

  test('retention keeps the newest BACKUP_RETENTION_COUNT files and deletes older ones', async () => {
    const t = fileApp({ BACKUP_RETENTION_COUNT: '3' });
    let minute = 0;
    const backups = createBackupService({ db: t.db, repos: t.repos, config: t.config, logger: quiet, now: () => new Date(2026, 4, 1, 10, minute++) });
    fs.mkdirSync(t.config.backupDir, { recursive: true });
    fs.writeFileSync(path.join(t.config.backupDir, 'notes.txt'), 'not a backup'); // other files are left alone
    for (let i = 0; i < 5; i += 1) await backups.create(null, 'scheduled');
    assert.deepEqual(backups.list().map((b) => b.name),
      ['flowsense-2026-05-01-1004.db', 'flowsense-2026-05-01-1003.db', 'flowsense-2026-05-01-1002.db']);
    assert.ok(fs.existsSync(path.join(t.config.backupDir, 'notes.txt')));
    const audits = t.repos.audit.listByAction('backup_created');
    assert.equal(audits.length, 5);
    assert.deepEqual(audits[3].details.pruned, ['flowsense-2026-05-01-1000.db']);
    assert.equal(audits[0].actor_user_id, null); // scheduled: system action
  });

  test('a failed backup is logged and audit-logged, returns 500, and the server keeps working', async () => {
    const blocker = path.join(tempDir('flowsense-'), 'not-a-directory');
    fs.writeFileSync(blocker, 'x');
    const t = fileApp({ BACKUP_DIR: blocker, LOG_LEVEL: 'silent' });
    const admin = t.createUser({ role: 'admin' });
    const res = await t.as(admin).post('/api/admin/backups').send({});
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, 'backup_failed');
    assert.ok(!/at .*\.js:\d+/.test(JSON.stringify(res.body)), 'no stack trace in the response');
    const [entry] = t.repos.audit.listByAction('backup_failed');
    assert.equal(entry.actor_user_id, admin.id);
    assert.equal(entry.details.trigger, 'manual');
    assert.ok(entry.details.error);
    assert.equal((await t.as(admin).get('/api/auth/me')).status, 200);
  });

  test('the scheduler backs up at start, survives failures and can be stopped', async () => {
    const t = fileApp();
    const scheduler = startBackupScheduler({ backups: t.services.backups, intervalHours: 24, logger: quiet });
    await scheduler.first;
    scheduler.stop();
    assert.equal(t.services.backups.list().length, 1);
    assert.equal(t.repos.audit.listByAction('backup_created')[0].details.trigger, 'scheduled');

    const failing = { create: async () => { throw new Error('disk full'); } };
    const s2 = startBackupScheduler({ backups: failing, intervalHours: 24, logger: quiet });
    await assert.doesNotReject(s2.first);
    s2.stop();
  });
});
