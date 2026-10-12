import { h } from '../dom.js';
import { t } from '../i18n.js';
import { getUser } from '../auth.js';

export async function homeView(main) {
  const user = getUser();
  main.append(h('section', { class: 'stack' },
    h('h1', {}, t('home.title', { name: user.name })),
    h('p', {}, t('home.role', { role: t(`role.${user.role}`) })),
    h('p', { class: 'card' }, t(`home.${user.role}`))));
}
