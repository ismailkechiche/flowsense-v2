'use strict';

const crypto = require('node:crypto');
const { forbidden } = require('../domain/errors');

const CSRF_COOKIE = 'fs_csrf';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfCookieOptions(config) {
  // Readable by the page (not httpOnly) so api.js can echo it in a header.
  return { httpOnly: false, sameSite: 'strict', secure: config.cookieSecure, path: '/' };
}

function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Double-submit cookie CSRF protection. Every response makes sure the
 * browser holds a random `fs_csrf` cookie; every state-changing request
 * must echo that value in the `X-CSRF-Token` header. Another site can make
 * the browser send the cookie but cannot read it, so it cannot forge the
 * header. This is in addition to SameSite=Strict on the auth cookie.
 */
function csrfProtection({ config }) {
  return function checkCsrf(req, res, next) {
    let token = req.cookies?.[CSRF_COOKIE];
    if (!token) {
      token = crypto.randomBytes(32).toString('hex');
      res.cookie(CSRF_COOKIE, token, csrfCookieOptions(config));
      req.csrfIssued = true;
    }
    req.csrfToken = token;
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.csrfIssued || !tokensMatch(req.get(CSRF_HEADER), token)) {
      return next(forbidden('Missing or invalid CSRF token; reload the page and try again', 'csrf_invalid'));
    }
    return next();
  };
}

module.exports = { csrfProtection, CSRF_COOKIE, CSRF_HEADER };
