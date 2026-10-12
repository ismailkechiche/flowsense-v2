// Chart.js wrappers for the dashboard. Chart.js is vendored in
// frontend/vendor (CSP script-src 'self') and loaded as a classic script,
// so it is available as the global `Chart`.
import { t } from '../i18n.js';

const live = new Set();

/**
 * Colours come from the CSS tokens (css/base.css) so charts follow the
 * light/dark theme. Datasets carry a `tone` ('primary', 'secondary' or a
 * series index) and are recoloured by restyleCharts() when the theme flips.
 */
function palette() {
  const style = getComputedStyle(document.documentElement);
  const css = (name) => style.getPropertyValue(name).trim();
  return {
    primary: css('--chart-1'), secondary: css('--chart-2'), sla: css('--chart-sla'), grid: css('--chart-grid'), text: css('--chart-text'),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => css(`--series-${i}`)),
  };
}

function toneColor(tone, p) {
  return typeof tone === 'number' ? p.series[tone % p.series.length] : p[tone];
}

function paint(chart, p = palette()) {
  for (const dataset of chart.data.datasets) {
    if (dataset.tone === undefined) continue;
    const color = toneColor(dataset.tone, p);
    dataset.borderColor = color;
    dataset.backgroundColor = color;
  }
  for (const scale of Object.values(chart.options.scales ?? {})) {
    scale.grid = { ...scale.grid, color: p.grid };
    scale.border = { ...scale.border, color: p.grid };
    scale.ticks = { ...scale.ticks, color: p.text };
    if (scale.title) scale.title = { ...scale.title, color: p.text };
  }
  const legend = chart.options.plugins?.legend;
  if (legend) legend.labels = { ...legend.labels, color: p.text };
}

/** Re-applies theme colours to every live chart. */
export function restyleCharts() {
  if (typeof window.Chart !== 'function') return;
  const p = palette();
  window.Chart.defaults.color = p.text;
  window.Chart.defaults.borderColor = p.grid;
  for (const chart of live) {
    paint(chart, p);
    chart.update('none');
  }
}

/** Destroys every chart created so far (call before re-rendering). */
export function destroyCharts() {
  for (const chart of live) chart.destroy();
  live.clear();
}

function mount(canvas, config) {
  if (typeof window.Chart !== 'function') return null;
  const p = palette();
  window.Chart.defaults.color = p.text;
  window.Chart.defaults.borderColor = p.grid;
  window.Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font').trim() || 'system-ui, sans-serif';
  const chart = new window.Chart(canvas, {
    ...config,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      ...config.options,
      plugins: {
        legend: { labels: { usePointStyle: true, boxHeight: 8, padding: 16 } },
        tooltip: { padding: 10, cornerRadius: 8, boxPadding: 4 },
        ...config.options?.plugins,
      },
    },
  });
  paint(chart, p);
  chart.update('none');
  live.add(chart);
  return chart;
}

/** A canvas in a fixed-height box, with a text alternative for screen readers. */
export function chartBox(label) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);
  const box = document.createElement('div');
  box.className = 'chart-box';
  box.append(canvas);
  return { box, canvas };
}

/**
 * Draws a dashed vertical line for each SLA threshold on a category axis
 * whose categories are consecutive bins of `binMinutes`. A bin edge k sits
 * halfway between categories k−1 and k.
 */
function slaLinePlugin(thresholds, binMinutes) {
  return {
    id: 'slaLines',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      ctx.save();
      const { sla } = palette();
      ctx.strokeStyle = sla;
      ctx.fillStyle = sla;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.font = '12px system-ui, sans-serif';
      thresholds.forEach((minutes, i) => {
        const x = scales.x.getPixelForValue(minutes / binMinutes - 0.5);
        if (!Number.isFinite(x)) return;
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        // Stagger labels so several thresholds don't print over each other.
        ctx.fillText(t('dash.slaLine', { minutes }), x + 4, chartArea.top + 12 + i * 14);
      });
      ctx.restore();
    },
  };
}

export function histogramChart(canvas, distribution) {
  const labels = distribution.bins.map((b) => (b.to_minutes === null ? `${b.from_minutes}+` : `${b.from_minutes}–${b.to_minutes}`));
  return mount(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ label: t('dash.passengers'), data: distribution.bins.map((b) => b.pax), tone: 'primary', borderRadius: 3, barPercentage: 1, categoryPercentage: 0.95 }] },
    options: {
      scales: {
        x: { title: { display: true, text: t('dash.waitMinutes') }, grid: { display: false } },
        y: { beginAtZero: true, title: { display: true, text: t('dash.passengers') }, ticks: { precision: 0 } },
      },
      plugins: { legend: { display: false } },
    },
    plugins: [slaLinePlugin(distribution.sla_thresholds, distribution.bin_minutes)],
  });
}

export function hourlyChart(canvas, items) {
  return mount(canvas, {
    data: {
      labels: items.map((h) => `${String(h.hour).padStart(2, '0')}:00`),
      datasets: [
        { type: 'bar', label: t('dash.passengers'), data: items.map((h) => h.pax_total), tone: 'primary', borderRadius: 4, yAxisID: 'pax', order: 2 },
        { type: 'line', label: t('dash.avgWait'), data: items.map((h) => h.avg_wait_minutes), tone: 'secondary', tension: 0.3, pointRadius: 3, borderWidth: 2.5, yAxisID: 'wait', order: 1 },
      ],
    },
    options: {
      scales: {
        pax: { position: 'left', beginAtZero: true, title: { display: true, text: t('dash.passengers') }, ticks: { precision: 0 } },
        wait: { position: 'right', beginAtZero: true, title: { display: true, text: t('dash.minutes') }, grid: { drawOnChartArea: false } },
      },
    },
  });
}

export function trendChart(canvas, items) {
  return mount(canvas, {
    type: 'line',
    data: {
      labels: items.map((d) => d.date),
      datasets: [
        { label: t('dash.avgWait'), data: items.map((d) => d.avg_wait_minutes), tone: 'primary', tension: 0.3, pointRadius: 3, borderWidth: 2.5, yAxisID: 'wait' },
        { label: t('dash.slaCompliance'), data: items.map((d) => d.sla_compliance_pct), tone: 'secondary', tension: 0.3, pointRadius: 3, borderWidth: 2, borderDash: [6, 4], yAxisID: 'pct' },
      ],
    },
    options: {
      scales: {
        wait: { position: 'left', beginAtZero: true, title: { display: true, text: t('dash.minutes') } },
        pct: { position: 'right', min: 0, max: 100, title: { display: true, text: '%' }, grid: { drawOnChartArea: false } },
      },
    },
  });
}

/**
 * Pivot chart. `labels` are the row values; `series` = [{ label, values }].
 * Bar or line, one colour per series.
 */
export function pivotChart(canvas, type, labels, series) {
  return mount(canvas, {
    type,
    data: {
      labels,
      datasets: series.map((s, i) => ({
        label: s.label, data: s.values, tone: i, spanGaps: false,
        ...(type === 'bar' ? { borderRadius: 4 } : { tension: 0.3, pointRadius: 3, borderWidth: 2.5 }),
      })),
    },
    options: { scales: { y: { beginAtZero: true } } },
  });
}
