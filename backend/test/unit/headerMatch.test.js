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

test('a one-checkpoint check-in sheet maps every column and guesses no checkpoint', () => {
  assert.deepEqual(mapped(['Dep Date', 'Flight N', 'Chek-in counter', 'Number of pax', 'Arrival time the queue',
    'Arrival time to the chek-in', 'End of the service', 'processing time', 'waiting time', 'total time']), {
    date: 'Dep Date', flight_no: 'Flight N', counter: 'Chek-in counter', pax: 'Number of pax',
    arrival_time: 'Arrival time the queue', service_start: 'Arrival time to the chek-in', service_end: 'End of the service',
  });
});

test('computed duration columns are never guessed', () => {
  const { mapping, unmatched } = matchHeaders(['Processing time', 'Waiting time', 'Total time', 'Temps d\'attente', 'Durée']);
  assert.ok(Object.values(mapping).every((m) => m === null));
  assert.equal(unmatched.length, 5);
});

test('checkpoint is only guessed from a near-certain header', () => {
  assert.equal(matchHeaders(['Process']).mapping.checkpoint.header, 'Process');
  assert.equal(matchHeaders(['Check point']).mapping.checkpoint.header, 'Check point');
  assert.equal(matchHeaders(['Chekpoint']).mapping.checkpoint.header, 'Chekpoint');
  for (const header of ['Processing', 'Chek-in counter', 'Arrival area time', 'Pointage']) {
    assert.equal(matchHeaders([header]).mapping.checkpoint, null, header);
  }
});

test('a synonym inside a longer header counts, the longest one wins', () => {
  assert.equal(matchHeaders(['Check-in counter']).mapping.counter.header, 'Check-in counter');
  const { mapping } = matchHeaders(['Heure d\'arrivée dans la file']);
  assert.equal(mapping.arrival_time.header, 'Heure d\'arrivée dans la file');
  assert.equal(mapping.counter, null);
});

test('jaroWinkler sanity', () => {
  assert.equal(jaroWinkler('abc', 'abc'), 1);
  assert.equal(jaroWinkler('abc', 'xyz'), 0);
  assert.ok(jaroWinkler('martha', 'marhta') > 0.96);
});
