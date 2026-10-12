'use strict';

const { forbidden } = require('../domain/errors');
const { requireAuth } = require('./auth');

const ROLES = Object.freeze(['collector', 'analyst', 'admin']);

/**
 * Role guard: 401 without an approved user (see `requireAuth`), 403 for a
 * role outside `roles`. Every API route must carry exactly one access marker:
 * either `requireRole(...)` or `publicRoute`. The route-coverage test
 * walks the router and fails for any route that has neither, so a route
 * without an explicit guard cannot ship (default-deny).
 */
function requireRole(...roles) {
  for (const role of roles) {
    if (!ROLES.includes(role)) throw new Error(`requireRole: unknown role "${role}"`);
  }
  if (roles.length === 0) throw new Error('requireRole needs at least one role');
  function roleGuard(req, _res, next) {
    if (!req.user) return requireAuth(req, _res, next);
    if (!roles.includes(req.user.role)) return next(forbidden());
    return next();
  }
  roleGuard.access = Object.freeze([...roles]);
  return roleGuard;
}

/** Marks a route as intentionally reachable without a session. */
function publicRoute(_req, _res, next) {
  next();
}
publicRoute.access = 'public';

const ANY_ROLE = ROLES;

module.exports = { requireRole, publicRoute, ROLES, ANY_ROLE };
