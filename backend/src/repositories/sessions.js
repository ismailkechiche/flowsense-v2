'use strict';

const { paxWeightedAvgSql } = require('../domain/metrics');

const AVG_WAIT = paxWeightedAvgSql('o.wait_minutes');

// Per-session summary columns shared by the list and the detail query.
const SUMMARY_SELECT = `
  s.id, s.name, s.date, s.shift, s.checkpoint_id, c.name AS checkpoint_name,
  c.sla_wait_minutes, s.observer, s.notes, s.import_batch_id, s.created_by,
  u.name AS created_by_name, s.created_at,
  COUNT(o.id) AS group_count,
  COALESCE(SUM(o.pax), 0) AS pax_total,
  ${AVG_WAIT} AS avg_wait_minutes,
  COALESCE(SUM(CASE WHEN o.wait_minutes > c.sla_wait_minutes THEN o.pax END), 0) AS breach_pax,
  COUNT(CASE WHEN o.wait_minutes > c.sla_wait_minutes THEN 1 END) AS breach_groups`;

const SUMMARY_FROM = `
  FROM sessions s
  JOIN checkpoints c ON c.id = s.checkpoint_id
  JOIN users u ON u.id = s.created_by
  LEFT JOIN observations o ON o.session_id = s.id`;

/** Builds WHERE clauses for the session filters; values are bound params. */
function filterClause({ checkpointId, from, to, shift }) {
  const where = [];
  const params = {};
  if (checkpointId) { where.push('s.checkpoint_id = @checkpointId'); params.checkpointId = checkpointId; }
  if (from) { where.push('s.date >= @from'); params.from = from; }
  if (to) { where.push('s.date <= @to'); params.to = to; }
  if (shift) { where.push('s.shift = @shift'); params.shift = shift; }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function createSessionsRepository(db) {
  const insert = db.prepare(`INSERT INTO sessions (name, date, shift, checkpoint_id, observer, notes, import_batch_id, created_by)
    VALUES (@name, @date, @shift, @checkpoint_id, @observer, @notes, @import_batch_id, @created_by)`);
  const byId = db.prepare('SELECT * FROM sessions WHERE id = ?');
  const summaryById = db.prepare(`SELECT ${SUMMARY_SELECT} ${SUMMARY_FROM} WHERE s.id = ? GROUP BY s.id`);
  const setShift = db.prepare('UPDATE sessions SET shift = ? WHERE id = ?');
  const remove = db.prepare('DELETE FROM sessions WHERE id = ?');
  const byCheckpointAndDate = db.prepare(`SELECT s.id, s.name, s.created_by, s.import_batch_id, COUNT(o.id) AS group_count
    FROM sessions s LEFT JOIN observations o ON o.session_id = s.id
    WHERE s.checkpoint_id = ? AND s.date = ? GROUP BY s.id ORDER BY s.id`);
  const idsByImportBatch = db.prepare('SELECT id FROM sessions WHERE import_batch_id = ? ORDER BY id').pluck();

  return {
    insert(session) {
      const info = insert.run({ shift: null, observer: null, notes: null, import_batch_id: null, ...session });
      return Number(info.lastInsertRowid);
    },
    findById: (id) => byId.get(id),
    findSummaryById: (id) => summaryById.get(id),
    list(filters, { limit, offset }) {
      const { sql, params } = filterClause(filters);
      const total = db.prepare(`SELECT COUNT(*) FROM sessions s ${sql}`).pluck().get(params);
      const items = db.prepare(`SELECT ${SUMMARY_SELECT} ${SUMMARY_FROM} ${sql}
        GROUP BY s.id ORDER BY s.date DESC, s.id DESC LIMIT @limit OFFSET @offset`)
        .all({ ...params, limit, offset });
      return { items, total };
    },
    /** Updates the given editable fields (fixed column list). */
    update(id, fields) {
      const allowed = ['name', 'date', 'checkpoint_id', 'observer', 'notes'].filter((key) => key in fields);
      if (allowed.length === 0) return;
      const assignments = allowed.map((key) => `${key} = @${key}`).join(', ');
      db.prepare(`UPDATE sessions SET ${assignments} WHERE id = @id`).run({ ...fields, id });
    },
    setShift: (id, shift) => setShift.run(shift, id),
    remove: (id) => remove.run(id),
    listByCheckpointAndDate: (checkpointId, date) => byCheckpointAndDate.all(checkpointId, date),
    idsByImportBatch: (batchId) => idsByImportBatch.all(batchId),
  };
}

module.exports = { createSessionsRepository };
