import { h, field, option, message, clear } from '../dom.js';
import { t } from '../i18n.js';
import { api, query } from '../api.js';
import { errorText, pageHeader, card, term } from './common.js';
import { fmt, fmtPct } from './analyticsFilters.js';
import { barChart, chartBox, destroyCharts } from '../charts/charts.js';

const CURVE_EXTRA = 3;   // counters shown beyond what is needed
const CURVE_MAX = 15;    // never more bars than this

/** A labelled number field whose label explains the term on hover/focus. */
function numberField(label, hint, attrs) {
  const { wrapper, input } = field('', 'input', { type: 'number', step: 'any', required: true, ...attrs });
  wrapper.querySelector('label').replaceChildren(term(label, hint));
  return { wrapper, input };
}

/**
 * The counter counts to compare on the "wait by number of counters" chart:
 * from the smallest stable count (more than λ/μ) to a few past what is
 * needed or what is open, whichever is larger.
 */
export function curveCounts(lambda, mu, current, needed) {
  const stable = Math.floor(lambda / mu) + 1;
  const start = Math.max(1, Math.min(current, stable) - 1);
  const end = Math.min(Math.max(start + 3, current, needed ?? current) + CURVE_EXTRA, start + CURVE_MAX - 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/**
 * M/M/c simulator (spec §8.3): start from a checkpoint's observed rates,
 * change them, and see the effect. Inputs are per hour, which is how people
 * talk about passengers and counters; the server's queueing engine works per
 * minute and computes every result, the page only converts units.
 */
export async function simulatorView(main) {
  const { items: checkpoints } = await api.get('/checkpoints');
  const feedback = h('div', { 'aria-live': 'polite' });
  const observed = h('p', { class: 'muted' });
  const results = h('div', { class: 'stack', 'aria-live': 'polite' });
  const curveHolder = h('div', { class: 'stack' });

  const checkpoint = field(t('sessions.checkpoint'), 'select', { required: true },
    checkpoints.map((c, i) => option(c.id, c.name, i === 0)));
  const from = field(t('sessions.from'), 'input', { type: 'date' });
  const to = field(t('sessions.to'), 'input', { type: 'date' });

  const arrivals = numberField(t('sim.arrivalsHour'), t('hint.lambda'), { min: 0 });
  const service = numberField(t('sim.serviceHour'), t('hint.mu'), { min: 0 });
  const c = numberField(t('sim.counters'), t('hint.c'), { min: 1, max: 100, step: 1 });
  const sla = numberField(t('sim.sla'), t('hint.slaTarget'), { min: 0 });
  const fields = [arrivals, service, c, sla];

  /** Per-minute rates for the API from the per-hour inputs. */
  const perMinute = (input) => String(Number(input.value) / 60);

  async function loadDefaults() {
    message(feedback);
    try {
      const d = await api.get(`/simulator/defaults${query({ checkpoint_id: checkpoint.input.value, from: from.input.value, to: to.input.value })}`);
      sla.input.value = d.sla_wait_minutes;
      c.input.value = d.c;
      arrivals.input.value = d.lambda === null ? '' : (d.lambda * 60).toFixed(1);
      service.input.value = d.mu === null ? '' : (d.mu * 60).toFixed(1);
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
    timer = setTimeout(run, 300);
  }

  const simulate = (counters) => api.get(`/simulator/run${query({
    lambda: perMinute(arrivals.input), mu: perMinute(service.input), c: counters, sla_minutes: sla.input.value,
  })}`);

  async function run() {
    if (fields.some((f) => f.input.value === '' || !f.input.checkValidity())) {
      destroyCharts();
      clear(curveHolder);
      clear(results).append(h('p', { class: 'muted' }, t('sim.fillIn')));
      return;
    }
    const mine = ++sequence;
    try {
      const r = await simulate(c.input.value);
      if (mine !== sequence) return; // a newer run already answered
      renderResult(r);
      await renderCurve(r, mine);
    } catch (err) {
      if (mine === sequence) clear(results).append(h('p', { class: 'message error' }, errorText(err)));
    }
  }

  function tile(label, value, { tone, hint, breach = false, sub } = {}) {
    return h('div', { class: `kpi${tone ? ` tone-${tone}` : ''}${breach ? ' breach' : ''}` },
      h('div', { class: 'kpi-label' }, hint ? term(label, hint) : label), h('div', { class: 'kpi-value' }, value),
      sub ? h('div', { class: 'kpi-sub' }, sub) : null);
  }

  function renderResult(r) {
    clear(results);
    const needed = r.recommended_exceeds_max ? t('dash.moreThan', { max: r.max_servers }) : String(r.recommended_servers);
    const late = r.overloaded || r.wq > r.sla_minutes;
    const verdict = r.overloaded
      ? t('sim.verdictOverloaded')
      : t(late ? 'sim.verdictLate' : 'sim.verdictOk', { wait: fmt(r.wq, 1), sla: r.sla_minutes });
    results.append(
      h('div', { class: `verdict ${late ? 'bad' : 'good'}`, role: late ? 'alert' : 'status' },
        h('strong', {}, verdict), h('span', {}, t('sim.needed', { minutes: r.sla_minutes, servers: needed }))),
      h('div', { class: 'kpi-grid headline' },
        tile(t('sim.wq'), r.overloaded ? '∞' : `${fmt(r.wq, 1)} min`, { breach: late, hint: t('hint.wq') }),
        tile(t('sim.rho'), fmtPct(r.rho * 100), { tone: 'violet', hint: t('hint.rho'), breach: r.overloaded }),
        tile(t('sim.pWait'), r.overloaded ? '—' : fmtPct(r.p_wait * 100), { tone: 'teal', hint: t('hint.pWait') }),
        tile(t('sim.lq'), r.overloaded ? '∞' : fmt(r.lq, 1), { tone: 'amber', hint: t('hint.lq') })),
      h('details', { class: 'numbers' }, h('summary', {}, t('sim.more')),
        h('div', { class: 'kpi-grid' },
          tile(t('sim.w'), r.overloaded ? '∞' : `${fmt(r.w, 2)} min`, { tone: 'muted', hint: t('hint.w') }),
          tile(t('sim.l'), r.overloaded ? '∞' : fmt(r.l, 2), { tone: 'muted', hint: t('hint.l') }),
          tile(t('sim.wqExact'), r.overloaded ? '∞' : `${fmt(r.wq, 2)} min`, { tone: 'muted' })),
        h('p', { class: 'muted' }, t('sim.help'))));
  }

  /** "Predicted wait by number of counters", one server run per bar. */
  async function renderCurve(current, mine) {
    const counts = curveCounts(Number(arrivals.input.value), Number(service.input.value), Number(c.input.value), current.recommended_servers);
    const runs = await Promise.all(counts.map((n) => simulate(n).catch(() => null)));
    if (mine !== sequence) return;
    destroyCharts();
    const { box, canvas } = chartBox(t('sim.curveTitle'));
    clear(curveHolder).append(box);
    const slaValue = Number(sla.input.value);
    barChart(canvas, {
      labels: counts.map((n) => (n === Number(c.input.value) ? `${n} ★` : String(n))),
      valueTitle: t('sim.curveAxis'), legend: false,
      reference: { value: slaValue, label: t('dash.slaLine', { minutes: slaValue }) },
      datasets: [{
        label: t('sim.wq'),
        data: runs.map((r) => (!r || r.overloaded ? null : Math.round(r.wq * 100) / 100)),
        tones: runs.map((r) => (!r || r.overloaded || r.wq > slaValue ? 'danger' : 'ok')),
      }],
    });
    const overloadedCounts = counts.filter((n, i) => runs[i]?.overloaded);
    if (overloadedCounts.length) curveHolder.append(h('p', { class: 'muted' }, t('sim.curveOverloaded', { list: overloadedCounts.join(', ') })));
  }

  for (const f of fields) f.input.addEventListener('input', scheduleRun);
  checkpoint.input.addEventListener('change', loadDefaults);

  main.append(h('section', { class: 'stack' },
    pageHeader(t('sim.title'), { subtitle: t('sim.subtitle') }),
    h('div', { class: 'grid-2 sim-grid' },
      h('div', { class: 'stack' },
        card({ title: t('sim.step1'), subtitle: t('sim.step1Help'), icon: 'checkpoints', tone: 'teal', tag: 'form', className: 'sim-load' },
          h('div', { class: 'form-grid' }, checkpoint.wrapper, from.wrapper, to.wrapper),
          h('div', { class: 'row' }, h('button', { type: 'submit', class: 'secondary' }, t('sim.load'))),
          observed),
        card({ title: t('sim.step2'), subtitle: t('sim.step2Help'), icon: 'simulator', tone: 'violet', tag: 'form' },
          h('div', { class: 'form-grid two' }, ...fields.map((f) => f.wrapper)))),
      h('div', { class: 'stack' },
        card({ title: t('sim.results'), icon: 'dashboard' }, results),
        card({ title: t('sim.curveTitle'), subtitle: t('sim.curveHelp'), icon: 'bar', tone: 'amber', className: 'chart-card' }, curveHolder))),
    feedback));
  for (const form of main.querySelectorAll('form')) form.addEventListener('submit', (event) => { event.preventDefault(); if (form.classList.contains('sim-load')) loadDefaults(); else run(); });
  await loadDefaults();
}
