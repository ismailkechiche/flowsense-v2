'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { paxWeightedAvg, paxWeightedAvgSql } = require('../../src/domain/metrics');

// A family of 6 waits 30 min; two solo travellers wait 0 min.
const rows = [{ pax: 6, wait: 30 }, { pax: 1, wait: 0 }, { pax: 1, wait: 0 }];

test('pax-weighted average differs from the plain row average', () => {
  const rowAverage = rows.reduce((sum, r) => sum + r.wait, 0) / rows.length;
  assert.equal(rowAverage, 10);
  assert.equal(paxWeightedAvg(rows, 'wait'), 22.5);
});

test('the SQL fragment computes the same value as the JS function', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE o (pax INTEGER, wait REAL)');
  const insert = db.prepare('INSERT INTO o VALUES (?, ?)');
  for (const r of rows) insert.run(r.pax, r.wait);
  const sqlValue = db.prepare(`SELECT ${paxWeightedAvgSql('o.wait')} FROM o`).pluck().get();
  assert.equal(sqlValue, paxWeightedAvg(rows, 'wait'));
});

test('empty input gives null in both forms', () => {
  assert.equal(paxWeightedAvg([], 'wait'), null);
  const db = new Database(':memory:');
  db.exec('CREATE TABLE o (pax INTEGER, wait REAL)');
  assert.equal(db.prepare(`SELECT ${paxWeightedAvgSql('o.wait')} FROM o`).pluck().get(), null);
});

const {
  paxWeightedPercentile, paxWeightedPercentileSql, slaCompliancePct, slaCompliancePctSql,
  breachPaxSql, breachGroupsSql, throughputPerHour, arrivalRate, serviceRate,
} = require('../../src/domain/metrics');

function memoryTable(data) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE o (pax INTEGER, wait REAL, sla REAL)');
  const insert = db.prepare('INSERT INTO o VALUES (?, ?, ?)');
  for (const r of data) insert.run(r.pax, r.wait, r.sla ?? 10);
  return db;
}

test('pax-weighted percentile counts each row pax times (lower nearest rank)', () => {
  // Expanded list: 0, 0, 30×6 → P50 is 30, while the row median would be 0.
  assert.equal(paxWeightedPercentile(rows, 'wait', 50), 30);
  assert.equal(paxWeightedPercentile(rows, 'wait', 25), 0);
  assert.equal(paxWeightedPercentile(rows, 'wait', 90), 30);
  assert.equal(paxWeightedPercentile([], 'wait', 90), null);
  const ten = Array.from({ length: 10 }, (_, i) => ({ pax: 1, wait: i + 1 }));
  assert.equal(paxWeightedPercentile(ten, 'wait', 90), 9);
  assert.equal(paxWeightedPercentile(ten, 'wait', 91), 10);
});

test('the SQL percentile agrees with the JS one', () => {
  const data = [
    { pax: 3, wait: 12 }, { pax: 1, wait: 2 }, { pax: 6, wait: 7.5 }, { pax: 2, wait: 7.5 },
    { pax: 1, wait: 40 }, { pax: 4, wait: 0 }, { pax: 5, wait: 19 },
  ];
  const db = memoryTable(data);
  const query = db.prepare(paxWeightedPercentileSql('SELECT wait AS value, pax FROM o')).pluck();
  for (const p of [1, 10, 25, 50, 75, 90, 99, 100]) {
    assert.equal(query.get({ percentile: p }), paxWeightedPercentile(data, 'wait', p), `P${p}`);
  }
});

test('SLA compliance and breaches are counted in passengers', () => {
  const data = [{ pax: 6, wait: 30, sla: 10 }, { pax: 1, wait: 10, sla: 10 }, { pax: 1, wait: 0, sla: 10 }];
  assert.equal(slaCompliancePct(data, 'wait', 'sla'), 25);
  const db = memoryTable(data);
  const row = db.prepare(`SELECT ${slaCompliancePctSql('o.wait', 'o.sla')} AS pct,
    ${breachPaxSql('o.wait', 'o.sla')} AS pax, ${breachGroupsSql('o.wait', 'o.sla')} AS groups FROM o`).get();
  assert.deepEqual(row, { pct: 25, pax: 6, groups: 1 });
});

test('rates: throughput per hour, λ and μ per minute, null without a window', () => {
  assert.equal(throughputPerHour(120, 60), 120);
  assert.equal(throughputPerHour(10, 0), null);
  assert.equal(arrivalRate(30, 15), 2);
  assert.equal(arrivalRate(1, 0), null);
  // One group of 4 taking 4 minutes is 1 passenger per minute (step-0 Q2).
  assert.equal(serviceRate(4, 4), 1);
  assert.equal(serviceRate(4, 0), null);
  const groups = [{ pax: 4, processing: 4 }, { pax: 1, processing: 2 }];
  const perPax = paxWeightedAvg(groups, (g) => g.processing / g.pax);
  assert.ok(Math.abs(serviceRate(5, 6) - 1 / perPax) < 1e-12);
});
