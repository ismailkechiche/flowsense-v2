import { h, field, option, message, clear, emptyState, icon, iconChip } from '../dom.js';
import { t } from '../i18n.js';
import { api, query } from '../api.js';
import { errorText, pageHeader, card } from './common.js';
import { analyticsFilters, fmt, fmtPct } from './analyticsFilters.js';
import { chartBox, destroyCharts, pivotChart } from '../charts/charts.js';
import { createReportDraft, generateAndReset } from '../reportDraft.js';

const DEFAULT_VIZ = 'bar';
const VIZ_ICONS = { table: 'table', bar: 'bar', line: 'line' };
/** One-click starting points for common questions. */
const PRESETS = [
  { key: 'waitByCheckpoint', rows: 'checkpoint', metrics: ['avg_wait', 'avg_processing'], visualization: 'bar' },
  { key: 'paxByHour', rows: 'hour', metrics: ['pax_total'], visualization: 'bar' },
  { key: 'waitByHourCheckpoint', rows: 'hour', columns: 'checkpoint', metrics: ['avg_wait'], visualization: 'line' },
  { key: 'dailyTrend', rows: 'date', metrics: ['avg_wait', 'sla_compliance'], visualization: 'line' },
  { key: 'flights', rows: 'flight_no', metrics: ['pax_total', 'avg_wait', 'sla_compliance'], visualization: 'table' },
];

/** Display text for a dimension value. */
function dimensionText(key, value) {
  if (value === null || value === undefined) return t('pivot.none');
  if (key === 'hour') return `${String(value).padStart(2, '0')}:00`;
  if (key === 'shift') return t(`shift.${value}`);
  return String(value);
}

function metricText(metric, value) {
  if (value === null || value === undefined) return '—';
  if (metric.unit === '%') return fmtPct(value);
  if (['pax', 'groups'].includes(metric.unit)) return String(value);
  return fmt(value, 1);
}

/** Drops empty filter values so the saved configuration stays small. */
function compactFilters(values) {
  const out = {};
  if (values.checkpoint_id.length) out.checkpoint_id = values.checkpoint_id.map(Number);
  if (values.from) out.from = values.from;
  if (values.to) out.to = values.to;
  if (values.session_id) out.session_id = Number(values.session_id);
  return out;
}

/**
 * Pivot builder (spec §9) with the report draft and PDF download (§10).
 * The builder resets to its empty state only after a PDF was downloaded.
 */
export async function pivotView(main) {
  const options = await api.get('/pivot/options');
  const draft = createReportDraft();
  const feedback = h('div', { 'aria-live': 'polite' });
  const resultHolder = h('div', { class: 'stack' });
  let lastResult = null;

  // ---- Builder controls -------------------------------------------------
  const dimOptions = (emptyLabel) => [option('', emptyLabel, true), ...options.dimensions.map((d) => option(d.key, t(`pivot.dim.${d.key}`)))];
  const rows = field(t('pivot.rows'), 'select', {}, dimOptions(t('pivot.choose')));
  const columns = field(t('pivot.columns'), 'select', {}, dimOptions(t('pivot.noColumns')));
  const metricBoxes = options.metrics.map((m) => h('input', { type: 'checkbox', value: m.key, name: 'metric' }));
  const metricSet = h('fieldset', { class: 'checks' }, h('legend', {}, t('pivot.metrics')),
    options.metrics.map((m, i) => h('label', {}, metricBoxes[i], ` ${t(`pivot.metric.${m.key}`)}`)));
  const vizInputs = options.visualizations.map((v) => h('input', { type: 'radio', name: 'viz', value: v, checked: v === DEFAULT_VIZ }));
  const vizSet = h('fieldset', { class: 'checks segmented' }, h('legend', {}, t('pivot.visualization')),
    options.visualizations.map((v, i) => h('label', {}, vizInputs[i], icon(VIZ_ICONS[v] ?? 'table'), t(`pivot.viz.${v}`))));
  const lineHint = h('span', { class: 'muted' });
  const title = field(t('pivot.title'), 'input', { maxlength: 120, autocomplete: 'off' });

  const ordered = (key) => options.dimensions.find((d) => d.key === key)?.ordered ?? false;
  const selectedMetrics = () => metricBoxes.filter((b) => b.checked).map((b) => b.value);
  const visualization = () => vizInputs.find((r) => r.checked)?.value ?? DEFAULT_VIZ;

  /** Line needs an ordered row dimension (date or hour). */
  function syncLineAvailability() {
    const line = vizInputs.find((r) => r.value === 'line');
    const allowed = ordered(rows.input.value);
    line.disabled = !allowed;
    lineHint.textContent = allowed ? '' : t('pivot.lineHint');
    if (!allowed && line.checked) vizInputs.find((r) => r.value === DEFAULT_VIZ).checked = true;
  }

  // ---- Running a pivot --------------------------------------------------
  let filters;
  function currentConfig() {
    return {
      rows: rows.input.value,
      columns: columns.input.value || null,
      metrics: selectedMetrics(),
      visualization: visualization(),
      title: title.input.value.trim(),
      filters: compactFilters(filters.values()),
    };
  }

  let sequence = 0;
  async function run() {
    message(feedback);
    const config = currentConfig();
    if (!config.rows || config.metrics.length === 0) {
      lastResult = null;
      destroyCharts();
      clear(resultHolder).append(emptyState(t('pivot.pickFirstTitle'), t('pivot.pickFirst'), null, 'pivot'));
      renderDraft();
      return;
    }
    const mine = ++sequence;
    try {
      const result = await api.post('/pivot', config);
      if (mine !== sequence) return;
      lastResult = result;
      renderResult();
    } catch (err) {
      if (mine !== sequence) return;
      lastResult = null;
      destroyCharts();
      clear(resultHolder).append(h('p', { class: 'message error', role: 'alert' }, errorText(err)));
    }
    renderDraft();
  }

  /**
   * Chart data: without columns, one chart with a series per metric; with
   * columns, one chart per metric with a series per column value.
   */
  function chartsFor(result) {
    const c = result.config;
    const lookup = new Map(result.cells.map((cell) => [JSON.stringify([cell.row, cell.column]), cell]));
    const at = (r, col) => lookup.get(JSON.stringify([r, col]));
    if (c.columns) {
      return result.metrics.map((metric) => ({
        title: result.metrics.length > 1 ? t(`pivot.metric.${metric.key}`) : null,
        series: result.column_values.map((col) => ({
          label: dimensionText(c.columns, col),
          values: result.row_values.map((r) => at(r, col)?.values[metric.key] ?? null),
        })),
      }));
    }
    return [{ title: null, series: result.metrics.map((m) => ({ label: t(`pivot.metric.${m.key}`), values: result.row_values.map((r) => at(r, null)?.values[m.key] ?? null) })) }];
  }

  function resultTable(result) {
    const c = result.config;
    const lookup = new Map(result.cells.map((cell) => [JSON.stringify([cell.row, cell.column]), cell]));
    const cols = c.columns
      ? result.column_values.flatMap((col) => result.metrics.map((m) => ({ col, m })))
      : result.metrics.map((m) => ({ col: null, m }));
    const head = h('tr', {}, h('th', { scope: 'col' }, t(`pivot.dim.${c.rows}`)),
      cols.map(({ col, m }) => h('th', { scope: 'col', class: 'num' },
        c.columns ? `${dimensionText(c.columns, col)} · ${t(`pivot.metric.${m.key}`)}` : t(`pivot.metric.${m.key}`))));
    const body = result.row_values.map((r) => h('tr', {},
      h('th', { scope: 'row' }, dimensionText(c.rows, r)),
      cols.map(({ col, m }) => {
        const cell = lookup.get(JSON.stringify([r, col]));
        const breach = m.key === 'avg_wait' && cell?.breach;
        return h('td', { class: 'num' }, metricText(m, cell?.values[m.key]),
          breach ? [' ', h('span', { class: 'badge breach' }, `⚠ ${t('sessions.breach')}`)] : null);
      })));
    return h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, head), h('tbody', {}, body)));
  }

  function renderResult() {
    destroyCharts();
    clear(resultHolder);
    const result = lastResult;
    if (!result) return;
    resultHolder.append(h('h3', { class: 'result-title' }, result.config.title));
    if (result.cells.length === 0) {
      resultHolder.append(emptyState(t('dash.noData'), t('dash.noDataHint')));
      return;
    }
    const viz = visualization();
    if (viz === 'table') {
      resultHolder.append(resultTable(result));
    } else {
      // A chart view shows only the chart(s): the table is its own choice.
      const labels = result.row_values.map((r) => dimensionText(result.config.rows, r));
      for (const chart of chartsFor(result)) {
        const { box, canvas } = chartBox(chart.title ? `${result.config.title} · ${chart.title}` : result.config.title);
        if (chart.title) resultHolder.append(h('h3', {}, chart.title));
        resultHolder.append(box);
        pivotChart(canvas, viz, labels, chart.series);
      }
    }
    resultHolder.append(h('p', { class: 'muted' }, t('pivot.cells', { count: result.cell_count, max: result.max_cells })));
  }

  // ---- Report draft -----------------------------------------------------
  const draftList = h('ol', { class: 'stack-tight' });
  const draftHeading = h('h2', {});
  const addButton = h('button', { type: 'button', onclick: () => {
    const config = { ...currentConfig(), title: title.input.value.trim() || lastResult.config.title };
    draft.add(config);
    renderDraft();
    message(feedback, 'success', t('pivot.added', { title: config.title }));
  } }, icon('plus'), t('pivot.addToReport'));

  const reportTitle = field(t('report.title'), 'input', { maxlength: 120, autocomplete: 'off' });
  const scopeRange = h('input', { type: 'radio', name: 'scope', value: 'range', checked: true });
  const scopeSession = h('input', { type: 'radio', name: 'scope', value: 'session' });
  const scopeFrom = field(t('sessions.from'), 'input', { type: 'date' });
  const scopeTo = field(t('sessions.to'), 'input', { type: 'date' });
  const scopeSessionSelect = field(t('dash.session'), 'select', {}, [option('', t('report.chooseSession'), true)]);
  const rangeFields = h('div', { class: 'row' });
  const sessionFields = h('div', { class: 'row', hidden: true }, scopeSessionSelect.wrapper);
  const generateButton = h('button', { type: 'button' }, t('report.generate'));
  const reportFeedback = h('div', { 'aria-live': 'polite' });

  function syncScope() {
    rangeFields.hidden = !scopeRange.checked;
    sessionFields.hidden = !scopeSession.checked;
  }
  scopeRange.addEventListener('change', syncScope);
  scopeSession.addEventListener('change', syncScope);

  function renderDraft() {
    const sections = draft.sections();
    draftHeading.textContent = t('report.draft', { count: sections.length });
    clear(draftList);
    if (sections.length === 0) draftList.append(h('li', { class: 'muted' }, t('report.empty')));
    sections.forEach((s, i) => {
      const describe = `${t(`pivot.viz.${s.visualization}`)} · ${t(`pivot.dim.${s.rows}`)}${s.columns ? ` × ${t(`pivot.dim.${s.columns}`)}` : ''}`;
      draftList.append(h('li', { class: 'row space-between' },
        h('span', {}, h('strong', {}, s.title), ' ', h('span', { class: 'muted' }, describe)),
        h('span', { class: 'actions' },
          h('button', { type: 'button', class: 'secondary', disabled: i === 0, 'aria-label': t('report.moveUp', { title: s.title }), onclick: () => { draft.move(i, -1); renderDraft(); } }, '↑'),
          h('button', { type: 'button', class: 'secondary', disabled: i === sections.length - 1, 'aria-label': t('report.moveDown', { title: s.title }), onclick: () => { draft.move(i, 1); renderDraft(); } }, '↓'),
          h('button', { type: 'button', class: 'secondary', 'aria-label': t('report.remove', { title: s.title }), onclick: () => { draft.remove(i); renderDraft(); } }, '✕'))));
    });
    addButton.disabled = !lastResult;
  }

  function scopeBody() {
    if (scopeSession.checked) return { session_id: scopeSessionSelect.input.value ? Number(scopeSessionSelect.input.value) : undefined };
    const ids = scopeCheckpointBoxes.filter((b) => b.checked).map((b) => Number(b.value));
    return { from: scopeFrom.input.value || undefined, to: scopeTo.input.value || undefined, checkpoint_id: ids.length ? ids : undefined };
  }

  /** Puts every control back to the default empty state. */
  function resetAll() {
    draft.clear();
    rows.input.value = '';
    columns.input.value = '';
    for (const b of metricBoxes) b.checked = false;
    for (const r of vizInputs) r.checked = r.value === DEFAULT_VIZ;
    title.input.value = '';
    filters.reset();
    reportTitle.input.value = '';
    scopeRange.checked = true;
    scopeFrom.input.value = '';
    scopeTo.input.value = '';
    for (const b of scopeCheckpointBoxes) b.checked = false;
    scopeSessionSelect.input.value = '';
    syncScope();
    syncLineAvailability();
    lastResult = null;
    destroyCharts();
    clear(resultHolder).append(emptyState(t('pivot.pickFirstTitle'), t('pivot.pickFirst'), null, 'pivot'));
    renderDraft();
  }

  function saveFile({ blob, filename }) {
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: filename, hidden: true });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  generateButton.addEventListener('click', async () => {
    message(reportFeedback, 'success', t('report.generating'));
    generateButton.disabled = true;
    try {
      const file = await generateAndReset({
        request: () => api.download('/reports', { scope: scopeBody(), sections: draft.sections(), title: reportTitle.input.value.trim() }),
        save: saveFile,
        reset: resetAll,
      });
      message(reportFeedback, 'success', t('report.done', { filename: file.filename }));
    } catch (err) {
      // Nothing is reset: the draft and the builder stay as they were.
      message(reportFeedback, 'error', `${t('report.failed')} ${errorText(err)}`, err.details);
    } finally {
      generateButton.disabled = false;
    }
  });

  // ---- Assemble ---------------------------------------------------------
  filters = await analyticsFilters({ onApply: run });
  const scopeCheckpointBoxes = filters.checkpoints.map((c) => h('input', { type: 'checkbox', value: c.id }));
  rangeFields.replaceChildren(scopeFrom.wrapper, scopeTo.wrapper,
    h('fieldset', { class: 'checks' }, h('legend', {}, t('dash.checkpoints')), filters.checkpoints.map((c, i) => h('label', {}, scopeCheckpointBoxes[i], ` ${c.name}`))));
  api.get(`/sessions${query({ page_size: 100 })}`).then((list) => {
    scopeSessionSelect.input.append(...list.items.map((s) => option(s.id, `${s.date} · ${s.checkpoint_name} · ${s.name}`)));
  }).catch(() => {});

  rows.input.addEventListener('change', () => { syncLineAvailability(); run(); });
  for (const el of [columns.input, ...metricBoxes]) el.addEventListener('change', run);
  for (const r of vizInputs) r.addEventListener('change', () => { if (lastResult) renderResult(); });
  title.input.addEventListener('change', () => { if (lastResult) run(); });
  syncLineAvailability();

  /** Quick starts fill the builder with a common view in one click. */
  function applyPreset(preset) {
    rows.input.value = preset.rows;
    columns.input.value = preset.columns ?? '';
    for (const b of metricBoxes) b.checked = preset.metrics.includes(b.value);
    syncLineAvailability();
    for (const r of vizInputs) r.checked = r.value === preset.visualization;
    title.input.value = '';
    run();
  }
  const presets = h('div', { class: 'presets' }, h('span', { class: 'muted' }, t('pivot.quickStart')),
    PRESETS.filter((p) => [p.rows, p.columns].filter(Boolean).every((key) => options.dimensions.some((d) => d.key === key)))
      .map((p) => h('button', { type: 'button', class: 'chip-button', onclick: () => applyPreset(p) }, icon(VIZ_ICONS[p.visualization]), t(`pivot.preset.${p.key}`))));

  main.append(h('section', { class: 'stack' },
    pageHeader(t('pivot.heading'), { subtitle: t('pivot.subtitle') }),
    card({ title: t('pivot.build'), subtitle: t('pivot.buildHelp'), icon: 'pivot', tone: 'amber' },
      presets,
      h('div', { class: 'form-grid' }, rows.wrapper, columns.wrapper, title.wrapper),
      metricSet,
      h('div', { class: 'row' }, vizSet, lineHint)),
    filters.form,
    feedback,
    card({ title: t('pivot.result'), icon: 'bar', actions: addButton, className: 'chart-card' }, resultHolder),
    h('section', { class: 'card stack', 'aria-labelledby': 'report-draft-heading' },
      h('div', { class: 'card-header' }, h('div', { class: 'card-title' }, iconChip('sessions', 'violet'),
        h('div', {}, Object.assign(draftHeading, { id: 'report-draft-heading' }), h('p', { class: 'card-subtitle' }, t('report.help'))))),
      draftList,
      h('div', { class: 'form-grid' }, reportTitle.wrapper),
      h('fieldset', { class: 'checks' }, h('legend', {}, t('report.scope')),
        h('label', {}, scopeRange, ` ${t('report.scopeRange')}`), h('label', {}, scopeSession, ` ${t('report.scopeSession')}`)),
      rangeFields, sessionFields,
      h('div', { class: 'row' }, generateButton), reportFeedback)));
  clear(resultHolder).append(emptyState(t('pivot.pickFirstTitle'), t('pivot.pickFirst'), null, 'pivot'));
  renderDraft();
}
