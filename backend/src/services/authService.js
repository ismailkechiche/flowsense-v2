'use strict';

const { badRequest, unauthorized, forbidden, conflict } = require('../domain/errors');
const { isUniqueViolation } = require('../repositories/sql');
const { hashPassword, verifyPassword, passwordProblem } = require('./passwords');

const SIGNUP_ROLES = Object.freeze(['collector', 'analyst']);

const INACTIVE_STATUS = {
  pending: ['account_pending', 'Your account is waiting for an administrator to approve it'],
  rejected: ['account_rejected', 'Your account request was rejected; contact an administrator'],
  disabled: ['account_disabled', 'Your account has been disabled; contact an administrator'],
};

const publicUser = ({ password_hash: _hash, ...user }) => user;

function createAuthService({ repos, logger }) {
  return {
    /** Creates a pending account. The admin picks the final role on approval. */
    async signup({ name, email, password, requested_role: requestedRole }) {
      const problem = passwordProblem(password);
      if (problem) throw badRequest('Some fields are invalid', [{ location: 'body', field: 'password', message: problem }]);
      if (!SIGNUP_ROLES.includes(requestedRole)) {
        throw badRequest('Some fields are invalid', [{ location: 'body', field: 'requested_role', message: `must be one of: ${SIGNUP_ROLES.join(', ')}` }]);
      }
      const passwordHash = await hashPassword(password);
      try {
        const id = repos.users.insert({ name, email, password_hash: passwordHash, role: requestedRole, status: 'pending' });
        return repos.users.findById(id);
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict('An account with this email already exists', 'email_taken');
        throw err;
      }
    },

    /** Checks credentials and account status; returns the user on success. */
    async login({ email, password }) {
      const user = repos.users.findCredentialsByEmail(email);
      const ok = await verifyPassword(password, user?.password_hash);
      if (!user || !ok) throw unauthorized('Email or password is incorrect', 'invalid_credentials');
      if (user.status !== 'approved') {
        const [code, message] = INACTIVE_STATUS[user.status];
        throw forbidden(message, code);
      }
      return publicUser(user);
    },

    async changePassword(userId, { current_password: current, new_password: next }) {
      const user = repos.users.findCredentialsById(userId);
      if (!user || !(await verifyPassword(current, user.password_hash))) {
        throw badRequest('Current password is incorrect', [{ location: 'body', field: 'current_password', message: 'is incorrect' }], 'invalid_credentials');
      }
      const problem = passwordProblem(next);
      if (problem) throw badRequest('Some fields are invalid', [{ location: 'body', field: 'new_password', message: problem }]);
      repos.users.setPassword(userId, await hashPassword(next));
    },

    /**
     * On startup: when no approved admin exists, create one (or restore the
     * account with the bootstrap email) from BOOTSTRAP_ADMIN_*. Without this
     * nobody could approve the first signups.
     */
    async ensureBootstrapAdmin({ email, password }) {
      if (repos.users.countApprovedAdmins() > 0) return null;
      const passwordHash = await hashPassword(password);
      const existing = repos.users.findCredentialsByEmail(email);
      let id;
      if (existing) {
        id = existing.id;
        repos.users.setPassword(id, passwordHash);
        repos.users.approve(id, 'admin', null);
      } else {
        id = repos.users.insert({ name: 'Administrator', email, password_hash: passwordHash, role: 'admin', status: 'approved' });
        repos.users.approve(id, 'admin', null);
      }
      logger.warn(`No administrator existed, so ${email} was ${existing ? 'restored as' : 'created as'} an approved admin from BOOTSTRAP_ADMIN_*. Log in and change this password now.`);
      return id;
    },
  };
}

module.exports = { createAuthService, SIGNUP_ROLES };
