'use strict';

const { createUsersRepository } = require('./users');
const { createCheckpointsRepository } = require('./checkpoints');
const { createAuditRepository } = require('./audit');

function createRepositories(db) {
  return {
    users: createUsersRepository(db),
    checkpoints: createCheckpointsRepository(db),
    audit: createAuditRepository(db),
  };
}

module.exports = { createRepositories };
