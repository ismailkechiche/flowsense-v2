import { h, field, option, message } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { errorText } from './common.js';
import { authLayout } from './authLayout.js';

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

  const form = h('form', { novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    submit.disabled = true;
    message(feedback);
    try {
      await api.post('/auth/signup', {
        name: name.input.value, email: email.input.value, password: password.input.value, requested_role: role.input.value,
      });
      form.replaceChildren(h('p', { class: 'message success', role: 'status' }, t('signup.done')),
        h('a', { class: 'button', href: '#/login' }, t('signup.backToLogin')));
      intro.hidden = true;
    } catch (err) {
      message(feedback, 'error', errorText(err), err.details);
      submit.disabled = false;
    }
  } }, name.wrapper, email.wrapper, password.wrapper, role.wrapper, feedback, submit);
  const intro = h('p', { class: 'subtitle' }, t('signup.subtitle'));

  main.append(authLayout(
    h('h1', {}, t('signup.title')),
    intro,
    form,
    h('p', { class: 'auth-switch' }, `${t('signup.haveAccount')} `, h('a', { href: '#/login' }, t('signup.loginLink')))));
  name.input.focus();
}
