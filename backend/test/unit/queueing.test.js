'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mmc, erlangC, recommendServers, QueueInputError } = require('../../src/domain/queueing');

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

// Reference Erlang C values from the textbook factorial formula, computed
// exactly with rational arithmetic (Python fractions), for c = 1..100.
const REFERENCE = [
  [1, 0.5, 0.5],
  [2, 1, 1 / 3],
  [3, 2, 4 / 9],
  [5, 4, 0.5541125541125541],
  [10, 8, 0.40918015079644354],
  [50, 45, 0.3638644672069884],
  [100, 90, 0.2169404809063664],
];

test('Erlang C matches reference values, including c = 100 (no factorial overflow)', () => {
  for (const [c, a, expected] of REFERENCE) close(erlangC(c, a), expected, 1e-12);
});

test('M/M/1 matches the closed form: Wq = ρ/(μ − λ), W = 1/(μ − λ)', () => {
  const r = mmc(0.5, 1, 1);
  close(r.rho, 0.5);
  close(r.p_wait, 0.5);
  close(r.wq, 1);
  close(r.lq, 0.5);
  close(r.w, 2);
  close(r.l, 1);
  assert.equal(r.overloaded, false);
});

test('M/M/c textbook example: λ = 2/min, μ = 1/min, c = 3', () => {
  const r = mmc(2, 1, 3);
  close(r.rho, 2 / 3);
  close(r.p_wait, 4 / 9);
  close(r.wq, 4 / 9);       // C / (cμ − λ) = (4/9) / 1
  close(r.lq, 8 / 9);
  close(r.w, 13 / 9);
  close(r.l, 26 / 9);
});

test('ρ ≥ 1 returns overloaded with null waits, never a finite or negative value', () => {
  for (const [lambda, mu, c] of [[3, 1, 3], [10, 1, 3], [1, 0.5, 2], [5, 1, 1]]) {
    const r = mmc(lambda, mu, c);
    assert.equal(r.overloaded, true);
    assert.ok(r.rho >= 1);
    for (const key of ['p_wait', 'wq', 'lq', 'w', 'l']) assert.equal(r[key], null, key);
  }
});

test('no arrivals: nobody waits', () => {
  const r = mmc(0, 1, 2);
  assert.equal(r.p_wait, 0);
  assert.equal(r.wq, 0);
  assert.equal(r.l, 0);
});

test('inputs are validated: λ ≥ 0, μ > 0, c integer ≥ 1', () => {
  for (const args of [[-1, 1, 1], [1, 0, 1], [1, -2, 1], [1, 1, 0], [1, 1, 2.5], [Number.NaN, 1, 1], [1, Infinity, 1], ['1', 1, 1]]) {
    assert.throws(() => mmc(...args), QueueInputError, JSON.stringify(args));
  }
});

test('recommended servers: smallest c whose Wq ≤ SLA', () => {
  // λ = 2, μ = 1: c = 3 gives Wq = 0.444 min; c = 4 gives Wq ≈ 0.087 min.
  assert.deepEqual(recommendServers(2, 1, 1), { servers: 3, exceeded: false });
  assert.deepEqual(recommendServers(2, 1, 0.1), { servers: 4, exceeded: false });
  for (const sla of [0.05, 0.5, 2, 10]) {
    const { servers } = recommendServers(2, 1, sla);
    assert.ok(mmc(2, 1, servers).wq <= sla);
    if (servers > 3) assert.ok(mmc(2, 1, servers - 1).overloaded || mmc(2, 1, servers - 1).wq > sla);
  }
});

test('recommended servers: an exact-integer load skips the ρ = 1 case', () => {
  assert.equal(recommendServers(4, 1, 1000).servers, 5);
});

test('recommended servers: more than the cap is reported, not invented', () => {
  assert.deepEqual(recommendServers(150, 1, 10), { servers: null, exceeded: true });
});
