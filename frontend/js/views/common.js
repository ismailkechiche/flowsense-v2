import { h, icon } from '../dom.js';
import { t } from '../i18n.js';

/** Turns an ApiError into a user-facing sentence. */
export function errorText(err) {
  if (err?.code === 'network_error') return t('error.network');
  return err?.message || t('error.generic');
}

/** Formats a stored local timestamp 'YYYY-MM-DDTHH:MM:SS' for display. */
export function formatLocal(ts) {
  return ts ? ts.replace('T', ' ').slice(0, 16) : '';
}

/** Minutes with one decimal, or an em dash when there is no value. */
export function formatMinutes(minutes) {
  return minutes === null || minutes === undefined ? '—' : minutes.toFixed(1);
}

/** Current local time as 'YYYY-MM-DDTHH:MM:SS' (what datetime-local inputs use). */
export function nowLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Page title row: optional back link, the h1, an optional subtitle and
 * actions on the right.
 */
export function pageHeader(title, { subtitle, actions, back } = {}) {
  return h('header', { class: 'page-header' },
    h('div', {},
      back ? h('a', { class: 'back-link', href: back.href }, icon('back'), back.label) : null,
      h('h1', {}, title),
      subtitle ? (subtitle instanceof Node ? subtitle : h('p', { class: 'subtitle' }, subtitle)) : null),
    actions ? h('div', { class: 'page-actions' }, actions) : null);
}
