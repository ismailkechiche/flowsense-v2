'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const bcrypt = require('bcrypt');
const request = require('supertest');
const { loadConfig } = require('../../src/config');
const { createLogger } = require('../../src/logger');
const { openDatabase, runMigrations } = require('../../src/db');
const { createApp } = require('../../src/app');
const { signToken, AUTH_COOKIE } = require('../../src/middleware/auth');
const { CSRF_COOKIE, CSRF_HEADER } = require('../../src/middleware/csrf');
const { BCRYPT_COST } = require('../../src/services/passwords');

const TEST_PASSWORD = 'correct-horse-battery';
// Hashed once per test process; bcrypt at cost 12 is deliberately slow.
const TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, BCRYPT_COST);
const CSRF = 'test-csrf-token-0123456789abcdef';

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    PORT: '3001',
    JWT_SECRET: 'test-secret-that-is-definitely-longer-than-32-chars',
    JWT_EXPIRES_IN: '8h',
    DB_PATH: ':memory:',
    // A fresh temp directory per test app, so tests never write into the repo.
    BACKUP_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'flowsense-test-backups-')),
    BACKUP_INTERVAL_HOURS: '24',
    BACKUP_RETENTION_COUNT: '30',
    COOKIE_SECURE: 'false',
    BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
    BOOTSTRAP_ADMIN_PASSWORD: 'bootstrap-password',
    ...overrides,
  };
}

/** A fresh app on an in-memory database with migrations applied. */
function createTestApp({ env, rateLimits } = {}) {
  const config = loadConfig(testEnv(env));
  const db = openDatabase(config.dbPath);
  runMigrations(db, config.migrationsDir);
  const logger = createLogger(config.logLevel);
  const app = createApp({ config, db, logger, rateLimits });
  const { repos, services } = app.locals.ctx;

  /** Inserts a user directly (status approved by default). */
  function createUser({ role = 'collector', status = 'approved', email, name } = {}) {
    const id = repos.users.insert({
      name: name ?? `${role} user`,
      email: email ?? `${role}-${Math.random().toString(36).slice(2, 10)}@example.com`,
      password_hash: TEST_PASSWORD_HASH,
      role,
      status,
    });
    return repos.users.findById(id);
  }

  /** Cookie header for an authenticated request (plus a CSRF cookie). */
  function cookiesFor(user) {
    const cookies = [`${CSRF_COOKIE}=${CSRF}`];
    if (user) cookies.push(`${AUTH_COOKIE}=${signToken(config, user.id)}`);
    return cookies;
  }

  /**
   * Request builder: `as(user).get('/api/...')`. Sends the CSRF cookie and
   * header so only auth/role decides the outcome; pass null for anonymous.
   */
  function as(user, { csrf = true } = {}) {
    const agent = request(app);
    const wrap = (method) => (path) => {
      const req = agent[method](path).set('Cookie', cookiesFor(user));
      return csrf ? req.set(CSRF_HEADER, CSRF) : req;
    };
    return { get: wrap('get'), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), delete: wrap('delete') };
  }

  return { app, db, config, repos, services, createUser, cookiesFor, as, request: () => request(app) };
}

/** Lists every API route as { method, path, access } by walking the routers. */
function listApiRoutes(app) {
  const routes = [];
  for (const [prefix, router] of app.locals.apiMounts) {
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const guards = layer.route.stack.map((l) => l.handle.access).filter((a) => a !== undefined);
      for (const method of Object.keys(layer.route.methods)) {
        if (method === '_all') continue;
        routes.push({
          method: method.toUpperCase(),
          path: `/api${prefix}${layer.route.path === '/' ? '' : layer.route.path}`,
          guards,
        });
      }
    }
  }
  return routes;
}

module.exports = { createTestApp, listApiRoutes, testEnv, TEST_PASSWORD, CSRF };
