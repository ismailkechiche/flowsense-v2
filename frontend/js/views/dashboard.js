import { h, message, clear, loading, emptyState } from '../dom.js';
import { t } from '../i18n.js';
import { api, query } from '../api.js';
import { errorText, pageHeader, card, term, tabs, recall, remember } from './common.js';
import { analyticsFilters, fmt, fmtPct } from './analyticsFilters.js';
import { barChart, chartBox, destroyCharts, histogramChart, hourlyChart, trendChart } from '../charts/charts.js';

const TABS = [
  { key: 'overview', icon: 'dashboard' },
  { key: 'time', icon: 'clock' },
  { key: 'staffing', icon: 'users' },
  { key: 'flights', icon: 'plane' },
];
const ENDPOINTS = ['summary', 'bottlenecks', 'hourly', 'breakdown', 'distribution', 'trend'];
const TAB_KEY = 'flowsense.dashboard.tab';
const FLIGHT_CHART_LIMIT = 12;

const th = (label, cls) => h('th', { scope: 'col', class: cls }, label);
const td = (value, cls = 'num') => h('td', { class: cls }, value);
const breachBadge = () => h('span', { class: 'badge breach' }, `⚠ ${t('sessions.breach')}`);
const hourLabel = (hour) => `${String(hour).padStart(2, '0')}:00`;

function table(headers, rows, compact = true) {
  return h('div', { class: 'table-wrap' }, h('table', { class: compact ? 'compact' : null },
    h('thead', {}, h('tr', {}, headers.map(([label, cls]) => th(label, cls)))),
    h('tbody', {}, rows)));
}

/** Exact numbers behind a chart, folded away by default. */
const numbers = (content, label = t('dash.showNumbers')) => h('details', { class: 'numbers' }, h('summary', {}, label), content);

/**
 * A chart in a card. Returns the card and a `draw` callback: charts need a
 * visible box to size themselves, so drawing waits until the tab is shown.
 */
function chartCard({ title, subtitle, iconName, tone, draw, after = [], tall = false }) {
  const { box, canvas } = chartBox(title);
  if (tall) box.classList.add('tall');
  return { node: card({ title, subtitle, icon: iconName, tone, className: 'chart-card' }, box, ...after), draw: () => draw(canvas) };
}

function kpi(label, value, { breach = false, tone = null, hint, sub, small = false } = {}) {
  return h('div', { class: `kpi${small ? ' small' : ''}${tone ? ` tone-${tone}` : ''}${breach ? ' breach' : ''}` },
    h('div', { class: 'kpi-label' }, hint ? term(label, hint) : label),
    h('div', { class: 'kpi-value' }, value, breach ? h('span', { class: 'visually-hidden' }, ` (${t('sessions.breach')})`) : null),
    sub ? h('div', { class: 'kpi-sub' }, sub) : null);
}

// ---- Overview --------------------------------------------------------------

/** Plain-language sentences about what stands out in the loaded data. */
export function keyFindings({ summary: s, bottlenecks, hourly, trend }) {
  const out = [];
  if (!s || s.pax_total === 0) return out;
  out.push(t('find.volume', { pax: s.pax_total, groups: s.group_count, wait: fmt(s.avg_wait_minutes), pct: fmtPct(s.sla_compliance_pct) }));
  const busiest = hourly?.items?.length ? hourly.items.reduce((a, b) => (b.pax_total > a.pax_total ? b : a)) : null;
  if (busiest) out.push(t('find.peakHour', { hour: hourLabel(busiest.hour), pax: busiest.pax_total, wait: fmt(busiest.avg_wait_minutes) }));
  const longest = hourly?.items?.filter((x) => x.avg_wait_minutes !== null).reduce((a, b) => (!a || b.avg_wait_minutes > a.avg_wait_minutes ? b : a), null);
  if (longest && busiest && longest.hour !== busiest.hour) out.push(t('find.worstHour', { hour: hourLabel(longest.hour), wait: fmt(longest.avg_wait_minutes) }));
  const items = bottlenecks?.items ?? [];
  const late = items.filter((b) => b.avg_wait_minutes !== null && b.avg_wait_minutes > b.sla_wait_minutes);
  if (late.length) {
    out.push(t('find.lateCheckpoints', { list: late.map((b) => `${b.checkpoint_name} (${fmt(b.avg_wait_minutes)} / ${b.sla_wait_minutes} min)`).join(', ') }));
  } else if (items.length) {
    out.push(t('find.allWithin'));
  }
  const overloaded = items.filter((b) => b.sla_status === 'overloaded');
  if (overloaded.length) out.push(t('find.overloaded', { list: overloaded.map((b) => b.checkpoint_name).join(', ') }));
  const short = items.filter((b) => b.recommended_servers !== null && b.c !== null && b.recommended_servers > b.c);
  if (short.length) out.push(t('find.shortStaffed', { list: short.map((b) => `${b.checkpoint_name} (${b.c} → ${b.recommended_servers})`).join(', ') }));
  const days = trend?.items ?? [];
  if (days.length > 1) {
    const worst = days.filter((d) => d.avg_wait_minutes !== null).reduce((a, b) => (!a || b.avg_wait_minutes > a.avg_wait_minutes ? b : a), null);
    if (worst) out.push(t('find.worstDay', { date: worst.date, wait: fmt(worst.avg_wait_minutes), pct: fmtPct(worst.sla_compliance_pct) }));
  }
  return out;
}

function overview(data) {
  const s = data.summary;
  if (!s) return { nodes: [h('p', { class: 'message error' }, errorText(data.errors.summary))], draws: [] };
  if (s.pax_total === 0) return { nodes: [emptyState(t('dash.noData'), t('dash.noDataHint'), null, 'dashboard')], draws: [] };
  const sla = s.sla_wait_minutes;
  const over = (minutes) => sla !== null && minutes !== null && minutes > sla;
  const nodes = [
    h('div', { class: 'kpi-grid headline' },
      kpi(t('dash.avgWait'), `${fmt(s.avg_wait_minutes)} min`, { breach: over(s.avg_wait_minutes), hint: t('hint.avgWait'), sub: sla !== null ? t('dash.slaIs', { minutes: sla }) : t('dash.slaPerCheckpoint') }),
      kpi(t('dash.p90Wait'), `${fmt(s.p90_wait_minutes)} min`, { breach: over(s.p90_wait_minutes), tone: 'violet', hint: t('hint.p90'), sub: t('dash.p50', { minutes: fmt(s.p50_wait_minutes) }) }),
      kpi(t('dash.slaCompliance'), fmtPct(s.sla_compliance_pct), { breach: s.breach_pax > 0, tone: 'teal', hint: t('hint.sla'), sub: t('dash.breaches', { pax: s.breach_pax, groups: s.breach_groups }) }),
      kpi(t('dash.totalPax'), String(s.pax_total), { tone: 'amber', sub: t('dash.inGroups', { groups: s.group_count }) })),
    h('div', { class: 'kpi-grid' },
      kpi(t('dash.avgProcessing'), `${fmt(s.avg_processing_minutes)} min`, { small: true, tone: 'muted', hint: t('hint.processing') }),
      kpi(t('dash.avgTotal'), `${fmt(s.avg_total_minutes)} min`, { small: true, tone: 'muted', hint: t('hint.total') }),
      kpi(t('dash.throughput'), `${fmt(s.throughput_per_hour, 0)} ${t('dash.paxPerHour')}`, { small: true, tone: 'muted', hint: t('hint.throughput') })),
  ];
  const draws = [];
  const findings = keyFindings(data);
  const grid = h('div', { class: 'grid-2' });
  if (findings.length) {
    grid.append(card({ title: t('dash.findings'), subtitle: t('dash.findingsHelp'), icon: 'info' },
      h('ul', { class: 'findings' }, findings.map((f) => h('li', {}, f)))));
  }
  const items = data.bottlenecks?.items ?? [];
  if (items.length) {
    const sorted = [...items].sort((a, b) => a.checkpoint_name.localeCompare(b.checkpoint_name));
    const chart = chartCard({
      title: t('dash.waitByCheckpoint'), subtitle: t('dash.waitByCheckpointHelp'), iconName: 'checkpoints', tone: 'teal',
      draw: (canvas) => barChart(canvas, {
        labels: sorted.map((b) => b.checkpoint_name),
        valueTitle: t('dash.minutes'),
        datasets: [
          { label: t('dash.avgWait'), data: sorted.map((b) => b.avg_wait_minutes), tones: sorted.map((b) => (b.avg_wait_minutes > b.sla_wait_minutes ? 'danger' : 'ok')) },
          { type: 'line', label: t('dash.slaTarget'), data: sorted.map((b) => b.sla_wait_minutes), tone: 'text', showLine: false, pointStyle: 'line', pointRadius: 22, pointHoverRadius: 22, borderWidth: 3 },
        ],
      }),
    });
    grid.append(chart.node);
    draws.push(chart.draw);
  }
  nodes.push(grid);
  return { nodes, draws };
}

// ---- Hours and days -------------------------------------------------------

function timeTab(data) {
  const nodes = [];
  const draws = [];
  const hourly = data.hourly?.items ?? [];
  if (hourly.length === 0) return { nodes: [emptyState(t('dash.noData'), t('dash.noDataHint'), null, 'clock')], draws };
  const hourChart = chartCard({
    title: t('dash.hourlyChart'), subtitle: t('dash.hourlyHelp'), iconName: 'clock', draw: (canvas) => hourlyChart(canvas, hourly),
    after: [numbers(table([[t('dash.hour')], [t('dash.passengers'), 'num'], [t('dash.throughput'), 'num'], [t('dash.avgWait'), 'num'], [t('dash.slaCompliance'), 'num']],
      hourly.map((x) => h('tr', {},
        td(`${hourLabel(x.hour)}–${String(x.hour).padStart(2, '0')}:59`, ''),
        td(String(x.pax_total)), td(`${fmt(x.throughput_per_hour, 1)} ${t('dash.paxPerHour')}`),
        td(fmt(x.avg_wait_minutes)), h('td', { class: 'num' }, fmtPct(x.sla_compliance_pct), ' ', x.breach_pax > 0 ? breachBadge() : null)))))],
  });
  nodes.push(hourChart.node);
  draws.push(hourChart.draw);

  const grid = h('div', { class: 'grid-2' });
  const days = data.trend?.items ?? [];
  if (days.length > 1) {
    const trend = chartCard({ title: t('dash.trendChart'), subtitle: t('dash.trendHelp'), iconName: 'calendar', tone: 'violet', draw: (canvas) => trendChart(canvas, days) });
    grid.append(trend.node);
    draws.push(trend.draw);
  } else {
    grid.append(card({ title: t('dash.trendChart'), icon: 'calendar', tone: 'violet' }, h('p', { class: 'muted' }, t('dash.oneDay'))));
  }
  const d = data.distribution;
  if (d && d.bins.some((b) => b.pax > 0)) {
    const dist = chartCard({ title: t('dash.histogramTitle'), subtitle: t('dash.histogramHelp'), iconName: 'dashboard', tone: 'amber', draw: (canvas) => histogramChart(canvas, d) });
    grid.append(dist.node);
    draws.push(dist.draw);
  }
  nodes.push(grid);
  return { nodes, draws };
}

// ---- Staffing ---------------------------------------------------------------

function statusBadge(b) {
  if (b.sla_status === 'overloaded') return h('span', { class: 'badge overloaded' }, t('dash.overloaded'));
  if (b.sla_status === 'breach') return breachBadge();
  if (b.sla_status === 'ok') return h('span', { class: 'badge ok' }, t('dash.withinSla'));
  return h('span', { class: 'badge' }, t('dash.notEnoughData'));
}

function staffing(data) {
  if (!data.bottlenecks) return { nodes: [h('p', { class: 'message error' }, errorText(data.errors.bottlenecks))], draws: [] };
  const { items, max_servers: maxServers } = data.bottlenecks;
  if (items.length === 0) return { nodes: [emptyState(t('dash.noData'), t('dash.noDataHint'), null, 'users')], draws: [] };
  const m = (b, key, digits = 2) => (b.model ? fmt(b.model[key], digits) : '—');
  const needed = (b) => {
    if (b.recommended_exceeds_max) return t('dash.moreThan', { max: maxServers });
    if (b.recommended_servers === null) return '—';
    const delta = b.recommended_servers - b.c;
    return delta > 0 ? `${b.recommended_servers} (+${delta})` : String(b.recommended_servers);
  };
  const nodes = [];
  const overloaded = items.filter((b) => b.sla_status === 'overloaded');
  if (overloaded.length) nodes.push(h('p', { class: 'message error', role: 'alert' }, `${overloaded.map((b) => b.checkpoint_name).join(', ')}: ${t('dash.overloadedText')}`));

  const counters = chartCard({
    title: t('dash.countersChart'), subtitle: t('dash.countersHelp'), iconName: 'users',
    draw: (canvas) => barChart(canvas, {
      labels: items.map((b) => b.checkpoint_name),
      valueTitle: t('dash.counters'),
      datasets: [
        { label: t('dash.countersOpen'), data: items.map((b) => b.c), tone: 'neutral' },
        { label: t('dash.countersNeeded'), data: items.map((b) => (b.recommended_exceeds_max ? maxServers : b.recommended_servers)), tones: items.map((b) => (b.recommended_servers !== null && b.recommended_servers <= b.c ? 'ok' : 'danger')) },
      ],
    }),
  });
  const rho = items.map((b) => (b.model ? Math.round(b.model.rho * 1000) / 10 : null));
  const busy = chartCard({
    title: t('dash.utilisationChart'), subtitle: t('dash.utilisationHelp'), iconName: 'simulator', tone: 'violet',
    draw: (canvas) => barChart(canvas, {
      labels: items.map((b) => b.checkpoint_name),
      valueTitle: '%', valueSuffix: ' %', legend: false,
      valueMax: Math.max(110, ...rho.filter((v) => v !== null).map((v) => Math.ceil(v / 10) * 10)),
      reference: { value: 100, label: t('dash.fullCapacity') },
      datasets: [{ label: t('dash.utilisation'), data: rho, tones: rho.map((v) => (v === null ? 'neutral' : v >= 100 ? 'danger' : v >= 85 ? 'secondary' : 'ok')) }],
    }),
  });
  nodes.push(h('div', { class: 'grid-2' }, counters.node, busy.node));

  // Exact numbers matter for staffing decisions: a compact table stays visible.
  nodes.push(card({ title: t('dash.staffingTable'), subtitle: t('dash.staffingTableHelp'), icon: 'table', tone: 'teal' },
    table([[t('sessions.checkpoint')], [term(t('dash.lambdaPlain'), t('hint.lambda')), 'num'], [term(t('dash.muPlain'), t('hint.mu')), 'num'],
      [term(t('dash.cPlain'), t('hint.c')), 'num'], [term(t('dash.rhoPlain'), t('hint.rho')), 'num'], [term(t('dash.wqPlain'), t('hint.wq')), 'num'],
      [t('dash.sla'), 'num'], [t('dash.status')], [term(t('dash.recommended'), t('hint.needed')), 'num']],
    items.map((b) => h('tr', {},
      td(b.checkpoint_name, ''),
      td(b.lambda === null ? '—' : `${fmt(b.lambda * 60, 0)}/h`), td(b.mu === null ? '—' : `${fmt(b.mu * 60, 1)}/h`),
      td(b.c === null ? '—' : String(b.c)),
      td(b.model ? fmtPct(b.model.rho * 100) : '—'),
      td(b.model?.overloaded ? '∞' : (b.model ? `${fmt(b.model.wq, 1)} min` : '—')),
      td(`${b.sla_wait_minutes} min`),
      h('td', { class: 'nowrap' }, statusBadge(b)),
      td(needed(b))))),
    numbers(h('div', { class: 'stack-tight' },
      table([[t('sessions.checkpoint')], [t('dash.lambda'), 'num'], [t('dash.mu'), 'num'], [t('dash.c'), 'num'], [t('dash.rho'), 'num'],
        [t('dash.pWait'), 'num'], [t('dash.wq'), 'num'], [t('dash.lq'), 'num'], [t('dash.w'), 'num'], [t('dash.l'), 'num']],
      items.map((b) => h('tr', {},
        td(b.checkpoint_name, ''), td(fmt(b.lambda, 3)), td(fmt(b.mu, 3)), td(b.c === null ? '—' : String(b.c)), td(m(b, 'rho')),
        td(b.model?.overloaded ? '—' : (b.model ? fmtPct(b.model.p_wait * 100) : '—')),
        td(b.model?.overloaded ? '∞' : m(b, 'wq', 1)), td(b.model?.overloaded ? '∞' : m(b, 'lq', 1)),
        td(b.model?.overloaded ? '∞' : m(b, 'w', 1)), td(b.model?.overloaded ? '∞' : m(b, 'l', 1))))),
      h('p', { class: 'muted' }, t('dash.modelHelp'))), t('dash.showModel'))));
  return { nodes, draws: [counters.draw, busy.draw] };
}

// ---- Flights and counters ---------------------------------------------------

function breakdownTable(rows, label, total, limit) {
  return h('div', { class: 'stack-tight' },
    table([[label], [t('dash.passengers'), 'num'], [t('dash.groups'), 'num'], [t('dash.avgWait'), 'num'], [t('dash.avgProcessing'), 'num'], [t('dash.slaCompliance'), 'num'], [t('dash.breachPax'), 'num']],
      rows.map((r) => h('tr', {}, td(r.value, ''), td(String(r.pax_total)), td(String(r.group_count)),
        td(fmt(r.avg_wait_minutes)), td(fmt(r.avg_processing_minutes)), td(fmtPct(r.sla_compliance_pct)),
        h('td', { class: 'num' }, String(r.breach_pax), r.breach_pax > 0 ? [' ', breachBadge()] : null)))),
    total > rows.length ? h('p', { class: 'muted' }, t('dash.topOnly', { shown: rows.length, total, limit })) : null);
}

function breakdownChart(rows, { what, title, iconName, tone, total, limit }) {
  if (rows.length === 0) return { node: card({ title, icon: iconName, tone }, h('p', { class: 'muted' }, t('dash.noBreakdown', { what }))), draw: null };
  const top = rows.slice(0, FLIGHT_CHART_LIMIT);
  return chartCard({
    title, subtitle: rows.length > top.length ? t('dash.busiestOnly', { count: top.length }) : t('dash.breakdownHelp'), iconName, tone, tall: top.length > 8,
    draw: (canvas) => barChart(canvas, {
      labels: top.map((r) => r.value), horizontal: true, valueTitle: t('dash.minutes'),
      datasets: [
        { label: t('dash.avgWait'), data: top.map((r) => r.avg_wait_minutes), tone: 'primary' },
        { label: t('dash.avgProcessing'), data: top.map((r) => r.avg_processing_minutes), tone: 'secondary' },
      ],
    }),
    after: [numbers(breakdownTable(rows, what, total, limit))],
  });
}

function flights(data) {
  const b = data.breakdown;
  if (!b) return { nodes: [h('p', { class: 'message error' }, errorText(data.errors.breakdown))], draws: [] };
  const f = breakdownChart(b.flights, { what: t('dash.flight'), title: t('dash.byFlight'), iconName: 'plane', total: b.flights_total, limit: b.limit });
  const c = breakdownChart(b.counters, { what: t('dash.counter'), title: t('dash.byCounter'), iconName: 'checkpoints', tone: 'teal', total: b.counters_total, limit: b.limit });
  return { nodes: [h('div', { class: 'grid-2' }, f.node, c.node)], draws: [f.draw, c.draw].filter(Boolean) };
}

const RENDER = { overview, time: timeTab, staffing, flights };

export async function dashboardView(main) {
  const feedback = h('div', { 'aria-live': 'polite' });
  const pending = {};
  const view = tabs(TABS.map((x) => ({ key: x.key, icon: x.icon, label: t(`dash.tab.${x.key}`) })), {
    label: t('dash.title'),
    initial: recall(TAB_KEY),
    onSelect: (key) => {
      remember(TAB_KEY, key);
      for (const draw of pending[key] ?? []) draw();
      delete pending[key];
    },
  });

  let sequence = 0;
  async function load(values) {
    const mine = ++sequence;
    message(feedback);
    const qs = query(values);
    for (const x of TABS) clear(view.panels[x.key]).append(loading(t('app.loading')));
    const results = await Promise.allSettled(ENDPOINTS.map((e) => api.get(`/analytics/${e}${qs}`)));
    if (mine !== sequence) return; // a newer filter change already answered
    const data = { errors: {} };
    ENDPOINTS.forEach((e, i) => {
      if (results[i].status === 'fulfilled') data[e] = results[i].value;
      else data.errors[e] = results[i].reason;
    });
    destroyCharts();
    for (const x of TABS) {
      const { nodes, draws } = RENDER[x.key](data);
      clear(view.panels[x.key]).append(...nodes);
      pending[x.key] = draws;
    }
    const shown = view.current();
    for (const draw of pending[shown] ?? []) draw();
    delete pending[shown];
  }

  const filters = await analyticsFilters({ onApply: load });
  main.append(h('section', { class: 'stack' },
    pageHeader(t('dash.title'), { subtitle: t('dash.subtitle') }),
    filters.form, feedback, view.list, ...TABS.map((x) => view.panels[x.key])));
  await load(filters.values());
}

