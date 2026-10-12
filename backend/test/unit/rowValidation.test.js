'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateObservationRow } = require('../../src/domain/rowValidation');

const good = {
  pax: 3,
  arrival_time: '2026-05-01T10:00:00',
  service_start: '2026-05-01T10:12:30',
  service_end: '2026-05-01T10:15:00',
};
const reasonsOf = (row) => validateObservationRow(row).reasons.map((r) => r.message);

test('a valid row gets its derived minutes', () => {
  const { ok, value } = validateObservationRow(good);
  assert.equal(ok, true);
  assert.equal(value.wait_minutes, 12.5);
  assert.equal(value.processing_minutes, 2.5);
  assert.equal(value.total_minutes, 15);
});

test('accepts HH:MM without seconds and a space separator', () => {
  const { ok, value } = validateObservationRow({ ...good, arrival_time: '2026-05-01 10:00' });
  assert.equal(ok, true);
  assert.equal(value.arrival_time, '2026-05-01T10:00:00');
});

test('pax must be an integer 1–6', () => {
  for (const pax of [0, 7, 2.5, -1, 'abc', null, undefined]) {
    assert.match(reasonsOf({ ...good, pax }).join(), /pax must be a whole number from 1 to 6/, String(pax));
  }
  assert.equal(validateObservationRow({ ...good, pax: '4' }).ok, true);
});

test('missing and unparseable timestamps are named', () => {
  assert.deepEqual(reasonsOf({ ...good, service_start: '' }), ['service_start is missing']);
  assert.deepEqual(reasonsOf({ ...good, arrival_time: '2026-02-30T10:00:00' }), ['arrival_time "2026-02-30T10:00:00" is not a valid date and time']);
  assert.deepEqual(reasonsOf({ ...good, service_end: '25:00' }), ['service_end "25:00" is not a valid date and time']);
});

test('order checks: start before arrival, end before start', () => {
  assert.deepEqual(reasonsOf({ ...good, service_start: '2026-05-01T09:59:00' }), ['service start is before arrival']);
  assert.deepEqual(reasonsOf({ ...good, service_end: '2026-05-01T10:12:00' }), ['service end is before service start']);
});

test('total over 6 hours is rejected; exactly 6 hours is allowed', () => {
  assert.equal(validateObservationRow({ ...good, service_end: '2026-05-01T16:00:00' }).ok, true);
  assert.match(reasonsOf({ ...good, service_end: '2026-05-01T16:00:01' }).join(), /over 6 hours/);
});

test('rows crossing midnight with full dates are fine', () => {
  const { ok, value } = validateObservationRow({
    pax: 1, arrival_time: '2026-05-01T23:55:00', service_start: '2026-05-02T00:05:00', service_end: '2026-05-02T00:07:00',
  });
  assert.equal(ok, true);
  assert.equal(value.wait_minutes, 10);
});

test('several problems are all reported', () => {
  assert.equal(validateObservationRow({ pax: 9, arrival_time: 'x' }).reasons.length, 4);
});
