import { h, icon, iconChip } from '../dom.js';
import { t } from '../i18n.js';

/** Two-column frame for the signed-out screens: brand story left, form right. */
export function authLayout(...card) {
  const point = (name, title, body) => h('li', {}, iconChip(name), h('span', {}, h('strong', {}, title), body));
  return h('div', { class: 'auth-shell' },
    h('aside', { class: 'auth-brand' },
      h('a', { class: 'brand', href: '#/login' },
        h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, icon('logo')),
        h('span', { class: 'brand-text' }, h('span', { class: 'brand-name' }, 'FLOWSENSE'), h('span', { class: 'brand-sub' }, t('app.tagline')))),
      h('div', {},
        h('h2', {}, t('auth.headline')),
        h('p', { class: 'lead' }, t('auth.lead')),
        h('ul', { class: 'auth-points' },
          point('sessions', t('auth.point1.title'), t('auth.point1.body')),
          point('dashboard', t('auth.point2.title'), t('auth.point2.body')),
          point('simulator', t('auth.point3.title'), t('auth.point3.body')))),
      h('p', { class: 'auth-foot' }, t('auth.foot'))),
    h('div', { class: 'auth-panel' }, h('div', { class: 'auth-card' }, ...card)));
}
