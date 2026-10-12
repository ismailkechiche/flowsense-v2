'use strict';

const { normalizeHeader, jaroWinkler } = require('./headerMatch');
const { parseCellDate, parseCellTime, addDays } = require('./timeParse');
const { validateObservationRow, arrivalDateProblem, checkPax } = require('./rowValidation');
const { detectShift } = require('./shifts');

/**
 * Turns parsed sheet rows into validated observation rows and proposed
 * sessions (spec §7.2–7.5). Pure: no database, no I/O.
 */

const CHECKPOINT_MATCH_THRESHOLD = 0.85;

// Extra names for the four standard checkpoints (English and French).
const CHECKPOINT_SYNONYMS = Object.freeze({
  'check in': ['checkin', 'check in', 'enregistrement', 'registration', 'counters', 'banques d enregistrement'],
  security: ['security', 'screening', 'surete', 'securite', 'pif', 'inspection filtrage', 'controle surete'],
  'passport control': ['passport', 'passports', 'immigration', 'border', 'border control', 'police',
    'controle passeport', 'controle des passeports', 'police aux frontieres', 'paf', 'emigration'],
  'boarding gate': ['boarding', 'gate', 'gates', 'embarquement', 'porte', 'porte d embarquement', 'salle d embarquement'],
});

/**
 * Matches a checkpoint cell (e.g. "Sûreté", "security ", "Check In") to a
 * configured checkpoint. Returns the checkpoint id or null.
 */
function matchCheckpointValue(value, checkpoints) {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  let best = null;
  for (const checkpoint of checkpoints) {
    const name = normalizeHeader(checkpoint.name);
    const names = [name, ...(CHECKPOINT_SYNONYMS[name] ?? [])];
    if (names.includes(normalized)) return checkpoint.id;
    for (const candidate of names) {
      const score = jaroWinkler(normalized, candidate);
      if (score >= CHECKPOINT_MATCH_THRESHOLD && (!best || score > best.score)) best = { id: checkpoint.id, score };
    }
  }
  return best?.id ?? null;
}

const isBlank = (cell) => cell === undefined || cell === null || (typeof cell === 'string' && cell.trim() === '');
const cellText = (cell) => (isBlank(cell) ? null : String(cell).trim());

/**
 * Resolves one sheet row.
 * ctx: { mapping: { field: columnIndex|null }, checkpointFor(rawValue) → id|null,
 *        fileCheckpointId|null }
 * Returns { ok, reasons, notes, value }.
 */
function resolveRow(cells, ctx) {
  const cell = (field) => (ctx.mapping[field] === null || ctx.mapping[field] === undefined ? undefined : cells[ctx.mapping[field]]);
  const reasons = [];
  const notes = [];

  // Checkpoint: the column when mapped, else the one chosen for the file.
  let checkpointId = null;
  let checkpointRaw = null;
  if (ctx.mapping.checkpoint !== null && ctx.mapping.checkpoint !== undefined) {
    checkpointRaw = cellText(cell('checkpoint'));
    if (!checkpointRaw) reasons.push({ field: 'checkpoint', message: 'checkpoint is missing' });
    else {
      checkpointId = ctx.checkpointFor(checkpointRaw);
      if (!checkpointId) reasons.push({ field: 'checkpoint', message: `checkpoint "${checkpointRaw}" does not match a configured checkpoint` });
    }
  } else if (ctx.fileCheckpointId) {
    checkpointId = ctx.fileCheckpointId;
  } else {
    reasons.push({ field: 'checkpoint', message: 'no checkpoint column; choose a checkpoint for the whole file' });
  }

  // Times: each cell may carry a date or only a time of day.
  const parsed = {};
  for (const field of ['arrival_time', 'service_start', 'service_end']) {
    const raw = cell(field);
    if (isBlank(raw)) { reasons.push({ field, message: `${field} is missing` }); continue; }
    const value = parseCellTime(raw);
    if (!value) reasons.push({ field, message: `${field} "${cellText(raw)}" is not a recognised time` });
    else parsed[field] = value;
  }

  // Date: the date column, else the date carried by the arrival cell.
  let date = null;
  const dateCell = cell('date');
  if (!isBlank(dateCell)) {
    date = parseCellDate(dateCell);
    if (!date) reasons.push({ field: 'date', message: `date "${cellText(dateCell)}" is not a recognised date` });
  } else if (parsed.arrival_time?.date) {
    date = parsed.arrival_time.date;
  } else if (parsed.arrival_time) {
    reasons.push({ field: 'date', message: 'no date: add a date column or use full date-times' });
  }

  // Compose full timestamps. A time-only value earlier than the previous
  // timestamp on the row is taken as the next day (midnight crossing).
  const full = {};
  if (date && parsed.arrival_time && parsed.service_start && parsed.service_end) {
    let previous = null;
    for (const field of ['arrival_time', 'service_start', 'service_end']) {
      const { date: ownDate, time } = parsed[field];
      let day = ownDate ?? (previous ? previous.slice(0, 10) : date);
      if (!ownDate && previous && `${day}T${time}` < previous) {
        day = addDays(day, 1);
        notes.push(`${field} is earlier than the previous time, so it was taken as the next day (midnight crossing)`);
      }
      full[field] = `${day}T${time}`;
      previous = full[field];
    }
  }

  const paxCell = cell('pax');
  const pax = typeof paxCell === 'string' ? paxCell.trim() : paxCell;
  let value = null;
  if (Object.keys(full).length === 3) {
    const result = validateObservationRow({ pax, ...full });
    if (!result.ok) reasons.push(...result.reasons);
    else {
      value = result.value;
      const problem = arrivalDateProblem(date, value.arrival_time);
      if (problem) reasons.push({ field: 'arrival_time', message: problem });
    }
  } else {
    // The times are unusable, but still report a bad pax alongside them.
    const { problem } = checkPax(pax);
    if (problem) reasons.push(problem);
  }

  if (reasons.length > 0) return { ok: false, reasons, notes, checkpointRaw };
  return {
    ok: true,
    reasons,
    notes,
    checkpointRaw,
    value: {
      ...value,
      date,
      checkpoint_id: checkpointId,
      passenger_group_code: cellText(cell('passenger_group_code')),
      flight_no: cellText(cell('flight_no')),
      counter: cellText(cell('counter')),
      observer: cellText(cell('observer')),
    },
  };
}

/**
 * Resolves every data row. `firstRowNumber` is the sheet row number of
 * rows[0] (header row + 1), so reasons can cite the row people see in Excel.
 */
function resolveRows(rows, ctx, firstRowNumber = 2) {
  const accepted = [];
  const rejected = [];
  let midnightCrossings = 0;
  rows.forEach((cells, i) => {
    if (cells.every(isBlank)) return; // blank lines are skipped silently
    const rowNumber = firstRowNumber + i;
    const result = resolveRow(cells, ctx);
    if (result.notes.length > 0) midnightCrossings += 1;
    if (result.ok) accepted.push({ rowNumber, ...result.value });
    else rejected.push({ rowNumber, reasons: result.reasons.map((r) => r.message), checkpoint_value: result.checkpointRaw });
  });
  return { accepted, rejected, midnightCrossings };
}

/** Groups accepted rows by DATE + CHECKPOINT together (never date alone). */
function splitIntoGroups(accepted) {
  const groups = new Map();
  for (const row of accepted) {
    const key = `${row.date}|${row.checkpoint_id}`;
    if (!groups.has(key)) groups.set(key, { key, date: row.date, checkpoint_id: row.checkpoint_id, rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()]
    .sort((a, b) => a.date.localeCompare(b.date) || a.checkpoint_id - b.checkpoint_id)
    .map((group) => ({
      ...group,
      shift: detectShift(group.rows),
      row_count: group.rows.length,
      pax_total: group.rows.reduce((sum, r) => sum + r.pax, 0),
      observers: [...new Set(group.rows.map((r) => r.observer).filter(Boolean))],
    }));
}

module.exports = { matchCheckpointValue, resolveRow, resolveRows, splitIntoGroups, CHECKPOINT_SYNONYMS };
