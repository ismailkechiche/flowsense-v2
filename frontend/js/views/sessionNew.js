import { h, field, option, message } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { errorText, nowLocal } from './common.js';

export async function sessionNewView(main) {
  const { items } = await api.get('/checkpoints');
  const checkpoints = items.filter((c) => c.active);
  const feedback = h('div', { 'aria-live': 'polite' });

  const checkpoint = field(t('sessions.checkpoint'), 'select', { required: true }, checkpoints.map((c) => option(c.id, c.name)));
  const date = field(t('sessions.date'), 'input', { type: 'date', required: true, value: nowLocal().slice(0, 10) });
  const name = field(t('sessions.name'), 'input', { required: true, maxlength: 120 });
  const observer = field(t('sessions.observer'), 'input', { maxlength: 120 });
  const notes = field(t('sessions.notes'), 'textarea', { rows: 3, maxlength: 2000 });

  // Suggest "{Checkpoint} — {date}" until the user types their own name.
  let nameTouched = false;
  const suggestName = () => {
    if (nameTouched) return;
    const cp = checkpoints.find((c) => String(c.id) === checkpoint.input.value);
    name.input.value = cp ? `${cp.name} — ${date.input.value}` : '';
  };
  name.input.addEventListener('input', () => { nameTouched = true; });
  checkpoint.input.addEventListener('change', suggestName);
  date.input.addEventListener('change', suggestName);
  suggestName();

  const submit = h('button', { type: 'submit' }, t('sessions.create'));
  const form = h('form', { class: 'card stack', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const { session } = await api.post('/sessions', {
        name: name.input.value,
        date: date.input.value,
        checkpoint_id: Number(checkpoint.input.value),
        observer: observer.input.value.trim() || null,
        notes: notes.input.value.trim() || null,
      });
      navigate(`/sessions/${session.id}`);
    } catch (err) {
      message(feedback, 'error', errorText(err), err.details);
      submit.disabled = false;
    }
  } }, h('div', { class: 'row' }, checkpoint.wrapper, date.wrapper), name.wrapper, observer.wrapper, notes.wrapper, feedback, submit);

  main.append(h('section', { class: 'stack' },
    h('a', { href: '#/sessions' }, `← ${t('sessions.back')}`),
    h('h1', {}, t('sessions.new')), form));
  checkpoint.input.focus();
}
