// Chart.js wrappers for the dashboard. Chart.js is vendored in
// frontend/vendor (CSP script-src 'self') and loaded as a classic script,
// so it is available as the global `Chart`.
import { t } from '../i18n.js';

const COLORS = { primary: '#1d5fa8', secondary: '#c56a00', sla: '#b3261e', grid: '#e3e7ec' };
const live = new Set();

/** Destroys every chart created so far (call before re-rendering). */
export function destroyCharts() {
  for (const chart of live) chart.destroy();
  live.clear();
}

function mount(canvas, config) {
  if (typeof window.Chart !== 'function') return null;
  const chart = new window.Chart(canvas, {
    ...config,
    options: { responsive: true, maintainAspectRatio: false, animation: false, ...config.options },
  });
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
      ctx.strokeStyle = COLORS.sla;
      ctx.fillStyle = COLORS.sla;
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
    data: { labels, datasets: [{ label: t('dash.passengers'), data: distribution.bins.map((b) => b.pax), backgroundColor: COLORS.primary, barPercentage: 1, categoryPercentage: 0.95 }] },
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
        { type: 'bar', label: t('dash.passengers'), data: items.map((h) => h.pax_total), backgroundColor: COLORS.primary, yAxisID: 'pax' },
        { type: 'line', label: t('dash.avgWait'), data: items.map((h) => h.avg_wait_minutes), borderColor: COLORS.secondary, backgroundColor: COLORS.secondary, yAxisID: 'wait' },
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
        { label: t('dash.avgWait'), data: items.map((d) => d.avg_wait_minutes), borderColor: COLORS.primary, backgroundColor: COLORS.primary, yAxisID: 'wait' },
        { label: t('dash.slaCompliance'), data: items.map((d) => d.sla_compliance_pct), borderColor: COLORS.secondary, backgroundColor: COLORS.secondary, borderDash: [6, 4], yAxisID: 'pct' },
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

const SERIES_COLORS = ['#1d5fa8', '#c56a00', '#2e7d32', '#6a1b9a', '#00838f', '#ad1457', '#5d4037', '#455a64'];

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
        label: s.label, data: s.values, backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length],
        borderColor: SERIES_COLORS[i % SERIES_COLORS.length], spanGaps: false,
      })),
    },
    options: { scales: { y: { beginAtZero: true } } },
  });
}
