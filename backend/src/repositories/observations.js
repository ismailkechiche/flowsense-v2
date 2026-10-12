'use strict';

const COLUMNS = `id, session_id, import_batch_id, passenger_group_code, pax, flight_no, counter,
  arrival_time, service_start, service_end, wait_minutes, processing_minutes, total_minutes, created_at`;
const EDITABLE = ['passenger_group_code', 'pax', 'flight_no', 'counter', 'arrival_time', 'service_start',
  'service_end', 'wait_minutes', 'processing_minutes', 'total_minutes'];

function createObservationsRepository(db) {
  const insert = db.prepare(`INSERT INTO observations (session_id, import_batch_id, passenger_group_code, pax,
      flight_no, counter, arrival_time, service_start, service_end, wait_minutes, processing_minutes, total_minutes)
    VALUES (@session_id, @import_batch_id, @passenger_group_code, @pax, @flight_no, @counter, @arrival_time,
      @service_start, @service_end, @wait_minutes, @processing_minutes, @total_minutes)`);
  const byId = db.prepare(`SELECT ${COLUMNS} FROM observations WHERE id = ?`);
  const countBySession = db.prepare('SELECT COUNT(*) FROM observations WHERE session_id = ?').pluck();
  const pageBySession = db.prepare(`SELECT ${COLUMNS} FROM observations WHERE session_id = ?
    ORDER BY arrival_time, id LIMIT ? OFFSET ?`);
  const arrivals = db.prepare('SELECT arrival_time, pax FROM observations WHERE session_id = ?');
  const arrivalRange = db.prepare('SELECT MIN(arrival_time) AS first, MAX(arrival_time) AS last FROM observations WHERE session_id = ?');
  const maxGroupNumber = db.prepare(`SELECT MAX(CAST(substr(passenger_group_code, 2) AS INTEGER))
    FROM observations WHERE session_id = ? AND passenger_group_code GLOB 'G[0-9]*'`).pluck();
  const remove = db.prepare('DELETE FROM observations WHERE id = ?');
  // Rows in a batch's own sessions that the batch did not create (added by
  // hand or by a later import): an import rollback must list these first.
  const addedToBatchSessions = db.prepare(`SELECT o.id, o.session_id, s.name AS session_name, o.passenger_group_code,
      o.pax, o.arrival_time, o.import_batch_id
    FROM observations o JOIN sessions s ON s.id = o.session_id
    WHERE s.import_batch_id = @batch AND (o.import_batch_id IS NULL OR o.import_batch_id != @batch)
    ORDER BY o.session_id, o.arrival_time, o.id`);
  const countByBatch = db.prepare('SELECT COUNT(*) FROM observations WHERE import_batch_id = ?').pluck();
  const foreignSessionsOfBatch = db.prepare(`SELECT DISTINCT o.session_id FROM observations o JOIN sessions s ON s.id = o.session_id
    WHERE o.import_batch_id = @batch AND (s.import_batch_id IS NULL OR s.import_batch_id != @batch)`).pluck();
  const deleteByBatch = db.prepare('DELETE FROM observations WHERE import_batch_id = ?');

  return {
    insert(observation) {
      const info = insert.run({ import_batch_id: null, flight_no: null, counter: null, ...observation });
      return Number(info.lastInsertRowid);
    },
    findById: (id) => byId.get(id),
    listBySession(sessionId, { limit, offset }) {
      return { items: pageBySession.all(sessionId, limit, offset), total: countBySession.get(sessionId) };
    },
    arrivalsForSession: (sessionId) => arrivals.all(sessionId),
    arrivalRange: (sessionId) => arrivalRange.get(sessionId),
    nextGroupCode(sessionId) {
      const next = (maxGroupNumber.get(sessionId) ?? 0) + 1;
      return `G${String(next).padStart(3, '0')}`;
    },
    update(id, fields) {
      const keys = EDITABLE.filter((key) => key in fields);
      if (keys.length === 0) return;
      db.prepare(`UPDATE observations SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({ ...fields, id });
    },
    remove: (id) => remove.run(id),
    addedToBatchSessions: (batchId) => addedToBatchSessions.all({ batch: batchId }),
    countByBatch: (batchId) => countByBatch.get(batchId),
    foreignSessionsOfBatch: (batchId) => foreignSessionsOfBatch.all({ batch: batchId }),
    deleteByBatch: (batchId) => deleteByBatch.run(batchId).changes,
  };
}

module.exports = { createObservationsRepository };
