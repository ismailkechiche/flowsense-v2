import { h, message, clear, toast } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { errorText } from './common.js';

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
  const info = h('p', { class: 'muted' });
  const holder = h('div');
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
        holder.append(h('p', { class: 'muted' }, t('backups.empty')));
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
    h('h1', {}, t('backups.title')),
    info,
    h('p', { class: 'card' }, t('backups.notDownloadable')),
    h('div', { class: 'row' }, button),
    feedback, holder));
  await load();
}
