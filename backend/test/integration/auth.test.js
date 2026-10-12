'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp, TEST_PASSWORD, CSRF } = require('../helpers/testApp');

const findCookie = (res, name) => (res.headers['set-cookie'] || []).find((c) => c.startsWith(`${name}=`));
const tokenFrom = (res) => findCookie(res, 'fs_token').split(';')[0];
const withCsrf = (req) => req.set('Cookie', [`fs_csrf=${CSRF}`]).set('x-csrf-token', CSRF);

describe('signup → pending → admin approval → login', () => {
  test('full flow, including cookie attributes and logout', async () => {
    const t = createTestApp();
    const admin = t.createUser({ role: 'admin' });

    const signup = await withCsrf(t.request().post('/api/auth/signup'))
      .send({ name: 'Amira', email: 'Amira@Example.com ', password: 'a-good-password', requested_role: 'analyst' });
    assert.equal(signup.status, 201);
    assert.equal(signup.body.user.status, 'pending');
    assert.equal(signup.body.user.email, 'amira@example.com');
    assert.equal(signup.body.user.password_hash, undefined);

    const pendingLogin = await withCsrf(t.request().post('/api/auth/login')).send({ email: 'amira@example.com', password: 'a-good-password' });
    assert.equal(pendingLogin.status, 403);
    assert.equal(pendingLogin.body.error.code, 'account_pending');

    const approve = await t.as(admin).post(`/api/users/${signup.body.user.id}/approve`).send({ role: 'analyst' });
    assert.equal(approve.status, 200);
    assert.equal(approve.body.user.status, 'approved');
    assert.equal(approve.body.user.approved_by, admin.id);

    const login = await withCsrf(t.request().post('/api/auth/login')).send({ email: 'AMIRA@example.com', password: 'a-good-password' });
    assert.equal(login.status, 200);
    const cookie = findCookie(login, 'fs_token');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /Max-Age=28800/);
    assert.doesNotMatch(cookie, /Secure/);

    const me = await t.request().get('/api/auth/me').set('Cookie', [tokenFrom(login)]);
    assert.equal(me.status, 200);
    assert.equal(me.body.user.role, 'analyst');

    const logout = await withCsrf(t.request().post('/api/auth/logout'));
    assert.equal(logout.status, 204);
    assert.match(findCookie(logout, 'fs_token'), /Expires=Thu, 01 Jan 1970/);
  });

  test('cookie is Secure when COOKIE_SECURE=true', async () => {
    const t = createTestApp({ env: { COOKIE_SECURE: 'true' } });
    const user = t.createUser({ role: 'collector', email: 'c@example.com' });
    const res = await withCsrf(t.request().post('/api/auth/login')).send({ email: user.email, password: TEST_PASSWORD });
    assert.equal(res.status, 200);
    assert.match(findCookie(res, 'fs_token'), /Secure/);
  });

  test('signup validation: duplicate email, weak password, admin role', async () => {
    const t = createTestApp();
    t.createUser({ email: 'taken@example.com' });
    const dup = await withCsrf(t.request().post('/api/auth/signup')).send({ name: 'X', email: 'taken@example.com', password: 'long-enough-pw' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'email_taken');

    const weak = await withCsrf(t.request().post('/api/auth/signup')).send({ name: 'X', email: 'w@example.com', password: 'short' });
    assert.equal(weak.status, 400);
    assert.equal(weak.body.error.details[0].field, 'password');

    const adminRole = await withCsrf(t.request().post('/api/auth/signup')).send({ name: 'X', email: 'a@example.com', password: 'long-enough-pw', requested_role: 'admin' });
    assert.equal(adminRole.status, 400);
    assert.equal(adminRole.body.error.code, 'validation_error');
  });

  test('wrong password and unknown email give the same 401', async () => {
    const t = createTestApp();
    const user = t.createUser({ email: 'u@example.com' });
    const wrong = await withCsrf(t.request().post('/api/auth/login')).send({ email: user.email, password: 'nope-nope-nope' });
    const unknown = await withCsrf(t.request().post('/api/auth/login')).send({ email: 'ghost@example.com', password: 'nope-nope-nope' });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
  });

  test('rejected and disabled accounts cannot log in', async () => {
    const t = createTestApp();
    for (const status of ['rejected', 'disabled']) {
      const user = t.createUser({ status });
      const res = await withCsrf(t.request().post('/api/auth/login')).send({ email: user.email, password: TEST_PASSWORD });
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, `account_${status}`);
    }
  });

  test('login is rate limited', async () => {
    const t = createTestApp({ rateLimits: { login: { limit: 3 } } });
    const statuses = [];
    for (let i = 0; i < 4; i += 1) {
      const res = await withCsrf(t.request().post('/api/auth/login')).send({ email: 'x@example.com', password: 'whatever-pw' });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [401, 401, 401, 429]);
  });

  test('a user can change their password', async () => {
    const t = createTestApp();
    const user = t.createUser({ email: 'p@example.com' });
    const bad = await t.as(user).post('/api/auth/password').send({ current_password: 'wrong-password', new_password: 'brand-new-password' });
    assert.equal(bad.status, 400);
    const ok = await t.as(user).post('/api/auth/password').send({ current_password: TEST_PASSWORD, new_password: 'brand-new-password' });
    assert.equal(ok.status, 204);
    const login = await withCsrf(t.request().post('/api/auth/login')).send({ email: user.email, password: 'brand-new-password' });
    assert.equal(login.status, 200);
  });
});

describe('access is re-checked on every request', () => {
  test('a disabled user is rejected on the next request', async () => {
    const t = createTestApp();
    const admin = t.createUser({ role: 'admin' });
    const collector = t.createUser({ role: 'collector' });
    assert.equal((await t.as(collector).get('/api/auth/me')).status, 200);

    const disable = await t.as(admin).post(`/api/users/${collector.id}/disable`).send();
    assert.equal(disable.status, 200);

    const after = await t.as(collector).get('/api/auth/me');
    assert.equal(after.status, 401);
    assert.equal(after.body.error.code, 'account_inactive');
  });

  test('a downgraded admin loses admin access immediately', async () => {
    const t = createTestApp();
    const admin = t.createUser({ role: 'admin' });
    const other = t.createUser({ role: 'admin' });
    assert.equal((await t.as(other).get('/api/users')).status, 200);
    assert.equal((await t.as(admin).patch(`/api/users/${other.id}/role`).send({ role: 'analyst' })).status, 200);
    assert.equal((await t.as(other).get('/api/users')).status, 403);
  });

  test('tampered or foreign tokens are treated as anonymous', async () => {
    const t = createTestApp();
    const forged = await t.request().get('/api/auth/me').set('Cookie', ['fs_token=eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.']);
    assert.equal(forged.status, 401);
  });
});

describe('CSRF (double-submit cookie)', () => {
  test('state-changing requests need a header matching the cookie', async () => {
    const t = createTestApp();
    const admin = t.createUser({ role: 'admin' });
    const body = { name: 'Fast Track', sla_wait_minutes: 5 };

    const noHeader = await t.as(admin, { csrf: false }).post('/api/checkpoints').send(body);
    assert.equal(noHeader.status, 403);
    assert.equal(noHeader.body.error.code, 'csrf_invalid');

    const wrongHeader = await t.as(admin, { csrf: false }).post('/api/checkpoints').set('x-csrf-token', 'something-else').send(body);
    assert.equal(wrongHeader.status, 403);

    const ok = await t.as(admin).post('/api/checkpoints').send(body);
    assert.equal(ok.status, 201);
  });

  test('a request with no CSRF cookie gets one issued but is still refused', async () => {
    const t = createTestApp();
    const res = await t.request().post('/api/auth/login').set('x-csrf-token', 'guess').send({ email: 'a@b.co', password: 'x' });
    assert.equal(res.status, 403);
    const issued = findCookie(res, 'fs_csrf');
    assert.ok(issued);
    assert.doesNotMatch(issued, /HttpOnly/i);
    assert.match(issued, /SameSite=Strict/i);
  });

  test('GET /api/auth/csrf returns the token in the cookie', async () => {
    const t = createTestApp();
    const res = await t.request().get('/api/auth/csrf');
    assert.equal(res.status, 200);
    assert.equal(findCookie(res, 'fs_csrf').split(';')[0], `fs_csrf=${res.body.csrf_token}`);
  });
});

describe('bootstrap admin', () => {
  test('is created once when no admin exists, and can log in', async () => {
    const t = createTestApp();
    const email = t.config.bootstrapAdminEmail;
    const first = await t.services.auth.ensureBootstrapAdmin({ email, password: 'bootstrap-password' });
    assert.ok(first);
    const second = await t.services.auth.ensureBootstrapAdmin({ email, password: 'bootstrap-password' });
    assert.equal(second, null);
    const res = await withCsrf(t.request().post('/api/auth/login')).send({ email, password: 'bootstrap-password' });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'admin');
    assert.equal(res.body.user.status, 'approved');
  });

  test('is skipped when an approved admin already exists', async () => {
    const t = createTestApp();
    t.createUser({ role: 'admin' });
    assert.equal(await t.services.auth.ensureBootstrapAdmin({ email: 'admin@example.com', password: 'x' }), null);
    assert.equal(t.repos.users.findCredentialsByEmail('admin@example.com'), undefined);
  });
});
