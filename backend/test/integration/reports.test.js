'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { createTestApp } = require('../helpers/testApp');
const { pdfText } = require('../helpers/pdfText');
const { SECURITY, GATE, seed } = require('../helpers/analyticsFixture');

/** Reads a binary response body into a Buffer. */
function binary(res, callback) {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

const RANGE = { from: '2026-05-01', to: '2026-05-31' };
const section = (title, extra = {}) => ({ rows: 'checkpoint', metrics: ['avg_wait', 'pax_total'], visualization: 'table', title, ...extra });

describe('PDF reports', () => {
  let t;
  let analyst;
  let sessionIds;
  const report = (body) => t.as(analyst).post('/api/reports').send(body).buffer(true).parse(binary);

  before(() => {
    t = createTestApp();
    const admin = t.createUser({ role: 'admin' });
    analyst = t.createUser({ role: 'analyst', name: 'Ana Lyst' });
    sessionIds = seed(t, admin, [
      ...require('../helpers/analyticsFixture').SESSIONS,
      { name: 'Gate rush', date: '2026-05-01', checkpoint_id: GATE, rows: [
        [2, '10:00', '10:00', '10:05', 'G1', null],
        [2, '10:01', '10:05', '10:10', 'G1', null],
        [2, '10:02', '10:10', '10:15', 'G1', null],
      ] },
    ]);
  });

  test('streams an A4 PDF with the fixed parts, then the pivot sections in the order given', async () => {
    const sections = [
      section('Alpha view'),
      section('Bravo view', { rows: 'hour', columns: 'checkpoint', metrics: ['pax_total', 'avg_wait'], visualization: 'bar' }),
      section('Charlie view', { rows: 'date', metrics: ['avg_wait', 'sla_compliance'], visualization: 'line' }),
    ];
    const res = await report({ scope: RANGE, sections, title: 'May review' });
    assert.equal(res.status, 200, res.body.toString().slice(0, 300));
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.match(res.headers['content-disposition'], /^attachment; filename="flowsense-report-2026-05-01_2026-05-31-\d{8}-\d{4}\.pdf"$/);
    assert.equal(res.body.subarray(0, 5).toString(), '%PDF-');
    assert.match(res.body.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/); // A4

    const cover = pdfText(res.body)[0];
    for (const marker of ['FLOWSENSE', 'May review', 'Ana Lyst']) assert.ok(cover.includes(marker), `cover lacks "${marker}"`);
    // The body comes after the cover (whose contents list names the sections too).
    const text = pdfText(res.body).slice(1).join('\n');
    const order = ['Key findings', 'KPI summary', 'By checkpoint', 'By hour of day',
      'Daily trend', 'Wait time distribution', 'Flights and counters', 'SLA breach details',
      'Staffing recommendations (M/M/c)', 'Reasoning', '1. Alpha view', '2. Bravo view', '3. Charlie view', 'Glossary'];
    let last = -1;
    for (const marker of order) {
      const at = text.indexOf(marker, last + 1);
      assert.ok(at > last, `"${marker}" missing or out of order`);
      last = at;
    }
    assert.match(text, /OVERLOADED: Boarding Gate/);
    assert.match(text, /Busiest hour: \d\d:00 with \d+ passengers/, 'written summary');
    assert.match(text, /Security: about \d+ passengers arrive per hour/, 'staffing reasoning');
    assert.match(text, /Recommendation:/);

    // Hafedh's rule: a chart section shows only the chart, a table section only the table.
    const between = (from, to) => text.slice(text.indexOf(from), to ? text.indexOf(to) : undefined).split('\n');
    assert.ok(between('1. Alpha view', '2. Bravo view').includes('Checkpoint'), 'table section has its header row');
    const bravo = between('2. Bravo view', '3. Charlie view');
    assert.ok(!bravo.includes('Hour'), 'bar chart section has no table header row');
    assert.ok(bravo.includes('Security') && bravo.includes('10:00'), 'bar chart legend and categories are drawn');
    assert.ok(!between('3. Charlie view', 'Glossary').includes('Date'), 'line chart section has no table');
    assert.match(text, /\(!\) 16\.9/, 'Security avg wait above SLA is marked');
    const pages = pdfText(res.body).length;
    assert.ok(pages >= 2);
    assert.match(cover, new RegExp(`Page 1 of ${pages}`));
    assert.match(text, new RegExp(`Page ${pages} of ${pages}`));
  });

  test('section order follows the request: reordering the draft reorders the PDF', async () => {
    const res = await report({ scope: RANGE, sections: [section('Charlie view'), section('Alpha view'), section('Bravo view')] });
    const text = pdfText(res.body).join('\n');
    assert.ok(text.indexOf('1. Charlie view') < text.indexOf('2. Alpha view'));
    assert.ok(text.indexOf('2. Alpha view') < text.indexOf('3. Bravo view'));
  });

  test('a single-session scope, and a report without pivot sections', async () => {
    const res = await report({ scope: { session_id: sessionIds[0] } });
    assert.equal(res.status, 200);
    assert.match(res.headers['content-disposition'], new RegExp(`flowsense-report-session-${sessionIds[0]}-`));
    const text = pdfText(res.body).join('\n');
    assert.match(text, /Session "Security day 1"/);
    assert.ok(!text.includes('Passport Control'), 'other sessions are out of scope');
  });

  test('long tables flow onto new pages with the header repeated', async () => {
    const t2 = createTestApp();
    const admin = t2.createUser({ role: 'admin' });
    const session = t2.services.sessions.create(admin, { name: 'Many flights', date: '2026-05-03', checkpoint_id: SECURITY });
    for (let i = 0; i < 120; i += 1) {
      const m = String(i % 60).padStart(2, '0');
      const h = String(8 + Math.floor(i / 60)).padStart(2, '0');
      t2.services.observations.create(admin, session.id, { pax: 1, flight_no: `FL${String(i).padStart(3, '0')}`,
        arrival_time: `2026-05-03T${h}:${m}:00`, service_start: `2026-05-03T${h}:${m}:30`, service_end: `2026-05-03T${h}:${m}:50` });
    }
    const res = await t2.as(admin).post('/api/reports').send({ scope: { session_id: session.id }, sections: [section('Every flight', { rows: 'flight_no', metrics: ['pax_total'] })] })
      .buffer(true).parse(binary);
    assert.equal(res.status, 200);
    const pages = pdfText(res.body);
    // The pivot section's pages (the built-in flight breakdown lists only the busiest).
    const start = pages.findIndex((p) => p.includes('1. Every flight'));
    const withRows = pages.slice(start).filter((p) => /FL\d{3}/.test(p));
    assert.ok(withRows.length >= 2, `flight table spans ${withRows.length} page(s)`);
    for (const page of withRows) assert.match(page, /Flight\nPassengers \(pax\)/, 'header repeated on each page');
    assert.match(pages.join('\n'), /FL119/);
  });

  test('bad requests are JSON errors, never a broken PDF', async () => {
    const cases = [
      [{ sections: [] }, 400, 'validation_error'],
      [{ scope: { from: '2026-05-01' } }, 400, 'validation_error'],
      [{ scope: { from: '2026-05-31', to: '2026-05-01' } }, 400, 'validation_error'],
      [{ scope: { session_id: 1, from: '2026-05-01', to: '2026-05-02' } }, 400, 'validation_error'],
      [{ scope: RANGE, sections: [section('ok'), { rows: 'hour; DROP TABLE users', metrics: ['avg_wait'] }] }, 400, 'unknown_pivot_key'],
      [{ scope: RANGE, sections: Array.from({ length: 21 }, (_, i) => section(`S${i}`)) }, 400, 'validation_error'],
      [{ scope: { session_id: 99999 } }, 404, 'not_found'],
      [{ scope: RANGE, data: [[1, 2]] }, 400, 'validation_error'],
    ];
    for (const [body, status, code] of cases) {
      const res = await t.as(analyst).post('/api/reports').send(body);
      assert.equal(res.status, status, JSON.stringify(body));
      assert.match(res.headers['content-type'], /json/);
      assert.equal(res.body.error.code, code, JSON.stringify(res.body));
    }
    const bad = await t.as(analyst).post('/api/reports').send({ scope: RANGE, sections: [section('ok'), { rows: 'hour; DROP TABLE users', metrics: ['avg_wait'] }] });
    assert.equal(bad.body.error.details[0].field, 'sections[1].rows');
  });
});
