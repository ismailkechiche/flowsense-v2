import { h, field, option, message, clear, toast } from '../dom.js';
import { t } from '../i18n.js';
import { api, query } from '../api.js';
import { getUser } from '../auth.js';
import { errorText, formatLocal } from './common.js';

const ROLES = ['collector', 'analyst', 'admin'];
const STATUSES = ['pending', 'approved', 'rejected', 'disabled'];

function roleSelect(selected, label) {
  const select = h('select', { 'aria-label': label }, ROLES.map((r) => option(r, t(`role.${r}`), r === selected)));
  return select;
}

export async function usersView(main) {
  const me = getUser();
  const feedback = h('div', { 'aria-live': 'polite' });
  const tableHolder = h('div');
  const filter = field(t('users.filter'), 'select', {}, [
    option('', t('common.all')),
    ...STATUSES.map((s) => option(s, t(`status.${s}`), s === 'pending')),
  ]);

  async function act(promise) {
    try {
      await promise;
      toast(t('common.saved'));
      await load();
    } catch (err) {
      message(feedback, 'error', errorText(err));
    }
  }

  function actionsFor(user) {
    if (user.id === me.id) return h('span', { class: 'muted' }, t('users.you'));
    const base = `/users/${user.id}`;
    if (user.status === 'pending' || user.status === 'rejected') {
      const select = roleSelect(user.role, `${t('users.approveAs')} ${user.name}`);
      return h('div', { class: 'actions' }, select,
        h('button', { type: 'button', onclick: () => act(api.post(`${base}/approve`, { role: select.value })) }, t('users.approve')),
        user.status === 'pending' && h('button', { type: 'button', class: 'secondary', onclick: () => {
          if (window.confirm(t('users.confirmReject', { name: user.name }))) act(api.post(`${base}/reject`));
        } }, t('users.reject')));
    }
    if (user.status === 'approved') {
      const select = roleSelect(user.role, `${t('users.changeRole')} ${user.name}`);
      select.addEventListener('change', () => act(api.patch(`${base}/role`, { role: select.value })));
      return h('div', { class: 'actions' }, select,
        h('button', { type: 'button', class: 'danger', onclick: () => {
          if (window.confirm(t('users.confirmDisable', { name: user.name }))) act(api.post(`${base}/disable`));
        } }, t('users.disable')));
    }
    return h('button', { type: 'button', class: 'secondary', onclick: () => act(api.post(`${base}/enable`)) }, t('users.enable'));
  }

  async function load() {
    message(feedback);
    try {
      const { items } = await api.get(`/users${query({ status: filter.input.value })}`);
      clear(tableHolder);
      if (items.length === 0) {
        tableHolder.append(h('p', { class: 'muted' }, t('common.empty')));
        return;
      }
      tableHolder.append(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, [t('users.name'), t('users.email'), t('users.role'), t('users.status'), t('users.created'), t('common.actions')]
          .map((label) => h('th', { scope: 'col' }, label)))),
        h('tbody', {}, items.map((user) => h('tr', {},
          h('td', {}, user.name),
          h('td', {}, user.email),
          h('td', {}, t(`role.${user.role}`)),
          h('td', {}, h('span', { class: `badge status-${user.status}` }, t(`status.${user.status}`))),
          h('td', {}, formatLocal(user.created_at)),
          h('td', {}, actionsFor(user))))))));
    } catch (err) {
      message(feedback, 'error', errorText(err));
    }
  }

  filter.input.addEventListener('change', load);
  main.append(h('section', { class: 'stack' }, h('h1', {}, t('users.title')), h('div', { class: 'row' }, filter.wrapper), feedback, tableHolder));
  await load();
}
