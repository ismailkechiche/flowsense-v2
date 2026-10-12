'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCellDate, parseCellTime } = require('../../src/domain/timeParse');

test('dates: Excel serials, ISO text and day-first text', () => {
  assert.equal(parseCellDate(46143), '2026-05-01');
  assert.equal(parseCellDate('2026-05-01'), '2026-05-01');
  assert.equal(parseCellDate('01/05/2026'), '2026-05-01');
  assert.equal(parseCellDate('1-5-2026'), '2026-05-01');
  assert.equal(parseCellDate('31.12.2026'), '2026-12-31');
  assert.equal(parseCellDate('31/02/2026'), null);
  assert.equal(parseCellDate(0.5), null);
  assert.equal(parseCellDate('tomorrow'), null);
});

test('times: day fractions, serial date-times and text', () => {
  assert.deepEqual(parseCellTime(0.5), { date: null, time: '12:00:00' });
  assert.deepEqual(parseCellTime(46143 + 0.75), { date: '2026-05-01', time: '18:00:00' });
  assert.deepEqual(parseCellTime('08:05'), { date: null, time: '08:05:00' });
  assert.deepEqual(parseCellTime('8:05:09'), { date: null, time: '08:05:09' });
  assert.deepEqual(parseCellTime('14h05'), { date: null, time: '14:05:00' });
  assert.deepEqual(parseCellTime('2026-05-01 23:59'), { date: '2026-05-01', time: '23:59:00' });
  assert.deepEqual(parseCellTime('01/05/2026 08:05'), { date: '2026-05-01', time: '08:05:00' });
});

test('fractions round to the nearest second and never reach 24:00', () => {
  assert.deepEqual(parseCellTime(8 / 24 + 0.4 / 86400), { date: null, time: '08:00:00' });
  assert.deepEqual(parseCellTime(0.9999999), { date: null, time: '23:59:59' });
});

test('invalid times are rejected', () => {
  for (const bad of ['25:00', '12:60', 'soon', '', -0.1, 5]) assert.equal(parseCellTime(bad), null, String(bad));
});
