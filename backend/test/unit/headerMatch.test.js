'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchHeaders, normalizeHeader, jaroWinkler } = require('../../src/domain/headerMatch');

const mapped = (headers, opts) => Object.fromEntries(
  Object.entries(matchHeaders(headers, opts).mapping).filter(([, m]) => m).map(([field, m]) => [field, m.header]),
);

test('normalisation strips case, accents, punctuation and extra spaces', () => {
  assert.equal(normalizeHeader('  Heure   d\'Arrivée (hh:mm) '), 'heure d arrivee hh mm');
  assert.equal(normalizeHeader('Début—service'), 'debut service');
});

test('English and French synonyms map exactly', () => {
  assert.deepEqual(mapped(['Dep Date', 'Point de contrôle', 'Nb Pax', 'Vol', 'Guichet', 'Heure arrivée', 'Début service', 'Fin service', 'Observateur']), {
    date: 'Dep Date', checkpoint: 'Point de contrôle', pax: 'Nb Pax', flight_no: 'Vol', counter: 'Guichet',
    arrival_time: 'Heure arrivée', service_start: 'Début service', service_end: 'Fin service', observer: 'Observateur',
  });
  assert.deepEqual(mapped(['Departure Date', 'Passengers', 'Arrival Time', 'Service Start', 'Service End']), {
    date: 'Departure Date', pax: 'Passengers', arrival_time: 'Arrival Time', service_start: 'Service Start', service_end: 'Service End',
  });
});

test('typos are matched by similarity above the threshold, with a confidence', () => {
  const { mapping } = matchHeaders(['Arival Tme', 'Servise start', 'Pasengers']);
  assert.equal(mapping.arrival_time.header, 'Arival Tme');
  assert.equal(mapping.arrival_time.method, 'similarity');
  assert.ok(mapping.arrival_time.confidence >= 0.8 && mapping.arrival_time.confidence < 1);
  assert.equal(mapping.service_start.header, 'Servise start');
  assert.equal(mapping.pax.header, 'Pasengers');
});

test('unrelated headers stay unmatched; the threshold is configurable', () => {
  const { mapping, unmatched } = matchHeaders(['Remarks', 'Weather', 'Arival']);
  assert.equal(mapping.arrival_time.header, 'Arival');
  assert.deepEqual(unmatched.map((u) => u.header), ['Remarks', 'Weather']);
  assert.equal(matchHeaders(['Arival'], { threshold: 0.99 }).mapping.arrival_time, null);
});

test('a column maps to one field at most; the more specific header wins a tie', () => {
  const { mapping } = matchHeaders(['Start', 'Service start']);
  assert.equal(mapping.service_start.header, 'Service start');
  const fieldsUsingStart = Object.values(mapping).filter((m) => m && m.header === 'Start');
  assert.ok(fieldsUsingStart.length <= 1);
  assert.ok(fieldsUsingStart.every((m) => m.confidence < 1), 'a fuzzy guess must show a confidence below 1');
});

test('jaroWinkler sanity', () => {
  assert.equal(jaroWinkler('abc', 'abc'), 1);
  assert.equal(jaroWinkler('abc', 'xyz'), 0);
  assert.ok(jaroWinkler('martha', 'marhta') > 0.96);
});
