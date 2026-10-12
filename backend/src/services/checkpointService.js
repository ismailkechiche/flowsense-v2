'use strict';

const { badRequest, notFound, conflict } = require('../domain/errors');
const { AUDIT_ACTIONS } = require('../domain/auditActions');
const { isUniqueViolation } = require('../repositories/sql');

const FIELDS = ['name', 'area', 'servers', 'sla_wait_minutes', 'active'];

function createCheckpointService({ db, repos }) {
  const load = (id) => {
    const checkpoint = repos.checkpoints.findById(id);
    if (!checkpoint) throw notFound('Checkpoint not found');
    return checkpoint;
  };
  const translateUnique = (err) => {
    if (isUniqueViolation(err)) return conflict('A checkpoint with this name already exists', 'checkpoint_name_taken');
    return err;
  };

  return {
    list: () => repos.checkpoints.list(),
    get: load,

    create: (actor, data) => db.transaction(() => {
      let id;
      try {
        id = repos.checkpoints.insert({ area: null, servers: 1, active: true, ...data });
      } catch (err) {
        throw translateUnique(err);
      }
      const created = repos.checkpoints.findById(id);
      repos.audit.insert({
        actorUserId: actor.id, action: AUDIT_ACTIONS.CHECKPOINT_CREATED, targetType: 'checkpoint', targetId: id,
        details: { after: created },
      });
      return created;
    })(),

    /** Partial update; the audit entry records before/after of changed fields only. */
    update: (actor, id, patch) => db.transaction(() => {
      if (Object.keys(patch).length === 0) throw badRequest('Nothing to update');
      const before = load(id);
      const changed = FIELDS.filter((field) => field in patch && patch[field] !== before[field]);
      if (changed.length === 0) return before;
      try {
        repos.checkpoints.update(id, Object.fromEntries(changed.map((field) => [field, patch[field]])));
      } catch (err) {
        throw translateUnique(err);
      }
      const after = repos.checkpoints.findById(id);
      repos.audit.insert({
        actorUserId: actor.id, action: AUDIT_ACTIONS.CHECKPOINT_UPDATED, targetType: 'checkpoint', targetId: id,
        details: {
          changed,
          before: Object.fromEntries(changed.map((field) => [field, before[field]])),
          after: Object.fromEntries(changed.map((field) => [field, after[field]])),
        },
      });
      return after;
    })(),
  };
}

module.exports = { createCheckpointService };
