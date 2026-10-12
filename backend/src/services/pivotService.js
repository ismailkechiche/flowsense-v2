'use strict';

const {
  DIMENSIONS, METRICS, VISUALIZATIONS, MAX_CELLS, MAX_METRICS, isDimension, isMetric,
} = require('../domain/pivotWhitelist');
const { throughputPerHour } = require('../domain/metrics');
const { v } = require('../middleware/validate');
const { badRequest } = require('../domain/errors');

const TITLE_MAX = 120;

// Rules for the filters stored in a pivot configuration. They are the same
// as the analytics query filters, applied to a JSON object.
const FILTER_RULES = {
  checkpoint_id: v.idList(),
  from: v.date(),
  to: v.date(),
  session_id: v.id(),
};

function parseFilters(raw, details) {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    details.push({ field: 'filters', message: 'must be an object' });
    return {};
  }
  const out = {};
  for (const key of Object.keys(raw)) {
    const rule = FILTER_RULES[key];
    if (!rule) {
      details.push({ field: `filters.${key}`, message: 'is not an allowed filter' });
      continue;
    }
    const value = raw[key];
    if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
    try {
      out[key] = rule.check(value);
    } catch (err) {
      details.push({ field: `filters.${key}`, message: err.message });
    }
  }
  if (out.from && out.to && out.from > out.to) details.push({ field: 'filters.to', message: 'must be on or after from' });
  return out;
}

/** Repository filter shape from validated config filters. */
const toRepoFilters = (f) => ({ checkpointIds: f.checkpoint_id ?? [], from: f.from, to: f.to, sessionId: f.session_id });

/**
 * Validates a pivot configuration against the whitelist. Unknown dimension
 * or metric keys are a 400 with code `unknown_pivot_key`; other mistakes
 * are a 400 `validation_error`. Returns the normalised configuration.
 */
function validateConfig(raw) {
  const details = [];
  const unknown = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw badRequest('The pivot configuration must be an object');
  const allowed = new Set(['rows', 'columns', 'metrics', 'visualization', 'title', 'filters']);
  for (const key of Object.keys(raw)) if (!allowed.has(key)) details.push({ field: key, message: 'is not an allowed field' });

  const rows = raw.rows;
  if (rows === undefined || rows === null || rows === '') details.push({ field: 'rows', message: 'is required' });
  else if (!isDimension(rows)) unknown.push({ field: 'rows', message: 'is not a known dimension' });

  let columns = raw.columns === '' || raw.columns === undefined ? null : raw.columns;
  if (columns !== null) {
    if (!isDimension(columns)) unknown.push({ field: 'columns', message: 'is not a known dimension' });
    else if (columns === rows) details.push({ field: 'columns', message: 'must differ from rows' });
  }

  const metrics = raw.metrics;
  if (!Array.isArray(metrics) || metrics.length === 0) {
    details.push({ field: 'metrics', message: 'must list at least one metric' });
  } else {
    if (metrics.length > MAX_METRICS) details.push({ field: 'metrics', message: `must list at most ${MAX_METRICS} metrics` });
    metrics.forEach((m, i) => { if (!isMetric(m)) unknown.push({ field: `metrics[${i}]`, message: 'is not a known metric' }); });
    if (new Set(metrics).size !== metrics.length) details.push({ field: 'metrics', message: 'must not repeat a metric' });
  }

  const visualization = raw.visualization ?? 'table';
  if (!VISUALIZATIONS.includes(visualization)) {
    details.push({ field: 'visualization', message: `must be one of: ${VISUALIZATIONS.join(', ')}` });
  } else if (visualization === 'line' && isDimension(rows) && !DIMENSIONS[rows].ordered) {
    details.push({ field: 'visualization', message: 'a line chart needs an ordered row dimension (date or hour)' });
  }

  let title = raw.title ?? '';
  if (typeof title !== 'string') details.push({ field: 'title', message: 'must be a string' });
  else {
    title = title.trim();
    if (title.length > TITLE_MAX) details.push({ field: 'title', message: `must be at most ${TITLE_MAX} characters` });
  }

  const filters = parseFilters(raw.filters, details);

  // Report unknown keys on their own, so an injection attempt is
  // recognisable in the response and logs.
  if (unknown.length > 0) throw badRequest('Unknown pivot dimension or metric', unknown, 'unknown_pivot_key');
  if (details.length > 0) throw badRequest('Some fields are invalid', details);
  columns = columns ?? null;
  return { rows, columns, metrics: [...metrics], visualization, title, filters };
}

/** Default title for a configuration, e.g. "Avg wait by hour × checkpoint". */
function defaultTitle(config, label) {
  const metrics = config.metrics.map((m) => label.metric(m)).join(', ');
  const dims = config.columns ? `${label.dimension(config.rows)} × ${label.dimension(config.columns)}` : label.dimension(config.rows);
  return `${metrics} by ${dims}`;
}

const LABELS = {
  dimension: (key) => ({
    checkpoint: 'checkpoint', date: 'date', hour: 'hour', shift: 'shift', flight_no: 'flight', counter: 'counter',
  })[key],
  metric: (key) => ({
    avg_wait: 'Avg wait', avg_processing: 'Avg processing', avg_total: 'Avg total time', throughput: 'Throughput',
    sla_compliance: 'SLA compliance', pax_total: 'Passengers', group_count: 'Groups', breach_pax: 'Breach pax',
  })[key],
};

function createPivotService({ repos }) {
  /**
   * Runs a validated configuration. Returns the row and column values in
   * order and one entry per non-empty cell. A cell's `breach` flag marks an
   * average wait above the (pax-weighted) SLA of the passengers in it.
   */
  function run(config) {
    const filters = toRepoFilters(config.filters);
    const cells = repos.pivot.cells(config, filters, MAX_CELLS + 1);
    if (cells.length > MAX_CELLS) {
      throw badRequest(`This pivot has more than ${MAX_CELLS.toLocaleString('en')} cells. Narrow the filters or choose fewer or coarser dimensions.`, undefined, 'too_many_cells');
    }
    const slaByCell = config.metrics.includes('avg_wait') ? repos.pivot.cellSla(config, filters) : null;
    const throughput = config.metrics.includes('throughput') ? repos.pivot.throughputWindows(config, filters) : null;
    const cellKey = (r, c) => JSON.stringify([r, c]);
    const throughputByCell = new Map((throughput ?? []).map((t) => [cellKey(t.row_value, t.column_value), throughputPerHour(t.pax_total, t.window_minutes)]));
    const slaMap = new Map((slaByCell ?? []).map((s) => [cellKey(s.row_value, s.column_value), s.sla_minutes]));

    const rowValues = [];
    const columnValues = [];
    const seenRow = new Set();
    const seenCol = new Set();
    const out = cells.map((cell) => {
      const k = cellKey(cell.row_value, cell.column_value);
      if (!seenRow.has(cell.row_value)) { seenRow.add(cell.row_value); rowValues.push(cell.row_value); }
      if (config.columns && !seenCol.has(cell.column_value)) { seenCol.add(cell.column_value); columnValues.push(cell.column_value); }
      const values = {};
      for (const m of config.metrics) values[m] = m === 'throughput' ? (throughputByCell.get(k) ?? null) : cell[m];
      const sla = slaMap.get(k);
      const breach = values.avg_wait !== undefined && values.avg_wait !== null && sla !== undefined && values.avg_wait > sla;
      return { row: cell.row_value, column: config.columns ? cell.column_value : null, values, breach };
    });
    if (config.columns) columnValues.sort((a, b) => (a === null ? -1 : b === null ? 1 : (a < b ? -1 : a > b ? 1 : 0)));

    return {
      config: { ...config, title: config.title || defaultTitle(config, LABELS) },
      row_values: rowValues,
      column_values: config.columns ? columnValues : null,
      metrics: config.metrics.map((key) => ({ key, label: LABELS.metric(key), unit: METRICS[key].unit })),
      cells: out,
      cell_count: out.length,
      max_cells: MAX_CELLS,
    };
  }

  return {
    validateConfig,
    run,
    /** Validates then runs a configuration from a request body. */
    query: (raw) => run(validateConfig(raw)),
    options: () => ({
      dimensions: Object.entries(DIMENSIONS).map(([key, d]) => ({ key, label: LABELS.dimension(key), ordered: d.ordered })),
      metrics: Object.entries(METRICS).map(([key, m]) => ({ key, label: LABELS.metric(key), unit: m.unit })),
      visualizations: VISUALIZATIONS,
      max_cells: MAX_CELLS,
    }),
  };
}

module.exports = { createPivotService, validateConfig, LABELS };
