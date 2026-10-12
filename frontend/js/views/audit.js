import { h, field, option, message, clear } from '../dom.js';
import { t } from '../i18n.js';
import { api, query } from '../api.js';
import { errorText, formatLocal } from './common.js';
import { pager } from './pager.js';

const PAGE_SIZE = 50;

const show = (value) => (value === null || value === undefined || value === '' ? '—' : (typeof value === 'object' ? JSON.stringify(value) : String(value)));

/**
 * Readable lines for an entry's details. A before/after pair (checkpoint
 * updates) lists only the fields that changed. Everything goes through text
 * nodes: details can hold user-entered names.
 */
export function detailLines(details) {
  if (!details || typeof details !== 'object') return [];
  const lines = [];
  const { before, after, ...rest } = details;
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    for (const key of Object.keys(after)) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) lines.push(`${key}: ${show(before[key])} → ${show(after[key])}`);
    }
  } else if (before === undefined && after && typeof after === 'object') {
    // A creation: the new record's fields.
    for (const [key, value] of Object.entries(after)) lines.push(`${key}: ${show(value)}`);
  } else {
    if (before !== undefined) rest.before = before;
    if (after !== undefined) rest.after = after;
  }
  for (const [key, value] of Object.entries(rest)) lines.push(`${key}: ${show(value)}`);
  return lines;
}

/** "checkpoint #5 · Transfer", or the name alone for a backup file. */
export function targetText(entry) {
  if (!entry.target_type) return '—';
  const ref = entry.target_id === null ? entry.target_type : `${entry.target_type.replace('_', ' ')} #${entry.target_id}`;
  if (entry.target_type === 'backup') return entry.target_name ?? ref;
  return entry.target_name ? `${ref} · ${entry.target_name}` : ref;
}

export async function auditView(main) {
  const feedback = h('div', { 'aria-live': 'polite' });
  const holder = h('div', { class: 'stack' });
  const action = field(t('audit.action'), 'select', {}, [option('', t('common.all'))]);
  const from = field(t('audit.from'), 'input', { type: 'date' });
  const to = field(t('audit.to'), 'input', { type: 'date' });

  async function load(page = 1) {
    message(feedback);
    try {
      const result = await api.get(`/audit${query({
        page, page_size: PAGE_SIZE, action: action.input.value, from: from.input.value, to: to.input.value,
      })}`);
      clear(holder);
      if (result.total === 0) {
        holder.append(h('p', { class: 'muted' }, t('audit.empty')));
        return;
      }
      holder.append(h('div', { class: 'table-wrap' }, h('table', {},
        h('caption', { class: 'visually-hidden' }, t('audit.caption')),
        h('thead', {}, h('tr', {}, [t('audit.when'), t('audit.actor'), t('audit.action'), t('audit.target'), t('audit.details')]
          .map((l) => h('th', { scope: 'col' }, l)))),
        h('tbody', {}, result.items.map((e) => {
          const lines = detailLines(e.details).filter((line) => !line.startsWith('changed: '));
          return h('tr', {},
            h('td', { class: 'nowrap' }, formatLocal(e.created_at)),
            h('td', {}, e.actor_user_id === null ? h('span', { class: 'muted' }, t('audit.system')) : (e.actor_name ?? `#${e.actor_user_id}`)),
            h('td', {}, h('span', { class: e.action.endsWith('_failed') ? 'badge breach' : 'badge' }, t(`audit.a.${e.action}`))),
            h('td', {}, targetText(e)),
            h('td', {}, lines.length ? h('ul', { class: 'plain' }, lines.map((line) => h('li', {}, line))) : '—'));
        })))),
      h('p', { class: 'muted' }, t('audit.count', { total: result.total })),
      pager(result, load));
    } catch (err) {
      message(feedback, 'error', errorText(err), err.details);
    }
  }

  try {
    const { items } = await api.get('/audit/actions');
    action.input.append(...items.map((a) => option(a, t(`audit.a.${a}`))));
  } catch (err) {
    message(feedback, 'error', errorText(err));
  }
  for (const f of [action, from, to]) f.input.addEventListener('change', () => load());

  main.append(h('section', { class: 'stack' },
    h('h1', {}, t('audit.title')),
    h('p', { class: 'muted' }, t('audit.help')),
    h('div', { class: 'row' }, action.wrapper, from.wrapper, to.wrapper),
    feedback, holder));
  await load();
}
