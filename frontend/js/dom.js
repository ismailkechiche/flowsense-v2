// DOM helpers. User-provided text only ever goes through textContent.

/**
 * h('button', { type: 'button', onclick: fn, class: 'x' }, 'Label', child)
 * Strings become text nodes; attributes starting with "on" become listeners.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') el.addEventListener(name.slice(2), value);
    else if (name === 'class') el.className = value;
    else if (name === 'dataset') Object.assign(el.dataset, value);
    else if (value === true) el.setAttribute(name, '');
    else el.setAttribute(name, String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

let fieldCounter = 0;
/** A labelled form field; returns { wrapper, input }. */
export function field(labelText, inputTag, attrs = {}, options = []) {
  fieldCounter += 1;
  const id = attrs.id ?? `f${fieldCounter}`;
  const input = h(inputTag, { ...attrs, id }, options);
  const wrapper = h('div', { class: 'field' }, h('label', { for: id }, labelText), input);
  return { wrapper, input };
}

export function option(value, label, selected = false) {
  return h('option', { value, selected }, label);
}

/** Shows an inline error/success box (aria-live) inside `container`. */
export function message(container, kind, text, details) {
  clear(container);
  if (!text) return;
  container.append(h('div', { class: `message ${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    text,
    details?.length ? h('ul', {}, details.map((d) => h('li', {}, d.field ? `${d.field}: ${d.message}` : d.message))) : null));
}

let toastTimer;
export function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** An icon from the sprite in index.html (`name` is a fixed id, never user text). */
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/** A rounded, tinted square holding an icon. */
export function iconChip(name, tone) {
  return h('span', { class: `icon-chip${tone ? ` tone-${tone}` : ''}`, 'aria-hidden': 'true' }, icon(name));
}

/** "Nothing here yet" panel: icon, title, optional hint and action. */
export function emptyState(title, hint, action, iconName = 'inbox') {
  return h('div', { class: 'empty-state' }, iconChip(iconName), h('h3', {}, title), hint ? h('p', {}, hint) : null, action ?? null);
}

/** Inline spinner with a label. */
export function loading(text) {
  return h('p', { class: 'loading', role: 'status' }, text);
}
