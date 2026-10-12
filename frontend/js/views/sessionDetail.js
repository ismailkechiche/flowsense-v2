import { h, field, option, message, clear, toast, icon, emptyState, loading } from '../dom.js';
import { t } from '../i18n.js';
import { api, query } from '../api.js';
import { getUser } from '../auth.js';
import { navigate } from '../router.js';
import { errorText, formatMinutes, formatLocal, nowLocal, pageHeader, cardHeader } from './common.js';
import { pager } from './pager.js';
import { slaBadge } from './sessions.js';

function canEdit(session) {
  const user = getUser();
  return user.role === 'admin' || (user.role === 'collector' && session.created_by === user.id);
}

/** A time input (with seconds) and a "Now" button for live capture. */
function timeField(label, value, onNow) {
  const f = field(label, 'input', { type: 'time', step: 1, required: true, value: value ?? '' });
  f.wrapper.append(h('button', { type: 'button', class: 'secondary', onclick: () => {
    f.input.value = nowLocal().slice(11);
    onNow?.();
  } }, t('obs.now')));
  return f;
}

const withSeconds = (time) => (time.length === 5 ? `${time}:00` : time);

function addOneDay(date) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const secondsOf = (time) => time.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
const MAX_ROLLOVER_GAP_SECONDS = 6 * 3600;

/**
 * Builds full timestamps from one date and three times. A time earlier than
 * the previous one is taken as the next day (midnight crossing, spec §5.2),
 * unless that would mean a gap of more than 6 hours: then it is kept on the
 * same day, so the server reports the clearer "before arrival" error for
 * what is almost certainly a typo.
 */
function composeTimes(date, arrival, start, end) {
  if (!date || !arrival) return [null, null, null];
  const out = [];
  let day = date;
  let previous = null;
  for (const time of [arrival, start, end]) {
    if (!time) { out.push(null); continue; }
    const full = withSeconds(time);
    if (previous && full < previous) {
      const rolledGap = 86400 - (secondsOf(previous) - secondsOf(full));
      if (rolledGap <= MAX_ROLLOVER_GAP_SECONDS) day = addOneDay(day);
    }
    out.push(`${day}T${full}`);
    previous = full;
  }
  return out;
}

function observationForm(session, initial, onDone) {
  const isEdit = Boolean(initial.id);
  const pax = field(t('obs.pax'), 'input', { type: 'number', min: 1, max: 6, step: 1, required: true, value: initial.pax ?? 1 });
  const group = field(t('obs.group'), 'input', { maxlength: 40, value: initial.passenger_group_code ?? '', placeholder: t('obs.groupHint') });
  const flight = field(t('obs.flight'), 'input', { maxlength: 20, value: initial.flight_no ?? '' });
  const counter = field(t('obs.counter'), 'input', { maxlength: 20, value: initial.counter ?? '' });
  const date = field(t('obs.date'), 'input', { type: 'date', required: true, value: (initial.arrival_time ?? session.date).slice(0, 10) });
  const arrival = timeField(t('obs.arrival'), initial.arrival_time?.slice(11), () => { date.input.value = nowLocal().slice(0, 10); });
  const start = timeField(t('obs.start'), initial.service_start?.slice(11));
  const end = timeField(t('obs.end'), initial.service_end?.slice(11));
  const feedback = h('div', { 'aria-live': 'polite' });
  const submit = h('button', { type: 'submit' }, t('common.save'));

  const form = h('form', { class: 'card stack', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    submit.disabled = true;
    const [arrivalTime, serviceStart, serviceEnd] = composeTimes(date.input.value, arrival.input.value, start.input.value, end.input.value);
    const body = {
      pax: pax.input.value === '' ? null : Number(pax.input.value),
      flight_no: flight.input.value.trim() || null,
      counter: counter.input.value.trim() || null,
      arrival_time: arrivalTime,
      service_start: serviceStart,
      service_end: serviceEnd,
    };
    if (group.input.value.trim()) body.passenger_group_code = group.input.value.trim();
    try {
      if (isEdit) await api.patch(`/observations/${initial.id}`, body);
      else await api.post(`/sessions/${session.id}/observations`, body);
      toast(t('obs.saved'));
      if (!isEdit) {
        // Keep date/pax/flight/counter for the next group; clear the times.
        group.input.value = '';
        for (const f of [arrival, start, end]) f.input.value = '';
        message(feedback);
        arrival.input.focus();
      }
      await onDone();
    } catch (err) {
      message(feedback, 'error', errorText(err), err.details);
    } finally {
      submit.disabled = false;
    }
  } },
  cardHeader({ title: isEdit ? `${t('obs.edit')} ${initial.passenger_group_code}` : t('obs.add'), subtitle: t('obs.formHint'), icon: isEdit ? 'clock' : 'plus', tone: 'teal' }),
  h('div', { class: 'form-grid' }, pax.wrapper, group.wrapper, flight.wrapper, counter.wrapper),
  h('div', { class: 'form-grid' }, date.wrapper, arrival.wrapper, start.wrapper, end.wrapper),
  h('p', { class: 'muted' }, t('obs.midnightHint')),
  feedback, h('div', { class: 'actions' }, submit));
  return form;
}

function sessionEditForm(session, checkpoints, onSaved, onCancel) {
  const name = field(t('sessions.name'), 'input', { required: true, maxlength: 120, value: session.name });
  const date = field(t('sessions.date'), 'input', { type: 'date', required: true, value: session.date });
  const checkpoint = field(t('sessions.checkpoint'), 'select', {}, checkpoints
    .filter((c) => c.active || c.id === session.checkpoint_id)
    .map((c) => option(c.id, c.name, c.id === session.checkpoint_id)));
  const observer = field(t('sessions.observer'), 'input', { maxlength: 120, value: session.observer ?? '' });
  const notes = field(t('sessions.notes'), 'textarea', { rows: 3, maxlength: 2000 });
  notes.input.value = session.notes ?? '';
  const feedback = h('div', { 'aria-live': 'polite' });

  return h('form', { class: 'card stack', novalidate: true, onsubmit: async (event) => {
    event.preventDefault();
    try {
      await api.patch(`/sessions/${session.id}`, {
        name: name.input.value, date: date.input.value, checkpoint_id: Number(checkpoint.input.value),
        observer: observer.input.value.trim() || null, notes: notes.input.value.trim() || null,
      });
      toast(t('common.saved'));
      await onSaved();
    } catch (err) {
      message(feedback, 'error', errorText(err), err.details);
    }
  } }, cardHeader({ title: t('sessions.edit'), icon: 'sessions', tone: 'teal' }), h('div', { class: 'form-grid' }, name.wrapper, date.wrapper, checkpoint.wrapper, observer.wrapper),
  notes.wrapper, feedback,
  h('div', { class: 'actions' }, h('button', { type: 'submit' }, t('common.save')), h('button', { type: 'button', class: 'secondary', onclick: onCancel }, t('common.cancel'))));
}

export async function sessionDetailView(main, { id }) {
  const feedback = h('div', { 'aria-live': 'polite' });
  const summaryHolder = h('div');
  const editorHolder = h('div');
  const obsHolder = h('div', { class: 'stack' }, loading(t('app.loading')));
  let session;
  let currentPage = 1;
  const { items: checkpoints } = await api.get('/checkpoints');

  async function loadSession() {
    ({ session } = await api.get(`/sessions/${encodeURIComponent(id)}`));
    const editable = canEdit(session);
    clear(summaryHolder);
    const breached = Boolean(session.sla_breached);
    const tile = (label, value, tone, breach = false) => h('div', { class: `kpi ${tone ? `tone-${tone}` : ''}${breach ? ' breach' : ''}` },
      h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value,
        breach ? h('span', { class: 'visually-hidden' }, ` (${t('sessions.breach')})`) : null));
    summaryHolder.append(h('div', { class: 'stack' },
      pageHeader(session.name, {
        back: { href: '#/sessions', label: t('sessions.back') },
        actions: editable
          ? [h('button', { type: 'button', class: 'secondary', onclick: openEditor }, t('sessions.edit')),
            getUser().role === 'admin' && h('button', { type: 'button', class: 'danger', onclick: removeSession }, t('sessions.delete'))]
          : null,
      }),
      h('div', { class: 'meta-chips' },
        h('span', { class: 'badge accent' }, icon('checkpoints'), session.checkpoint_name),
        h('span', { class: 'badge' }, session.date),
        h('span', { class: 'badge' }, session.shift ? t(`shift.${session.shift}`) : t('shift.none')),
        session.import_batch_id ? h('span', { class: 'badge' }, t('sessions.imported')) : null,
        slaBadge(session)),
      h('div', { class: 'kpi-grid' },
        tile(t('sessions.avgWait'), `${formatMinutes(session.avg_wait_minutes)} min`, null, breached),
        tile(t('sessions.pax'), String(session.pax_total), 'violet'),
        tile(t('sessions.groups'), String(session.group_count), 'teal'),
        tile(t('sessions.slaTarget'), `${session.sla_wait_minutes} min`, 'muted')),
      session.breach_pax > 0 ? h('p', { class: 'message error' }, t('sessions.breachDetail', { pax: session.breach_pax, groups: session.breach_groups, sla: session.sla_wait_minutes })) : null,
      h('div', { class: 'card' },
        h('dl', { class: 'facts' },
          h('dt', {}, t('sessions.observer')), h('dd', {}, session.observer ?? '—'),
          h('dt', {}, t('sessions.createdBy')), h('dd', {}, session.created_by_name),
          session.notes ? [h('dt', {}, t('sessions.notes')), h('dd', {}, session.notes)] : null),
        editable ? null : h('p', { class: 'muted' }, t('sessions.readOnly')))));
    return editable;
  }

  function openEditor() {
    clear(editorHolder);
    editorHolder.append(sessionEditForm(session, checkpoints, async () => { clear(editorHolder); await refresh(); }, () => clear(editorHolder)));
  }

  async function removeSession() {
    if (!window.confirm(t('sessions.confirmDelete', { name: session.name, count: session.group_count }))) return;
    try {
      await api.delete(`/sessions/${session.id}`);
      toast(t('sessions.deleted'));
      navigate('/sessions');
    } catch (err) {
      message(feedback, 'error', errorText(err));
    }
  }

  async function loadObservations(page = currentPage, editable = canEdit(session)) {
    currentPage = page;
    const result = await api.get(`/sessions/${session.id}/observations${query({ page })}`);
    clear(obsHolder);
    obsHolder.append(cardHeader({ title: t('obs.title'), subtitle: result.total > 0 ? t('obs.count', { count: result.total }) : null, icon: 'sessions' }));
    if (result.total === 0) {
      obsHolder.append(emptyState(t('obs.none'), editable ? t('obs.noneHint') : null, null, 'clock'));
      return;
    }
    const headers = [t('obs.group'), 'Pax', t('obs.flight'), t('obs.counter'), t('obs.arrival'), t('obs.start'), t('obs.end'),
      t('obs.wait'), t('obs.processing'), t('obs.total'), editable && t('common.actions')].filter(Boolean);
    obsHolder.append(h('div', { class: 'table-wrap' }, h('table', { class: 'compact' },
      h('thead', {}, h('tr', {}, headers.map((label) => h('th', { scope: 'col' }, label)))),
      h('tbody', {}, result.items.map((o) => h('tr', {},
        h('td', {}, o.passenger_group_code),
        h('td', { class: 'num' }, String(o.pax)),
        h('td', {}, o.flight_no ?? ''),
        h('td', {}, o.counter ?? ''),
        h('td', { class: 'nowrap' }, formatLocal(o.arrival_time)),
        h('td', { class: 'nowrap' }, formatLocal(o.service_start)),
        h('td', { class: 'nowrap' }, formatLocal(o.service_end)),
        h('td', { class: 'num' }, formatMinutes(o.wait_minutes), o.wait_minutes > session.sla_wait_minutes ? [' ', h('span', { class: 'badge breach', title: t('sessions.breach') }, '⚠')] : null),
        h('td', { class: 'num' }, formatMinutes(o.processing_minutes)),
        h('td', { class: 'num' }, formatMinutes(o.total_minutes)),
        editable && h('td', {}, h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'secondary', onclick: () => editObservation(o) }, t('checkpoints.edit')),
          h('button', { type: 'button', class: 'danger', onclick: () => deleteObservation(o) }, t('obs.delete'))))))))),
    pager(result, (p) => loadObservations(p)));
  }

  function editObservation(o) {
    clear(editorHolder);
    editorHolder.append(observationForm(session, o, async () => { clear(editorHolder); await refresh(); }));
    editorHolder.scrollIntoView({ block: 'start' });
  }

  async function deleteObservation(o) {
    if (!window.confirm(t('obs.confirmDelete', { code: o.passenger_group_code }))) return;
    try {
      await api.delete(`/observations/${o.id}`);
      await refresh();
    } catch (err) {
      message(feedback, 'error', errorText(err));
    }
  }

  const addHolder = h('div');
  async function refresh() {
    const editable = await loadSession();
    await loadObservations(currentPage, editable);
  }

  try {
    const editable = await loadSession();
    if (editable) addHolder.append(observationForm(session, {}, refresh));
    await loadObservations(1, editable);
  } catch (err) {
    message(feedback, 'error', errorText(err));
    if (!session) {
      feedback.prepend(h('a', { class: 'back-link', href: '#/sessions' }, icon('back'), t('sessions.back')));
      clear(obsHolder);
    }
  }

  main.append(h('section', { class: 'stack' },
    feedback, summaryHolder, editorHolder, addHolder, h('section', { class: 'stack' }, obsHolder)));
}
