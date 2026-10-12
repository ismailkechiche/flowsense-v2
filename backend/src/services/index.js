'use strict';

const { createAuthService } = require('./authService');
const { createUserService } = require('./userService');
const { createCheckpointService } = require('./checkpointService');
const { createSessionService } = require('./sessionService');
const { createObservationService } = require('./observationService');
const { createImportService } = require('./importService');
const { createPreviewStore } = require('./previewStore');
const { createAnalyticsService } = require('./analyticsService');
const { createPivotService } = require('./pivotService');
const { createReportService } = require('./reportService');

function createServices(deps) {
  const sessions = createSessionService(deps);
  const analytics = createAnalyticsService(deps);
  const pivot = createPivotService(deps);
  return {
    auth: createAuthService(deps),
    users: createUserService(deps),
    checkpoints: createCheckpointService(deps),
    sessions,
    observations: createObservationService({ ...deps, sessionService: sessions }),
    analytics,
    pivot,
    reports: createReportService({ ...deps, services: { analytics, pivot } }),
    imports: createImportService({ ...deps, sessionService: sessions, previewStore: deps.previewStore ?? createPreviewStore() }),
  };
}

module.exports = { createServices };
