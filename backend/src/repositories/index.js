'use strict';

const { createUsersRepository } = require('./users');
const { createCheckpointsRepository } = require('./checkpoints');
const { createAuditRepository } = require('./audit');
const { createSessionsRepository } = require('./sessions');
const { createObservationsRepository } = require('./observations');

function createRepositories(db) {
  return {
    users: createUsersRepository(db),
    checkpoints: createCheckpointsRepository(db),
    audit: createAuditRepository(db),
    sessions: createSessionsRepository(db),
    observations: createObservationsRepository(db),
  };
}

module.exports = { createRepositories };
