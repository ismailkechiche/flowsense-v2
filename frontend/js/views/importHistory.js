import { h, message, clear, toast } from '../dom.js';
import { t } from '../i18n.js';
import { api, query } from '../api.js';
import { errorText, formatLocal } from './common.js';
import { pager } from './pager.js';

export async function importHistoryView(main) {
  const feedback = h('div', { 'aria-live': 'polite' });
  const holder = h('div', { class: 'stack' });

  async function rollback(batch) {
    try {
      const check = await api.get(`/imports/${batch.id}/rollback`);
      if (!window.confirm(t('history.confirmRollback', { filename: batch.filename, sessions: check.sessions_to_delete.length, rows: check.batch_observation_count }))) return;
      let confirmAdded = false;
      if (check.added_rows.length > 0) {
        const list = check.added_rows.slice(0, 15).map((r) => `• ${r.session_name}: ${r.passenger_group_code} (${formatLocal(r.arrival_time)})`).join('\n');
        confirmAdded = window.confirm(t('history.confirmAdded', { count: check.added_rows.length, list }));
        if (!confirmAdded) return;
      }
      await api.post(`/imports/${batch.id}/rollback`, { confirm_added_rows: confirmAdded });
      toast(t('history.done'));
      await load();
    } catch (err) {
      message(feedback, 'error', errorText(err));
    }
  }

  async function load(page = 1) {
    try {
      const result = await api.get(`/imports${query({ page })}`);
      clear(holder);
      if (result.total === 0) {
        holder.append(h('p', { class: 'muted' }, t('common.empty')));
        return;
      }
      holder.append(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, [t('history.file'), t('history.by'), t('history.when'), t('history.rows'), t('history.rejected'), t('history.status'), t('common.actions')]
          .map((l) => h('th', { scope: 'col' }, l)))),
        h('tbody', {}, result.items.map((b) => h('tr', {},
          h('td', {}, b.filename),
          h('td', {}, b.uploaded_by_name),
          h('td', {}, formatLocal(b.created_at)),
          h('td', { class: 'num' }, String(b.row_count)),
          h('td', { class: 'num' }, String(b.rejected_row_count)),
          h('td', {}, b.status === 'committed'
            ? h('span', { class: 'badge status-approved' }, t('history.committed'))
            : h('span', { class: 'badge status-disabled' }, `${t('history.rolledBack')} · ${b.rolled_back_by_name ?? ''}`)),
          h('td', {}, b.status === 'committed' ? h('button', { type: 'button', class: 'danger', onclick: () => rollback(b) }, t('history.rollback')) : null)))))),
      pager(result, load));
    } catch (err) {
      message(feedback, 'error', errorText(err));
    }
  }

  main.append(h('section', { class: 'stack' }, h('h1', {}, t('history.title')), feedback, holder));
  await load();
}
