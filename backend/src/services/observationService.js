'use strict';

const { badRequest, notFound } = require('../domain/errors');
const { validateObservationRow } = require('../domain/rowValidation');
const { pageWindow, pageResult } = require('../domain/pagination');

const OPTIONAL_TEXT = ['flight_no', 'counter'];

function invalidRow(reasons) {
  return badRequest('This observation is not valid', reasons.map((r) => ({ location: 'body', ...r })), 'invalid_observation');
}

function createObservationService({ db, repos, sessionService }) {
  const load = (id) => {
    const observation = repos.observations.findById(id);
    if (!observation) throw notFound('Observation not found');
    return observation;
  };

  /** Validates a full row against §5.2 plus the session-date rule. */
  function checkRow(session, row) {
    const result = validateObservationRow(row);
    if (!result.ok) throw invalidRow(result.reasons);
    const problem = sessionService.arrivalDateProblem(session.date, result.value.arrival_time);
    if (problem) throw invalidRow([{ field: 'arrival_time', message: problem }]);
    const extras = {};
    for (const field of OPTIONAL_TEXT) extras[field] = row[field] ?? null;
    return { ...result.value, ...extras };
  }

  return {
    listForSession(sessionId, paging) {
      sessionService.loadSession(sessionId);
      const window = pageWindow(paging);
      const { items, total } = repos.observations.listBySession(sessionId, window);
      return pageResult(items, total, window);
    },

    create(actor, sessionId, input) {
      return db.transaction(() => {
        const session = sessionService.loadSession(sessionId);
        sessionService.assertCanEdit(actor, session);
        const row = checkRow(session, input);
        const id = repos.observations.insert({
          ...row,
          session_id: sessionId,
          passenger_group_code: input.passenger_group_code ?? repos.observations.nextGroupCode(sessionId),
        });
        sessionService.refreshShift(sessionId);
        return repos.observations.findById(id);
      })();
    },

    /** Partial update: the merged row is re-validated as a whole. */
    update(actor, id, patch) {
      return db.transaction(() => {
        if (Object.keys(patch).length === 0) throw badRequest('Nothing to update');
        const current = load(id);
        const session = sessionService.loadSession(current.session_id);
        sessionService.assertCanEdit(actor, session);
        const merged = { ...current, ...patch };
        const row = checkRow(session, merged);
        repos.observations.update(id, { ...row, passenger_group_code: merged.passenger_group_code });
        sessionService.refreshShift(current.session_id);
        return repos.observations.findById(id);
      })();
    },

    remove(actor, id) {
      return db.transaction(() => {
        const current = load(id);
        sessionService.assertCanEdit(actor, sessionService.loadSession(current.session_id));
        repos.observations.remove(id);
        sessionService.refreshShift(current.session_id);
      })();
    },
  };
}

module.exports = { createObservationService };
