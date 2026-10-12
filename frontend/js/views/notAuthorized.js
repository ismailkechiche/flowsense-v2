import { h, emptyState } from '../dom.js';
import { t } from '../i18n.js';

export async function notAuthorizedView(main) {
  main.append(h('section', { class: 'stack narrow fallback' },
    emptyState(t('notAuthorized.title'), t('notAuthorized.body'), h('a', { class: 'button', href: '#/home' }, t('common.goHome')), 'lock')));
}

export async function notFoundView(main) {
  main.append(h('section', { class: 'stack narrow fallback' },
    emptyState(t('notFound.title'), t('notFound.body'), h('a', { class: 'button', href: '#/home' }, t('common.goHome')), 'alert')));
}
