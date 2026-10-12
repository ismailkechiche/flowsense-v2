'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchCheckpointValue, resolveRows, splitIntoGroups } = require('../../src/domain/importRows');

const CHECKPOINTS = [
  { id: 1, name: 'Check-in' }, { id: 2, name: 'Security' }, { id: 3, name: 'Passport Control' }, { id: 4, name: 'Boarding Gate' },
];
const MAPPING = { date: 0, checkpoint: 1, pax: 2, arrival_time: 3, service_start: 4, service_end: 5 };
const ctx = (extra = {}) => ({ mapping: MAPPING, checkpointFor: (v) => matchCheckpointValue(v, CHECKPOINTS), fileCheckpointId: null, ...extra });

test('checkpoint values match names loosely and in French', () => {
  assert.equal(matchCheckpointValue('security ', CHECKPOINTS), 2);
  assert.equal(matchCheckpointValue('Sûreté', CHECKPOINTS), 2);
  assert.equal(matchCheckpointValue('Contrôle passeport', CHECKPOINTS), 3);
  assert.equal(matchCheckpointValue('Embarquement', CHECKPOINTS), 4);
  assert.equal(matchCheckpointValue('Check in', CHECKPOINTS), 1);
  assert.equal(matchCheckpointValue('Secuirty', CHECKPOINTS), 2);
  assert.equal(matchCheckpointValue('Lounge', CHECKPOINTS), null);
});

test('rows are resolved with sheet row numbers; blank rows are skipped', () => {
  const { accepted, rejected } = resolveRows([
    ['01/05/2026', 'Security', 2, '08:00', '08:05', '08:06'],
    [null, '', null],
    ['01/05/2026', 'Security', 9, '08:00', '08:05', '08:06'],
  ], ctx());
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].rowNumber, 2);
  assert.equal(accepted[0].arrival_time, '2026-05-01T08:00:00');
  assert.equal(accepted[0].wait_minutes, 5);
  assert.deepEqual(rejected, [{ rowNumber: 4, reasons: ['pax must be a whole number from 1 to 6'], checkpoint_value: 'Security' }]);
});

test('midnight crossing: time-only cells earlier than the previous time roll to the next day', () => {
  const { accepted, midnightCrossings } = resolveRows([['2026-05-05', 'Security', 1, '23:50', '23:58', '00:04']], ctx());
  assert.equal(midnightCrossings, 1);
  assert.equal(accepted[0].service_end, '2026-05-06T00:04:00');
  assert.equal(accepted[0].total_minutes, 14);
});

test('a big backwards jump is still rejected by the 6-hour rule', () => {
  const { rejected } = resolveRows([['2026-05-05', 'Security', 1, '09:00', '08:59', '09:05']], ctx());
  assert.match(rejected[0].reasons.join(), /over 6 hours/);
});

test('without a checkpoint column the file-level checkpoint is used', () => {
  const mapping = { date: 0, pax: 1, arrival_time: 2, service_start: 3, service_end: 4 };
  const rows = [['01/05/2026', 2, '08:00', '08:05', '08:06']];
  assert.match(resolveRows(rows, ctx({ mapping })).rejected[0].reasons[0], /choose a checkpoint/);
  assert.equal(resolveRows(rows, ctx({ mapping, fileCheckpointId: 3 })).accepted[0].checkpoint_id, 3);
});

test('without a date column, full date-times supply the date', () => {
  const mapping = { checkpoint: 0, pax: 1, arrival_time: 2, service_start: 3, service_end: 4 };
  const { accepted } = resolveRows([['Security', 2, 46146.75, 46146.76, 46146.77]], ctx({ mapping }));
  assert.equal(accepted[0].date, '2026-05-04');
  const { rejected } = resolveRows([['Security', 2, '08:00', '08:05', '08:06']], ctx({ mapping }));
  assert.match(rejected[0].reasons.join(), /no date/);
});

test('rows are split by DATE + CHECKPOINT together, never date alone', () => {
  const { accepted } = resolveRows([
    ['01/05/2026', 'Security', 2, '08:00', '08:05', '08:06'],
    ['01/05/2026', 'Passport Control', 3, '08:00', '08:05', '08:06'],
    ['01/05/2026', 'Sûreté', 1, '09:00', '09:05', '09:06'],
    ['02/05/2026', 'Security', 4, '15:00', '15:05', '15:06'],
  ], ctx());
  const groups = splitIntoGroups(accepted);
  assert.deepEqual(groups.map((g) => [g.date, g.checkpoint_id, g.row_count, g.pax_total, g.shift]), [
    ['2026-05-01', 2, 2, 3, 'morning'],
    ['2026-05-01', 3, 1, 3, 'morning'],
    ['2026-05-02', 2, 1, 4, 'afternoon'],
  ]);
});
