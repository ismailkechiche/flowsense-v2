'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, ConfigError } = require('../../src/config');
const { parseDurationMs } = require('../../src/domain/duration');
const { testEnv } = require('../helpers/testApp');

test('a complete environment loads, with derived values', () => {
  const config = loadConfig(testEnv({ COOKIE_SECURE: 'true', BOOTSTRAP_ADMIN_EMAIL: 'Boss@Example.com' }));
  assert.equal(config.port, 3001);
  assert.equal(config.jwtExpiresInMs, 8 * 3600 * 1000);
  assert.equal(config.cookieSecure, true);
  assert.equal(config.bootstrapAdminEmail, 'boss@example.com');
});

test('every missing variable is reported at once', () => {
  const env = testEnv();
  delete env.JWT_SECRET;
  delete env.DB_PATH;
  env.PORT = '';
  assert.throws(() => loadConfig(env), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.equal(err.problems.length, 3);
    assert.match(err.message, /JWT_SECRET is required/);
    assert.match(err.message, /DB_PATH is required/);
    assert.match(err.message, /PORT is required/);
    return true;
  });
});

test('JWT_SECRET shorter than 32 characters is rejected', () => {
  assert.throws(() => loadConfig(testEnv({ JWT_SECRET: 'x'.repeat(31) })), /at least 32 characters/);
  assert.doesNotThrow(() => loadConfig(testEnv({ JWT_SECRET: 'x'.repeat(32) })));
});

test('the .env.example placeholder secret is rejected', () => {
  assert.throws(() => loadConfig(testEnv({ JWT_SECRET: 'change-me-to-a-long-random-string' })), /placeholder/);
});

test('malformed numbers, booleans and durations are rejected', () => {
  assert.throws(() => loadConfig(testEnv({ BACKUP_RETENTION_COUNT: '0' })), /BACKUP_RETENTION_COUNT/);
  assert.throws(() => loadConfig(testEnv({ COOKIE_SECURE: 'yes' })), /COOKIE_SECURE/);
  assert.throws(() => loadConfig(testEnv({ JWT_EXPIRES_IN: 'forever' })), /JWT_EXPIRES_IN/);
});

test('parseDurationMs', () => {
  assert.equal(parseDurationMs('30m'), 1_800_000);
  assert.equal(parseDurationMs('1d'), 86_400_000);
  assert.equal(parseDurationMs('8'), null);
  assert.equal(parseDurationMs('0h'), null);
});
