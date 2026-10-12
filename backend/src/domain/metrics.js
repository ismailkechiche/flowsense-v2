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

module.exports = { paxWeightedAvg, paxWeightedAvgSql };
