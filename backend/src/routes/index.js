'use strict';

const { authRoutes } = require('./auth');
const { userRoutes } = require('./users');
const { checkpointRoutes } = require('./checkpoints');

/**
 * Every API router and the prefix it is mounted at under /api.
 * Tests walk this list to enumerate all routes (RBAC matrix, guard check).
 */
function buildApiMounts(ctx) {
  return [
    ['/auth', authRoutes(ctx)],
    ['/users', userRoutes(ctx)],
    ['/checkpoints', checkpointRoutes(ctx)],
  ];
}

module.exports = { buildApiMounts };
