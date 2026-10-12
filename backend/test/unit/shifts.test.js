'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shiftForTime, detectShift, SHIFT_BOUNDARIES } = require('../../src/domain/shifts');

const at = (time, date = '2026-05-01') => `${date}T${time}`;

test('boundaries: morning 05:00–12:59, afternoon 13:00–20:59, night 21:00–04:59', () => {
  const cases = [
    ['04:59:59', 'night'],
    ['05:00:00', 'morning'],
    ['12:59:00', 'morning'],
    ['12:59:59', 'morning'],
    ['13:00:00', 'afternoon'],
    ['20:59:59', 'afternoon'],
    ['21:00:00', 'night'],
    ['23:59:59', 'night'],
    ['00:00:00', 'night'],
  ];
  for (const [time, expected] of cases) assert.equal(shiftForTime(at(time)), expected, time);
});

test('boundaries live in one exported constant', () => {
  assert.deepEqual(SHIFT_BOUNDARIES, { morning: { start: '05:00', end: '13:00' }, afternoon: { start: '13:00', end: '21:00' } });
  assert.ok(Object.isFrozen(SHIFT_BOUNDARIES));
});

test('detection uses the pax-weighted average arrival time', () => {
  // Plain average of 12:00 and 14:00 is 13:00 (afternoon); weighted by pax
  // (5 at 12:00, 1 at 14:00) it is 12:20 (morning).
  const rows = [{ arrival_time: at('12:00:00'), pax: 5 }, { arrival_time: at('14:00:00'), pax: 1 }];
  assert.equal(detectShift(rows), 'morning');
  assert.equal(detectShift([{ arrival_time: at('12:00:00'), pax: 1 }, { arrival_time: at('14:00:00'), pax: 1 }]), 'afternoon');
});

test('night sessions spanning midnight stay night', () => {
  const rows = [
    { arrival_time: at('23:00:00', '2026-05-01'), pax: 2 },
    { arrival_time: at('01:00:00', '2026-05-02'), pax: 2 },
  ];
  assert.equal(detectShift(rows), 'night');
});

test('a weighted average landing exactly on a boundary uses the later shift', () => {
  const rows = [{ arrival_time: at('12:00:00'), pax: 3 }, { arrival_time: at('14:00:00'), pax: 3 }];
  assert.equal(detectShift(rows), 'afternoon');
});

test('no observations → no shift', () => {
  assert.equal(detectShift([]), null);
});
