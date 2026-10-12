'use strict';

const { createAuthService } = require('./authService');
const { createUserService } = require('./userService');
const { createCheckpointService } = require('./checkpointService');
const { createSessionService } = require('./sessionService');
const { createObservationService } = require('./observationService');
const { createImportService } = require('./importService');
const { createPreviewStore } = require('./previewStore');

function createServices(deps) {
  const sessions = createSessionService(deps);
  return {
    auth: createAuthService(deps),
    users: createUserService(deps),
    checkpoints: createCheckpointService(deps),
    sessions,
    observations: createObservationService({ ...deps, sessionService: sessions }),
    imports: createImportService({ ...deps, sessionService: sessions, previewStore: deps.previewStore ?? createPreviewStore() }),
  };
}

module.exports = { createServices };
