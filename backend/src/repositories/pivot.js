'use strict';

const { DIMENSIONS, METRICS } = require('../domain/pivotWhitelist');
const { paxWeightedAvgSql } = require('../domain/metrics');
const { filterClause, FROM, minutesBetween } = require('./analytics');

/**
 * Pivot queries. Callers pass whitelist KEYS (already checked by the
 * service); this file maps them to the fixed SQL in pivotWhitelist.js and
 * never interpolates anything else. Filter values are bound parameters.
 */
function createPivotRepository(db) {
  return {
    /**
     * One row per (row value, column value) cell with the requested SQL
     * metrics. Returns at most `limit` cells; the caller asks for one more
     * than it allows to detect overflow.
     */
    cells({ rows, columns, metrics }, filters, limit) {
      const rowSql = DIMENSIONS[rows].sql;
      const colSql = columns ? DIMENSIONS[columns].sql : 'NULL';
      const selects = metrics.filter((key) => METRICS[key].sql).map((key) => `${METRICS[key].sql} AS ${key}`);
      const f = filterClause(filters);
      return db.prepare(`SELECT ${rowSql} AS row_value, ${colSql} AS column_value
          ${selects.length ? `, ${selects.join(', ')}` : ''}
        ${FROM} ${f.sql}
        GROUP BY row_value, column_value
        ORDER BY row_value, column_value
        LIMIT @limit`).all({ ...f.params, limit });
    },

    /**
     * The SLA each cell's passengers are measured against, pax-weighted (a
     * single checkpoint's threshold when the cell covers one checkpoint).
     */
    cellSla({ rows, columns }, filters) {
      const rowSql = DIMENSIONS[rows].sql;
      const colSql = columns ? DIMENSIONS[columns].sql : 'NULL';
      const f = filterClause(filters);
      return db.prepare(`SELECT ${rowSql} AS row_value, ${colSql} AS column_value,
          ${paxWeightedAvgSql('c.sla_wait_minutes')} AS sla_minutes
        ${FROM} ${f.sql}
        GROUP BY row_value, column_value`).all(f.params);
    },

    /**
     * Passengers and observed minutes per cell for throughput: each
     * session's window (last service end − first arrival) is taken over the
     * session's rows in that cell, then the windows are added up.
     */
    throughputWindows({ rows, columns }, filters) {
      const rowSql = DIMENSIONS[rows].sql;
      const colSql = columns ? DIMENSIONS[columns].sql : 'NULL';
      const f = filterClause(filters);
      return db.prepare(`SELECT row_value, column_value, SUM(pax) AS pax_total, SUM(window_minutes) AS window_minutes
        FROM (
          SELECT ${rowSql} AS row_value, ${colSql} AS column_value, s.id AS session_id, SUM(o.pax) AS pax,
                 ${minutesBetween('MAX(o.service_end)', 'MIN(o.arrival_time)')} AS window_minutes
          ${FROM} ${f.sql}
          GROUP BY row_value, column_value, s.id
        )
        GROUP BY row_value, column_value`).all(f.params);
    },
  };
}

module.exports = { createPivotRepository };
