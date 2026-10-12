import { h, field, option, message, clear } from '../dom.js';
import { t } from '../i18n.js';
import { api, query } from '../api.js';
import { errorText, formatMinutes } from './common.js';
import { pager } from './pager.js';

export function slaBadge(session) {
  return session.sla_breached ? h('span', { class: 'badge breach', title: t('sessions.breach') }, `⚠ ${t('sessions.breach')}`) : null;
}

export async function sessionsView(main) {
  const feedback = h('div', { 'aria-live': 'polite' });
  const results = h('div', { class: 'stack' });
  const { items: checkpoints } = await api.get('/checkpoints');

  const checkpoint = field(t('sessions.checkpoint'), 'select', {}, [
    option('', t('sessions.anyCheckpoint')), ...checkpoints.map((c) => option(c.id, c.name)),
  ]);
  const from = field(t('sessions.from'), 'input', { type: 'date' });
  const to = field(t('sessions.to'), 'input', { type: 'date' });
  const shift = field(t('sessions.shift'), 'select', {}, [
    option('', t('sessions.anyShift')), ...['morning', 'afternoon', 'night'].map((s) => option(s, t(`shift.${s}`))),
  ]);

  async function load(page = 1) {
    message(feedback);
    try {
      const result = await api.get(`/sessions${query({
        page, checkpoint_id: checkpoint.input.value, from: from.input.value, to: to.input.value, shift: shift.input.value,
      })}`);
      clear(results);
      if (result.total === 0) {
        results.append(h('p', { class: 'muted' }, t('common.empty')));
        return;
      }
      results.append(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, [t('sessions.name'), t('sessions.date'), t('sessions.checkpoint'), t('sessions.shift'),
          t('sessions.groups'), t('sessions.pax'), t('sessions.avgWait'), t('sessions.createdBy')].map((label) => h('th', { scope: 'col' }, label)))),
        h('tbody', {}, result.items.map((s) => h('tr', {},
          h('td', {}, h('a', { href: `#/sessions/${s.id}` }, s.name), s.import_batch_id ? h('span', { class: 'badge' }, ` ${t('sessions.imported')}`) : null),
          h('td', {}, s.date),
          h('td', {}, s.checkpoint_name),
          h('td', {}, s.shift ? t(`shift.${s.shift}`) : t('shift.none')),
          h('td', { class: 'num' }, String(s.group_count)),
          h('td', { class: 'num' }, String(s.pax_total)),
          h('td', { class: 'num' }, formatMinutes(s.avg_wait_minutes), ' ', slaBadge(s)),
          h('td', {}, s.created_by_name)))))),
      pager(result, load));
    } catch (err) {
      message(feedback, 'error', errorText(err));
    }
  }

  const filters = h('form', { class: 'row card', onsubmit: (event) => { event.preventDefault(); load(1); } },
    checkpoint.wrapper, from.wrapper, to.wrapper, shift.wrapper, h('button', { type: 'submit' }, t('sessions.filter')));

  main.append(h('section', { class: 'stack' },
    h('div', { class: 'row space-between' }, h('h1', {}, t('sessions.title')),
      h('a', { class: 'button', href: '#/sessions/new', 'data-roles': 'collector admin' }, t('sessions.new'))),
    filters, feedback, results));
  await load(1);
}
