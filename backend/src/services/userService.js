'use strict';

const { badRequest, notFound, conflict } = require('../domain/errors');
const { AUDIT_ACTIONS } = require('../domain/auditActions');

function createUserService({ db, repos }) {
  const load = (id) => {
    const user = repos.users.findById(id);
    if (!user) throw notFound('User not found');
    return user;
  };
  const notSelf = (actor, user, verb) => {
    if (actor.id === user.id) throw badRequest(`You cannot ${verb} your own account`, undefined, 'self_action');
  };
  const keepOneAdmin = (user) => {
    if (user.role === 'admin' && user.status === 'approved' && repos.users.countApprovedAdmins() <= 1) {
      throw conflict('This is the last active administrator', 'last_admin');
    }
  };
  const audit = (actor, action, user, details) => repos.audit.insert({
    actorUserId: actor.id, action, targetType: 'user', targetId: user.id, details,
  });

  return {
    list: (filters) => repos.users.list(filters),

    approve: (actor, id, role) => db.transaction(() => {
      const user = load(id);
      if (user.status !== 'pending' && user.status !== 'rejected') {
        throw conflict(`Only pending or rejected accounts can be approved (this one is ${user.status})`, 'invalid_status');
      }
      repos.users.approve(id, role, actor.id);
      audit(actor, AUDIT_ACTIONS.USER_APPROVED, user, { role, requested_role: user.role, previous_status: user.status });
      return repos.users.findById(id);
    })(),

    reject: (actor, id) => db.transaction(() => {
      const user = load(id);
      if (user.status !== 'pending') throw conflict(`Only pending accounts can be rejected (this one is ${user.status})`, 'invalid_status');
      repos.users.setStatus(id, 'rejected');
      audit(actor, AUDIT_ACTIONS.USER_REJECTED, user, {});
      return repos.users.findById(id);
    })(),

    changeRole: (actor, id, role) => db.transaction(() => {
      const user = load(id);
      notSelf(actor, user, 'change the role of');
      if (user.role === role) return user;
      if (role !== 'admin') keepOneAdmin(user);
      repos.users.setRole(id, role);
      audit(actor, AUDIT_ACTIONS.USER_ROLE_CHANGED, user, { from: user.role, to: role });
      return repos.users.findById(id);
    })(),

    disable: (actor, id) => db.transaction(() => {
      const user = load(id);
      notSelf(actor, user, 'disable');
      if (user.status === 'disabled') return user;
      keepOneAdmin(user);
      repos.users.setStatus(id, 'disabled');
      audit(actor, AUDIT_ACTIONS.USER_DISABLED, user, { previous_status: user.status });
      return repos.users.findById(id);
    })(),

    /** Re-enabling is an approval, so it is audit-logged as user_approved. */
    enable: (actor, id) => db.transaction(() => {
      const user = load(id);
      if (user.status !== 'disabled') throw conflict(`Only disabled accounts can be re-enabled (this one is ${user.status})`, 'invalid_status');
      repos.users.approve(id, user.role, actor.id);
      audit(actor, AUDIT_ACTIONS.USER_APPROVED, user, { role: user.role, previous_status: 'disabled', reenabled: true });
      return repos.users.findById(id);
    })(),
  };
}

module.exports = { createUserService };
