import { h, field, option, message, clear } from '../dom.js';
import { t } from '../i18n.js';
import { api, query } from '../api.js';
import { errorText, pageHeader } from './common.js';
import { fmt, fmtPct } from './analyticsFilters.js';

/**
 * M/M/c simulator (spec §8.3): start from a checkpoint's observed λ, μ and c,
 * change them, and see the effect. Every result comes from the server's
 * queueing engine; the page only collects inputs.
 */
export async function simulatorView(main) {
  const { items: checkpoints } = await api.get('/checkpoints');
  const feedback = h('div', { 'aria-live': 'polite' });
  const observed = h('p', { class: 'muted' });
  const results = h('div', { class: 'stack', 'aria-live': 'polite' });

  const checkpoint = field(t('sessions.checkpoint'), 'select', { required: true },
    checkpoints.map((c, i) => option(c.id, c.name, i === 0)));
  const from = field(t('sessions.from'), 'input', { type: 'date' });
  const to = field(t('sessions.to'), 'input', { type: 'date' });

  const lambda = field(t('sim.lambda'), 'input', { type: 'number', min: 0, step: 'any', required: true });
  const mu = field(t('sim.mu'), 'input', { type: 'number', min: 0, step: 'any', required: true });
  const c = field(t('sim.c'), 'input', { type: 'number', min: 1, max: 100, step: 1, required: true });
  const sla = field(t('sim.sla'), 'input', { type: 'number', min: 0, step: 'any', required: true });
  const lambdaHour = h('span', { class: 'muted' });

  async function loadDefaults() {
    message(feedback);
    try {
      const d = await api.get(`/simulator/defaults${query({ checkpoint_id: checkpoint.input.value, from: from.input.value, to: to.input.value })}`);
      sla.input.value = d.sla_wait_minutes;
      c.input.value = d.c;
      lambda.input.value = d.lambda === null ? '' : d.lambda.toFixed(4);
      mu.input.value = d.mu === null ? '' : d.mu.toFixed(4);
      observed.textContent = d.lambda === null || d.mu === null
        ? t('sim.noObserved', { checkpoint: d.checkpoint_name })
        : t('sim.observed', { checkpoint: d.checkpoint_name, pax: d.pax_total, source: t(`sim.cSource.${d.c_source}`) });
      run();
    } catch (err) {
      message(feedback, 'error', errorText(err));
    }
  }

  let timer;
  let sequence = 0;
  function scheduleRun() {
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  }

  async function run() {
    const l = Number(lambda.input.value);
    lambdaHour.textContent = lambda.input.value === '' ? '' : t('sim.perHour', { value: fmt(l * 60, 1) });
    if ([lambda, mu, c, sla].some((f) => f.input.value === '' || !f.input.checkValidity())) {
      clear(results).append(h('p', { class: 'muted' }, t('sim.fillIn')));
      return;
    }
    const mine = ++sequence;
    try {
      const r = await api.get(`/simulator/run${query({ lambda: lambda.input.value, mu: mu.input.value, c: c.input.value, sla_minutes: sla.input.value })}`);
      if (mine !== sequence) return; // a newer run already answered
      renderResult(r);
    } catch (err) {
      if (mine === sequence) clear(results).append(h('p', { class: 'message error' }, errorText(err)));
    }
  }

  function cell(label, value, tone) {
    return h('div', { class: `kpi${tone ? ` tone-${tone}` : ''}` }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value' }, value));
  }

  function renderResult(r) {
    clear(results);
    const needed = r.recommended_exceeds_max
      ? t('dash.moreThan', { max: r.max_servers })
      : String(r.recommended_servers);
    results.append(h('div', { class: 'stack' },
      r.overloaded
        ? h('p', { class: 'message error', role: 'alert' }, t('dash.overloadedText'))
        : null,
      h('div', { class: 'result-grid' },
        cell(t('sim.rho'), fmt(r.rho, 3), 'violet'),
        cell(t('sim.pWait'), r.overloaded ? '—' : fmtPct(r.p_wait * 100), 'violet'),
        cell(t('sim.wq'), r.overloaded ? '∞' : `${fmt(r.wq, 2)} min`),
        cell(t('sim.lq'), r.overloaded ? '∞' : fmt(r.lq, 2), 'teal'),
        cell(t('sim.w'), r.overloaded ? '∞' : `${fmt(r.w, 2)} min`),
        cell(t('sim.l'), r.overloaded ? '∞' : fmt(r.l, 2), 'teal')),
      h('p', { class: `message ${!r.overloaded && r.wq > r.sla_minutes ? 'error' : 'info'}` }, h('strong', {}, t('sim.needed', { minutes: r.sla_minutes, servers: needed })),
        !r.overloaded && r.wq > r.sla_minutes ? ` ${t('sim.currentBreaches')}` : null)));
  }

  for (const f of [lambda, mu, c, sla]) f.input.addEventListener('input', scheduleRun);

  main.append(h('section', { class: 'stack' },
    pageHeader(t('sim.title'), { subtitle: t('sim.subtitle') }),
    h('form', { class: 'card stack', onsubmit: (event) => { event.preventDefault(); loadDefaults(); } },
      h('div', { class: 'card-header' }, h('h2', {}, t('sim.step1'))),
      h('div', { class: 'row' }, checkpoint.wrapper, from.wrapper, to.wrapper, h('button', { type: 'submit', class: 'secondary' }, t('sim.load'))),
      observed),
    feedback,
    h('form', { class: 'card stack', onsubmit: (event) => { event.preventDefault(); run(); } },
      h('div', { class: 'card-header' }, h('h2', {}, t('sim.step2'))),
      h('div', { class: 'form-grid' }, h('div', { class: 'stack-tight' }, lambda.wrapper, lambdaHour), mu.wrapper, c.wrapper, sla.wrapper),
      h('p', { class: 'muted' }, t('sim.help'))),
    h('section', { class: 'stack' }, h('h2', {}, t('sim.results')), results)));
  await loadDefaults();
}
