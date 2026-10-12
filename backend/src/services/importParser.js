'use strict';

const path = require('node:path');
const XLSX = require('xlsx');
const { badRequest } = require('../domain/errors');

const ACCEPTED_EXTENSIONS = Object.freeze(['.xlsx', '.xls', '.csv']);
const MIN_HEADER_CELLS = 3;

/** Decodes CSV bytes: UTF-8 (BOM stripped), falling back to Windows-1252. */
function decodeCsv(buffer) {
  const utf8 = buffer.toString('utf8').replace(/^﻿/, '');
  if (!utf8.includes('�')) return utf8;
  return new TextDecoder('windows-1252').decode(buffer);
}

const isBlank = (cell) => cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '');

/** The header is the first row with at least MIN_HEADER_CELLS filled cells. */
function findHeaderRow(rows) {
  return rows.findIndex((row) => row.filter((cell) => !isBlank(cell)).length >= MIN_HEADER_CELLS);
}

/**
 * Parses an uploaded spreadsheet into plain values. Cells keep their raw
 * form: numbers stay numbers (Excel serial dates/times are decoded later
 * by the domain layer, with no time-zone conversion) and CSV cells stay
 * text. Returns { sheets: [{ name, headerRowIndex, headers, rows }] }.
 */
function parseSpreadsheet(buffer, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    throw badRequest(`Unsupported file type "${ext || 'none'}"; upload .xlsx, .xls or .csv`, undefined, 'unsupported_file');
  }
  if (!buffer || buffer.length === 0) throw badRequest('The uploaded file is empty', undefined, 'empty_file');

  let workbook;
  try {
    workbook = ext === '.csv'
      ? XLSX.read(decodeCsv(buffer), { type: 'string', raw: true, cellDates: false })
      : XLSX.read(buffer, { type: 'buffer', cellDates: false, cellFormula: false, cellHTML: false });
  } catch {
    throw badRequest('The file could not be read as a spreadsheet', undefined, 'unreadable_file');
  }

  const sheets = workbook.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true });
    const headerRowIndex = findHeaderRow(rows);
    if (headerRowIndex === -1) return { name, headerRowIndex: -1, headers: [], rows: [] };
    const headers = rows[headerRowIndex].map((cell) => (isBlank(cell) ? '' : String(cell).trim()));
    return { name, headerRowIndex, headers, rows: rows.slice(headerRowIndex + 1) };
  });
  if (sheets.every((sheet) => sheet.headerRowIndex === -1)) {
    throw badRequest('No header row found: the sheet needs a row of column titles above the data', undefined, 'no_header_row');
  }
  return { sheets };
}

module.exports = { parseSpreadsheet, ACCEPTED_EXTENSIONS };
