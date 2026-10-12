'use strict';

const express = require('express');
const { validate, v } = require('../middleware/validate');
const { requireRole, publicRoute, ANY_ROLE } = require('../middleware/rbac');
const { AUTH_COOKIE, authCookieOptions, signToken } = require('../middleware/auth');
const { CSRF_HEADER } = require('../middleware/csrf');
const { SIGNUP_ROLES } = require('../services/authService');

function authRoutes({ config, services, limiters }) {
  const router = express.Router();
  const { maxAge: _maxAge, ...clearOptions } = authCookieOptions(config);

  // Hands the page its CSRF token (also set as the fs_csrf cookie).
  router.get('/csrf', publicRoute, (req, res) => {
    res.json({ csrf_token: req.csrfToken, header: CSRF_HEADER });
  });

  router.post('/signup', publicRoute, limiters.signup, validate({
    body: {
      name: v.string({ max: 100 }),
      email: v.email(),
      password: v.string({ min: 1, max: 200, trim: false }),
      requested_role: v.oneOf(SIGNUP_ROLES, { default: 'collector' }),
    },
  }), async (req, res) => {
    const user = await services.auth.signup(req.valid.body);
    res.status(201).json({ user, message: 'Account created; an administrator must approve it before you can log in' });
  });

  router.post('/login', publicRoute, limiters.login, validate({
    body: { email: v.email(), password: v.string({ min: 1, max: 200, trim: false }) },
  }), async (req, res) => {
    const user = await services.auth.login(req.valid.body);
    res.cookie(AUTH_COOKIE, signToken(config, user.id), authCookieOptions(config));
    res.json({ user });
  });

  // Public so a stale or invalid cookie can always be cleared.
  router.post('/logout', publicRoute, (_req, res) => {
    res.clearCookie(AUTH_COOKIE, clearOptions);
    res.status(204).end();
  });

  router.get('/me', requireRole(...ANY_ROLE), (req, res) => {
    res.json({ user: req.user });
  });

  router.post('/password', requireRole(...ANY_ROLE), validate({
    body: {
      current_password: v.string({ min: 1, max: 200, trim: false }),
      new_password: v.string({ min: 1, max: 200, trim: false }),
    },
  }), async (req, res) => {
    await services.auth.changePassword(req.user.id, req.valid.body);
    res.status(204).end();
  });

  return router;
}

module.exports = { authRoutes };
