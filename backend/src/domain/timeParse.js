'use strict';

/**
 * Local-time handling. Every timestamp is a naive local airport time,
 * stored as 'YYYY-MM-DDTHH:MM:SS' with no offset. Arithmetic is done on
 * the calendar fields directly (via Date.UTC as a plain calendar
 * calculator), so no time zone or DST rule ever shifts a value.
 */

const ISO_LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n, width = 2) => String(n).padStart(width, '0');

function validCalendarDate(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1) return false;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= daysInMonth;
}

/**
 * Parses 'YYYY-MM-DDTHH:MM[:SS]' (or with a space instead of T) and returns
 * the canonical 'YYYY-MM-DDTHH:MM:SS' string, or null when invalid.
 */
function parseLocalDateTime(value) {
  if (typeof value !== 'string') return null;
  const m = ISO_LOCAL.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map((part) => (part === undefined ? 0 : Number(part)));
  if (!validCalendarDate(y, mo, d) || h > 23 || mi > 59 || s > 59) return null;
  return `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}`;
}

/** Parses 'YYYY-MM-DD'; returns it canonical or null. */
function parseLocalDate(value) {
  if (typeof value !== 'string') return null;
  const m = DATE_ONLY.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  return validCalendarDate(y, mo, d) ? `${pad(y, 4)}-${pad(mo)}-${pad(d)}` : null;
}

/** Seconds since 1970-01-01T00:00:00 on a naive calendar (canonical input only). */
function toEpochSeconds(canonical) {
  const [datePart, timePart] = canonical.split('T');
  const [y, mo, d] = datePart.split('-').map(Number);
  const [h, mi, s] = (timePart ?? '00:00:00').split(':').map(Number);
  return Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
}

function fromEpochSeconds(seconds) {
  const dt = new Date(Math.round(seconds) * 1000);
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:${pad(dt.getUTCSeconds())}`;
}

/** Minutes from `a` to `b` (both canonical); negative when b is earlier. */
function minutesBetween(a, b) {
  return (toEpochSeconds(b) - toEpochSeconds(a)) / 60;
}

/** Adds whole days to a 'YYYY-MM-DD' date. */
function addDays(date, days) {
  return fromEpochSeconds(toEpochSeconds(`${date}T00:00:00`) + days * 86_400).slice(0, 10);
}

/** Seconds since local midnight for a canonical timestamp. */
function secondsOfDay(canonical) {
  const [h, mi, s] = canonical.slice(11).split(':').map(Number);
  return h * 3600 + mi * 60 + s;
}

// ---------------------------------------------------------------------------
// Spreadsheet cells. Dates and times may arrive as Excel serial numbers
// (days since 1899-12-30, the epoch that absorbs Excel's 1900 leap-year
// bug), as fractions of a day (time only), or as text.

const EXCEL_EPOCH_SECONDS = toEpochSeconds('1899-12-30T00:00:00');
const SECONDS_PER_DAY = 86_400;
// Serials below this are not plausible observation dates (before 1950).
const MIN_DATE_SERIAL = 18_264;

/** Excel serial (days, may include a fraction) → canonical datetime. */
function fromExcelSerial(serial) {
  return fromEpochSeconds(EXCEL_EPOCH_SECONDS + Math.round(serial * SECONDS_PER_DAY));
}

/** Fraction of a day (0 ≤ f < 1) → 'HH:MM:SS'. */
function fromDayFraction(fraction) {
  const seconds = Math.min(Math.round(fraction * SECONDS_PER_DAY), SECONDS_PER_DAY - 1);
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}

const DMY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
const TIME_TEXT = /^(\d{1,2})\s*[:hH]\s*(\d{2})(?:\s*[:mM]\s*(\d{2}))?\s*(?:s|S)?$/;

function parseTimeText(text) {
  const m = TIME_TEXT.exec(text);
  if (!m) return null;
  const [h, mi, s] = [m[1], m[2], m[3] ?? '0'].map(Number);
  if (h > 23 || mi > 59 || s > 59) return null;
  return `${pad(h)}:${pad(mi)}:${pad(s)}`;
}

/**
 * A date cell → 'YYYY-MM-DD' or null. Accepts Excel serials, ISO text
 * (YYYY-MM-DD, optionally with a time) and day-first text
 * (DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY), the convention in FLOWSENSE sheets.
 */
function parseCellDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= MIN_DATE_SERIAL ? fromExcelSerial(value).slice(0, 10) : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const iso = parseLocalDate(text.slice(0, 10));
  if (iso && (text.length === 10 || parseLocalDateTime(text))) return iso;
  const m = DMY.exec(text);
  if (!m) return null;
  return parseLocalDate(`${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`);
}

/**
 * A time cell → { date: 'YYYY-MM-DD' | null, time: 'HH:MM:SS' } or null.
 * Accepts fractions of a day, full Excel serial datetimes, 'HH:MM[:SS]',
 * French '14h05', and full datetime text (ISO or day-first).
 */
function parseCellTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 0 && value < 1) return { date: null, time: fromDayFraction(value) };
    if (value >= MIN_DATE_SERIAL) {
      const full = fromExcelSerial(value);
      return { date: full.slice(0, 10), time: full.slice(11) };
    }
    return null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const timeOnly = parseTimeText(text);
  if (timeOnly) return { date: null, time: timeOnly };
  const isoFull = parseLocalDateTime(text);
  if (isoFull) return { date: isoFull.slice(0, 10), time: isoFull.slice(11) };
  const space = text.lastIndexOf(' ');
  if (space > 0) {
    const date = parseCellDate(text.slice(0, space));
    const time = parseTimeText(text.slice(space + 1));
    if (date && time) return { date, time };
  }
  return null;
}

module.exports = {
  parseCellDate, parseCellTime, fromExcelSerial,
  parseLocalDateTime, parseLocalDate, toEpochSeconds, fromEpochSeconds, minutesBetween, addDays, secondsOfDay,
};
