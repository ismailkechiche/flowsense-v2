'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const t = require('../../src/domain/timeParse');

test('parseLocalDateTime canonicalises and rejects impossible values', () => {
  assert.equal(t.parseLocalDateTime('2026-03-29T02:30'), '2026-03-29T02:30:00');
  assert.equal(t.parseLocalDateTime('2028-02-29 23:59:59'), '2028-02-29T23:59:59');
  assert.equal(t.parseLocalDateTime('2026-02-29T10:00:00'), null);
  assert.equal(t.parseLocalDateTime('2026-05-01T10:00:00Z'), null);
  assert.equal(t.parseLocalDateTime('2026-05-01T10:00:00+01:00'), null);
  assert.equal(t.parseLocalDateTime(42), null);
});

test('arithmetic ignores DST: a European spring-forward night is still 60 minutes per hour', () => {
  assert.equal(t.minutesBetween('2026-03-29T01:30:00', '2026-03-29T03:30:00'), 120);
});

test('addDays and secondsOfDay', () => {
  assert.equal(t.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(t.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(t.secondsOfDay('2026-01-01T01:02:03'), 3723);
});
