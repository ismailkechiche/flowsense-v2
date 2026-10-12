'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, runMigrations } = require('../../src/db');

const MIGRATIONS = path.resolve(__dirname, '../../migrations');

test('migrations apply once, are recorded, and are idempotent', () => {
  const db = openDatabase(':memory:');
  const first = runMigrations(db, MIGRATIONS);
  assert.deepEqual(first, [1, 2]);
  assert.deepEqual(runMigrations(db, MIGRATIONS), []);
  const recorded = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all();
  assert.deepEqual(recorded, [{ version: 1, name: 'init' }, { version: 2, name: 'seed_checkpoints' }]);
});

test('the four standard checkpoints are seeded', () => {
  const db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS);
  const names = db.prepare('SELECT name FROM checkpoints ORDER BY id').pluck().all();
  assert.deepEqual(names, ['Check-in', 'Security', 'Passport Control', 'Boarding Gate']);
});

test('file databases use WAL mode and enforce foreign keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowsense-'));
  const db = openDatabase(path.join(dir, 'nested', 'test.db'));
  try {
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    runMigrations(db, MIGRATIONS);
    assert.throws(
      () => db.prepare("INSERT INTO sessions (name, date, checkpoint_id, created_by) VALUES ('x', '2026-01-01', 999, 999)").run(),
      /FOREIGN KEY constraint failed/,
    );
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a failing migration is rolled back and not recorded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowsense-mig-'));
  fs.writeFileSync(path.join(dir, '001_ok.sql'), 'CREATE TABLE a (id INTEGER);');
  fs.writeFileSync(path.join(dir, '002_bad.sql'), 'CREATE TABLE b (id INTEGER); SELECT * FROM missing_table;');
  const db = openDatabase(':memory:');
  try {
    assert.throws(() => runMigrations(db, dir), /no such table/);
    assert.deepEqual(db.prepare('SELECT version FROM schema_migrations').pluck().all(), [1]);
    assert.equal(db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE name = 'b'").pluck().get(), 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
