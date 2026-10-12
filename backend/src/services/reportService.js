'use strict';

const { createDocument, heading, paragraph, addPageNumbers, ensureSpace } = require('../pdf/layout');
const { drawTable } = require('../pdf/tables');
const { drawChart } = require('../pdf/charts');
const { validateConfig, LABELS } = require('./pivotService');
const { v } = require('../middleware/validate');
const { badRequest, notFound } = require('../domain/errors');
const { MAX_SERVERS } = require('../domain/queueing');

const MAX_SECTIONS = 20;
const BREACH_MARK = '(!)';

const pad = (n) => String(n).padStart(2, '0');
/** Local wall-clock time of the server (the airport), not UTC. */
const localStamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fileStamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;

const num = (value, digits = 1) => (value === null || value === undefined ? '-' : Number(value).toFixed(digits));
const pct = (value) => (value === null || value === undefined ? '-' : `${Number(value).toFixed(1)} %`);

/** Formats one pivot value by its metric's unit. */
function formatMetric(key, value) {
  if (value === null || value === undefined) return '-';
  if (key === 'sla_compliance') return pct(value);
  if (['pax_total', 'group_count', 'breach_pax'].includes(key)) return String(value);
  return num(value, 1);
}

/** Human label for a dimension value. */
function formatDimension(key, value) {
  if (value === null || value === undefined) return '(none)';
  if (key === 'hour') return `${pad(value)}:00`;
  if (key === 'shift') return value.charAt(0).toUpperCase() + value.slice(1);
  return String(value);
}

/**
 * Validates `{ scope, sections, title }`. Scope is one session
 * (`{ session_id }`) or a date range (`{ from, to, checkpoint_id? }`).
 * Every section is a pivot configuration, checked against the whitelist.
 */
function validateRequest(body) {
  const details = [];
  const scope = body.scope;
  let parsedScope = null;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    details.push({ field: 'scope', message: 'is required' });
  } else {
    const extra = Object.keys(scope).filter((k) => !['session_id', 'from', 'to', 'checkpoint_id'].includes(k));
    extra.forEach((k) => details.push({ field: `scope.${k}`, message: 'is not an allowed field' }));
    const read = (key, rule) => {
      if (scope[key] === undefined || scope[key] === null || scope[key] === '' || (Array.isArray(scope[key]) && scope[key].length === 0)) return undefined;
      try { return rule.check(scope[key]); } catch (err) { details.push({ field: `scope.${key}`, message: err.message }); return undefined; }
    };
    const sessionId = read('session_id', v.id());
    const from = read('from', v.date());
    const to = read('to', v.date());
    const checkpointIds = read('checkpoint_id', v.idList()) ?? [];
    if (sessionId !== undefined) {
      if (from || to || checkpointIds.length) details.push({ field: 'scope', message: 'is either one session or a date range, not both' });
      parsedScope = { sessionId };
    } else if (!from || !to) {
      details.push({ field: 'scope', message: 'needs a session, or both from and to dates' });
    } else if (from > to) {
      details.push({ field: 'scope.to', message: 'must be on or after from' });
    } else {
      parsedScope = { from, to, checkpointIds };
    }
  }
  const sections = body.sections ?? [];
  if (!Array.isArray(sections)) details.push({ field: 'sections', message: 'must be a list' });
  else if (sections.length > MAX_SECTIONS) details.push({ field: 'sections', message: `must have at most ${MAX_SECTIONS} entries` });
  let title = body.title ?? '';
  if (typeof title !== 'string' || title.trim().length > 120) details.push({ field: 'title', message: 'must be text of at most 120 characters' });
  else title = title.trim();
  if (details.length > 0) throw badRequest('Some fields are invalid', details);

  // Each section goes through the pivot whitelist; report which one failed.
  const configs = sections.map((raw, index) => {
    try {
      return validateConfig(raw);
    } catch (err) {
      err.details = (err.details ?? []).map((d) => ({ ...d, field: `sections[${index}].${d.field}` }));
      throw err;
    }
  });
  return { scope: parsedScope, configs, title };
}

function createReportService({ repos, services }) {
  /** Gathers everything the report shows; nothing comes from the client but configuration. */
  function build(actor, body, now = new Date()) {
    const { scope, configs, title } = validateRequest(body ?? {});
    let scopeText;
    let scopeSlug;
    let filters;
    if (scope.sessionId) {
      const session = repos.sessions.findSummaryById(scope.sessionId);
      if (!session) throw notFound('Session not found');
      scopeText = `Session "${session.name}" - ${session.checkpoint_name}, ${session.date}`;
      scopeSlug = `session-${session.id}`;
      filters = { sessionId: session.id };
    } else {
      const names = scope.checkpointIds.map((id) => {
        const cp = repos.checkpoints.findById(id);
        if (!cp) throw notFound(`Checkpoint ${id} not found`);
        return cp.name;
      });
      scopeText = `${scope.from} to ${scope.to}, ${names.length ? names.join(', ') : 'all checkpoints'}`;
      scopeSlug = `${scope.from}_${scope.to}`;
      filters = { from: scope.from, to: scope.to, checkpointIds: scope.checkpointIds };
    }
    const summary = services.analytics.summary(filters);
    const staffing = services.analytics.bottlenecks(filters).items;
    // The server recomputes every pivot from its configuration (spec §9).
    const pivots = configs.map((config) => services.pivot.run(config));

    return {
      filename: `flowsense-report-${scopeSlug}-${fileStamp(now)}.pdf`,
      model: {
        title: title || 'FLOWSENSE queue report', scopeText, generatedBy: actor.name, generatedAt: localStamp(now), summary, staffing, pivots,
      },
    };
  }

  /** Writes the PDF for a built model into `doc` and ends it. */
  function render(doc, model) {
    cover(doc, model);
    kpiSummary(doc, model.summary);
    breachTable(doc, model.staffing);
    staffingTable(doc, model.staffing);
    model.pivots.forEach((pivot, index) => pivotSection(doc, pivot, index + 1));
    addPageNumbers(doc, `FLOWSENSE - ${model.title}`);
    doc.end();
  }

  function cover(doc, m) {
    doc.moveDown(6);
    doc.font('Helvetica-Bold').fontSize(26).fillColor('black').text('FLOWSENSE', { align: 'center' });
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(18).text(m.title, { align: 'center' });
    doc.moveDown(2);
    for (const [label, value] of [['Scope', m.scopeText], ['Generated by', m.generatedBy], ['Generated at', `${m.generatedAt} (local airport time)`]]) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#333333').text(label.toUpperCase(), { align: 'center' });
      doc.font('Helvetica').fontSize(12).fillColor('black').text(value, { align: 'center' });
      doc.moveDown(0.6);
    }
    doc.moveDown(2);
    doc.font('Helvetica-Oblique').fontSize(9).text(
      'All averages are passenger-weighted: SUM(value x pax) / SUM(pax). SLA checks use each checkpoint\'s current threshold. '
      + `Values marked ${BREACH_MARK} in bold are above the SLA.`, { align: 'center' },
    );
    doc.addPage();
  }

  function kpiSummary(doc, s) {
    heading(doc, 'KPI summary');
    if (s.pax_total === 0) {
      paragraph(doc, 'No observations in this scope.');
      return;
    }
    const over = (minutes) => s.sla_wait_minutes !== null && minutes !== null && minutes > s.sla_wait_minutes;
    const mark = (text, breach) => (breach ? { text: `${BREACH_MARK} ${text}`, bold: true } : text);
    drawTable(doc, {
      columns: [{ label: 'Indicator', weight: 2 }, { label: 'Value', weight: 1, align: 'right' }],
      rows: [
        ['Passengers', String(s.pax_total)],
        ['Groups', String(s.group_count)],
        ['Avg wait (min)', mark(num(s.avg_wait_minutes), over(s.avg_wait_minutes))],
        ['P50 wait (min)', num(s.p50_wait_minutes)],
        ['P90 wait (min)', mark(num(s.p90_wait_minutes), over(s.p90_wait_minutes))],
        ['Avg processing (min)', num(s.avg_processing_minutes)],
        ['Avg total time (min)', num(s.avg_total_minutes)],
        ['Throughput (pax/h)', num(s.throughput_per_hour)],
        ['SLA compliance', mark(pct(s.sla_compliance_pct), s.breach_pax > 0)],
        ['SLA breaches', mark(`${s.breach_pax} pax in ${s.breach_groups} groups`, s.breach_pax > 0)],
      ],
    });
  }

  function breachTable(doc, staffing) {
    heading(doc, 'SLA breaches by checkpoint');
    if (staffing.length === 0) {
      paragraph(doc, 'No observations in this scope.');
      return;
    }
    drawTable(doc, {
      columns: [{ label: 'Checkpoint', weight: 2 }, { label: 'SLA (min)', align: 'right' }, { label: 'Passengers', align: 'right' },
        { label: 'Avg wait (min)', align: 'right' }, { label: 'SLA compliance', align: 'right' }, { label: 'Breach pax', align: 'right' }, { label: 'Breach groups', align: 'right' }],
      rows: staffing.map((b) => {
        const late = b.avg_wait_minutes !== null && b.avg_wait_minutes > b.sla_wait_minutes;
        return [b.checkpoint_name, String(b.sla_wait_minutes), String(b.pax_total),
          late ? { text: `${BREACH_MARK} ${num(b.avg_wait_minutes)}`, bold: true } : num(b.avg_wait_minutes),
          pct(b.sla_compliance_pct),
          b.breach_pax > 0 ? { text: `${BREACH_MARK} ${b.breach_pax}`, bold: true } : '0',
          String(b.breach_groups)];
      }),
    });
  }

  function staffingTable(doc, staffing) {
    heading(doc, 'Staffing recommendations (M/M/c)');
    if (staffing.length === 0) {
      paragraph(doc, 'No observations in this scope.');
      return;
    }
    const overloaded = staffing.filter((b) => b.sla_status === 'overloaded');
    if (overloaded.length > 0) {
      paragraph(doc, `OVERLOADED: ${overloaded.map((b) => b.checkpoint_name).join(', ')} - arrivals exceed service capacity, the queue grows without limit.`, { font: 'Helvetica-Bold', size: 11 });
    }
    const status = { overloaded: 'OVERLOADED', breach: 'Above SLA', ok: 'Within SLA', not_enough_data: 'Not enough data' };
    drawTable(doc, {
      columns: [{ label: 'Checkpoint', weight: 1.8 }, { label: 'lambda /min', align: 'right' }, { label: 'mu /min', align: 'right' },
        { label: 'c', align: 'right', weight: 0.6 }, { label: 'rho', align: 'right', weight: 0.8 }, { label: 'Wq (min)', align: 'right' },
        { label: 'Status', weight: 1.3 }, { label: 'Servers needed', align: 'right', weight: 1.1 }],
      rows: staffing.map((b) => {
        const needed = b.recommended_exceeds_max ? `> ${MAX_SERVERS}` : (b.recommended_servers ?? '-');
        const wq = b.model ? (b.model.overloaded ? 'unbounded' : num(b.model.wq, 2)) : '-';
        const flagged = b.sla_status === 'overloaded' || b.sla_status === 'breach';
        return [b.checkpoint_name, num(b.lambda, 3), num(b.mu, 3), b.c === null ? '-' : String(b.c), b.model ? num(b.model.rho, 2) : '-',
          flagged ? { text: wq, bold: true } : wq,
          flagged ? { text: `${BREACH_MARK} ${status[b.sla_status]}`, bold: true } : status[b.sla_status],
          String(needed)];
      }),
    });
    paragraph(doc, 'lambda: passengers arriving per minute. mu: passengers one server handles per minute. c: servers observed. rho = lambda / (c x mu), the utilisation. Wq: predicted wait in queue. Servers needed: smallest c whose Wq is within the SLA. (Greek letters are spelled out because the PDF uses the standard Helvetica font.)', { size: 8, font: 'Helvetica-Oblique' });
  }

  function describeFilters(f) {
    const parts = [];
    if (f.checkpoint_id?.length) parts.push(`checkpoints ${f.checkpoint_id.map((id) => repos.checkpoints.findById(id)?.name ?? `#${id}`).join(', ')}`);
    if (f.from || f.to) parts.push(`dates ${f.from ?? '...'} to ${f.to ?? '...'}`);
    if (f.session_id) parts.push(`session #${f.session_id}`);
    return parts.length ? `Filters: ${parts.join('; ')}.` : 'Filters: none (all data).';
  }

  function pivotSection(doc, pivot, number) {
    const { config } = pivot;
    // Keep the heading with the start of its content: a chart, or the
    // first rows of a table.
    ensureSpace(doc, config.visualization === 'table' || pivot.cells.length === 0 ? 120 : 300);
    heading(doc, `${number}. ${config.title}`);
    paragraph(doc, describeFilters(config.filters), { size: 8.5, font: 'Helvetica-Oblique' });
    if (pivot.cells.length === 0) {
      paragraph(doc, 'No observations match this view.');
      return;
    }
    const rowLabels = pivot.row_values.map((r) => formatDimension(config.rows, r));
    const lookup = new Map(pivot.cells.map((c) => [JSON.stringify([c.row, c.column]), c]));
    const cell = (r, c) => lookup.get(JSON.stringify([r, c]));
    const metricLabel = (m) => `${LABELS.metric(m.key)} (${m.unit})`;

    if (config.visualization !== 'table') {
      const first = pivot.metrics[0];
      const series = config.columns
        ? pivot.column_values.map((cv) => ({ label: formatDimension(config.columns, cv), values: pivot.row_values.map((r) => cell(r, cv)?.values[first.key] ?? null) }))
        : pivot.metrics.map((m) => ({ label: metricLabel(m), values: pivot.row_values.map((r) => cell(r, null)?.values[m.key] ?? null) }));
      drawChart(doc, { type: config.visualization, categories: rowLabels, series, yLabel: config.columns || pivot.metrics.length === 1 ? metricLabel(first) : '' });
      if (config.columns && pivot.metrics.length > 1) paragraph(doc, `Chart shows ${metricLabel(first)}; the tables list every metric.`, { size: 8, font: 'Helvetica-Oblique' });
    }

    const valueCell = (c, key) => {
      if (!c) return '-';
      const text = formatMetric(key, c.values[key]);
      return key === 'avg_wait' && c.breach ? { text: `${BREACH_MARK} ${text}`, bold: true } : text;
    };
    const dimLabel = (key) => LABELS.dimension(key).replace(/^./, (ch) => ch.toUpperCase());
    if (!config.columns) {
      drawTable(doc, {
        columns: [{ label: dimLabel(config.rows), weight: 1.5 }, ...pivot.metrics.map((m) => ({ label: metricLabel(m), align: 'right' }))],
        rows: pivot.row_values.map((r, i) => [rowLabels[i], ...pivot.metrics.map((m) => valueCell(cell(r, null), m.key))]),
      });
      return;
    }
    // Row × column matrix: one table per metric, at most 7 value columns wide.
    const PER_TABLE = 7;
    for (const m of pivot.metrics) {
      for (let start = 0; start < pivot.column_values.length; start += PER_TABLE) {
        const cols = pivot.column_values.slice(start, start + PER_TABLE);
        const part = pivot.column_values.length > PER_TABLE ? ` (columns ${start + 1}-${start + cols.length} of ${pivot.column_values.length})` : '';
        paragraph(doc, `${metricLabel(m)} by ${LABELS.dimension(config.rows)} and ${LABELS.dimension(config.columns)}${part}`, { font: 'Helvetica-Bold', size: 9 });
        drawTable(doc, {
          columns: [{ label: dimLabel(config.rows), weight: 1.5 }, ...cols.map((cv) => ({ label: formatDimension(config.columns, cv), align: 'right' }))],
          rows: pivot.row_values.map((r, i) => [rowLabels[i], ...cols.map((cv) => valueCell(cell(r, cv), m.key))]),
        });
      }
    }
  }

  return {
    build,
    render,
    /** A PDFKit document for a built model. */
    createDocument: (model) => createDocument({ title: model.title, author: model.generatedBy }),
  };
}

module.exports = { createReportService, validateRequest, formatDimension, formatMetric };
