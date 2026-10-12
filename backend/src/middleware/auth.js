'use strict';

const jwt = require('jsonwebtoken');
const { unauthorized } = require('../domain/errors');

const AUTH_COOKIE = 'fs_token';

function authCookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    path: '/',
    maxAge: config.jwtExpiresInMs,
  };
}

function signToken(config, userId) {
  return jwt.sign({}, config.jwtSecret, {
    subject: String(userId),
    expiresIn: config.jwtExpiresIn,
    algorithm: 'HS256',
  });
}

/**
 * Loads `req.user` from the auth cookie when there is a valid one.
 * The user is re-read from the database on every request, so a disabled,
 * rejected or re-roled user is affected on their very next request rather
 * than when the token expires. It never rejects by itself: the role guard
 * on each route decides (401 when `req.user` is missing).
 */
function loadUser({ config, repos }) {
  return function loadUserFromCookie(req, _res, next) {
    req.user = null;
    const token = req.cookies?.[AUTH_COOKIE];
    if (!token) return next();
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      return next();
    }
    const user = repos.users.findById(Number(payload.sub));
    if (user && user.status === 'approved') {
      req.user = { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status };
    } else {
      req.authRejected = true;
    }
    return next();
  };
}

/** Rejects requests without an approved user. Used by the role guard path. */
function requireAuth(req, _res, next) {
  if (req.user) return next();
  if (req.authRejected) return next(unauthorized('Your account is no longer active', 'account_inactive'));
  return next(unauthorized());
}

module.exports = { AUTH_COOKIE, authCookieOptions, signToken, loadUser, requireAuth };
