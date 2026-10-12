import { h, field, option, message } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { errorText } from './common.js';

export async function signupView(main) {
  const name = field(t('signup.name'), 'input', { name: 'name', autocomplete: 'name', required: true, maxlength: 100 });
  const email = field(t('signup.email'), 'input', { type: 'email', name: 'email', autocomplete: 'email', required: true });
  const password = field(t('signup.password'), 'input', { type: 'password', name: 'password', autocomplete: 'new-password', required: true, minlength: 10 });
  const role = field(t('signup.role'), 'select', { name: 'requested_role' }, [
    option('collector', t('role.collector'), true),
    option('analyst', t('role.analyst')),
  ]);
  const feedback = h('div', { 'aria-live': 'polite' });
  const submit = h('button', { type: 'submit' }, t('signup.submit'));

  const form = h('form', { class: 'card stack', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    submit.disabled = true;
    message(feedback);
    try {
      await api.post('/auth/signup', {
        name: name.input.value, email: email.input.value, password: password.input.value, requested_role: role.input.value,
      });
      form.replaceChildren(h('h1', {}, t('signup.title')), h('p', { class: 'message success' }, t('signup.done')),
        h('a', { href: '#/login' }, t('signup.backToLogin')));
    } catch (err) {
      message(feedback, 'error', errorText(err), err.details);
      submit.disabled = false;
    }
  } }, h('h1', {}, t('signup.title')), name.wrapper, email.wrapper, password.wrapper, role.wrapper, feedback, submit,
  h('p', {}, h('a', { href: '#/login' }, t('signup.backToLogin'))));

  main.append(h('div', { class: 'narrow' }, form));
  name.input.focus();
}
