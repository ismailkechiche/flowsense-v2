'use strict';

/**
 * M/M/c queueing model (spec §8.2). Units: λ and μ in passengers per
 * minute, so Wq and W come out in minutes.
 *
 *   a = λ/μ (offered load, Erlangs), ρ = λ/(cμ)
 *   P(wait) = Erlang C(c, a)
 *   Wq = P(wait) / (cμ − λ),  Lq = λ·Wq,  W = Wq + 1/μ,  L = λ·W
 *
 * Erlang C is computed from the Erlang B recurrence
 *   B(0) = 1,  B(k) = a·B(k−1) / (k + a·B(k−1))
 *   C = B(c) / (1 − ρ·(1 − B(c)))
 * which never forms a factorial or a power, so it stays stable for c in the
 * hundreds.
 */

const MAX_SERVERS = 100;

class QueueInputError extends Error {}

function checkInputs(lambda, mu, c) {
  const problems = [];
  if (typeof lambda !== 'number' || !Number.isFinite(lambda) || lambda < 0) problems.push('λ must be a number ≥ 0');
  if (typeof mu !== 'number' || !Number.isFinite(mu) || mu <= 0) problems.push('μ must be a number > 0');
  if (!Number.isInteger(c) || c < 1) problems.push('c must be a whole number ≥ 1');
  if (problems.length > 0) throw new QueueInputError(problems.join('; '));
}

/** Erlang B blocking probability for c servers and offered load a. */
function erlangB(c, a) {
  let b = 1;
  for (let k = 1; k <= c; k += 1) b = (a * b) / (k + a * b);
  return b;
}

/** Erlang C: probability an arrival has to wait. Requires a < c. */
function erlangC(c, a) {
  if (a === 0) return 0;
  const rho = a / c;
  const b = erlangB(c, a);
  return b / (1 - rho * (1 - b));
}

/**
 * Steady-state M/M/c results. With ρ ≥ 1 the queue grows without limit, so
 * the result is `{ overloaded: true }` with every wait and length null.
 */
function mmc(lambda, mu, c) {
  checkInputs(lambda, mu, c);
  const a = lambda / mu;
  const rho = lambda / (c * mu);
  if (rho >= 1) {
    return { lambda, mu, c, rho, overloaded: true, p_wait: null, wq: null, lq: null, w: null, l: null };
  }
  const pWait = erlangC(c, a);
  const wq = lambda === 0 ? 0 : pWait / (c * mu - lambda);
  const w = wq + 1 / mu;
  return { lambda, mu, c, rho, overloaded: false, p_wait: pWait, wq, lq: lambda * wq, w, l: lambda * w };
}

/**
 * Smallest c (1..maxServers) whose Wq ≤ slaMinutes. Returns
 * `{ servers, exceeded: false }`, or `{ servers: null, exceeded: true }`
 * when even maxServers is not enough.
 */
function recommendServers(lambda, mu, slaMinutes, maxServers = MAX_SERVERS) {
  checkInputs(lambda, mu, 1);
  if (typeof slaMinutes !== 'number' || !(slaMinutes > 0)) throw new QueueInputError('SLA must be a number > 0');
  // Below ⌈a⌉ the system is overloaded, so start there.
  const start = Math.max(1, Math.floor(lambda / mu) + 1);
  for (let c = start; c <= maxServers; c += 1) {
    const result = mmc(lambda, mu, c);
    if (!result.overloaded && result.wq <= slaMinutes) return { servers: c, exceeded: false };
  }
  return { servers: null, exceeded: true };
}

module.exports = { mmc, erlangB, erlangC, recommendServers, QueueInputError, MAX_SERVERS };
