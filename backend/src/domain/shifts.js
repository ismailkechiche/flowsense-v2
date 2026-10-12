'use strict';

const { paxWeightedAvg } = require('./metrics');
const { toEpochSeconds, fromEpochSeconds, secondsOfDay } = require('./timeParse');

/**
 * Shift boundaries (spec §5.1), as [start, end) times of day. Change them
 * here only. Anything not covered by morning or afternoon is night
 * (21:00–04:59 by default).
 */
const SHIFT_BOUNDARIES = Object.freeze({
  morning: Object.freeze({ start: '05:00', end: '13:00' }),
  afternoon: Object.freeze({ start: '13:00', end: '21:00' }),
});
const SHIFTS = Object.freeze(['morning', 'afternoon', 'night']);

const toSeconds = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 3600 + m * 60;
};

/** Shift for a time of day given as a canonical timestamp. */
function shiftForTime(canonical) {
  const sec = secondsOfDay(canonical);
  for (const [shift, { start, end }] of Object.entries(SHIFT_BOUNDARIES)) {
    if (sec >= toSeconds(start) && sec < toSeconds(end)) return shift;
  }
  return 'night';
}

/**
 * Detects a session's shift from the pax-weighted average arrival time of
 * its observations. The average is taken over full timestamps (not times
 * of day), so a night session spanning 23:00 → 01:00 averages to around
 * midnight, not to midday. Returns null for a session with no rows.
 */
function detectShift(observations) {
  const avgSeconds = paxWeightedAvg(observations, (o) => toEpochSeconds(o.arrival_time));
  if (avgSeconds === null) return null;
  return shiftForTime(fromEpochSeconds(avgSeconds));
}

module.exports = { SHIFT_BOUNDARIES, SHIFTS, shiftForTime, detectShift };
