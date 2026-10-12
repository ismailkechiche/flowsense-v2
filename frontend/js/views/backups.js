import { h, message, clear, toast, emptyState, loading, icon } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { errorText, pageHeader } from './common.js';

/** Bytes as a short human-readable size. */
export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

export async function backupsView(main) {
  const feedback = h('div', { 'aria-live': 'polite' });
  const info = h('p', { class: 'subtitle' });
  const holder = h('div', {}, loading(t('app.loading')));
  const button = h('button', { type: 'button', onclick: backUp }, t('backups.now'));

  async function backUp() {
    button.disabled = true;
    button.textContent = t('backups.running');
    message(feedback);
    try {
      const { backup } = await api.post('/admin/backups', {});
      toast(t('backups.created', { name: backup.name }));
      await load();
    } catch (err) {
      message(feedback, 'error', errorText(err));
    } finally {
      button.disabled = false;
      button.textContent = t('backups.now');
    }
  }

  async function load() {
    try {
      const result = await api.get('/admin/backups');
      info.textContent = t('backups.info', { directory: result.directory, hours: result.interval_hours, count: result.retention_count });
      clear(holder);
      if (result.items.length === 0) {
        holder.append(emptyState(t('backups.empty'), null, null, 'backups'));
        return;
      }
      holder.append(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, [t('backups.name'), t('backups.size'), t('backups.date')].map((l) => h('th', { scope: 'col' }, l)))),
        h('tbody', {}, result.items.map((b) => h('tr', {},
          h('td', {}, h('code', {}, b.name)),
          h('td', { class: 'num' }, formatSize(b.size_bytes)),
          h('td', { class: 'nowrap' }, b.created_at.replace('T', ' ').slice(0, 16))))))));
    } catch (err) {
      message(feedback, 'error', errorText(err));
    }
  }

  main.append(h('section', { class: 'stack' },
    pageHeader(t('backups.title'), { subtitle: info, actions: button }),
    h('p', { class: 'message info' }, t('backups.notDownloadable')),
    feedback, holder));
  await load();
}
