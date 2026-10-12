'use strict';

const { NOW_LOCAL } = require('./sql');

const parseJson = (row) => row && {
  ...row,
  column_mapping: JSON.parse(row.column_mapping),
  split_summary: JSON.parse(row.split_summary),
  session_ids: JSON.parse(row.session_ids),
};

function createImportBatchesRepository(db) {
  const insert = db.prepare(`INSERT INTO import_batches (filename, file_sha256, uploaded_by, column_mapping, row_count, rejected_row_count)
    VALUES (@filename, @file_sha256, @uploaded_by, @column_mapping, @row_count, @rejected_row_count)`);
  const byId = db.prepare(`SELECT b.*, u.name AS uploaded_by_name FROM import_batches b JOIN users u ON u.id = b.uploaded_by WHERE b.id = ?`);
  const committedBySha = db.prepare(`SELECT b.id, b.filename, b.created_at, u.name AS uploaded_by_name
    FROM import_batches b JOIN users u ON u.id = b.uploaded_by
    WHERE b.file_sha256 = ? AND b.status = 'committed' ORDER BY b.id DESC LIMIT 1`);
  const setResult = db.prepare('UPDATE import_batches SET session_ids = @session_ids, split_summary = @split_summary WHERE id = @id');
  const markRolledBack = db.prepare(`UPDATE import_batches SET status = 'rolled_back', rolled_back_by = @by, rolled_back_at = ${NOW_LOCAL} WHERE id = @id`);

  return {
    insert(batch) {
      const info = insert.run({ ...batch, column_mapping: JSON.stringify(batch.column_mapping) });
      return Number(info.lastInsertRowid);
    },
    findById: (id) => parseJson(byId.get(id)),
    findCommittedBySha: (sha) => committedBySha.get(sha),
    setResult: (id, { sessionIds, splitSummary }) => setResult.run({
      id, session_ids: JSON.stringify(sessionIds), split_summary: JSON.stringify(splitSummary),
    }),
    markRolledBack: (id, by) => markRolledBack.run({ id, by }),
    list({ limit, offset }) {
      const total = db.prepare('SELECT COUNT(*) FROM import_batches').pluck().get();
      const items = db.prepare(`SELECT b.*, u.name AS uploaded_by_name, r.name AS rolled_back_by_name
        FROM import_batches b JOIN users u ON u.id = b.uploaded_by LEFT JOIN users r ON r.id = b.rolled_back_by
        ORDER BY b.id DESC LIMIT ? OFFSET ?`).all(limit, offset).map(parseJson);
      return { items, total };
    },
  };
}

module.exports = { createImportBatchesRepository };
