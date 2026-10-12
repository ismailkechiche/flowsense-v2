'use strict';

const { ensureSpace, contentWidth, GREY, FONT } = require('./layout');

/**
 * Bar and line charts drawn with PDFKit vector primitives (no browser).
 * Black and white only: bar series differ by fill pattern, line series by
 * dash style and marker shape.
 */
const CHART_HEIGHT = 190;
const AXIS_WIDTH = 42;
const LEGEND_ROW = 14;
const MAX_SERIES = 6;

// Bar fills: solid dark, solid light, diagonal hatch, cross-hatch, dots, outline.
const BAR_STYLES = ['solid-dark', 'solid-light', 'hatch', 'crosshatch', 'dots', 'outline'];
const LINE_DASHES = [null, [5, 3], [1.5, 2.5], [8, 3, 2, 3], [3, 3], [10, 4]];
const MARKERS = ['circle', 'square', 'triangle', 'diamond', 'cross', 'none'];

function niceMax(value) {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) if (value <= step * magnitude) return step * magnitude;
  return 10 * magnitude;
}

function fillPattern(doc, style, x, y, w, h) {
  if (w <= 0 || h <= 0) return;
  doc.save();
  if (style === 'solid-dark') doc.rect(x, y, w, h).fill(GREY.dark);
  else if (style === 'solid-light') doc.rect(x, y, w, h).fillAndStroke(GREY.light, GREY.dark);
  else {
    doc.rect(x, y, w, h).clip();
    doc.lineWidth(0.6).strokeColor('black').fillColor('black');
    if (style === 'hatch' || style === 'crosshatch') {
      for (let d = -h; d < w; d += 4) doc.moveTo(x + d, y + h).lineTo(x + d + h, y).stroke();
      if (style === 'crosshatch') for (let d = -h; d < w; d += 4) doc.moveTo(x + d, y).lineTo(x + d + h, y + h).stroke();
    } else if (style === 'dots') {
      for (let yy = y + 2; yy < y + h; yy += 4) for (let xx = x + 2; xx < x + w; xx += 4) doc.circle(xx, yy, 0.7).fill();
    }
    doc.restore().save();
    doc.rect(x, y, w, h).lineWidth(0.6).strokeColor('black').stroke();
  }
  doc.restore();
}

function marker(doc, shape, x, y) {
  const r = 2.4;
  doc.save().lineWidth(0.8).strokeColor('black').fillColor('black');
  if (shape === 'circle') doc.circle(x, y, r).fill();
  else if (shape === 'square') doc.rect(x - r, y - r, 2 * r, 2 * r).fill();
  else if (shape === 'triangle') doc.polygon([x, y - r], [x + r, y + r], [x - r, y + r]).fill();
  else if (shape === 'diamond') doc.polygon([x, y - r], [x + r, y], [x, y + r], [x - r, y]).fill();
  else if (shape === 'cross') doc.moveTo(x - r, y - r).lineTo(x + r, y + r).moveTo(x - r, y + r).lineTo(x + r, y - r).stroke();
  doc.restore();
}

/**
 * Draws a chart and moves the cursor below it.
 * `categories`: x labels; `series`: [{ label, values: (number|null)[] }].
 */
function drawChart(doc, { type, categories, series, yLabel }) {
  const shown = series.slice(0, MAX_SERIES);
  const legendHeight = Math.ceil(shown.length / 3) * LEGEND_ROW;
  const total = CHART_HEIGHT + legendHeight + 34;
  ensureSpace(doc, total);

  const left = doc.page.margins.left + AXIS_WIDTH;
  const width = contentWidth(doc) - AXIS_WIDTH;
  const top = doc.y + 6;
  const bottom = top + CHART_HEIGHT;
  const values = shown.flatMap((s) => s.values).filter((v) => v !== null && Number.isFinite(v));
  const yMax = niceMax(Math.max(0, ...values));
  const yOf = (v) => bottom - (v / yMax) * CHART_HEIGHT;

  // Axes and grid.
  doc.font(FONT.regular).fontSize(7).fillColor('black');
  for (let i = 0; i <= 4; i += 1) {
    const v = (yMax * i) / 4;
    const y = yOf(v);
    doc.save().moveTo(left, y).lineTo(left + width, y).lineWidth(0.3).strokeColor(GREY.light).stroke().restore();
    doc.text(Number.isInteger(v) ? String(v) : v.toFixed(1), left - AXIS_WIDTH, y - 3, { width: AXIS_WIDTH - 4, align: 'right', lineBreak: false });
  }
  doc.save().moveTo(left, top).lineTo(left, bottom).lineTo(left + width, bottom).lineWidth(0.8).strokeColor('black').stroke().restore();
  if (yLabel) {
    doc.save().rotate(-90, { origin: [left - AXIS_WIDTH + 2, bottom] });
    doc.text(yLabel, left - AXIS_WIDTH + 2, bottom, { width: CHART_HEIGHT, align: 'center', lineBreak: false });
    doc.restore();
  }

  // X labels: thin them out when there are many categories.
  const slot = width / Math.max(1, categories.length);
  const every = Math.max(1, Math.ceil(categories.length / Math.floor(width / 34)));
  categories.forEach((label, i) => {
    if (i % every !== 0) return;
    doc.text(String(label), left + i * slot, bottom + 3, { width: slot * every, align: every === 1 ? 'center' : 'left', lineBreak: false, ellipsis: true });
  });

  if (type === 'bar') {
    const groupWidth = slot * 0.8;
    const barWidth = groupWidth / Math.max(1, shown.length);
    shown.forEach((s, si) => s.values.forEach((v, ci) => {
      if (v === null || !Number.isFinite(v)) return;
      const x = left + ci * slot + slot * 0.1 + si * barWidth;
      fillPattern(doc, BAR_STYLES[si], x, yOf(v), Math.max(0.5, barWidth - 1), bottom - yOf(v));
    }));
  } else {
    shown.forEach((s, si) => {
      const points = s.values.map((v, ci) => (v === null || !Number.isFinite(v) ? null : [left + ci * slot + slot / 2, yOf(v)]));
      doc.save().lineWidth(1.2).strokeColor('black');
      if (LINE_DASHES[si]) doc.dash(LINE_DASHES[si][0], { space: LINE_DASHES[si][1] });
      let drawing = false;
      for (const p of points) {
        if (!p) { drawing = false; continue; }
        if (drawing) doc.lineTo(p[0], p[1]); else doc.moveTo(p[0], p[1]);
        drawing = true;
      }
      doc.stroke().undash().restore();
      for (const p of points) if (p) marker(doc, MARKERS[si], p[0], p[1]);
    });
  }

  // Legend.
  let ly = bottom + 18;
  shown.forEach((s, si) => {
    const col = si % 3;
    if (si > 0 && col === 0) ly += LEGEND_ROW;
    const lx = doc.page.margins.left + col * (contentWidth(doc) / 3);
    if (type === 'bar') fillPattern(doc, BAR_STYLES[si], lx, ly, 14, 9);
    else {
      doc.save().lineWidth(1.2).strokeColor('black');
      if (LINE_DASHES[si]) doc.dash(LINE_DASHES[si][0], { space: LINE_DASHES[si][1] });
      doc.moveTo(lx, ly + 4.5).lineTo(lx + 14, ly + 4.5).stroke().undash().restore();
      marker(doc, MARKERS[si], lx + 7, ly + 4.5);
    }
    doc.font(FONT.regular).fontSize(7.5).fillColor('black')
      .text(s.label, lx + 18, ly + 1, { width: contentWidth(doc) / 3 - 22, lineBreak: false, ellipsis: true });
  });
  doc.x = doc.page.margins.left;
  doc.y = ly + LEGEND_ROW + 4;
  if (series.length > MAX_SERIES) {
    doc.font(FONT.italic).fontSize(8).text(`Chart shows the first ${MAX_SERIES} of ${series.length} series; the table lists all.`);
  }
  doc.moveDown(0.4);
}

module.exports = { drawChart, MAX_SERIES };
