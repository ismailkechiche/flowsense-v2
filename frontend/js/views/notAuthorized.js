import { h } from '../dom.js';
import { t } from '../i18n.js';

export async function notAuthorizedView(main) {
  main.append(h('section', { class: 'card stack' },
    h('h1', {}, t('notAuthorized.title')),
    h('p', {}, t('notAuthorized.body')),
    h('a', { href: '#/home' }, t('common.goHome'))));
}

export async function notFoundView(main) {
  main.append(h('section', { class: 'card stack' },
    h('h1', {}, t('notFound.title')),
    h('p', {}, t('notFound.body')),
    h('a', { href: '#/home' }, t('common.goHome'))));
}
