'use strict';

const { createAuthService } = require('./authService');
const { createUserService } = require('./userService');
const { createCheckpointService } = require('./checkpointService');
const { createSessionService } = require('./sessionService');
const { createObservationService } = require('./observationService');

function createServices(deps) {
  const sessions = createSessionService(deps);
  return {
    auth: createAuthService(deps),
    users: createUserService(deps),
    checkpoints: createCheckpointService(deps),
    sessions,
    observations: createObservationService({ ...deps, sessionService: sessions }),
  };
}

module.exports = { createServices };
