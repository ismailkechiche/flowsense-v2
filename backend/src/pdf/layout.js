'use strict';

const PDFDocument = require('pdfkit');

/**
 * Page set-up and text helpers for FLOWSENSE reports. Black and white only
 * (spec §10): text is black, fills are greys, series differ by pattern.
 * Fonts are PDFKit's built-in Helvetica, which covers French accents.
 */
const MARGIN = 50;
const FOOTER_HEIGHT = 30;
const GREY = Object.freeze({ dark: '#333333', mid: '#808080', light: '#d9d9d9', faint: '#f2f2f2' });
const FONT = Object.freeze({ regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' });

function createDocument({ title, author }) {
  return new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN + FOOTER_HEIGHT, left: MARGIN, right: MARGIN },
    bufferPages: true, // page numbers are written once the page count is known
    info: { Title: title, Author: author, Creator: 'FLOWSENSE' },
  });
}

const contentWidth = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const bottomLimit = (doc) => doc.page.height - doc.page.margins.bottom;

/** Starts a new page unless `height` points still fit on this one. */
function ensureSpace(doc, height) {
  if (doc.y + height > bottomLimit(doc)) doc.addPage();
}

function heading(doc, text, level = 1) {
  const size = level === 1 ? 16 : 12;
  ensureSpace(doc, size * 4);
  if (doc.y > doc.page.margins.top) doc.moveDown(level === 1 ? 1 : 0.6);
  doc.font(FONT.bold).fontSize(size).fillColor('black').text(text, doc.page.margins.left, doc.y, { width: contentWidth(doc) });
  doc.moveDown(0.4);
}

function paragraph(doc, text, { font = FONT.regular, size = 10, color = 'black' } = {}) {
  ensureSpace(doc, size * 2);
  doc.font(font).fontSize(size).fillColor(color).text(text, doc.page.margins.left, doc.y, { width: contentWidth(doc) });
  doc.moveDown(0.4);
}

/** Writes "FLOWSENSE · page i of n" at the foot of every buffered page. */
function addPageNumbers(doc, label) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // writing in the margin must not add a page
    const y = doc.page.height - MARGIN - 10;
    doc.save().moveTo(MARGIN, y - 6).lineTo(doc.page.width - MARGIN, y - 6).lineWidth(0.5).strokeColor(GREY.mid).stroke().restore();
    doc.font(FONT.regular).fontSize(8).fillColor(GREY.dark)
      .text(label, MARGIN, y, { width: contentWidth(doc) / 2, lineBreak: false })
      .text(`Page ${i + 1 - range.start} of ${range.count}`, MARGIN + contentWidth(doc) / 2, y, { width: contentWidth(doc) / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

module.exports = {
  createDocument, ensureSpace, heading, paragraph, addPageNumbers, contentWidth, bottomLimit, GREY, FONT, MARGIN,
};
