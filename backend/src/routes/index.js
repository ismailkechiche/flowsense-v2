'use strict';

const { authRoutes } = require('./auth');
const { userRoutes } = require('./users');
const { checkpointRoutes } = require('./checkpoints');
const { sessionRoutes } = require('./sessions');
const { observationRoutes } = require('./observations');
const { importRoutes } = require('./imports');
const { analyticsRoutes, simulatorRoutes } = require('./analytics');
const { pivotRoutes, reportRoutes } = require('./pivot');

/**
 * Every API router and the prefix it is mounted at under /api.
 * Tests walk this list to enumerate all routes (RBAC matrix, guard check).
 */
function buildApiMounts(ctx) {
  return [
    ['/auth', authRoutes(ctx)],
    ['/users', userRoutes(ctx)],
    ['/checkpoints', checkpointRoutes(ctx)],
    ['/sessions', sessionRoutes(ctx)],
    ['/observations', observationRoutes(ctx)],
    ['/imports', importRoutes(ctx)],
    ['/analytics', analyticsRoutes(ctx)],
    ['/simulator', simulatorRoutes(ctx)],
    ['/pivot', pivotRoutes(ctx)],
    ['/reports', reportRoutes(ctx)],
  ];
}

module.exports = { buildApiMounts };
