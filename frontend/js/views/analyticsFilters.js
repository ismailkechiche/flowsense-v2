import { h, field, option, clear, icon } from '../dom.js';
import { t } from '../i18n.js';
import { api, query } from '../api.js';

const PERIODS = ['all', '7', '30', 'custom'];
let instances = 0;

const pad = (n) => String(n).padStart(2, '0');
/** Local calendar date `days` before today, as YYYY-MM-DD. */
export function daysAgo(days, today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The from/to dates a period preset stands for ('' = open-ended). */
export function periodRange(period, today = new Date()) {
  if (period === '7' || period === '30') return { from: daysAgo(Number(period) - 1, today), to: daysAgo(0, today) };
  return { from: '', to: '' };
}

/**
 * The filters every analytics screen shares (spec §8): any number of
 * checkpoints, a date range and optionally one session. Laid out for
 * clarity: a period preset (all dates, last 7 / 30 days or a custom range),
 * checkpoint chips with an "All" chip, and the session under "More
 * filters". Changes apply on their own (debounced) and a one-line summary
 * says what is shown. `onApply(values)` receives the query parameters.
 */
export async function analyticsFilters({ onApply }) {
  instances += 1;
  const name = `filters${instances}`;
  const { items: checkpoints } = await api.get('/checkpoints');

  const periodInputs = PERIODS.map((p) => h('input', { type: 'radio', name: `${name}-period`, value: p, checked: p === 'all' }));
  const periodSet = h('fieldset', { class: 'checks segmented' }, h('legend', {}, t('filters.period')),
    PERIODS.map((p, i) => h('label', {}, periodInputs[i], t(`filters.period.${p}`))));
  const from = field(t('sessions.from'), 'input', { type: 'date' });
  const to = field(t('sessions.to'), 'input', { type: 'date' });
  const customRange = h('div', { class: 'row', hidden: true }, from.wrapper, to.wrapper);

  const allBox = h('input', { type: 'checkbox', checked: true });
  const boxes = checkpoints.map((c) => h('input', { type: 'checkbox', value: c.id, name: `${name}-checkpoint` }));
  const checks = h('fieldset', { class: 'checks' }, h('legend', {}, t('filters.checkpoints')),
    h('label', {}, allBox, t('filters.allCheckpoints')),
    checkpoints.map((c, i) => h('label', {}, boxes[i], c.name)));

  const session = field(t('dash.session'), 'select', {}, [option('', t('dash.allSessions'))]);
  const more = h('details', { class: 'more-filters' }, h('summary', {}, t('filters.more')), h('div', { class: 'row' }, session.wrapper));
  const summary = h('p', { class: 'filter-summary', 'aria-live': 'polite' });
  const resetButton = h('button', { type: 'button', class: 'secondary small', onclick: () => { reset(); apply(); } }, t('filters.reset'));

  const period = () => periodInputs.find((r) => r.checked)?.value ?? 'all';
  const selectedCheckpoints = () => boxes.filter((b) => b.checked).map((b) => b.value);
  function dates() {
    return period() === 'custom' ? { from: from.input.value, to: to.input.value } : periodRange(period());
  }

  /** Lists up to 100 sessions matching the other filters (newest first). */
  async function loadSessions() {
    const ids = selectedCheckpoints();
    const keep = session.input.value;
    try {
      const result = await api.get(`/sessions${query({ page_size: 100, ...dates(), checkpoint_id: ids.length === 1 ? ids[0] : '' })}`);
      const items = ids.length > 1 ? result.items.filter((s) => ids.includes(String(s.checkpoint_id))) : result.items;
      clear(session.input);
      session.input.append(option('', t('dash.allSessions')),
        ...items.map((s) => option(s.id, `${s.date} · ${s.checkpoint_name} · ${s.name}`, String(s.id) === keep)));
    } catch {
      // The session list is a convenience; the other filters still work.
    }
  }

  function describe() {
    const ids = selectedCheckpoints();
    const cps = ids.length === 0 ? t('filters.allCheckpoints').toLowerCase()
      : checkpoints.filter((c) => ids.includes(String(c.id))).map((c) => c.name).join(', ');
    const { from: f, to: tt } = dates();
    let when = t('filters.anyDate');
    if (f && tt) when = f === tt ? f : t('filters.between', { from: f, to: tt });
    else if (f) when = t('filters.since', { from: f });
    else if (tt) when = t('filters.until', { to: tt });
    const s = session.input.selectedOptions[0];
    const parts = [cps, when];
    if (session.input.value && s) parts.push(s.textContent);
    summary.replaceChildren(icon('info'), h('span', {}, t('filters.showing', { what: parts.join(' · ') })));
  }

  let timer;
  function apply() {
    describe();
    clearTimeout(timer);
    timer = setTimeout(() => onApply(values()), 250);
  }

  allBox.addEventListener('change', () => {
    if (allBox.checked) for (const b of boxes) b.checked = false;
    else if (selectedCheckpoints().length === 0) allBox.checked = true; // "all" is the only way to have none ticked
    loadSessions(); apply();
  });
  for (const box of boxes) {
    box.addEventListener('change', () => { allBox.checked = selectedCheckpoints().length === 0; loadSessions(); apply(); });
  }
  for (const r of periodInputs) {
    r.addEventListener('change', () => { customRange.hidden = period() !== 'custom'; loadSessions(); apply(); });
  }
  for (const input of [from.input, to.input]) input.addEventListener('change', () => { loadSessions(); apply(); });
  session.input.addEventListener('change', apply);

  /** Back to the default: all checkpoints, all dates, all sessions. */
  function reset() {
    for (const box of boxes) box.checked = false;
    allBox.checked = true;
    for (const r of periodInputs) r.checked = r.value === 'all';
    customRange.hidden = true;
    from.input.value = '';
    to.input.value = '';
    session.input.value = '';
    more.open = false;
    loadSessions();
    describe();
  }

  function values() {
    return { checkpoint_id: selectedCheckpoints(), ...dates(), session_id: session.input.value };
  }

  const form = h('form', { class: 'card filter-bar', 'aria-label': t('filters.label'), onsubmit: (event) => { event.preventDefault(); apply(); } },
    h('div', { class: 'filter-grid' }, h('div', { class: 'stack-tight' }, periodSet, customRange), checks),
    more,
    h('div', { class: 'filter-foot' }, summary, resetButton));
  loadSessions();
  describe();
  return { form, values, reset, checkpoints };
}

/** Number with `digits` decimals, or an em dash for null. */
export function fmt(value, digits = 1) {
  return value === null || value === undefined ? '—' : Number(value).toFixed(digits);
}

export function fmtPct(value) {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(1)} %`;
}
