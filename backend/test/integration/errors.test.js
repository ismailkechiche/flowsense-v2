'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createTestApp } = require('../helpers/testApp');
const { errorHandler } = require('../../src/middleware/errors');
const { createLogger } = require('../../src/logger');

test('unknown API routes return a JSON 404', async () => {
  const t = createTestApp();
  const res = await t.request().get('/api/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'route_not_found');
});

test('malformed JSON returns 400 invalid_json', async () => {
  const t = createTestApp();
  const admin = t.createUser({ role: 'admin' });
  const res = await t.as(admin).post('/api/checkpoints').set('Content-Type', 'application/json').send('{"name":');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'invalid_json');
});

test('unexpected errors return 500 without a stack trace in production', async () => {
  const app = express();
  app.get('/boom', async () => { throw new Error('database exploded at /secret/path'); });
  app.use(errorHandler({ config: { isProduction: true }, logger: createLogger('silent') }));
  const res = await request(app).get('/boom');
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: { code: 'internal_error', message: 'Something went wrong on the server' } });
});

test('security headers are set (CSP, nosniff, no x-powered-by)', async () => {
  const t = createTestApp();
  const res = await t.request().get('/api/auth/csrf');
  assert.match(res.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-powered-by'], undefined);
});
