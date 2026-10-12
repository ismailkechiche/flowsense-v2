'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { AUDIT_ACTIONS } = require('../domain/auditActions');
const { AppError } = require('../domain/errors');

// flowsense-YYYY-MM-DD-HHmm.db, plus -2, -3… for a second backup in the same minute.
const BACKUP_NAME = /^flowsense-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(?:-(\d+))?\.db$/;

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
const localTime = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** Sort key: the timestamp in the name, then the same-minute counter. */
function order(name) {
  const m = BACKUP_NAME.exec(name);
  return `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}-${String(Number(m[6] ?? 1)).padStart(6, '0')}`;
}

/**
 * Database backups (spec §12.3), always through SQLite's online backup API
 * (`db.backup()`): a plain file copy can catch a WAL-mode database halfway
 * through a checkpoint and produce a broken file.
 *
 * Backups are written next to each other in BACKUP_DIR and are never
 * served over HTTP; the API only lists names, sizes and dates.
 */
function createBackupService({ db, repos, config, logger, now = () => new Date() }) {
  const dir = config.backupDir;
  let running = null;

  function list() {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    return names.filter((name) => BACKUP_NAME.test(name))
      .sort((a, b) => (order(a) < order(b) ? 1 : -1)) // newest first
      .map((name) => {
        const stat = fs.statSync(path.join(dir, name));
        return { name, size_bytes: stat.size, created_at: localTime(stat.mtime) };
      });
  }

  /** Deletes the oldest backups beyond BACKUP_RETENTION_COUNT. Returns the deleted names. */
  function prune() {
    const excess = list().slice(config.backupRetentionCount);
    for (const { name } of excess) fs.rmSync(path.join(dir, name), { force: true });
    return excess.map((b) => b.name);
  }

  function freeName(date) {
    const base = `flowsense-${stamp(date)}`;
    for (let n = 1; ; n += 1) {
      const name = n === 1 ? `${base}.db` : `${base}-${n}.db`;
      if (!fs.existsSync(path.join(dir, name)) && !fs.existsSync(path.join(dir, `${name}.partial`))) return name;
    }
  }

  /**
   * Makes one backup, then applies retention. `actor` is the admin who
   * asked, or null for the scheduled backup. Success and failure are both
   * audit-logged. Throws a 500 AppError on failure so a manual request can
   * report it; the scheduler catches it.
   */
  async function create(actor, trigger) {
    // One backup at a time: a second request waits for the running one.
    while (running) await running.catch(() => {});
    const job = (async () => {
      const started = Date.now();
      let name;
      try {
        fs.mkdirSync(dir, { recursive: true });
        name = freeName(now());
        const partial = path.join(dir, `${name}.partial`);
        // Write under a temporary name so a half-written file is never listed
        // or kept by retention, then move it into place.
        await db.backup(partial);
        fs.renameSync(partial, path.join(dir, name));
        const { size } = fs.statSync(path.join(dir, name));
        const pruned = prune();
        repos.audit.insert({
          actorUserId: actor?.id ?? null, action: AUDIT_ACTIONS.BACKUP_CREATED, targetType: 'backup',
          details: { file: name, size_bytes: size, trigger, duration_ms: Date.now() - started, pruned },
        });
        logger.info(`Backup created: ${name} (${size} bytes, ${trigger})${pruned.length ? `; pruned ${pruned.join(', ')}` : ''}`);
        return { name, size_bytes: size, pruned };
      } catch (err) {
        if (name) fs.rmSync(path.join(dir, `${name}.partial`), { force: true });
        logger.error(`Backup failed (${trigger})`, err);
        try {
          repos.audit.insert({
            actorUserId: actor?.id ?? null, action: AUDIT_ACTIONS.BACKUP_FAILED, targetType: 'backup',
            details: { trigger, error: err.message },
          });
        } catch (auditErr) {
          logger.error('Could not audit-log the failed backup', auditErr);
        }
        throw new AppError(500, 'backup_failed', 'The backup failed. The reason is in the audit log and the server log.');
      }
    })();
    running = job;
    try {
      return await job;
    } finally {
      running = null;
    }
  }

  return { create, list, prune, directory: dir };
}

module.exports = { createBackupService, BACKUP_NAME };
