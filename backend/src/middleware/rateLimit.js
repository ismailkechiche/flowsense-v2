'use strict';

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

function limitHandler(req, res, _next, options) {
  res.status(options.statusCode).json({
    error: { code: 'rate_limited', message: 'Too many attempts; please wait a few minutes and try again' },
  });
}

/** Login: 10 attempts per 15 minutes per IP + email pair. */
function loginLimiter(overrides = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email ?? '').trim().toLowerCase()}`,
    handler: limitHandler,
    ...overrides,
  });
}

/** Signup: 5 per hour per IP. */
function signupLimiter(overrides = {}) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    handler: limitHandler,
    ...overrides,
  });
}

module.exports = { loginLimiter, signupLimiter };
