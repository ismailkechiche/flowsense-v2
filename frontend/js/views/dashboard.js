import { h, message, clear } from '../dom.js';
import { t } from '../i18n.js';
import { api, query } from '../api.js';
import { errorText } from './common.js';
import { analyticsFilters, fmt, fmtPct } from './analyticsFilters.js';
import { chartBox, destroyCharts, histogramChart, hourlyChart, trendChart } from '../charts/charts.js';

const SECTIONS = ['overview', 'bottlenecks', 'hourly', 'breakdown', 'distribution', 'trend'];
const STORAGE_KEY = 'flowsense.dashboard.open';

// Which sections are expanded is a per-browser convenience; storage can be
// unavailable (private mode, blocked site data), so every access is guarded.
function loadOpenState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === 'object') return saved;
  } catch { /* fall through to the default */ }
  return Object.fromEntries(SECTIONS.map((s) => [s, true]));
}
function saveOpenState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* not persisted */ }
}

const th = (label, cls) => h('th', { scope: 'col', class: cls }, label);
const td = (value, cls = 'num') => h('td', { class: cls }, value);
const breachBadge = () => h('span', { class: 'badge breach' }, `⚠ ${t('sessions.breach')}`);

function table(headers, rows) {
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, headers.map(([label, cls]) => th(label, cls)))),
    h('tbody', {}, rows)));
}

function kpi(label, value, breach = false) {
  return h('div', { class: `kpi${breach ? ' breach' : ''}` },
    h('div', { class: 'kpi-label' }, label),
    h('div', { class: 'kpi-value' }, value, breach ? h('span', { class: 'visually-hidden' }, ` (${t('sessions.breach')})`) : null));
}

function overview(s) {
  if (s.pax_total === 0) return h('p', { class: 'muted' }, t('dash.noData'));
  const sla = s.sla_wait_minutes;
  const over = (minutes) => sla !== null && minutes !== null && minutes > sla;
  return h('div', { class: 'stack' },
    h('div', { class: 'kpi-grid' },
      kpi(t('dash.avgWait'), `${fmt(s.avg_wait_minutes)} min`, over(s.avg_wait_minutes)),
      kpi(t('dash.avgProcessing'), `${fmt(s.avg_processing_minutes)} min`),
      kpi(t('dash.avgTotal'), `${fmt(s.avg_total_minutes)} min`),
      kpi(t('dash.throughput'), `${fmt(s.throughput_per_hour, 0)} ${t('dash.paxPerHour')}`),
      kpi(t('dash.slaCompliance'), fmtPct(s.sla_compliance_pct), s.breach_pax > 0),
      kpi(t('dash.p90Wait'), `${fmt(s.p90_wait_minutes)} min`, over(s.p90_wait_minutes)),
      kpi(t('dash.totalPax'), String(s.pax_total)),
      kpi(t('dash.totalGroups'), String(s.group_count))),
    h('p', { class: s.breach_pax > 0 ? 'error-text' : 'muted' },
      t('dash.breaches', { pax: s.breach_pax, groups: s.breach_groups }),
      ' ', sla !== null ? t('dash.slaIs', { minutes: sla }) : t('dash.slaPerCheckpoint'),
      ' ', t('dash.p50', { minutes: fmt(s.p50_wait_minutes) })));
}

function statusBadge(b) {
  if (b.sla_status === 'overloaded') return h('span', { class: 'badge overloaded' }, t('dash.overloaded'));
  if (b.sla_status === 'breach') return breachBadge();
  if (b.sla_status === 'ok') return h('span', { class: 'badge ok' }, t('dash.withinSla'));
  return h('span', { class: 'badge' }, t('dash.notEnoughData'));
}

function bottlenecks({ items, max_servers: maxServers }) {
  if (items.length === 0) return h('p', { class: 'muted' }, t('dash.noData'));
  const m = (b, key, digits = 2) => (b.model ? fmt(b.model[key], digits) : '—');
  const recommended = (b) => {
    if (b.recommended_exceeds_max) return t('dash.moreThan', { max: maxServers });
    if (b.recommended_servers === null) return '—';
    const delta = b.recommended_servers - b.c;
    return delta > 0 ? `${b.recommended_servers} (+${delta})` : String(b.recommended_servers);
  };
  const overloaded = items.filter((b) => b.sla_status === 'overloaded');
  return h('div', { class: 'stack' },
    overloaded.length > 0
      ? h('p', { class: 'message error', role: 'alert' }, `${overloaded.map((b) => b.checkpoint_name).join(', ')}: ${t('dash.overloadedText')}`)
      : null,
    table([[t('sessions.checkpoint')], [t('dash.lambda'), 'num'], [t('dash.mu'), 'num'], [t('dash.c'), 'num'], [t('dash.rho'), 'num'],
      [t('dash.pWait'), 'num'], [t('dash.wq'), 'num'], [t('dash.lq'), 'num'], [t('dash.w'), 'num'], [t('dash.l'), 'num'],
      [t('dash.sla'), 'num'], [t('dash.status')], [t('dash.recommended'), 'num']],
    items.map((b) => h('tr', {},
      td(b.checkpoint_name, ''),
      td(fmt(b.lambda, 3)), td(fmt(b.mu, 3)),
      td(b.c === null ? '—' : String(b.c), 'num'),
      td(m(b, 'rho')),
      td(b.model?.overloaded ? '—' : (b.model ? fmtPct(b.model.p_wait * 100) : '—')),
      td(b.model?.overloaded ? '∞' : m(b, 'wq', 1)), td(b.model?.overloaded ? '∞' : m(b, 'lq', 1)),
      td(b.model?.overloaded ? '∞' : m(b, 'w', 1)), td(b.model?.overloaded ? '∞' : m(b, 'l', 1)),
      td(`${b.sla_wait_minutes} min`),
      h('td', { class: 'nowrap' }, statusBadge(b)),
      td(recommended(b))))),
    h('p', { class: 'muted' }, t('dash.modelHelp')));
}

function hourly({ items }) {
  if (items.length === 0) return h('p', { class: 'muted' }, t('dash.noData'));
  const { box, canvas } = chartBox(t('dash.hourlyChart'));
  const section = h('div', { class: 'stack' }, box,
    table([[t('dash.hour')], [t('dash.passengers'), 'num'], [t('dash.throughput'), 'num'], [t('dash.avgWait'), 'num'], [t('dash.slaCompliance'), 'num']],
      items.map((x) => h('tr', {},
        td(`${String(x.hour).padStart(2, '0')}:00–${String(x.hour).padStart(2, '0')}:59`, ''),
        td(String(x.pax_total)), td(`${fmt(x.throughput_per_hour, 1)} ${t('dash.paxPerHour')}`),
        td(fmt(x.avg_wait_minutes)), h('td', { class: 'num' }, fmtPct(x.sla_compliance_pct), ' ', x.breach_pax > 0 ? breachBadge() : null)))),
    h('p', { class: 'muted' }, t('dash.hourlyHelp')));
  return { section, draw: () => hourlyChart(canvas, items) };
}

function breakdownTable(rows, label, total, limit) {
  if (rows.length === 0) return h('p', { class: 'muted' }, t('dash.noBreakdown', { what: label }));
  return h('div', { class: 'stack-tight' },
    table([[label], [t('dash.passengers'), 'num'], [t('dash.groups'), 'num'], [t('dash.avgWait'), 'num'], [t('dash.avgProcessing'), 'num'], [t('dash.slaCompliance'), 'num'], [t('dash.breachPax'), 'num']],
      rows.map((r) => h('tr', {}, td(r.value, ''), td(String(r.pax_total)), td(String(r.group_count)),
        td(fmt(r.avg_wait_minutes)), td(fmt(r.avg_processing_minutes)), td(fmtPct(r.sla_compliance_pct)),
        h('td', { class: 'num' }, String(r.breach_pax), r.breach_pax > 0 ? [' ', breachBadge()] : null)))),
    total > rows.length ? h('p', { class: 'muted' }, t('dash.topOnly', { shown: rows.length, total, limit })) : null);
}

function breakdown(b) {
  return h('div', { class: 'stack' },
    h('h3', {}, t('dash.byFlight')), breakdownTable(b.flights, t('dash.flight'), b.flights_total, b.limit),
    h('h3', {}, t('dash.byCounter')), breakdownTable(b.counters, t('dash.counter'), b.counters_total, b.limit));
}

function distribution(d) {
  if (d.bins.every((b) => b.pax === 0)) return h('p', { class: 'muted' }, t('dash.noData'));
  const { box, canvas } = chartBox(t('dash.histogramChart'));
  const section = h('div', { class: 'stack' }, box,
    h('details', {}, h('summary', {}, t('dash.showTable')),
      table([[t('dash.waitMinutes')], [t('dash.passengers'), 'num'], [t('dash.groups'), 'num']],
        d.bins.filter((b) => b.pax > 0).map((b) => h('tr', {},
          td(b.to_minutes === null ? `${b.from_minutes}+` : `${b.from_minutes}–${b.to_minutes}`, ''), td(String(b.pax)), td(String(b.group_count)))))),
    h('p', { class: 'muted' }, t('dash.histogramHelp')));
  return { section, draw: () => histogramChart(canvas, d) };
}

function trend({ items }) {
  if (items.length === 0) return h('p', { class: 'muted' }, t('dash.noData'));
  const { box, canvas } = chartBox(t('dash.trendChart'));
  const section = h('div', { class: 'stack' }, box,
    table([[t('sessions.date')], [t('dash.passengers'), 'num'], [t('dash.avgWait'), 'num'], [t('dash.slaCompliance'), 'num'], [t('dash.breachPax'), 'num']],
      items.map((d) => h('tr', {}, td(d.date, ''), td(String(d.pax_total)), td(fmt(d.avg_wait_minutes)), td(fmtPct(d.sla_compliance_pct)), td(String(d.breach_pax))))));
  return { section, draw: () => trendChart(canvas, items) };
}

const RENDER = { overview, bottlenecks, hourly, breakdown, distribution, trend };
const ENDPOINT = { overview: 'summary', bottlenecks: 'bottlenecks', hourly: 'hourly', breakdown: 'breakdown', distribution: 'distribution', trend: 'trend' };

export async function dashboardView(main) {
  const feedback = h('div', { 'aria-live': 'polite' });
  const openState = loadOpenState();
  const bodies = {};
  const pending = {};
  const sections = SECTIONS.map((name) => {
    bodies[name] = h('div', {}, h('p', { class: 'muted' }, t('app.loading')));
    const details = h('details', { class: 'section', open: openState[name] !== false },
      h('summary', {}, t(`dash.section.${name}`)), bodies[name]);
    details.addEventListener('toggle', () => {
      openState[name] = details.open;
      saveOpenState(openState);
      // Charts need a visible box to size themselves, so draw on first open.
      if (details.open && pending[name]) { pending[name](); delete pending[name]; }
    });
    return details;
  });

  async function load(values) {
    message(feedback);
    destroyCharts();
    const qs = query(values);
    for (const name of SECTIONS) clear(bodies[name]).append(h('p', { class: 'muted' }, t('app.loading')));
    await Promise.all(SECTIONS.map(async (name, i) => {
      try {
        const data = await api.get(`/analytics/${ENDPOINT[name]}${qs}`);
        const out = RENDER[name](data);
        const node = out instanceof Node ? out : out.section;
        clear(bodies[name]).append(node);
        if (out.draw) {
          if (sections[i].open) out.draw();
          else pending[name] = out.draw;
        }
      } catch (err) {
        clear(bodies[name]).append(h('p', { class: 'message error' }, errorText(err)));
      }
    }));
  }

  const filters = await analyticsFilters({ onApply: load });
  main.append(h('section', { class: 'stack' }, h('h1', {}, t('dash.title')), filters.form, feedback, ...sections));
  await load(filters.values());
}
