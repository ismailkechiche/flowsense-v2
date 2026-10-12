'use strict';

const { createAuthService } = require('./authService');
const { createUserService } = require('./userService');
const { createCheckpointService } = require('./checkpointService');

function createServices(deps) {
  return {
    auth: createAuthService(deps),
    users: createUserService(deps),
    checkpoints: createCheckpointService(deps),
  };
}

module.exports = { createServices };
