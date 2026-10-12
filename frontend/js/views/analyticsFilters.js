import { h, field, option, clear } from '../dom.js';
import { t } from '../i18n.js';
import { api, query } from '../api.js';

/**
 * The filters every analytics screen shares (spec §8): any number of
 * checkpoints, a date range and optionally one session. `onApply(values)`
 * runs on submit; `values()` returns the current query parameters.
 */
export async function analyticsFilters({ onApply, submitLabel = t('dash.apply') }) {
  const { items: checkpoints } = await api.get('/checkpoints');
  const boxes = checkpoints.map((c) => h('input', { type: 'checkbox', value: c.id, name: 'checkpoint' }));
  const checks = h('fieldset', { class: 'checks' }, h('legend', {}, t('dash.checkpoints')),
    checkpoints.map((c, i) => h('label', {}, boxes[i], ` ${c.name}`)));
  const from = field(t('sessions.from'), 'input', { type: 'date' });
  const to = field(t('sessions.to'), 'input', { type: 'date' });
  const session = field(t('dash.session'), 'select', {}, [option('', t('dash.allSessions'))]);

  const selectedCheckpoints = () => boxes.filter((b) => b.checked).map((b) => b.value);

  /** Lists up to 100 sessions matching the other filters (newest first). */
  async function loadSessions() {
    const ids = selectedCheckpoints();
    const keep = session.input.value;
    try {
      const result = await api.get(`/sessions${query({
        page_size: 100, from: from.input.value, to: to.input.value, checkpoint_id: ids.length === 1 ? ids[0] : '',
      })}`);
      const items = ids.length > 1 ? result.items.filter((s) => ids.includes(String(s.checkpoint_id))) : result.items;
      clear(session.input);
      session.input.append(option('', t('dash.allSessions')),
        ...items.map((s) => option(s.id, `${s.date} · ${s.checkpoint_name} · ${s.name}`, String(s.id) === keep)));
    } catch {
      // The session list is a convenience; the other filters still work.
    }
  }
  for (const input of [...boxes, from.input, to.input]) input.addEventListener('change', loadSessions);

  /** Back to the default empty state: no checkpoint, no dates, all sessions. */
  function reset() {
    for (const box of boxes) box.checked = false;
    from.input.value = '';
    to.input.value = '';
    session.input.value = '';
    loadSessions();
  }

  function values() {
    return { checkpoint_id: selectedCheckpoints(), from: from.input.value, to: to.input.value, session_id: session.input.value };
  }

  const form = h('form', { class: 'card row', onsubmit: (event) => { event.preventDefault(); onApply(values()); } },
    checks, from.wrapper, to.wrapper, session.wrapper, h('button', { type: 'submit' }, submitLabel));
  loadSessions();
  return { form, values, reset, checkpoints };
}

/** Number with `digits` decimals, or an em dash for null. */
export function fmt(value, digits = 1) {
  return value === null || value === undefined ? '—' : Number(value).toFixed(digits);
}

export function fmtPct(value) {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(1)} %`;
}
