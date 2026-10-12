'use strict';

const { parseLocalDateTime, minutesBetween } = require('./timeParse');

const MIN_PAX = 1;
const MAX_PAX = 6;
const MAX_TOTAL_MINUTES = 6 * 60;
const TIMESTAMP_FIELDS = Object.freeze(['arrival_time', 'service_start', 'service_end']);

/**
 * Validates one observation (manual entry or import, spec §5.2) and
 * computes its derived minute columns.
 *
 * Input timestamps must already be canonical-able local datetimes
 * ('YYYY-MM-DDTHH:MM[:SS]'); the import layer resolves Excel serials,
 * time-only cells and midnight crossing before calling this.
 *
 * Returns { ok: true, value } or { ok: false, reasons: [{ field, message }] }.
 */
function validateObservationRow(row) {
  const reasons = [];
  const pax = typeof row.pax === 'string' && row.pax.trim() !== '' ? Number(row.pax) : row.pax;
  if (!Number.isInteger(pax) || pax < MIN_PAX || pax > MAX_PAX) {
    reasons.push({ field: 'pax', message: `pax must be a whole number from ${MIN_PAX} to ${MAX_PAX}` });
  }

  const times = {};
  for (const field of TIMESTAMP_FIELDS) {
    const raw = row[field];
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      reasons.push({ field, message: `${field} is missing` });
      continue;
    }
    const parsed = parseLocalDateTime(String(raw));
    if (!parsed) reasons.push({ field, message: `${field} "${raw}" is not a valid date and time` });
    else times[field] = parsed;
  }

  let wait;
  let processing;
  let total;
  if (Object.keys(times).length === TIMESTAMP_FIELDS.length) {
    wait = minutesBetween(times.arrival_time, times.service_start);
    processing = minutesBetween(times.service_start, times.service_end);
    total = minutesBetween(times.arrival_time, times.service_end);
    if (wait < 0) reasons.push({ field: 'service_start', message: 'service start is before arrival' });
    if (processing < 0) reasons.push({ field: 'service_end', message: 'service end is before service start' });
    if (wait >= 0 && processing >= 0 && total > MAX_TOTAL_MINUTES) {
      reasons.push({ field: 'service_end', message: `total time ${formatMinutes(total)} is over 6 hours (likely a data-entry error)` });
    }
  }

  if (reasons.length > 0) return { ok: false, reasons };
  return {
    ok: true,
    value: {
      pax,
      arrival_time: times.arrival_time,
      service_start: times.service_start,
      service_end: times.service_end,
      wait_minutes: wait,
      processing_minutes: processing,
      total_minutes: total,
    },
  };
}

function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return `${h}h${String(m).padStart(2, '0')}`;
}

module.exports = { validateObservationRow, MIN_PAX, MAX_PAX, MAX_TOTAL_MINUTES };
