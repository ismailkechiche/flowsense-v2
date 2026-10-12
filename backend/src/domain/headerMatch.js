'use strict';

/**
 * Fuzzy matching of spreadsheet headers to FLOWSENSE fields (spec §7.2):
 *   1. normalise (lowercase, strip accents/punctuation/extra spaces);
 *   2. exact hit in a per-field synonym list (English and French);
 *   3. otherwise Jaro-Winkler similarity against the field's synonyms,
 *      accepted at or above a threshold (default 0.8).
 * Each header maps to at most one field and vice versa; the best scores
 * are assigned first.
 */

const DEFAULT_THRESHOLD = 0.8;

const TARGET_FIELDS = Object.freeze([
  'date', 'checkpoint', 'passenger_group_code', 'pax', 'flight_no', 'counter',
  'arrival_time', 'service_start', 'service_end', 'observer',
]);

/** Fields a sheet must provide (date and checkpoint have fallbacks). */
const REQUIRED_FIELDS = Object.freeze(['pax', 'arrival_time', 'service_start', 'service_end']);

const SYNONYMS = Object.freeze({
  date: ['date', 'day', 'dep date', 'departure date', 'flight date', 'observation date', 'jour',
    'date depart', 'date de depart', 'date vol', 'date du vol', 'date observation'],
  checkpoint: ['checkpoint', 'check point', 'station', 'point', 'area', 'process', 'zone', 'poste',
    'point de controle', 'controle', 'processus', 'etape'],
  passenger_group_code: ['passenger group code', 'group code', 'group', 'group id', 'pax group', 'code',
    'groupe', 'code groupe', 'id groupe', 'numero groupe', 'n groupe', 'passenger id', 'id'],
  pax: ['pax', 'passengers', 'nb pax', 'number of passengers', 'pax count', 'group size', 'persons',
    'passagers', 'nombre de passagers', 'nombre pax', 'nb passagers', 'taille groupe', 'personnes'],
  flight_no: ['flight', 'flight no', 'flight number', 'flight nb', 'flt', 'flight num',
    'vol', 'numero de vol', 'n vol', 'no vol', 'num vol'],
  counter: ['counter', 'desk', 'lane', 'counter no', 'desk no', 'booth', 'gate', 'server',
    'comptoir', 'guichet', 'file', 'poste de travail', 'n comptoir', 'banque', 'aubette'],
  arrival_time: ['arrival', 'arrival time', 'time of arrival', 'arrival hour', 'queue entry', 'entry time', 'arrived',
    'arrivee', 'heure arrivee', 'heure d arrivee', 'heure de arrivee', 'entree file', 'heure entree'],
  service_start: ['service start', 'start service', 'service begin', 'start', 'start time', 'begin service', 'served at', 'svc start', 'svc begin',
    'debut service', 'debut du service', 'heure debut', 'debut traitement', 'prise en charge', 'heure de prise en charge'],
  service_end: ['service end', 'end service', 'end', 'end time', 'service finish', 'finish', 'completed', 'departure', 'svc end',
    'fin service', 'fin du service', 'heure fin', 'fin traitement', 'sortie', 'heure de sortie'],
  observer: ['observer', 'collector', 'recorded by', 'agent', 'staff', 'surveyor',
    'observateur', 'agent observateur', 'releve par', 'enqueteur', 'saisi par'],
});

/** Lowercase, strip accents and punctuation, collapse whitespace. */
function normalizeHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function jaro(a, b) {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - window);
    const end = Math.min(i + window + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (!bMatches[j] && a[i] === b[j]) {
        aMatches[i] = true;
        bMatches[j] = true;
        matches += 1;
        break;
      }
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  return (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;
}

/** Jaro-Winkler similarity in [0, 1]. */
function jaroWinkler(a, b) {
  const j = jaro(a, b);
  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix += 1;
  return j + prefix * 0.1 * (1 - j);
}

const NORMALIZED_SYNONYMS = Object.fromEntries(
  Object.entries(SYNONYMS).map(([field, list]) => [field, [...new Set([normalizeHeader(field), ...list.map(normalizeHeader)])]]),
);

/** Best score of one normalised header against one field. */
function scoreHeader(normalized, field) {
  if (normalized === '') return { score: 0, method: null };
  if (NORMALIZED_SYNONYMS[field].includes(normalized)) return { score: 1, method: 'synonym' };
  let best = 0;
  for (const synonym of NORMALIZED_SYNONYMS[field]) best = Math.max(best, jaroWinkler(normalized, synonym));
  return { score: best, method: 'similarity' };
}

/**
 * Proposes a mapping for a header row.
 * Returns { mapping: { field: { index, header, confidence, method } | null },
 *           unmatched: [{ index, header }] }.
 */
function matchHeaders(headers, { threshold = DEFAULT_THRESHOLD } = {}) {
  const candidates = [];
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    for (const field of TARGET_FIELDS) {
      const { score, method } = scoreHeader(normalized, field);
      if (score >= threshold) candidates.push({ field, index, header: String(header), confidence: Number(score.toFixed(3)), method, specificity: normalized.length });
    }
  });
  // Highest confidence first; on ties prefer the more specific (longer)
  // header, so "Service start" beats a bare "Start", then earlier columns.
  candidates.sort((x, y) => y.confidence - x.confidence || y.specificity - x.specificity || x.index - y.index);

  const mapping = Object.fromEntries(TARGET_FIELDS.map((field) => [field, null]));
  const usedColumns = new Set();
  for (const candidate of candidates) {
    if (mapping[candidate.field] || usedColumns.has(candidate.index)) continue;
    const { field, specificity: _specificity, ...rest } = candidate;
    mapping[field] = rest;
    usedColumns.add(candidate.index);
  }
  const unmatched = headers
    .map((header, index) => ({ index, header: String(header ?? '') }))
    .filter(({ index, header }) => !usedColumns.has(index) && header.trim() !== '');
  return { mapping, unmatched };
}

module.exports = {
  TARGET_FIELDS, REQUIRED_FIELDS, SYNONYMS, DEFAULT_THRESHOLD, normalizeHeader, jaroWinkler, matchHeaders,
};
