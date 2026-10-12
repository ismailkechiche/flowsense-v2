'use strict';

const { createDocument, heading, paragraph, addPageNumbers, ensureSpace, contentWidth } = require('../pdf/layout');
const { drawTable } = require('../pdf/tables');
const { drawChart } = require('../pdf/charts');
const { validateConfig, LABELS } = require('./pivotService');
const { v } = require('../middleware/validate');
const { badRequest, notFound } = require('../domain/errors');
const { MAX_SERVERS, recommendServers } = require('../domain/queueing');

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

const TOP_FLIGHTS = 15;
const CHART_BLOCK = 330; // points a heading plus a chart need
const TOP_COUNTERS = 20;
const HOUR = (h) => `${pad(h)}:00`;
const maxBy = (items, key) => items.filter((x) => x[key] !== null && x[key] !== undefined).reduce((a, b) => (!a || b[key] > a[key] ? b : a), null);

/**
 * Plain-language sentences about what stands out (the report's opening
 * summary). Pure: takes the gathered model, returns strings.
 */
function keyFindings(m) {
  const s = m.summary;
  if (s.pax_total === 0) return ['No observations in this scope, so there is nothing to summarise.'];
  const out = [];
  out.push(`${s.pax_total} passengers in ${s.group_count} groups were observed. They waited ${num(s.avg_wait_minutes)} min on average `
    + `(median ${num(s.p50_wait_minutes)} min, 9 in 10 under ${num(s.p90_wait_minutes)} min) and ${pct(s.sla_compliance_pct)} were served within the SLA.`);
  if (s.breach_pax > 0) out.push(`${s.breach_pax} passengers (${s.breach_groups} groups) waited longer than their checkpoint's SLA.`);
  const late = m.staffing.filter((b) => b.avg_wait_minutes !== null && b.avg_wait_minutes > b.sla_wait_minutes);
  if (late.length) out.push(`Average wait above the SLA at ${late.map((b) => `${b.checkpoint_name} (${num(b.avg_wait_minutes)} min vs ${b.sla_wait_minutes} min)`).join(', ')}.`);
  else if (m.staffing.length) out.push('Every checkpoint\'s average wait is within its SLA.');
  const worstCp = [...m.staffing].filter((b) => b.sla_compliance_pct !== null).sort((a, b) => a.sla_compliance_pct - b.sla_compliance_pct)[0];
  if (worstCp && m.staffing.length > 1) out.push(`Lowest SLA compliance: ${worstCp.checkpoint_name}, ${pct(worstCp.sla_compliance_pct)}.`);
  const busiest = maxBy(m.hourly, 'pax_total');
  const slowest = maxBy(m.hourly, 'avg_wait_minutes');
  if (busiest) out.push(`Busiest hour: ${HOUR(busiest.hour)} with ${busiest.pax_total} passengers (avg wait ${num(busiest.avg_wait_minutes)} min).`);
  if (slowest && (!busiest || slowest.hour !== busiest.hour)) out.push(`Longest waits at ${HOUR(slowest.hour)}: ${num(slowest.avg_wait_minutes)} min on average.`);
  if (m.trend.length > 1) {
    const worstDay = maxBy(m.trend, 'avg_wait_minutes');
    out.push(`Worst day: ${worstDay.date}, avg wait ${num(worstDay.avg_wait_minutes)} min, SLA compliance ${pct(worstDay.sla_compliance_pct)}.`);
  }
  const overloaded = m.staffing.filter((b) => b.sla_status === 'overloaded');
  if (overloaded.length) out.push(`OVERLOADED: ${overloaded.map((b) => b.checkpoint_name).join(', ')} - arrivals exceed what the counters can serve.`);
  const short = m.checkpoints.filter((c) => c.peak && c.peak.needed !== null && c.staffing.c !== null && c.peak.needed > c.staffing.c);
  if (short.length) out.push(`At the busiest hour, more counters are needed than were open at ${short.map((c) => `${c.staffing.checkpoint_name} (${c.staffing.c} open, ${c.peak.needed} needed at ${HOUR(c.peak.hour)})`).join(', ')}.`);
  const worstFlight = [...m.breakdown.flights].sort((a, b) => b.breach_pax - a.breach_pax)[0];
  if (worstFlight && worstFlight.breach_pax > 0) out.push(`Flight with the most SLA breaches: ${worstFlight.value}, ${worstFlight.breach_pax} passengers (${pct(worstFlight.sla_compliance_pct)} compliance).`);
  return out;
}

/** Why each checkpoint needs the counters it needs, in words. */
function staffingReason(c) {
  const b = c.staffing;
  if (!b.model || b.lambda === null || b.mu === null) return `${b.checkpoint_name}: not enough data to model the queue.`;
  const parts = [`${b.checkpoint_name}: about ${num(b.lambda * 60, 0)} passengers arrive per hour and one counter serves about ${num(b.mu * 60, 1)} per hour, `
    + `so ${b.c} counter(s) are busy ${pct(b.model.rho * 100)} of the time.`];
  if (b.model.overloaded) parts.push('That is more work than the counters can do: the queue keeps growing.');
  else parts.push(`Over the whole period the model predicts a ${num(b.model.wq, 1)} min wait against a ${b.sla_wait_minutes} min SLA.`);
  if (b.avg_wait_minutes !== null && b.model && !b.model.overloaded && b.avg_wait_minutes > b.sla_wait_minutes && b.model.wq <= b.sla_wait_minutes) {
    parts.push(`Yet passengers actually waited ${num(b.avg_wait_minutes)} min on average: arrivals are not spread evenly, and the queue builds at peak times.`);
  }
  if (c.peak) {
    const p = c.peak;
    parts.push(`At the busiest hour (${HOUR(p.hour)}, about ${num(p.arrivals_per_hour, 0)} passengers per hour) `
      + (p.exceeded ? `even ${MAX_SERVERS} counters would not keep the wait within the SLA.` : `${p.needed} counter(s) are needed to stay within the SLA.`));
  }
  if (b.recommended_exceeds_max) parts.push(`Recommendation: more than ${MAX_SERVERS} counters, or faster processing.`);
  else if (b.recommended_servers !== null) {
    const peakNeed = c.peak && !c.peak.exceeded ? c.peak.needed : b.recommended_servers;
    const need = Math.max(b.recommended_servers, peakNeed ?? 0);
    parts.push(need > b.c ? `Recommendation: open ${need} counters at peak times (${need - b.c} more than observed).`
      : `Recommendation: ${b.c} counters are enough${b.recommended_servers < b.c ? `; ${b.recommended_servers} would do outside the peak` : ''}.`);
  }
  return parts.join(' ');
}

function createReportService({ repos, services }) {
  /** Per-checkpoint detail: KPIs, staffing and the peak hour's needs. */
  function checkpointDetail(filters, staffing) {
    return staffing.map((b) => {
      const scoped = { ...filters, checkpointIds: [b.checkpoint_id] };
      const summary = services.analytics.summary(scoped);
      const hourly = services.analytics.hourly(scoped).items;
      const top = maxBy(hourly, 'throughput_per_hour');
      let peak = null;
      if (top && b.mu) {
        const lambda = top.throughput_per_hour / 60;
        const advice = recommendServers(lambda, b.mu, b.sla_wait_minutes);
        peak = { hour: top.hour, arrivals_per_hour: top.throughput_per_hour, avg_wait_minutes: top.avg_wait_minutes, needed: advice.servers, exceeded: advice.exceeded };
      }
      return { staffing: b, summary, hourly, peak };
    });
  }

  /** Gathers everything the report shows; nothing comes from the client but configuration. */
  function build(actor, body, now = new Date()) {
    const { scope, configs, title } = validateRequest(body ?? {});
    let scopeText;
    let scopeSlug;
    let filters;
    let pivotFilters;
    if (scope.sessionId) {
      const session = repos.sessions.findSummaryById(scope.sessionId);
      if (!session) throw notFound('Session not found');
      scopeText = `Session "${session.name}" - ${session.checkpoint_name}, ${session.date}`;
      scopeSlug = `session-${session.id}`;
      filters = { sessionId: session.id };
      pivotFilters = { session_id: session.id };
    } else {
      const names = scope.checkpointIds.map((id) => {
        const cp = repos.checkpoints.findById(id);
        if (!cp) throw notFound(`Checkpoint ${id} not found`);
        return cp.name;
      });
      scopeText = `${scope.from} to ${scope.to}, ${names.length ? names.join(', ') : 'all checkpoints'}`;
      scopeSlug = `${scope.from}_${scope.to}`;
      filters = { from: scope.from, to: scope.to, checkpointIds: scope.checkpointIds };
      pivotFilters = { from: scope.from, to: scope.to, ...(scope.checkpointIds.length ? { checkpoint_id: scope.checkpointIds } : {}) };
    }
    const summary = services.analytics.summary(filters);
    const staffing = services.analytics.bottlenecks(filters).items;
    const hourly = services.analytics.hourly(filters).items;
    const trend = services.analytics.trend(filters).items;
    const distribution = services.analytics.distribution(filters);
    const breakdown = services.analytics.breakdown(filters);
    const checkpoints = checkpointDetail(filters, staffing);
    // Avg wait by hour and checkpoint, through the pivot whitelist.
    const hourByCheckpoint = staffing.length > 1
      ? services.pivot.run(validateConfig({ rows: 'hour', columns: 'checkpoint', metrics: ['avg_wait'], visualization: 'table', title: 'hour x checkpoint', filters: pivotFilters }))
      : null;
    // The server recomputes every pivot from its configuration (spec §9).
    const pivots = configs.map((config) => services.pivot.run(config));

    const model = {
      title: title || 'FLOWSENSE queue report', scopeText, generatedBy: actor.name, generatedAt: localStamp(now),
      summary, staffing, hourly, trend, distribution, breakdown, checkpoints, hourByCheckpoint, pivots,
    };
    model.findings = keyFindings(model);
    return { filename: `flowsense-report-${scopeSlug}-${fileStamp(now)}.pdf`, model };
  }

  /** Writes the PDF for a built model into `doc` and ends it. */
  function render(doc, model) {
    cover(doc, model);
    findingsSection(doc, model);
    kpiSummary(doc, model.summary);
    if (model.summary.pax_total > 0) {
      checkpointSection(doc, model);
      hourlySection(doc, model);
      trendSection(doc, model.trend);
      distributionSection(doc, model);
      breakdownSection(doc, model.breakdown);
    }
    breachSection(doc, model);
    staffingSection(doc, model);
    model.pivots.forEach((pivot, index) => pivotSection(doc, pivot, index + 1));
    glossary(doc);
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
    doc.moveDown(1.5);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#333333').text('CONTENTS', { align: 'center' });
    const contents = ['Key findings', 'KPI summary', 'By checkpoint', 'By hour of day', 'Daily trend', 'Wait time distribution',
      'Flights and counters', 'SLA breach details', 'Staffing recommendations'];
    if (m.pivots.length) contents.push(`Your sections (${m.pivots.length})`);
    contents.push('Glossary');
    doc.font('Helvetica').fontSize(10).fillColor('black').text(contents.join('  ·  '), { align: 'center' });
    doc.moveDown(2);
    doc.font('Helvetica-Oblique').fontSize(9).text(
      'All averages are passenger-weighted: SUM(value x pax) / SUM(pax). SLA checks use each checkpoint\'s current threshold. '
      + `Values marked ${BREACH_MARK} in bold are above the SLA.`, { align: 'center' },
    );
    doc.addPage();
  }

  function bullets(doc, lines) {
    for (const line of lines) {
      ensureSpace(doc, 30);
      const y = doc.y;
      doc.font('Helvetica').fontSize(10).fillColor('black').text('-', doc.page.margins.left, y, { width: 10 });
      doc.text(line, doc.page.margins.left + 12, y, { width: contentWidth(doc) - 12 });
      doc.moveDown(0.35);
    }
    doc.x = doc.page.margins.left;
    doc.moveDown(0.3);
  }

  function findingsSection(doc, m) {
    heading(doc, 'Key findings');
    bullets(doc, m.findings);
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
      columns: [{ label: 'Indicator', weight: 2 }, { label: 'Value', weight: 1, align: 'right' }, { label: 'What it means', weight: 3.2 }],
      rows: [
        ['Passengers', String(s.pax_total), 'People observed (a group of 4 counts 4).'],
        ['Groups', String(s.group_count), 'Observation rows (families or travel groups).'],
        ['Avg wait (min)', mark(num(s.avg_wait_minutes), over(s.avg_wait_minutes)), 'Queue join to counter, passenger-weighted.'],
        ['P50 wait (min)', num(s.p50_wait_minutes), 'Half of the passengers waited less than this.'],
        ['P90 wait (min)', mark(num(s.p90_wait_minutes), over(s.p90_wait_minutes)), '9 in 10 passengers waited less than this.'],
        ['Avg processing (min)', num(s.avg_processing_minutes), 'Time at the counter.'],
        ['Avg total time (min)', num(s.avg_total_minutes), 'Wait plus processing.'],
        ['Throughput (pax/h)', num(s.throughput_per_hour), 'Passengers served per observed hour.'],
        ['SLA compliance', mark(pct(s.sla_compliance_pct), s.breach_pax > 0), 'Share of passengers within the SLA.'],
        ['SLA breaches', mark(`${s.breach_pax} pax in ${s.breach_groups} groups`, s.breach_pax > 0), 'Passengers who waited longer than the SLA.'],
      ],
    });
  }

  function checkpointSection(doc, m) {
    ensureSpace(doc, CHART_BLOCK); // keep the heading with its chart
    heading(doc, 'By checkpoint');
    paragraph(doc, 'Average wait against each checkpoint\'s SLA target, then the detailed figures.', { size: 9, font: 'Helvetica-Oblique' });
    drawChart(doc, {
      type: 'bar', categories: m.checkpoints.map((c) => c.staffing.checkpoint_name), yLabel: 'Minutes',
      series: [
        { label: 'Avg wait (min)', values: m.checkpoints.map((c) => c.summary.avg_wait_minutes) },
        { label: 'P90 wait (min)', values: m.checkpoints.map((c) => c.summary.p90_wait_minutes) },
        { label: 'SLA (min)', values: m.checkpoints.map((c) => c.staffing.sla_wait_minutes) },
      ],
    });
    drawTable(doc, {
      columns: [{ label: 'Checkpoint', weight: 1.7 }, { label: 'Pax', align: 'right', weight: 0.8 }, { label: 'Avg wait', align: 'right' },
        { label: 'P90 wait', align: 'right' }, { label: 'Avg proc.', align: 'right' }, { label: 'Pax/h', align: 'right', weight: 0.8 },
        { label: 'SLA', align: 'right', weight: 0.7 }, { label: 'Compliance', align: 'right', weight: 1.1 }, { label: 'Peak hour', align: 'right', weight: 1.4 }],
      rows: m.checkpoints.map(({ staffing: b, summary: s, peak }) => {
        const late = s.avg_wait_minutes !== null && s.avg_wait_minutes > b.sla_wait_minutes;
        return [b.checkpoint_name, String(s.pax_total),
          late ? { text: `${BREACH_MARK} ${num(s.avg_wait_minutes)}`, bold: true } : num(s.avg_wait_minutes),
          num(s.p90_wait_minutes), num(s.avg_processing_minutes), num(s.throughput_per_hour, 0), String(b.sla_wait_minutes),
          pct(s.sla_compliance_pct), peak ? `${HOUR(peak.hour)} (${num(peak.arrivals_per_hour, 0)}/h)` : '-'];
      }),
    });
    paragraph(doc, 'Minutes unless stated. Pax/h: passengers served per observed hour. Peak hour: the hour with the most arrivals per day observed.', { size: 8, font: 'Helvetica-Oblique' });
  }

  function hourlySection(doc, m) {
    if (m.hourly.length === 0) return;
    ensureSpace(doc, CHART_BLOCK); // keep the heading with its chart
    heading(doc, 'By hour of day');
    const labels = m.hourly.map((x) => HOUR(x.hour));
    drawChart(doc, { type: 'bar', categories: labels, series: [{ label: 'Passengers', values: m.hourly.map((x) => x.pax_total) }], yLabel: 'Passengers' });
    if (m.hourly.length > 1) {
      drawChart(doc, { type: 'line', categories: labels, series: [{ label: 'Avg wait (min)', values: m.hourly.map((x) => x.avg_wait_minutes) }], yLabel: 'Avg wait (min)' });
    }
    drawTable(doc, {
      columns: [{ label: 'Hour', weight: 1.2 }, { label: 'Passengers', align: 'right' }, { label: 'Pax per day', align: 'right' },
        { label: 'Avg wait (min)', align: 'right' }, { label: 'SLA compliance', align: 'right' }, { label: 'Breach pax', align: 'right' }],
      rows: m.hourly.map((x) => [`${HOUR(x.hour)}-${pad(x.hour)}:59`, String(x.pax_total), num(x.throughput_per_hour, 1),
        num(x.avg_wait_minutes), pct(x.sla_compliance_pct), x.breach_pax > 0 ? { text: `${BREACH_MARK} ${x.breach_pax}`, bold: true } : '0']),
    });
    const hc = m.hourByCheckpoint;
    if (hc && hc.cells.length) {
      const lookup = new Map(hc.cells.map((c) => [JSON.stringify([c.row, c.column]), c]));
      ensureSpace(doc, 120);
      paragraph(doc, 'Avg wait (min) by hour and checkpoint', { font: 'Helvetica-Bold', size: 9 });
      drawTable(doc, {
        columns: [{ label: 'Hour', weight: 1.2 }, ...hc.column_values.map((cv) => ({ label: String(cv), align: 'right' }))],
        rows: hc.row_values.map((r) => [HOUR(r), ...hc.column_values.map((cv) => {
          const cell = lookup.get(JSON.stringify([r, cv]));
          if (!cell) return '-';
          const text = num(cell.values.avg_wait);
          return cell.breach ? { text: `${BREACH_MARK} ${text}`, bold: true } : text;
        })]),
      });
    }
  }

  function trendSection(doc, trend) {
    if (trend.length < 2) return;
    ensureSpace(doc, CHART_BLOCK); // keep the heading with its chart
    heading(doc, 'Daily trend');
    const labels = trend.map((d) => d.date.slice(5));
    drawChart(doc, {
      type: 'line', categories: labels, yLabel: '',
      series: [{ label: 'Avg wait (min)', values: trend.map((d) => d.avg_wait_minutes) }, { label: 'SLA compliance (%)', values: trend.map((d) => d.sla_compliance_pct) }],
    });
    drawTable(doc, {
      columns: [{ label: 'Date', weight: 1.3 }, { label: 'Passengers', align: 'right' }, { label: 'Avg wait (min)', align: 'right' },
        { label: 'SLA compliance', align: 'right' }, { label: 'Breach pax', align: 'right' }],
      rows: trend.map((d) => [d.date, String(d.pax_total), num(d.avg_wait_minutes), pct(d.sla_compliance_pct), String(d.breach_pax)]),
    });
  }

  function distributionSection(doc, m) {
    const { bins, bin_minutes: binMinutes, sla_thresholds: thresholds } = m.distribution;
    const total = bins.reduce((a, b) => a + b.pax, 0);
    if (total === 0) return;
    ensureSpace(doc, CHART_BLOCK); // keep the heading with its chart
    heading(doc, 'Wait time distribution');
    const last = bins.reduce((at, b, i) => (b.pax > 0 ? i : at), 0);
    const shown = bins.slice(0, last + 1);
    const label = (b) => (b.to_minutes === null ? `${b.from_minutes}+` : `${b.from_minutes}-${b.to_minutes}`);
    drawChart(doc, { type: 'bar', categories: shown.map(label), series: [{ label: `Passengers per ${binMinutes}-minute wait band`, values: shown.map((b) => b.pax) }], yLabel: 'Passengers' });
    const within = (minutes) => bins.filter((b) => b.to_minutes !== null && b.to_minutes <= minutes).reduce((a, b) => a + b.pax, 0);
    paragraph(doc, `Median wait ${num(m.summary.p50_wait_minutes)} min; 9 in 10 passengers waited under ${num(m.summary.p90_wait_minutes)} min. `
      + thresholds.map((t) => `${pct((within(t) / total) * 100)} waited ${t} min or less`).join('; ') + '.', { size: 9 });
    let cumulative = 0;
    drawTable(doc, {
      columns: [{ label: 'Wait (min)', weight: 1.2 }, { label: 'Passengers', align: 'right' }, { label: 'Groups', align: 'right' }, { label: 'Share', align: 'right' }, { label: 'Cumulative', align: 'right' }],
      rows: shown.filter((b) => b.pax > 0).map((b) => {
        cumulative += b.pax;
        return [label(b), String(b.pax), String(b.group_count), pct((b.pax / total) * 100), pct((cumulative / total) * 100)];
      }),
    });
  }

  function breakdownTable(doc, rows, label) {
    drawTable(doc, {
      columns: [{ label, weight: 1.3 }, { label: 'Passengers', align: 'right' }, { label: 'Groups', align: 'right' }, { label: 'Avg wait (min)', align: 'right' },
        { label: 'Avg proc. (min)', align: 'right' }, { label: 'SLA compliance', align: 'right' }, { label: 'Breach pax', align: 'right' }],
      rows: rows.map((r) => [r.value, String(r.pax_total), String(r.group_count), num(r.avg_wait_minutes), num(r.avg_processing_minutes),
        pct(r.sla_compliance_pct), r.breach_pax > 0 ? { text: `${BREACH_MARK} ${r.breach_pax}`, bold: true } : '0']),
    });
  }

  function breakdownSection(doc, b) {
    ensureSpace(doc, b.flights.length ? CHART_BLOCK + 40 : 120);
    heading(doc, 'Flights and counters');
    if (b.flights.length === 0 && b.counters.length === 0) {
      paragraph(doc, 'No flight numbers or counters were recorded in this scope.');
      return;
    }
    if (b.flights.length) {
      ensureSpace(doc, CHART_BLOCK);
      heading(doc, `By flight${b.flights_total > TOP_FLIGHTS ? ` (the ${TOP_FLIGHTS} busiest of ${b.flights_total})` : ''}`, 2);
      const top = b.flights.slice(0, TOP_FLIGHTS);
      drawChart(doc, { type: 'bar', categories: top.map((r) => r.value), series: [{ label: 'Avg wait (min)', values: top.map((r) => r.avg_wait_minutes) }, { label: 'Avg processing (min)', values: top.map((r) => r.avg_processing_minutes) }], yLabel: 'Minutes' });
      breakdownTable(doc, top, 'Flight');
    }
    if (b.counters.length) {
      heading(doc, `By counter${b.counters_total > TOP_COUNTERS ? ` (the ${TOP_COUNTERS} busiest of ${b.counters_total})` : ''}`, 2);
      breakdownTable(doc, b.counters.slice(0, TOP_COUNTERS), 'Counter');
    }
  }

  function breachSection(doc, m) {
    const staffing = m.staffing;
    heading(doc, 'SLA breach details');
    if (staffing.length === 0) {
      paragraph(doc, 'No observations in this scope.');
      return;
    }
    heading(doc, 'By checkpoint', 2);
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
    const hours = m.hourly.filter((x) => x.breach_pax > 0).sort((a, b) => b.breach_pax - a.breach_pax).slice(0, 6);
    if (hours.length) {
      heading(doc, 'Hours with the most breaches', 2);
      drawTable(doc, {
        columns: [{ label: 'Hour', weight: 1.2 }, { label: 'Breach pax', align: 'right' }, { label: 'Share of hour', align: 'right' }, { label: 'Avg wait (min)', align: 'right' }],
        rows: hours.map((x) => [HOUR(x.hour), String(x.breach_pax), pct((x.breach_pax / x.pax_total) * 100), num(x.avg_wait_minutes)]),
      });
    }
    const flights = [...m.breakdown.flights].filter((f) => f.breach_pax > 0).sort((a, b) => b.breach_pax - a.breach_pax).slice(0, 10);
    if (flights.length) {
      heading(doc, 'Flights with the most breaches', 2);
      drawTable(doc, {
        columns: [{ label: 'Flight', weight: 1.2 }, { label: 'Breach pax', align: 'right' }, { label: 'Passengers', align: 'right' }, { label: 'SLA compliance', align: 'right' }, { label: 'Avg wait (min)', align: 'right' }],
        rows: flights.map((f) => [f.value, String(f.breach_pax), String(f.pax_total), pct(f.sla_compliance_pct), num(f.avg_wait_minutes)]),
      });
    }
  }

  function staffingSection(doc, m) {
    const staffing = m.staffing;
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
    const peakOf = new Map(m.checkpoints.map((c) => [c.staffing.checkpoint_id, c.peak]));
    drawTable(doc, {
      columns: [{ label: 'Checkpoint', weight: 1.7 }, { label: 'lambda /h', align: 'right', weight: 0.9 }, { label: 'mu /h', align: 'right', weight: 0.8 },
        { label: 'c', align: 'right', weight: 0.5 }, { label: 'rho', align: 'right', weight: 0.8 }, { label: 'Wq (min)', align: 'right', weight: 0.9 },
        { label: 'Status', weight: 1.3 }, { label: 'Needed (avg)', align: 'right', weight: 1 }, { label: 'Needed (peak)', align: 'right', weight: 1 }],
      rows: staffing.map((b) => {
        const needed = b.recommended_exceeds_max ? `> ${MAX_SERVERS}` : (b.recommended_servers ?? '-');
        const peak = peakOf.get(b.checkpoint_id);
        const peakNeeded = !peak ? '-' : (peak.exceeded ? `> ${MAX_SERVERS}` : String(peak.needed));
        const wq = b.model ? (b.model.overloaded ? 'unbounded' : num(b.model.wq, 2)) : '-';
        const flagged = b.sla_status === 'overloaded' || b.sla_status === 'breach';
        return [b.checkpoint_name, b.lambda === null ? '-' : num(b.lambda * 60, 1), b.mu === null ? '-' : num(b.mu * 60, 1), b.c === null ? '-' : String(b.c),
          b.model ? pct(b.model.rho * 100) : '-',
          flagged ? { text: wq, bold: true } : wq,
          flagged ? { text: `${BREACH_MARK} ${status[b.sla_status]}`, bold: true } : status[b.sla_status],
          String(needed), peak && peak.needed !== null && b.c !== null && peak.needed > b.c ? { text: peakNeeded, bold: true } : peakNeeded];
      }),
    });
    heading(doc, 'Reasoning', 2);
    bullets(doc, m.checkpoints.map(staffingReason));
    paragraph(doc, 'Needed (avg): fewest counters whose predicted wait is within the SLA at the period\'s average arrival rate. '
      + 'Needed (peak): the same at the busiest hour\'s arrival rate. The model assumes random arrivals and service times; real queues at peaks are usually longer.', { size: 8, font: 'Helvetica-Oblique' });
  }

  function glossary(doc) {
    heading(doc, 'Glossary');
    const terms = [
      ['lambda (arrival rate)', 'Passengers arriving per hour (per minute in the model).'],
      ['mu (service rate)', 'Passengers one counter serves per hour: total passengers / total processing time.'],
      ['c (counters)', 'Counters open at the same time: those recorded in the data, else the configured number.'],
      ['rho (utilisation)', 'lambda / (c x mu): share of counter time spent serving. At 100 % or more the queue never clears.'],
      ['Wq', 'Predicted wait in the queue from the M/M/c (Erlang C) model.'],
      ['P50 / P90', 'Half / 9 in 10 of the passengers waited less than this.'],
      ['SLA compliance', 'Share of passengers whose wait was within the checkpoint\'s SLA threshold.'],
      ['Passenger-weighted', 'Each group counts as many times as it has passengers.'],
    ];
    drawTable(doc, { columns: [{ label: 'Term', weight: 1.3 }, { label: 'Meaning', weight: 4 }], rows: terms.map(([a, b]) => [{ text: a, bold: true }, b]) });
    paragraph(doc, '(Greek letters are spelled out because the PDF uses the standard Helvetica font.)', { size: 8, font: 'Helvetica-Oblique' });
  }

  function describeFilters(f) {
    const parts = [];
    if (f.checkpoint_id?.length) parts.push(`checkpoints ${f.checkpoint_id.map((id) => repos.checkpoints.findById(id)?.name ?? `#${id}`).join(', ')}`);
    if (f.from || f.to) parts.push(`dates ${f.from ?? '...'} to ${f.to ?? '...'}`);
    if (f.session_id) parts.push(`session #${f.session_id}`);
    return parts.length ? `Filters: ${parts.join('; ')}.` : 'Filters: none (all data).';
  }

  /**
   * One pivot section. A chart section draws only the chart(s), one per
   * metric when the view is split by columns; a table section draws only
   * the table (Hafedh's request, 2026-10-12: no table under a chart).
   */
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
      if (!config.columns) {
        const series = pivot.metrics.map((m) => ({ label: metricLabel(m), values: pivot.row_values.map((r) => cell(r, null)?.values[m.key] ?? null) }));
        drawChart(doc, { type: config.visualization, categories: rowLabels, series, yLabel: pivot.metrics.length === 1 ? metricLabel(pivot.metrics[0]) : '' });
        return;
      }
      for (const m of pivot.metrics) {
        if (pivot.metrics.length > 1) paragraph(doc, `${metricLabel(m)} by ${LABELS.dimension(config.rows)} and ${LABELS.dimension(config.columns)}`, { font: 'Helvetica-Bold', size: 9 });
        const series = pivot.column_values.map((cv) => ({ label: formatDimension(config.columns, cv), values: pivot.row_values.map((r) => cell(r, cv)?.values[m.key] ?? null) }));
        drawChart(doc, { type: config.visualization, categories: rowLabels, series, yLabel: metricLabel(m) });
      }
      return;
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

module.exports = { createReportService, validateRequest, formatDimension, formatMetric, keyFindings, staffingReason };
