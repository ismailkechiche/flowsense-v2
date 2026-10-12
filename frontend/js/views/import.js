import { h, field, option, message, clear, icon, iconChip } from '../dom.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { errorText, pageHeader } from './common.js';

const FIELDS = ['date', 'checkpoint', 'passenger_group_code', 'pax', 'flight_no', 'counter', 'arrival_time', 'service_start', 'service_end', 'observer'];

/**
 * Import flow: upload → preview (nothing saved) → confirm.
 *
 * Every upload starts from a fresh `choices` object and freshly built
 * controls: no previous session, mapping or name is remembered anywhere
 * (no localStorage, no module-level state, autocomplete off), so each
 * group defaults to "Create new session" (spec §7.4).
 */
export async function importView(main) {
  const { items: allCheckpoints } = await api.get('/checkpoints');
  const checkpoints = allCheckpoints.filter((c) => c.active);
  const feedback = h('div', { 'aria-live': 'polite' });
  const previewHolder = h('div', { class: 'stack' });

  const fileInput = h('input', { type: 'file', id: 'import-file', accept: '.xlsx,.xls,.csv', required: true, autocomplete: 'off' });
  const uploadButton = h('button', { type: 'submit' }, icon('import'), t('import.upload'));
  const uploadForm = h('form', { class: 'card stack', autocomplete: 'off', onsubmit: async (event) => {
    event.preventDefault();
    const file = fileInput.files[0];
    if (!file) return;
    clear(previewHolder);
    message(feedback, 'success', t('import.uploading'));
    uploadButton.disabled = true;
    try {
      const { preview } = await api.upload(`/imports/preview?filename=${encodeURIComponent(file.name)}`, file);
      message(feedback);
      startPreview(preview);
    } catch (err) {
      message(feedback, 'error', errorText(err), err.details);
    } finally {
      uploadButton.disabled = false;
    }
  } },
  h('div', { class: 'card-title' }, iconChip('import', 'teal'), h('div', {}, h('h2', {}, t('import.step1')), h('p', { class: 'muted' }, t('import.formats')))),
  h('div', { class: 'field' }, h('label', { for: 'import-file' }, t('import.file')), fileInput), h('div', { class: 'actions' }, uploadButton));

  /** One preview's lifetime: its own choices, discarded on the next upload. */
  function startPreview(initial) {
    const choices = { mapping: {}, checkpoint_values: {} };
    let current = initial;

    async function refresh() {
      try {
        ({ preview: current } = await api.post(`/imports/previews/${current.preview_id}`, choices));
        render();
      } catch (err) {
        message(feedback, 'error', errorText(err), err.details);
      }
    }

    function render() {
      clear(previewHolder);
      const p = current;
      previewHolder.append(h('p', { class: 'message info' }, h('strong', {}, p.filename), `: ${t('import.nothingWritten')}`));

      if (p.duplicate) {
        previewHolder.append(h('div', { class: 'message error', role: 'alert' },
          t('import.duplicate', { date: p.duplicate.created_at.replace('T', ' ').slice(0, 16), name: p.duplicate.uploaded_by_name, filename: p.duplicate.filename }),
          h('label', { class: 'inline' }, h('input', { type: 'checkbox', id: 'confirm-duplicate' }), ` ${t('import.duplicateConfirm')}`)));
      }

      if (p.sheets.length > 1) {
        const sheet = field(t('import.sheet'), 'select', {}, p.sheets.map((s) => option(s.index, s.name, s.index === p.sheet)));
        sheet.input.addEventListener('change', () => {
          choices.sheet = Number(sheet.input.value);
          choices.mapping = {};
          refresh();
        });
        previewHolder.append(h('div', { class: 'row' }, sheet.wrapper));
      }

      // Most sheets hold one checkpoint and have no checkpoint column, so the
      // picker always comes first.
      previewHolder.append(fileCheckpointPicker(p));
      previewHolder.append(mappingTable(p));
      if (p.unknown_checkpoint_values.length > 0) previewHolder.append(unknownValues(p));
      if (p.midnight_crossings > 0) previewHolder.append(h('p', { class: 'muted' }, t('import.midnight', { rule: p.midnight_rule, count: p.midnight_crossings })));
      else previewHolder.append(h('p', { class: 'muted' }, p.midnight_rule));

      const targetControls = new Map();
      if (p.groups.length > 0) previewHolder.append(groupsTable(p, targetControls));
      if (p.rejected_rows.length > 0) previewHolder.append(rejectedTable(p));
      previewHolder.append(commitBar(p, targetControls));
    }

    function mappingTable(p) {
      return h('section', { class: 'card stack' }, h('h2', {}, t('import.mapping')),
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, [t('import.field'), t('import.column'), t('import.confidence')].map((l) => h('th', { scope: 'col' }, l)))),
          h('tbody', {}, FIELDS.map((f) => {
            const m = p.mapping[f];
            const required = p.required_fields.includes(f);
            const select = h('select', { 'aria-label': `${t('import.column')}: ${t(`field.${f}`)}` },
              option('', t('import.notMapped'), !m),
              p.headers.filter((col) => col.header).map((col) => option(col.index, col.header, m && m.index === col.index)));
            select.addEventListener('change', () => {
              choices.mapping[f] = select.value === '' ? null : Number(select.value);
              if (f === 'checkpoint' && select.value !== '') delete choices.file_checkpoint_id;
              refresh();
            });
            return h('tr', {},
              h('td', {}, t(`field.${f}`), required ? h('span', { class: 'muted' }, ` (${t('import.required')})`) : null),
              h('td', {}, select),
              h('td', {}, m ? h('span', { class: `badge ${m.confidence < 1 ? 'status-pending' : 'status-approved'}` },
                `${Math.round(m.confidence * 100)}% · ${t(`import.method.${m.method}`)}`) : (required ? h('span', { class: 'badge breach' }, '!') : '')));
          })))));
    }

    function fileCheckpointPicker(p) {
      const column = p.mapping.checkpoint;
      const picker = field(t('import.fileCheckpoint'), 'select', { required: true }, [
        column
          ? option('', t('import.checkpointFromColumn', { column: column.header }), true)
          : option('', t('import.chooseCheckpoint'), !p.file_checkpoint_id),
        ...checkpoints.map((c) => option(c.id, c.name, !column && c.id === p.file_checkpoint_id)),
      ]);
      picker.input.addEventListener('change', () => {
        if (picker.input.value === '') {
          delete choices.file_checkpoint_id;
        } else {
          // One checkpoint for every row: stop reading it from a column.
          choices.file_checkpoint_id = Number(picker.input.value);
          choices.mapping.checkpoint = null;
        }
        refresh();
      });
      return h('div', { class: 'card stack' }, picker.wrapper, h('p', { class: 'muted' }, t('import.fileCheckpointHelp')));
    }

    function unknownValues(p) {
      return h('section', { class: 'card stack' }, h('h2', {}, t('import.unknownValues')), h('p', { class: 'muted' }, t('import.unknownHelp')),
        p.unknown_checkpoint_values.map((value) => {
          const f = field(value, 'select', {}, [option('', t('import.skipRows'), true), ...checkpoints.map((c) => option(c.id, c.name))]);
          f.input.addEventListener('change', () => {
            if (f.input.value === '') delete choices.checkpoint_values[value];
            else choices.checkpoint_values[value] = Number(f.input.value);
            refresh();
          });
          return f.wrapper;
        }));
    }

    function groupsTable(p, targetControls) {
      return h('section', { class: 'card stack' }, h('h2', {}, t('import.sessions')), h('p', { class: 'muted' }, t('import.sessionsHelp')),
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, [t('sessions.checkpoint'), t('sessions.date'), t('sessions.shift'), t('import.rows'), t('sessions.pax'), t('import.target')]
            .map((l) => h('th', { scope: 'col' }, l)))),
          h('tbody', {}, p.groups.map((g) => {
            // Always starts on "new"; existing sessions are offered, never pre-selected.
            const select = h('select', { 'aria-label': `${t('import.target')}: ${g.checkpoint_name} ${g.date}`, autocomplete: 'off' },
              option('new', t('import.newSession'), true),
              g.existing_sessions.map((s) => option(s.id, t('import.appendTo', { name: s.name, count: s.group_count }))));
            const name = h('input', { 'aria-label': t('import.sessionName'), value: g.default_target.name, maxlength: 120, autocomplete: 'off' });
            select.addEventListener('change', () => { name.hidden = select.value !== 'new'; });
            targetControls.set(g.key, { select, name });
            return h('tr', {},
              h('td', {}, g.checkpoint_name), h('td', {}, g.date), h('td', {}, g.shift ? t(`shift.${g.shift}`) : '—'),
              h('td', { class: 'num' }, String(g.row_count)), h('td', { class: 'num' }, String(g.pax_total)),
              h('td', {}, h('div', { class: 'stack-tight' }, select, name)));
          })))));
    }

    function rejectedTable(p) {
      return h('details', { class: 'card', open: p.rejected_rows.length <= 20 },
        h('summary', {}, t('import.rejected', { count: p.rejected_count })),
        h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, t('import.rowNumber')), h('th', { scope: 'col' }, t('import.reasons')))),
          h('tbody', {}, p.rejected_rows.map((r) => h('tr', {}, h('td', { class: 'num' }, String(r.rowNumber)), h('td', {}, r.reasons.join('; '))))))));
    }

    function commitBar(p, targetControls) {
      const result = h('div', { 'aria-live': 'polite' });
      const button = h('button', { type: 'button', disabled: !p.can_commit, onclick: async () => {
        button.disabled = true;
        button.textContent = t('import.committing');
        const targets = [...targetControls.entries()].map(([key, { select, name }]) => (select.value === 'new'
          ? { key, mode: 'new', name: name.value }
          : { key, mode: 'existing', session_id: Number(select.value) }));
        try {
          const { batch } = await api.post(`/imports/previews/${p.preview_id}/commit`, {
            ...choices, targets, confirm_duplicate: document.getElementById('confirm-duplicate')?.checked ?? false,
          });
          finish(batch);
        } catch (err) {
          message(result, 'error', errorText(err), err.details);
          button.disabled = false;
          button.textContent = t('import.commit', { rows: p.accepted_count, groups: p.groups.length });
        }
      } }, t('import.commit', { rows: p.accepted_count, groups: p.groups.length }));
      return h('div', { class: 'card stack' },
        p.blocking_reasons.length > 0 ? h('div', { class: 'message error' }, t('import.blocked'), h('ul', {}, p.blocking_reasons.map((r) => h('li', {}, r)))) : null,
        result, button);
    }

    render();
  }

  function finish(batch) {
    // Reset everything so the next upload starts clean.
    uploadForm.reset();
    clear(previewHolder);
    message(feedback);
    previewHolder.append(h('div', { class: 'message success stack' },
      h('p', {}, t('import.done', { rows: batch.row_count, groups: batch.split_summary.length })),
      h('ul', {}, batch.split_summary.map((s) => h('li', {}, h('a', { href: `#/sessions/${s.session_id}` }, `${s.checkpoint_name} — ${s.date}`), ` (${s.row_count})`)))));
  }

  main.append(h('section', { class: 'stack' },
    pageHeader(t('import.title'), { subtitle: t('import.subtitle') }),
    uploadForm, feedback, previewHolder));
}
