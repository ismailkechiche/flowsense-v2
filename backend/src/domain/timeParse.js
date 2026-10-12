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

module.exports = {
  parseLocalDateTime, parseLocalDate, toEpochSeconds, fromEpochSeconds, minutesBetween, addDays, secondsOfDay,
};
