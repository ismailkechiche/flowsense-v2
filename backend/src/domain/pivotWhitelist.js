'use strict';

const {
  paxWeightedAvgSql, slaCompliancePctSql, breachPaxSql,
} = require('./metrics');

/**
 * The ONLY dimensions and metrics a pivot can use (spec §9). Requests name
 * keys of these objects; the server looks each key up and uses the SQL
 * written here. A key that isn't here is rejected with 400, so user input
 * never reaches the SQL text. Filter values are always bound parameters.
 *
 * `ordered` dimensions have a natural order, so a line chart makes sense.
 */
const DIMENSIONS = Object.freeze({
  checkpoint: Object.freeze({ sql: 'c.name', ordered: false }),
  date: Object.freeze({ sql: 's.date', ordered: true }),
  hour: Object.freeze({ sql: "CAST(strftime('%H', o.arrival_time) AS INTEGER)", ordered: true }),
  shift: Object.freeze({ sql: 's.shift', ordered: false }),
  flight_no: Object.freeze({ sql: "NULLIF(TRIM(o.flight_no), '')", ordered: false }),
  counter: Object.freeze({ sql: "NULLIF(TRIM(o.counter), '')", ordered: false }),
});

/**
 * Metrics. `sql` is an aggregate over the observation rows of one cell.
 * Throughput has no single-query form: it needs each session's own window
 * inside the cell (step-0 assumption 25), so the repository computes it
 * with a second, fixed query (`sql: null`).
 */
const METRICS = Object.freeze({
  avg_wait: Object.freeze({ sql: paxWeightedAvgSql('o.wait_minutes'), unit: 'min' }),
  avg_processing: Object.freeze({ sql: paxWeightedAvgSql('o.processing_minutes'), unit: 'min' }),
  avg_total: Object.freeze({ sql: paxWeightedAvgSql('o.total_minutes'), unit: 'min' }),
  throughput: Object.freeze({ sql: null, unit: 'pax/h' }),
  sla_compliance: Object.freeze({ sql: slaCompliancePctSql(), unit: '%' }),
  pax_total: Object.freeze({ sql: 'COALESCE(SUM(o.pax), 0)', unit: 'pax' }),
  group_count: Object.freeze({ sql: 'COUNT(o.id)', unit: 'groups' }),
  breach_pax: Object.freeze({ sql: breachPaxSql(), unit: 'pax' }),
});

const VISUALIZATIONS = Object.freeze(['table', 'bar', 'line']);
const MAX_CELLS = 1000;
const MAX_METRICS = Object.keys(METRICS).length;

const has = (object, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(object, key);
const isDimension = (key) => has(DIMENSIONS, key);
const isMetric = (key) => has(METRICS, key);

module.exports = {
  DIMENSIONS, METRICS, VISUALIZATIONS, MAX_CELLS, MAX_METRICS, isDimension, isMetric,
};
