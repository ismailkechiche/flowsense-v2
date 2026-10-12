'use strict';

/**
 * THE passenger-weighting module (spec §2). Every KPI in FLOWSENSE is
 * passenger-weighted, never a plain row average:
 *
 *     pax_weighted_avg(metric) = SUM(metric * pax) / SUM(pax)
 *
 * This file is the only place that formula is written down, as a pure JS
 * function (tests, in-memory calculations) and as a SQL fragment builder
 * (every aggregation query). Do not compute an average anywhere else.
 */

/**
 * Pure JS: pax-weighted average of `metric(row)` over rows with a `pax`
 * field. Returns null when there are no passengers.
 */
function paxWeightedAvg(rows, metric) {
  const read = typeof metric === 'function' ? metric : (row) => row[metric];
  let weighted = 0;
  let pax = 0;
  for (const row of rows) {
    weighted += read(row) * row.pax;
    pax += row.pax;
  }
  return pax > 0 ? weighted / pax : null;
}

/**
 * SQL: pax-weighted average of `expr`. Both arguments must be fixed SQL
 * expressions written in server code (never user input).
 */
function paxWeightedAvgSql(expr, paxExpr = 'o.pax') {
  return `(SUM((${expr}) * (${paxExpr})) * 1.0 / NULLIF(SUM(${paxExpr}), 0))`;
}

/**
 * Pure JS: pax-weighted percentile (spec §2.1, P50/P90), "lower nearest
 * rank" on the list where each row is repeated `pax` times: the smallest
 * value v such that the passengers with a value ≤ v are at least p% of all
 * passengers. Returns null when there are no passengers.
 */
function paxWeightedPercentile(rows, metric, p) {
  const read = typeof metric === 'function' ? metric : (row) => row[metric];
  const sorted = rows.map((row) => ({ value: read(row), pax: row.pax })).sort((x, y) => x.value - y.value);
  const total = sorted.reduce((sum, row) => sum + row.pax, 0);
  if (total === 0) return null;
  let cumulative = 0;
  for (const row of sorted) {
    cumulative += row.pax;
    if (cumulative * 100 >= p * total) return row.value;
  }
  return sorted[sorted.length - 1].value;
}

/**
 * SQL: the same percentile as a full SELECT returning one value. `source`
 * is a fixed server-side subquery yielding `value` and `pax` columns; the
 * percentile is bound as the named parameter `@percentile` (0–100).
 */
function paxWeightedPercentileSql(source) {
  return `SELECT MIN(value) FROM (
      SELECT value,
             SUM(pax) OVER (ORDER BY value ROWS UNBOUNDED PRECEDING) AS cumulative,
             SUM(pax) OVER () AS total
      FROM (${source})
    ) WHERE cumulative * 100.0 >= @percentile * total`;
}

/** Pure JS: % of passengers whose wait is within their SLA. */
function slaCompliancePct(rows, wait = 'wait_minutes', sla = 'sla_wait_minutes') {
  const readWait = typeof wait === 'function' ? wait : (row) => row[wait];
  const readSla = typeof sla === 'function' ? sla : (row) => row[sla];
  let within = 0;
  let pax = 0;
  for (const row of rows) {
    if (readWait(row) <= readSla(row)) within += row.pax;
    pax += row.pax;
  }
  return pax > 0 ? (within * 100) / pax : null;
}

/** SQL: % of passengers whose wait is within the SLA. */
function slaCompliancePctSql(waitExpr = 'o.wait_minutes', slaExpr = 'c.sla_wait_minutes', paxExpr = 'o.pax') {
  return `(SUM(CASE WHEN (${waitExpr}) <= (${slaExpr}) THEN (${paxExpr}) ELSE 0 END) * 100.0 / NULLIF(SUM(${paxExpr}), 0))`;
}

/** SQL: passengers and groups in breach (wait strictly above the SLA). */
function breachPaxSql(waitExpr = 'o.wait_minutes', slaExpr = 'c.sla_wait_minutes', paxExpr = 'o.pax') {
  return `COALESCE(SUM(CASE WHEN (${waitExpr}) > (${slaExpr}) THEN (${paxExpr}) END), 0)`;
}
function breachGroupsSql(waitExpr = 'o.wait_minutes', slaExpr = 'c.sla_wait_minutes') {
  return `COUNT(CASE WHEN (${waitExpr}) > (${slaExpr}) THEN 1 END)`;
}

/** Throughput in passengers per hour over an observed window in minutes. */
function throughputPerHour(pax, windowMinutes) {
  return windowMinutes > 0 ? (pax * 60) / windowMinutes : null;
}

/** λ: passengers per minute over an arrival window in minutes. */
function arrivalRate(pax, arrivalWindowMinutes) {
  return arrivalWindowMinutes > 0 ? pax / arrivalWindowMinutes : null;
}

/**
 * μ per server, in passengers per minute: SUM(pax) / SUM(processing).
 * This equals 1 / pax_weighted_avg(processing_minutes / pax), the
 * pax-weighted service time per passenger (approved in step 0 instead of
 * 1 / pax_weighted_avg(processing_minutes), which counts groups).
 */
function serviceRate(pax, processingMinutes) {
  return processingMinutes > 0 ? pax / processingMinutes : null;
}

module.exports = {
  paxWeightedAvg,
  paxWeightedAvgSql,
  paxWeightedPercentile,
  paxWeightedPercentileSql,
  slaCompliancePct,
  slaCompliancePctSql,
  breachPaxSql,
  breachGroupsSql,
  throughputPerHour,
  arrivalRate,
  serviceRate,
};
