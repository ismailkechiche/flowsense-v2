import { h, icon, iconChip } from '../dom.js';
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

/**
 * A content card with a header row: optional icon chip, title, one-line
 * description and actions on the right. Every screen builds its panels with
 * this so they share one look.
 */
export function card({ title, subtitle, icon: iconName, tone, actions, id, tag = 'section', className = '' }, ...children) {
  return h(tag, { class: `card stack ${className}`.trim(), 'aria-labelledby': id ? `${id}-title` : null },
    cardHeader({ title, subtitle, icon: iconName, tone, actions, id }), ...children);
}

/** The header row of a card on its own, for forms that build their own card. */
export function cardHeader({ title, subtitle, icon: iconName, tone, actions, id }) {
  return h('div', { class: 'card-header' },
    h('div', { class: 'card-title' },
      iconName ? iconChip(iconName, tone) : null,
      h('div', {}, h('h2', { id: id ? `${id}-title` : null }, title), subtitle ? h('p', { class: 'card-subtitle' }, subtitle) : null)),
    actions ? h('div', { class: 'page-actions' }, actions) : null);
}

let hintCounter = 0;
/**
 * A label followed by a small "i" button that reveals a plain-language
 * explanation on hover or keyboard focus (the text is also the button's
 * accessible description).
 */
export function term(label, explanation) {
  hintCounter += 1;
  const id = `hint-${hintCounter}`;
  return h('span', { class: 'term' }, label,
    h('button', { type: 'button', class: 'hint-button', 'aria-describedby': id, 'aria-label': t('common.whatIs', { term: label }) }, icon('info')),
    h('span', { class: 'hint-pop', role: 'tooltip', id }, explanation));
}

let tabsCounter = 0;
/**
 * Accessible tabs: `items` = [{ key, label, icon? }]. Returns the tab list,
 * one panel element per key and `select(key)`. Arrow keys move between
 * tabs; `onSelect(key)` runs whenever the shown tab changes.
 */
export function tabs(items, { label, initial, onSelect } = {}) {
  tabsCounter += 1;
  const prefix = `tabs${tabsCounter}`;
  const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': label });
  const buttons = {};
  const panels = {};
  let current = null;

  function select(key, focus = false, notify = true) {
    if (!buttons[key]) key = items[0].key;
    current = key;
    for (const item of items) {
      const on = item.key === key;
      buttons[item.key].setAttribute('aria-selected', String(on));
      buttons[item.key].tabIndex = on ? 0 : -1;
      panels[item.key].hidden = !on;
    }
    if (focus) buttons[key].focus();
    if (notify) onSelect?.(key);
  }

  for (const item of items) {
    buttons[item.key] = h('button', {
      type: 'button', role: 'tab', class: 'tab', id: `${prefix}-${item.key}-tab`, 'aria-controls': `${prefix}-${item.key}`,
      onclick: () => select(item.key),
    }, item.icon ? icon(item.icon) : null, h('span', {}, item.label));
    panels[item.key] = h('div', { role: 'tabpanel', class: 'tab-panel stack', id: `${prefix}-${item.key}`, 'aria-labelledby': `${prefix}-${item.key}-tab`, hidden: true });
    list.append(buttons[item.key]);
  }
  list.addEventListener('keydown', (event) => {
    const keys = items.map((i) => i.key);
    const at = keys.indexOf(current);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: keys.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    select(keys[(to + keys.length) % keys.length], true);
  });
  // The first selection does not call onSelect: the caller's handler may
  // refer to the returned object, which does not exist yet.
  select(initial ?? items[0].key, false, false);
  return { list, panels, select, current: () => current };
}

/** Reads `?name=value` from the hash (`#/admin?tab=audit`). */
export function hashParam(name) {
  const queryString = location.hash.split('?')[1] ?? '';
  return new URLSearchParams(queryString).get(name);
}

/** Rewrites the hash query without a navigation (no re-render, no history entry). */
export function setHashParam(name, value) {
  const [path, queryString = ''] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(queryString);
  params.set(name, value);
  history.replaceState(null, '', `#${path}?${params}`);
}

/** Per-browser remembered choice (storage can be unavailable). */
export function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { /* not persisted */ }
}
export function recall(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
