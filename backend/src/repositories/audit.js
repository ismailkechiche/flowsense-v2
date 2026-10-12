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
    /**
     * Newest first, with the actor's name and a readable target name (the
     * current name for users and checkpoints; the name recorded in the
     * details for things that may since have been deleted). Filters: action, and from/to on
     * the entry's local date (inclusive). Values are bound parameters.
     */
    list({ action, from, to }, { limit, offset }) {
      const where = [];
      const params = {};
      if (action) { where.push('a.action = @action'); params.action = action; }
      if (from) { where.push('substr(a.created_at, 1, 10) >= @from'); params.from = from; }
      if (to) { where.push('substr(a.created_at, 1, 10) <= @to'); params.to = to; }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = db.prepare(`SELECT COUNT(*) FROM audit_log a ${clause}`).pluck().get(params);
      const items = db.prepare(`SELECT a.id, a.created_at, a.action, a.target_type, a.target_id, a.details,
          a.actor_user_id, u.name AS actor_name, u.email AS actor_email,
          CASE a.target_type
            WHEN 'user' THEN tu.name
            WHEN 'checkpoint' THEN tc.name
            WHEN 'import_batch' THEN json_extract(a.details, '$.filename')
            WHEN 'session' THEN json_extract(a.details, '$.name')
            WHEN 'backup' THEN json_extract(a.details, '$.file')
          END AS target_name
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.actor_user_id
        LEFT JOIN users tu ON a.target_type = 'user' AND tu.id = a.target_id
        LEFT JOIN checkpoints tc ON a.target_type = 'checkpoint' AND tc.id = a.target_id
        ${clause} ORDER BY a.id DESC LIMIT @limit OFFSET @offset`).all({ ...params, limit, offset })
        .map((row) => ({ ...row, details: JSON.parse(row.details) }));
      return { items, total };
    },
    /** All entries for one action, oldest first (tests). */
    listByAction(action) {
      return db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY id').all(action)
        .map((row) => ({ ...row, details: JSON.parse(row.details) }));
    },
  };
}

module.exports = { createAuditRepository };
