'use strict';

function createAuditRepository(db) {
  const insert = db.prepare(`INSERT INTO audit_log (actor_user_id, action, target_type, target_id, details)
    VALUES (@actor_user_id, @action, @target_type, @target_id, @details)`);

  return {
    insert(entry) {
      const info = insert.run({
        actor_user_id: entry.actorUserId ?? null,
        action: entry.action,
        target_type: entry.targetType ?? null,
        target_id: entry.targetId ?? null,
        details: JSON.stringify(entry.details ?? {}),
      });
      return Number(info.lastInsertRowid);
    },
    /** Used by tests and, from Phase 6, by the audit screen. */
    listByAction(action) {
      return db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id').all(action)
        .map((row) => ({ ...row, details: JSON.parse(row.details) }));
    },
  };
}

module.exports = { createAuditRepository };
