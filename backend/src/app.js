'use strict';

const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { createRepositories } = require('./repositories');
const { createServices } = require('./services');
const { buildApiMounts } = require('./routes');
const { csrfProtection } = require('./middleware/csrf');
const { loadUser } = require('./middleware/auth');
const { requestLog } = require('./middleware/requestLog');
const { apiNotFound, errorHandler } = require('./middleware/errors');
const { loginLimiter, signupLimiter } = require('./middleware/rateLimit');

/**
 * Builds the Express app. `server.js` and the tests both use this, so tests
 * exercise exactly the middleware stack that runs in production.
 */
function createApp({ config, db, logger, rateLimits = {} }) {
  const repos = createRepositories(db);
  const services = createServices({ db, repos, config, logger });
  const limiters = { login: loginLimiter(rateLimits.login), signup: signupLimiter(rateLimits.signup) };
  const ctx = { config, db, repos, services, logger, limiters };

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    strictTransportSecurity: config.cookieSecure,
  }));
  app.use(requestLog({ logger }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(csrfProtection({ config }));
  api.use(loadUser({ config, repos }));
  const mounts = buildApiMounts(ctx);
  for (const [prefix, router] of mounts) api.use(prefix, router);
  api.use(apiNotFound);
  app.use('/api', api);

  app.use(express.static(config.frontendDir, { index: 'index.html' }));
  app.use(errorHandler({ config, logger }));

  app.locals.ctx = ctx;
  app.locals.apiMounts = mounts;
  return app;
}

module.exports = { createApp };
