'use strict';

const {
  paxWeightedAvgSql, paxWeightedPercentileSql, slaCompliancePctSql, breachPaxSql, breachGroupsSql,
} = require('../domain/metrics');

// Every analytics query reads observations joined to their session and
// checkpoint. SLA checks use the checkpoint's threshold in force now
// (spec §11: historical thresholds are out of scope).
const FROM = `
  FROM observations o
  JOIN sessions s ON s.id = o.session_id
  JOIN checkpoints c ON c.id = s.checkpoint_id`;

const KPI_SELECT = `
  COUNT(o.id) AS group_count,
  COALESCE(SUM(o.pax), 0) AS pax_total,
  ${paxWeightedAvgSql('o.wait_minutes')} AS avg_wait_minutes,
  ${paxWeightedAvgSql('o.processing_minutes')} AS avg_processing_minutes,
  ${paxWeightedAvgSql('o.total_minutes')} AS avg_total_minutes,
  ${slaCompliancePctSql()} AS sla_compliance_pct,
  ${breachPaxSql()} AS breach_pax,
  ${breachGroupsSql()} AS breach_groups`;

// Minutes between two local timestamps, from whole seconds (exact, unlike
// julianday()). strftime('%s') reads the stored string as a plain calendar
// value: no time-zone conversion happens.
const minutesBetween = (later, earlier) => `((strftime('%s', ${later}) - strftime('%s', ${earlier})) / 60.0)`;

// The two optional breakdown dimensions (spec §8.1 section 4). Fixed
// column names: the caller passes a key, never SQL.
const BREAKDOWN_COLUMNS = Object.freeze({ flight_no: 'o.flight_no', counter: 'o.counter' });

const HISTOGRAM_BIN_MINUTES = 5;
const HISTOGRAM_LAST_BIN = 24; // [120, ∞) minutes

/**
 * WHERE clause for the shared analytics filters (spec §8): checkpoint ids
 * (any number), session date range (inclusive) and one session. Values are
 * always bound parameters.
 */
function filterClause({ checkpointIds = [], from, to, sessionId } = {}) {
  const where = [];
  const params = {};
  if (checkpointIds.length > 0) {
    const names = checkpointIds.map((id, i) => {
      params[`checkpoint${i}`] = id;
      return `@checkpoint${i}`;
    });
    where.push(`s.checkpoint_id IN (${names.join(', ')})`);
  }
  if (from) { where.push('s.date >= @from'); params.from = from; }
  if (to) { where.push('s.date <= @to'); params.to = to; }
  if (sessionId) { where.push('s.id = @sessionId'); params.sessionId = sessionId; }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/** Appends one more condition to a filter clause. */
function andWhere(clause, condition) {
  return clause.sql ? `${clause.sql} AND ${condition}` : `WHERE ${condition}`;
}

function createAnalyticsRepository(db) {
  const all = (sql, params) => db.prepare(sql).all(params);
  const get = (sql, params) => db.prepare(sql).get(params);

  return {
    /** Overview KPIs over the whole scope (no throughput: see sessionWindows). */
    overview(filters) {
      const f = filterClause(filters);
      return get(`SELECT ${KPI_SELECT} ${FROM} ${f.sql}`, f.params);
    },

    /** Pax-weighted percentile of the wait time, `percentile` in 0–100. */
    waitPercentile(filters, percentile) {
      const f = filterClause(filters);
      const source = `SELECT o.wait_minutes AS value, o.pax AS pax ${FROM} ${f.sql}`;
      return db.prepare(paxWeightedPercentileSql(source)).pluck().get({ ...f.params, percentile });
    },

    /**
     * One row per session in scope with its observed windows, used for
     * throughput, λ, μ and c (step-0 decision: multi-day scopes add up the
     * per-session windows instead of spanning nights between sessions).
     */
    sessionWindows(filters) {
      const f = filterClause(filters);
      return all(`SELECT s.id AS session_id, s.checkpoint_id, c.servers,
          SUM(o.pax) AS pax_total,
          SUM(o.processing_minutes) AS processing_minutes_sum,
          ${minutesBetween('MAX(o.service_end)', 'MIN(o.arrival_time)')} AS service_window_minutes,
          ${minutesBetween('MAX(o.arrival_time)', 'MIN(o.arrival_time)')} AS arrival_window_minutes,
          COUNT(DISTINCT NULLIF(TRIM(o.counter), '')) AS counter_count
        ${FROM} ${f.sql}
        GROUP BY s.id ORDER BY s.id`, f.params);
    },

    /** KPIs per checkpoint in scope, with the checkpoint's SLA and servers. */
    byCheckpoint(filters) {
      const f = filterClause(filters);
      return all(`SELECT c.id AS checkpoint_id, c.name AS checkpoint_name, c.servers,
          c.sla_wait_minutes, ${KPI_SELECT}
        ${FROM} ${f.sql}
        GROUP BY c.id ORDER BY c.name`, f.params);
    },

    /**
     * KPIs per hour of day of the arrival time, plus the number of distinct
     * days observed in that hour (the throughput denominator).
     */
    hourly(filters) {
      const f = filterClause(filters);
      return all(`SELECT CAST(strftime('%H', o.arrival_time) AS INTEGER) AS hour,
          COUNT(DISTINCT date(o.arrival_time)) AS days_observed, ${KPI_SELECT}
        ${FROM} ${f.sql}
        GROUP BY hour ORDER BY hour`, f.params);
    },

    /** KPIs per flight number or per counter; rows without one are left out. */
    breakdown(filters, dimension, limit) {
      const column = BREAKDOWN_COLUMNS[dimension];
      if (!column) throw new Error(`Unknown breakdown dimension ${dimension}`);
      const f = filterClause(filters);
      const where = andWhere(f, `NULLIF(TRIM(${column}), '') IS NOT NULL`);
      const items = all(`SELECT TRIM(${column}) AS value, ${KPI_SELECT}
        ${FROM} ${where}
        GROUP BY TRIM(${column}) ORDER BY pax_total DESC, value LIMIT @limit`, { ...f.params, limit });
      const total = db.prepare(`SELECT COUNT(DISTINCT TRIM(${column})) ${FROM} ${where}`).pluck().get(f.params);
      return { items, total };
    },

    /** Passengers and groups per 5-minute wait bin; the last bin is 120+ min. */
    waitHistogram(filters) {
      const f = filterClause(filters);
      return all(`SELECT MIN(CAST(o.wait_minutes / ${HISTOGRAM_BIN_MINUTES} AS INTEGER), ${HISTOGRAM_LAST_BIN}) AS bin,
          SUM(o.pax) AS pax, COUNT(o.id) AS group_count
        ${FROM} ${f.sql}
        GROUP BY bin ORDER BY bin`, f.params);
    },

    /** Distinct SLA thresholds of the checkpoints in scope. */
    slaThresholds(filters) {
      const f = filterClause(filters);
      return db.prepare(`SELECT DISTINCT c.sla_wait_minutes ${FROM} ${f.sql} ORDER BY 1`).pluck().all(f.params);
    },

    /** KPIs per session date. */
    trend(filters) {
      const f = filterClause(filters);
      return all(`SELECT s.date, ${KPI_SELECT}
        ${FROM} ${f.sql}
        GROUP BY s.date ORDER BY s.date`, f.params);
    },
  };
}

module.exports = {
  createAnalyticsRepository, filterClause, FROM, minutesBetween, BREAKDOWN_COLUMNS, HISTOGRAM_BIN_MINUTES, HISTOGRAM_LAST_BIN,
};
