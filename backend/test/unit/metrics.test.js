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
