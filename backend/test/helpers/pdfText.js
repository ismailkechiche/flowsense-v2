'use strict';

const zlib = require('node:zlib');

/**
 * Extracts the text drawn on each page of a PDFKit-generated PDF, in
 * drawing order. PDFKit writes text with the standard fonts as hex strings
 * in TJ arrays inside Flate-compressed content streams; this decodes just
 * that, which is all the tests need. Returns one string per content stream.
 */
function pdfText(buffer) {
  const raw = buffer.toString('latin1');
  const pages = [];
  const streamRe = /stream\r?\n/g;
  let match;
  while ((match = streamRe.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end === -1) break;
    const header = raw.slice(Math.max(0, match.index - 300), match.index);
    let body = buffer.subarray(start, end);
    if (/FlateDecode/.test(header)) {
      try { body = zlib.inflateSync(body); } catch { continue; }
    }
    const content = body.toString('latin1');
    if (!/\bTJ\b|\bTj\b/.test(content)) continue;
    const lines = [];
    for (const op of content.matchAll(/\[((?:[^\]])*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
      const parts = op[1] !== undefined ? [...op[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((m) => m[1]) : [op[2]];
      lines.push(parts.map((hex) => Buffer.from(hex, 'hex').toString('latin1')).join(''));
    }
    pages.push(lines.join('\n'));
    streamRe.lastIndex = end;
  }
  return pages;
}

module.exports = { pdfText };
