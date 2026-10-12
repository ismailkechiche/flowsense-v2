'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, listApiRoutes } = require('../helpers/testApp');

const ALL = ['collector', 'analyst', 'admin'];
const PUBLIC = 'public';

/**
 * Expected access for every API route. Adding a route without adding it
 * here fails the coverage test below, so this table is the single place
 * where the access policy (spec §6) is written down and checked.
 * `:id` is replaced with an id that does not exist, so allowed requests
 * get past the guard without changing data.
 */
const MATRIX = [
  ['GET', '/api/auth/csrf', PUBLIC],
  ['POST', '/api/auth/signup', PUBLIC],
  ['POST', '/api/auth/login', PUBLIC],
  ['POST', '/api/auth/logout', PUBLIC],
  ['GET', '/api/auth/me', ALL],
  ['POST', '/api/auth/password', ALL],

  ['GET', '/api/users', ['admin']],
  ['POST', '/api/users/:id/approve', ['admin']],
  ['POST', '/api/users/:id/reject', ['admin']],
  ['PATCH', '/api/users/:id/role', ['admin']],
  ['POST', '/api/users/:id/disable', ['admin']],
  ['POST', '/api/users/:id/enable', ['admin']],

  ['GET', '/api/checkpoints', ALL],
  ['GET', '/api/checkpoints/:id', ALL],
  ['POST', '/api/checkpoints', ['admin']],
  ['PATCH', '/api/checkpoints/:id', ['admin']],

  ['GET', '/api/sessions', ALL],
  ['POST', '/api/sessions', ['collector', 'admin']],
  ['GET', '/api/sessions/:id', ALL],
  ['PATCH', '/api/sessions/:id', ['collector', 'admin']],
  ['DELETE', '/api/sessions/:id', ['admin']],
  ['GET', '/api/sessions/:id/observations', ALL],
  ['POST', '/api/sessions/:id/observations', ['collector', 'admin']],
  ['PATCH', '/api/observations/:id', ['collector', 'admin']],
  ['DELETE', '/api/observations/:id', ['collector', 'admin']],

  ['POST', '/api/imports/preview', ['collector', 'admin']],
  ['POST', '/api/imports/previews/:previewId', ['collector', 'admin']],
  ['POST', '/api/imports/previews/:previewId/commit', ['collector', 'admin']],
  ['GET', '/api/imports', ['admin']],
  ['GET', '/api/imports/:id/rollback', ['admin']],
  ['POST', '/api/imports/:id/rollback', ['admin']],

  // Collectors get 403 on every analytics route (spec §6, §14 phase 4).
  ['GET', '/api/analytics/summary', ['analyst', 'admin']],
  ['GET', '/api/analytics/bottlenecks', ['analyst', 'admin']],
  ['GET', '/api/analytics/hourly', ['analyst', 'admin']],
  ['GET', '/api/analytics/breakdown', ['analyst', 'admin']],
  ['GET', '/api/analytics/distribution', ['analyst', 'admin']],
  ['GET', '/api/analytics/trend', ['analyst', 'admin']],
  ['GET', '/api/simulator/defaults', ['analyst', 'admin']],
  ['GET', '/api/simulator/run', ['analyst', 'admin']],
  ['GET', '/api/pivot/options', ['analyst', 'admin']],
  ['POST', '/api/pivot', ['analyst', 'admin']],
  ['POST', '/api/reports', ['analyst', 'admin']],
];

const key = (method, path) => `${method} ${path}`;

describe('RBAC matrix', () => {
  let t;
  let users;
  before(() => {
    t = createTestApp();
    users = { anonymous: null, collector: t.createUser({ role: 'collector' }), analyst: t.createUser({ role: 'analyst' }), admin: t.createUser({ role: 'admin' }) };
  });

  test('every registered API route carries exactly one access guard (default-deny)', () => {
    const unguarded = listApiRoutes(t.app).filter((r) => r.guards.length !== 1);
    assert.deepEqual(unguarded.map((r) => key(r.method, r.path)), []);
  });

  test('the matrix lists every registered route and nothing else', () => {
    const registered = listApiRoutes(t.app).map((r) => key(r.method, r.path)).sort();
    const expected = MATRIX.map(([m, p]) => key(m, p)).sort();
    assert.deepEqual(registered, expected);
  });

  test('each route guard declares the access the matrix expects', () => {
    const byKey = new Map(listApiRoutes(t.app).map((r) => [key(r.method, r.path), r.guards[0]]));
    for (const [method, path, access] of MATRIX) {
      const declared = byKey.get(key(method, path));
      if (access === PUBLIC) assert.equal(declared, PUBLIC, key(method, path));
      else assert.deepEqual([...declared].sort(), [...access].sort(), key(method, path));
    }
  });

  for (const [method, path, access] of MATRIX) {
    for (const who of ['anonymous', ...ALL]) {
      let expectation;
      if (access === PUBLIC) expectation = 'not 401/403';
      else if (who === 'anonymous') expectation = 401;
      else if (access.includes(who)) expectation = 'not 401/403';
      else expectation = 403;

      test(`${method} ${path} as ${who} → ${expectation}`, async () => {
        const url = path.replace(':id', '999999').replace(':previewId', 'no-such-preview');
        const res = await t.as(users[who])[method.toLowerCase()](url).send({});
        if (expectation === 'not 401/403') {
          assert.ok(![401, 403].includes(res.status), `got ${res.status}: ${JSON.stringify(res.body)}`);
        } else {
          assert.equal(res.status, expectation, JSON.stringify(res.body));
        }
      });
    }
  }
});
