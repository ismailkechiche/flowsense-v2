'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const MIGRATION_FILE = /^(\d+)_([\w-]+)\.sql$/;

/** Opens the database with WAL mode, foreign keys and a busy timeout. */
function openDatabase(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

/**
 * Applies every numbered migration in `dir` that is not yet recorded in
 * `schema_migrations`, in order, each in its own transaction.
 * Returns the list of versions applied by this call.
 */
function runMigrations(db, dir) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime'))
  )`);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').pluck().all());
  const files = fs.readdirSync(dir)
    .map((file) => ({ file, match: MIGRATION_FILE.exec(file) }))
    .filter(({ match }) => match)
    .map(({ file, match }) => ({ file, version: Number(match[1]), name: match[2] }))
    .sort((a, b) => a.version - b.version);

  const seen = new Set();
  for (const { file, version } of files) {
    if (seen.has(version)) throw new Error(`Duplicate migration version ${version} (${file})`);
    seen.add(version);
  }

  const record = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)');
  const newlyApplied = [];
  for (const { file, version, name } of files) {
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      record.run(version, name);
    })();
    newlyApplied.push(version);
  }
  return newlyApplied;
}

module.exports = { openDatabase, runMigrations };
