import { h, field, message } from '../dom.js';
import { t } from '../i18n.js';
import { login } from '../auth.js';
import { navigate } from '../router.js';
import { errorText } from './common.js';
import { authLayout } from './authLayout.js';

export async function loginView(main) {
  const email = field(t('login.email'), 'input', { type: 'email', name: 'email', autocomplete: 'username', required: true });
  const password = field(t('login.password'), 'input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const feedback = h('div', { 'aria-live': 'polite' });
  const submit = h('button', { type: 'submit' }, t('login.submit'));

  const form = h('form', { novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    submit.disabled = true;
    message(feedback);
    try {
      await login(email.input.value, password.input.value);
      navigate('/home');
    } catch (err) {
      message(feedback, 'error', errorText(err));
      password.input.value = '';
      password.input.focus();
    } finally {
      submit.disabled = false;
    }
  } }, email.wrapper, password.wrapper, feedback, submit);

  main.append(authLayout(
    h('h1', {}, t('login.title')),
    h('p', { class: 'subtitle' }, t('login.subtitle')),
    form,
    h('p', { class: 'auth-switch' }, `${t('login.noAccount')} `, h('a', { href: '#/signup' }, t('login.signupLink')))));
  email.input.focus();
}
