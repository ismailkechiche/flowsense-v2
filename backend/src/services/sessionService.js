'use strict';

const { badRequest, notFound, forbidden, conflict } = require('../domain/errors');
const { AUDIT_ACTIONS } = require('../domain/auditActions');
const { detectShift } = require('../domain/shifts');
const { addDays } = require('../domain/timeParse');
const { pageWindow, pageResult } = require('../domain/pagination');

/** Collectors may change only sessions they created; admins any session. */
function assertCanEdit(actor, session) {
  if (actor.role === 'admin') return;
  if (session.created_by !== actor.id) throw forbidden('You can only change sessions you created', 'not_session_owner');
}

/** A session's observations must arrive on its date or, overnight, the next day. */
function arrivalDateProblem(sessionDate, arrivalTime) {
  const day = arrivalTime.slice(0, 10);
  if (day === sessionDate || day === addDays(sessionDate, 1)) return null;
  return `arrival date ${day} is not the session date ${sessionDate} (or the next day, for overnight sessions)`;
}

/** Adds the SLA verdict to a session summary row (threshold in force now). */
function withSlaStatus(summary) {
  if (!summary) return summary;
  return {
    ...summary,
    sla_breached: summary.avg_wait_minutes !== null && summary.avg_wait_minutes > summary.sla_wait_minutes,
  };
}

function createSessionService({ db, repos }) {
  const loadSession = (id) => {
    const session = repos.sessions.findById(id);
    if (!session) throw notFound('Session not found');
    return session;
  };
  const activeCheckpoint = (checkpointId) => {
    const checkpoint = repos.checkpoints.findById(checkpointId);
    if (!checkpoint) throw badRequest('Unknown checkpoint', [{ location: 'body', field: 'checkpoint_id', message: 'does not exist' }]);
    if (!checkpoint.active) throw badRequest('This checkpoint is inactive', [{ location: 'body', field: 'checkpoint_id', message: 'is inactive' }]);
    return checkpoint;
  };

  /** Recomputes and stores the session's shift from its observations. */
  function refreshShift(sessionId) {
    repos.sessions.setShift(sessionId, detectShift(repos.observations.arrivalsForSession(sessionId)));
  }

  return {
    assertCanEdit,
    arrivalDateProblem,
    refreshShift,
    loadSession,

    list(filters, paging) {
      const window = pageWindow(paging);
      const { items, total } = repos.sessions.list(filters, window);
      return pageResult(items.map(withSlaStatus), total, window);
    },

    get(id) {
      const summary = withSlaStatus(repos.sessions.findSummaryById(id));
      if (!summary) throw notFound('Session not found');
      return summary;
    },

    create(actor, data) {
      activeCheckpoint(data.checkpoint_id);
      const id = repos.sessions.insert({ ...data, created_by: actor.id });
      return this.get(id);
    },

    update(actor, id, patch) {
      return db.transaction(() => {
        const session = loadSession(id);
        assertCanEdit(actor, session);
        if (Object.keys(patch).length === 0) throw badRequest('Nothing to update');
        if (patch.checkpoint_id !== undefined && patch.checkpoint_id !== session.checkpoint_id) activeCheckpoint(patch.checkpoint_id);
        if (patch.date !== undefined && patch.date !== session.date) {
          const { first, last } = repos.observations.arrivalRange(id);
          const problem = first && (arrivalDateProblem(patch.date, first) || arrivalDateProblem(patch.date, last));
          if (problem) throw conflict(`Cannot move the session to ${patch.date}: an observation's ${problem}`, 'date_mismatch');
        }
        repos.sessions.update(id, patch);
        return this.get(id);
      })();
    },

    /** Admin only (enforced by the route). Observations go via ON DELETE CASCADE. */
    remove(actor, id) {
      return db.transaction(() => {
        const summary = this.get(id);
        repos.sessions.remove(id);
        repos.audit.insert({
          actorUserId: actor.id, action: AUDIT_ACTIONS.SESSION_DELETED, targetType: 'session', targetId: id,
          details: {
            name: summary.name, date: summary.date, checkpoint_id: summary.checkpoint_id,
            checkpoint_name: summary.checkpoint_name, observation_count: summary.group_count,
            pax_total: summary.pax_total, import_batch_id: summary.import_batch_id,
          },
        });
      })();
    },
  };
}

module.exports = { createSessionService };
