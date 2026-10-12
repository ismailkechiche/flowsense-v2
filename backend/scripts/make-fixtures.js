'use strict';

/**
 * Regenerates the spreadsheet fixtures in test/fixtures/. The files are
 * committed so tests never depend on running this script; rerun it only
 * when a fixture needs to change:  node scripts/make-fixtures.js
 */

const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const OUT = path.resolve(__dirname, '../test/fixtures');

// Excel serial for a local date (days since 1899-12-30).
const serialDate = (iso) => (Date.UTC(...iso.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n)))) - Date.UTC(1899, 11, 30)) / 86_400_000;
const dayFraction = (hhmm) => {
  const [h, m, s = 0] = hhmm.split(':').map(Number);
  return (h * 3600 + m * 60 + s) / 86_400;
};

function writeSheet(file, rows, { bookType = 'xlsx', sheetName = 'Observations', formats = {}, extraSheets = [] } = {}) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // Apply number formats so Excel shows dates/times as people would type them.
  for (const [col, fmt] of Object.entries(formats)) {
    for (let r = 1; r < rows.length; r += 1) {
      const ref = XLSX.utils.encode_cell({ r, c: Number(col) });
      if (ws[ref] && ws[ref].t === 'n') ws[ref].z = fmt;
    }
  }
  const wb = XLSX.utils.book_new();
  for (const [name, extraRows] of extraSheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(extraRows), name);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, path.join(OUT, file), { bookType });
}

fs.mkdirSync(OUT, { recursive: true });

// 1. Messy, mixed English/French headers; serial dates and time fractions;
//    a notes sheet before the data sheet; an extra unmapped column.
writeSheet('messy-headers.xlsx', [
  ['Dep Date', 'Point de contrôle', 'Groupe', 'Nb Pax', 'Flight No.', 'Comptoir', 'Heure arrivée', 'Début service', 'Fin service', 'Observateur', 'Remarks'],
  [serialDate('2026-05-01'), 'Security', 'F1', 4, 'TU712', 'L1', dayFraction('08:00'), dayFraction('08:12'), dayFraction('08:15'), 'Sami', ''],
  [serialDate('2026-05-01'), 'Security', 'F2', 1, 'TU712', 'L2', dayFraction('08:03'), dayFraction('08:05'), dayFraction('08:06'), 'Sami', 'solo'],
  [serialDate('2026-05-01'), 'Security', 'F3', 6, 'BJ308', 'L1', dayFraction('08:10'), dayFraction('08:31'), dayFraction('08:38'), 'Sami', 'tour group'],
], { formats: { 0: 'dd/mm/yyyy', 6: 'hh:mm', 7: 'hh:mm', 8: 'hh:mm' }, extraSheets: [['Notes', [['Recorded at NBE'], ['shift A']]]] });

// 2. Two checkpoints on one date (plus a second date): three sessions.
//    Checkpoint names are written loosely ("Sûreté", "passport control ").
writeSheet('two-checkpoints-one-date.xlsx', [
  ['Date', 'Checkpoint', 'Group', 'Pax', 'Arrival', 'Service start', 'Service end'],
  ['01/05/2026', 'Security', 'S1', 2, '08:00', '08:04', '08:06'],
  ['01/05/2026', 'Sûreté', 'S2', 3, '08:10', '08:20', '08:24'],
  ['01/05/2026', 'passport control ', 'P1', 1, '08:30', '08:31', '08:33'],
  ['01/05/2026', 'Passport Control', 'P2', 4, '08:35', '08:50', '08:58'],
  ['02/05/2026', 'Security', 'S3', 2, '14:00', '14:02', '14:05'],
]);

// 3. Bad rows of every kind, plus a blank line that is skipped silently.
writeSheet('bad-rows.xlsx', [
  ['Date', 'Checkpoint', 'Group', 'Pax', 'Arrival', 'Service start', 'Service end'],
  ['01/05/2026', 'Security', 'OK1', 2, '09:00', '09:05', '09:07'],
  ['01/05/2026', 'Security', 'BADPAX', 7, '09:10', '09:12', '09:13'],
  ['01/05/2026', 'Security', 'MISSING', 2, '', '09:12', '09:13'],
  ['01/05/2026', 'Security', 'GARBAGE', 2, 'soon', '09:12', '09:13'],
  [],
  ['01/05/2026', 'Security', 'TOOLONG', 2, '09:00', '09:10', '15:30'],
  ['01/05/2026', 'Lounge', 'NOCP', 2, '09:00', '09:01', '09:02'],
  ['01/05/2026', 'Security', 'OK2', 3, '09:20', '09:31', '09:33'],
]);

// 4. French CSV (UTF-8 with BOM), DD/MM/YYYY dates, "14h05" times,
//    no checkpoint column (the user picks one for the whole file).
fs.writeFileSync(path.join(OUT, 'french-headers.csv'), `﻿${[
  'Date du vol,Code groupe,Passagers,Vol,Guichet,Heure d\'arrivée,Prise en charge,Heure de sortie',
  '03/05/2026,G-A,2,TU214,3,14h05,14h20,14h26',
  '03/05/2026,G-B,5,TU214,4,14h07,14h30,14h41',
  '03/05/2026,G-C,1,TU214,3,14h15,14h27,14h29',
].join('\r\n')}\r\n`);

// 5. Legacy .xls with full date-time serials in the time columns and no
//    date column at all.
const dt = (iso, hhmm) => serialDate(iso) + dayFraction(hhmm);
writeSheet('serial-dates.xls', [
  ['Checkpoint', 'Pax', 'Arrival time', 'Service start', 'Service end'],
  ['Boarding Gate', 2, dt('2026-05-04', '19:00'), dt('2026-05-04', '19:05'), dt('2026-05-04', '19:06')],
  ['Boarding Gate', 3, dt('2026-05-04', '19:02'), dt('2026-05-04', '19:06'), dt('2026-05-04', '19:08')],
], { bookType: 'biff8', formats: { 2: 'dd/mm/yyyy hh:mm', 3: 'dd/mm/yyyy hh:mm', 4: 'dd/mm/yyyy hh:mm' } });

// 6. Time-only cells crossing midnight.
writeSheet('midnight-crossing.xlsx', [
  ['Date', 'Checkpoint', 'Pax', 'Arrival', 'Service start', 'Service end'],
  ['2026-05-05', 'Passport Control', 2, '23:50', '23:58', '00:04'],
  ['2026-05-05', 'Passport Control', 1, '23:59', '00:03', '00:05'],
  ['2026-05-05', 'Passport Control', 3, '23:55', '00:01', '00:02'],
]);

process.stdout.write(`Fixtures written to ${OUT}\n`);
