'use strict';

const { ensureSpace, contentWidth, bottomLimit, GREY, FONT } = require('./layout');

const PAD = 4;
const SIZE = 8.5;

/** A cell is a string or `{ text, bold }`. */
const cellText = (cell) => (cell !== null && typeof cell === 'object' ? String(cell.text) : String(cell ?? ''));
const cellBold = (cell) => cell !== null && typeof cell === 'object' && Boolean(cell.bold);

/**
 * Draws a table that flows across pages, repeating the header row at the
 * top of each new page. `columns` = [{ label, weight?, align? }]; widths are
 * shared out by weight across the content width.
 */
function drawTable(doc, { columns, rows }) {
  const x0 = doc.page.margins.left;
  const total = contentWidth(doc);
  const weights = columns.map((c) => c.weight ?? 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / sum) * total);

  const rowHeight = (cells, bold) => Math.max(...cells.map((cell, i) => {
    doc.font(bold || cellBold(cell) ? FONT.bold : FONT.regular).fontSize(SIZE);
    return doc.heightOfString(cellText(cell), { width: widths[i] - 2 * PAD });
  })) + 2 * PAD;

  const drawRow = (cells, { header = false, shade = false } = {}) => {
    const height = rowHeight(cells, header);
    const y = doc.y;
    if (header || shade) doc.save().rect(x0, y, total, height).fill(header ? GREY.light : GREY.faint).restore();
    let x = x0;
    cells.forEach((cell, i) => {
      doc.font(header || cellBold(cell) ? FONT.bold : FONT.regular).fontSize(SIZE).fillColor('black')
        .text(cellText(cell), x + PAD, y + PAD, { width: widths[i] - 2 * PAD, align: header ? 'left' : (columns[i].align ?? 'left') });
      x += widths[i];
    });
    doc.save().moveTo(x0, y + height).lineTo(x0 + total, y + height).lineWidth(0.4).strokeColor(GREY.mid).stroke().restore();
    doc.x = x0;
    doc.y = y + height;
  };

  const header = columns.map((c) => c.label);
  ensureSpace(doc, rowHeight(header, true) + (rows[0] ? rowHeight(rows[0], false) : 0));
  drawRow(header, { header: true });
  rows.forEach((cells, index) => {
    if (doc.y + rowHeight(cells, false) > bottomLimit(doc)) {
      doc.addPage();
      drawRow(header, { header: true });
    }
    drawRow(cells, { shade: index % 2 === 1 });
  });
  doc.moveDown(0.6);
}

module.exports = { drawTable };
