import { h, field, message, clear, toast, icon } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { hasRole } from '../auth.js';
import { errorText, pageHeader } from './common.js';

function checkpointForm(initial, submitLabel, onSubmit, onCancel) {
  const name = field(t('checkpoints.name'), 'input', { required: true, maxlength: 80, value: initial.name ?? '' });
  const area = field(t('checkpoints.area'), 'input', { maxlength: 120, value: initial.area ?? '' });
  const servers = field(t('checkpoints.servers'), 'input', { type: 'number', min: 1, step: 1, required: true, value: initial.servers ?? 1 });
  const sla = field(t('checkpoints.sla'), 'input', { type: 'number', min: 0.1, step: 0.1, required: true, value: initial.sla_wait_minutes ?? '' });
  const active = h('input', { type: 'checkbox', id: `active-${initial.id ?? 'new'}`, checked: initial.active ?? true });
  const feedback = h('div', { 'aria-live': 'polite' });
  const submit = h('button', { type: 'submit' }, submitLabel);

  const form = h('form', { class: 'card stack', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      await onSubmit({
        name: name.input.value,
        area: area.input.value.trim() === '' ? null : area.input.value,
        servers: Number(servers.input.value),
        sla_wait_minutes: Number(sla.input.value),
        active: active.checked,
      });
    } catch (err) {
      message(feedback, 'error', errorText(err), err.details);
      submit.disabled = false;
    }
  } },
  h('div', { class: 'form-grid' }, name.wrapper, area.wrapper, servers.wrapper, sla.wrapper),
  h('label', { class: 'inline', for: active.id }, active, t('checkpoints.active')),
  feedback,
  h('div', { class: 'actions' }, submit, onCancel && h('button', { type: 'button', class: 'secondary', onclick: onCancel }, t('common.cancel'))));
  return form;
}

export async function checkpointsView(main) {
  const isAdmin = hasRole(['admin']);
  const feedback = h('div', { 'aria-live': 'polite' });
  const listHolder = h('div');
  const editorHolder = h('div');

  async function load() {
    try {
      const { items } = await api.get('/checkpoints');
      clear(listHolder);
      listHolder.append(h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, [[t('checkpoints.name')], [t('checkpoints.area')], [t('checkpoints.servers'), 'num'], [t('checkpoints.sla'), 'num'], [t('checkpoints.active')], isAdmin && [t('common.actions')]]
          .filter(Boolean).map(([label, cls]) => h('th', { scope: 'col', class: cls }, label)))),
        h('tbody', {}, items.map((cp) => h('tr', {},
          h('td', {}, h('strong', {}, cp.name)),
          h('td', { class: 'muted' }, cp.area ?? ''),
          h('td', { class: 'num' }, String(cp.servers)),
          h('td', { class: 'num' }, String(cp.sla_wait_minutes)),
          h('td', {}, cp.active
            ? h('span', { class: 'badge status-approved' }, t('common.yes'))
            : h('span', { class: 'badge status-disabled' }, t('common.no'))),
          isAdmin && h('td', {}, h('button', { type: 'button', class: 'secondary', onclick: () => edit(cp) }, t('checkpoints.edit')))))))));
    } catch (err) {
      message(feedback, 'error', errorText(err));
    }
  }

  function closeEditor() {
    clear(editorHolder);
  }

  function edit(cp) {
    clear(editorHolder);
    const form = checkpointForm(cp, t('common.save'), async (data) => {
      await api.patch(`/checkpoints/${cp.id}`, data);
      toast(t('common.saved'));
      closeEditor();
      await load();
    }, closeEditor);
    form.prepend(h('h2', {}, `${t('checkpoints.edit')}: ${cp.name}`));
    editorHolder.append(form);
    editorHolder.querySelector('input').focus();
  }

  function add() {
    clear(editorHolder);
    const form = checkpointForm({}, t('checkpoints.create'), async (data) => {
      await api.post('/checkpoints', data);
      toast(t('common.saved'));
      closeEditor();
      await load();
    }, closeEditor);
    form.prepend(h('h2', {}, t('checkpoints.add')));
    editorHolder.append(form);
    editorHolder.querySelector('input').focus();
  }

  main.append(h('section', { class: 'stack' },
    pageHeader(t('checkpoints.title'), {
      subtitle: t('checkpoints.slaNote'),
      actions: h('button', { type: 'button', onclick: add, 'data-roles': 'admin' }, icon('plus'), t('checkpoints.add')),
    }),
    feedback, editorHolder, listHolder));
  await load();
}
