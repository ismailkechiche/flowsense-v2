'use strict';

const crypto = require('node:crypto');
const { badRequest, notFound, conflict } = require('../domain/errors');
const { AUDIT_ACTIONS } = require('../domain/auditActions');
const { matchHeaders, normalizeHeader, REQUIRED_FIELDS, TARGET_FIELDS } = require('../domain/headerMatch');
const { matchCheckpointValue, resolveRows, splitIntoGroups } = require('../domain/importRows');
const { pageWindow, pageResult } = require('../domain/pagination');
const { parseSpreadsheet } = require('./importParser');

const MIDNIGHT_RULE = 'When a cell holds only a time (no date) and it is earlier than the previous time on the same row, '
  + 'it is taken as the next day (the row crossed midnight).';

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

/**
 * Excel import (spec §7): upload → parse → preview (nothing written) →
 * user confirms → one transaction. The client only ever sends a preview id
 * and its choices; every row is recomputed on the server from the stored
 * upload, so nothing can be tampered with between preview and commit.
 */
function createImportService({ db, repos, sessionService, previewStore }) {
  /** Applies the user's choices to a stored upload and computes everything shown in the preview. */
  function compute(state, choices, actor) {
    choices = choices ?? {};
    const sheetIndex = choices.sheet ?? state.defaultSheet;
    const sheet = state.sheets[sheetIndex];
    if (!sheet || sheet.headerRowIndex === -1) {
      throw badRequest('That sheet has no header row', [{ location: 'body', field: 'sheet', message: 'has no data' }]);
    }

    // Mapping: automatic per sheet, then the user's overrides on top.
    const auto = matchHeaders(sheet.headers).mapping;
    const mapping = {};
    for (const field of TARGET_FIELDS) {
      if (choices.mapping && field in choices.mapping) {
        const index = choices.mapping[field];
        mapping[field] = index === null ? null : { index, header: sheet.headers[index], confidence: 1, method: 'manual' };
      } else {
        mapping[field] = auto[field];
      }
    }
    const used = new Map();
    for (const [field, m] of Object.entries(mapping)) {
      if (!m) continue;
      if (m.index >= sheet.headers.length) throw badRequest(`Column ${m.index + 1} does not exist`, [{ location: 'body', field: `mapping.${field}`, message: 'is out of range' }]);
      if (used.has(m.index)) throw badRequest(`Column "${m.header}" is mapped to both ${used.get(m.index)} and ${field}`, [{ location: 'body', field: `mapping.${field}`, message: 'column used twice' }]);
      used.set(m.index, field);
    }

    const activeCheckpoints = repos.checkpoints.list().filter((c) => c.active);
    const byId = new Map(activeCheckpoints.map((c) => [c.id, c]));
    let fileCheckpointId = choices.file_checkpoint_id ?? null;
    if (fileCheckpointId !== null && !byId.has(fileCheckpointId)) {
      throw badRequest('Unknown or inactive checkpoint', [{ location: 'body', field: 'file_checkpoint_id', message: 'is not an active checkpoint' }]);
    }
    if (mapping.checkpoint) fileCheckpointId = null;

    const overrides = {};
    for (const [raw, id] of Object.entries(choices.checkpoint_values ?? {})) {
      if (!byId.has(id)) throw badRequest(`Checkpoint mapping for "${raw}" points to an unknown or inactive checkpoint`);
      overrides[normalizeHeader(raw)] = id;
    }
    const checkpointFor = (raw) => overrides[normalizeHeader(raw)] ?? matchCheckpointValue(raw, activeCheckpoints);

    const columnIndexes = Object.fromEntries(Object.entries(mapping).map(([field, m]) => [field, m ? m.index : null]));
    const { accepted, rejected, midnightCrossings } = resolveRows(sheet.rows, {
      mapping: columnIndexes, checkpointFor, fileCheckpointId,
    }, sheet.headerRowIndex + 2);

    // Checkpoint values that matched nothing, so the user can map them.
    const unknownCheckpointValues = [...new Set(rejected
      .filter((r) => r.checkpoint_value && !checkpointFor(r.checkpoint_value))
      .map((r) => r.checkpoint_value))];

    const groups = splitIntoGroups(accepted).map((group) => {
      const checkpoint = byId.get(group.checkpoint_id);
      return {
        ...group,
        checkpoint_name: checkpoint.name,
        proposed_name: `${checkpoint.name} — ${group.date}`,
        // Every new preview defaults every group to a new session; nothing is remembered.
        default_target: { mode: 'new', name: `${checkpoint.name} — ${group.date}` },
        // Only sessions with the same checkpoint AND date, that this user may edit, can be appended to.
        existing_sessions: repos.sessions.listByCheckpointAndDate(group.checkpoint_id, group.date)
          .filter((s) => actor.role === 'admin' || s.created_by === actor.id)
          .map(({ id, name, group_count: groupCount }) => ({ id, name, group_count: groupCount })),
      };
    });

    const missingFields = REQUIRED_FIELDS.filter((field) => !mapping[field]);
    const blocking = [];
    if (missingFields.length > 0) blocking.push(`Required columns not mapped: ${missingFields.join(', ')}`);
    if (!mapping.checkpoint && !fileCheckpointId) blocking.push('No checkpoint column: choose the checkpoint for the whole file');
    if (accepted.length === 0 && missingFields.length === 0) blocking.push('No valid rows to import');

    return { sheetIndex, sheet, mapping, fileCheckpointId, unknownCheckpointValues, accepted, rejected, midnightCrossings, groups, missingFields, blocking };
  }

  function presentPreview(id, expiresAt, state, computed) {
    const duplicate = repos.importBatches.findCommittedBySha(state.sha256) ?? null;
    return {
      preview_id: id,
      expires_at: expiresAt.toISOString(),
      filename: state.filename,
      sha256: state.sha256,
      sheets: state.sheets.map((s, index) => ({ index, name: s.name, has_data: s.headerRowIndex !== -1 })),
      sheet: computed.sheetIndex,
      headers: computed.sheet.headers.map((header, index) => ({ index, header })),
      mapping: computed.mapping,
      required_fields: REQUIRED_FIELDS,
      missing_fields: computed.missingFields,
      file_checkpoint_id: computed.fileCheckpointId,
      unknown_checkpoint_values: computed.unknownCheckpointValues,
      groups: computed.groups.map(({ rows, ...group }) => group),
      accepted_count: computed.accepted.length,
      rejected_count: computed.rejected.length,
      rejected_rows: computed.rejected.map(({ checkpoint_value: _cv, ...r }) => r),
      midnight_crossings: computed.midnightCrossings,
      midnight_rule: MIDNIGHT_RULE,
      duplicate,
      blocking_reasons: computed.blocking,
      can_commit: computed.blocking.length === 0,
    };
  }

  return {
    /** Parses an upload and stores it for 30 minutes. Writes nothing to the database. */
    preview(actor, { filename, buffer }) {
      const { sheets } = parseSpreadsheet(buffer, filename);
      const state = {
        filename,
        sha256: sha256(buffer),
        sheets,
        defaultSheet: sheets.findIndex((s) => s.headerRowIndex !== -1),
      };
      const computed = compute(state, {}, actor);
      const { id, expiresAt } = previewStore.put(actor.id, state);
      return presentPreview(id, expiresAt, state, computed);
    },

    /** Recomputes a stored preview with new choices (mapping, sheet, checkpoints). */
    refresh(actor, previewId, choices) {
      const { data: state, expiresAt } = previewStore.get(previewId, actor.id);
      return presentPreview(previewId, expiresAt, state, compute(state, choices, actor));
    },

    /** Writes the batch, its sessions, observations and audit entry in one transaction. */
    commit(actor, previewId, choices) {
      const { data: state } = previewStore.get(previewId, actor.id);
      const computed = compute(state, choices, actor);
      if (computed.blocking.length > 0) throw badRequest(computed.blocking.join('; '), undefined, 'import_blocked');
      const duplicate = repos.importBatches.findCommittedBySha(state.sha256);
      if (duplicate && !choices.confirm_duplicate) {
        throw conflict(`This file was already imported (batch ${duplicate.id}, ${duplicate.filename}). Confirm to import it again.`, 'duplicate_import', { batch_id: duplicate.id });
      }
      const targets = new Map((choices.targets ?? []).map((t) => [t.key, t]));
      for (const key of targets.keys()) {
        if (!computed.groups.some((g) => g.key === key)) throw badRequest(`Unknown session group "${key}"`, undefined, 'unknown_group');
      }

      const result = db.transaction(() => {
        const batchId = repos.importBatches.insert({
          filename: state.filename,
          file_sha256: state.sha256,
          uploaded_by: actor.id,
          column_mapping: { sheet: state.sheets[computed.sheetIndex].name, ...Object.fromEntries(Object.entries(computed.mapping).map(([f, m]) => [f, m && m.header])) },
          row_count: computed.accepted.length,
          rejected_row_count: computed.rejected.length,
        });

        const createdSessionIds = [];
        const splitSummary = [];
        for (const group of computed.groups) {
          const target = targets.get(group.key) ?? { mode: 'new' };
          let sessionId;
          if (target.mode === 'existing') {
            const session = repos.sessions.findById(target.session_id);
            if (!session) throw badRequest(`Session ${target.session_id} does not exist`, undefined, 'target_not_found');
            // Re-checked here whatever the client showed: never merge across checkpoints or dates.
            if (session.checkpoint_id !== group.checkpoint_id || session.date !== group.date) {
              throw badRequest(`Rows for ${group.checkpoint_name} on ${group.date} cannot be appended to "${session.name}", which has a different checkpoint or date`, undefined, 'target_mismatch');
            }
            sessionService.assertCanEdit(actor, session);
            sessionId = session.id;
          } else {
            sessionId = repos.sessions.insert({
              name: target.name?.trim() || group.proposed_name,
              date: group.date,
              checkpoint_id: group.checkpoint_id,
              observer: group.observers.join(', ') || null,
              import_batch_id: batchId,
              created_by: actor.id,
            });
            createdSessionIds.push(sessionId);
          }
          for (const row of group.rows) {
            repos.observations.insert({
              session_id: sessionId,
              import_batch_id: batchId,
              passenger_group_code: row.passenger_group_code ?? repos.observations.nextGroupCode(sessionId),
              pax: row.pax,
              flight_no: row.flight_no,
              counter: row.counter,
              arrival_time: row.arrival_time,
              service_start: row.service_start,
              service_end: row.service_end,
              wait_minutes: row.wait_minutes,
              processing_minutes: row.processing_minutes,
              total_minutes: row.total_minutes,
            });
          }
          sessionService.refreshShift(sessionId);
          splitSummary.push({
            key: group.key, date: group.date, checkpoint_id: group.checkpoint_id, checkpoint_name: group.checkpoint_name,
            session_id: sessionId, mode: target.mode === 'existing' ? 'appended' : 'created', row_count: group.row_count, pax_total: group.pax_total,
          });
        }
        repos.importBatches.setResult(batchId, { sessionIds: createdSessionIds, splitSummary });
        repos.audit.insert({
          actorUserId: actor.id, action: AUDIT_ACTIONS.IMPORT_COMMITTED, targetType: 'import_batch', targetId: batchId,
          details: {
            filename: state.filename, file_sha256: state.sha256, row_count: computed.accepted.length,
            rejected_row_count: computed.rejected.length, sessions_created: createdSessionIds.length,
            sessions_appended: splitSummary.filter((s) => s.mode === 'appended').length, duplicate_of: duplicate?.id ?? null,
          },
        });
        return repos.importBatches.findById(batchId);
      })();
      previewStore.delete(previewId);
      return result;
    },

    list(paging) {
      const window = pageWindow(paging);
      const { items, total } = repos.importBatches.list(window);
      return pageResult(items, total, window);
    },

    /** What a rollback would remove, including rows added to the batch's sessions afterwards. */
    rollbackCheck(batchId) {
      const batch = repos.importBatches.findById(batchId);
      if (!batch) throw notFound('Import batch not found');
      if (batch.status !== 'committed') throw conflict('This import has already been rolled back', 'already_rolled_back');
      return {
        batch,
        sessions_to_delete: repos.sessions.idsByImportBatch(batchId),
        batch_observation_count: repos.observations.countByBatch(batchId),
        added_rows: repos.observations.addedToBatchSessions(batchId),
      };
    },

    /** Admin only. Removes everything the batch created, in one transaction. */
    rollback(actor, batchId, { confirm_added_rows: confirmAddedRows = false } = {}) {
      return db.transaction(() => {
        const check = this.rollbackCheck(batchId);
        if (check.added_rows.length > 0 && !confirmAddedRows) {
          throw conflict(`${check.added_rows.length} observation(s) were added to this import's sessions afterwards and would also be deleted; confirm to continue`,
            'rollback_needs_confirmation', { added_rows: check.added_rows });
        }
        // Rows this batch appended to sessions it did not create.
        const foreignSessions = repos.observations.foreignSessionsOfBatch(batchId);
        const batchRows = repos.observations.deleteByBatch(batchId);
        for (const sessionId of foreignSessions) sessionService.refreshShift(sessionId);
        // Its own sessions; the cascade removes any rows added later.
        for (const sessionId of check.sessions_to_delete) repos.sessions.remove(sessionId);
        repos.importBatches.markRolledBack(batchId, actor.id);
        repos.audit.insert({
          actorUserId: actor.id, action: AUDIT_ACTIONS.IMPORT_ROLLED_BACK, targetType: 'import_batch', targetId: batchId,
          details: {
            filename: check.batch.filename,
            sessions_deleted: check.sessions_to_delete.length,
            batch_observations_deleted: batchRows,
            added_observations_deleted: check.added_rows.length,
            sessions_appended_to: foreignSessions,
          },
        });
        return repos.importBatches.findById(batchId);
      })();
    },
  };
}

module.exports = { createImportService, MIDNIGHT_RULE };
