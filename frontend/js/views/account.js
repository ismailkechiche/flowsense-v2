import { h, field, message } from '../dom.js';
import { initials } from '../auth.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { getUser } from '../auth.js';
import { errorText, pageHeader } from './common.js';

export async function accountView(main) {
  const user = getUser();
  const current = field(t('account.current'), 'input', { type: 'password', autocomplete: 'current-password', required: true });
  const next = field(t('account.new'), 'input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 10 });
  const feedback = h('div', { 'aria-live': 'polite' });
  const submit = h('button', { type: 'submit' }, t('common.save'));

  const form = h('form', { class: 'card stack', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await api.post('/auth/password', { current_password: current.input.value, new_password: next.input.value });
      form.reset();
      message(feedback, 'success', t('account.changed'));
    } catch (err) {
      message(feedback, 'error', errorText(err), err.details);
    } finally {
      submit.disabled = false;
    }
  } }, h('h2', {}, t('account.changePassword')), current.wrapper, next.wrapper, feedback, submit);

  main.append(h('section', { class: 'stack narrow' },
    pageHeader(t('account.title')),
    h('div', { class: 'card profile' },
      h('span', { class: 'avatar large', 'aria-hidden': 'true' }, initials(user.name)),
      h('div', {}, h('h2', {}, user.name), h('p', { class: 'muted' }, user.email), h('span', { class: 'badge accent' }, t(`role.${user.role}`)))),
    form));
}
