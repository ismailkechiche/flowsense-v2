'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Pure helpers from the analytics screens; they touch no DOM.
const load = (name) => import(pathToFileURL(path.join(__dirname, '../../../frontend/js/views', name)).href);

test('filter period presets cover today and the days before it', async () => {
  const { periodRange, daysAgo } = await load('analyticsFilters.js');
  const today = new Date(2026, 9, 12); // 12 October 2026, local time
  assert.equal(daysAgo(0, today), '2026-10-12');
  assert.equal(daysAgo(12, today), '2026-09-30');
  assert.deepEqual(periodRange('7', today), { from: '2026-10-06', to: '2026-10-12' });
  assert.deepEqual(periodRange('30', today), { from: '2026-09-13', to: '2026-10-12' });
  assert.deepEqual(periodRange('all', today), { from: '', to: '' });
  assert.deepEqual(periodRange('custom', today), { from: '', to: '' });
});

test('simulator curve: from just below a stable count to a few past what is needed', async () => {
  const { curveCounts } = await load('simulator.js');
  // λ/μ = 4.2 → 5 is the first stable count; 6 open, 5 needed: 4 … 6 + 3.
  assert.deepEqual(curveCounts(1.26, 0.3, 6, 5), [4, 5, 6, 7, 8, 9, 10]);
  // Overloaded today (2 open, 5 needed): starts at 1, shows up to 5 + 3.
  assert.deepEqual(curveCounts(1.26, 0.3, 2, 5), [1, 2, 3, 4, 5, 6, 7, 8]);
  // Never more than 15 bars, never below 1.
  const many = curveCounts(30, 0.5, 70, 75);
  assert.equal(many.length, 15);
  assert.ok(many[0] >= 1);
});

test('dashboard key findings name the busiest hour, late and short-staffed checkpoints', async () => {
  const { keyFindings } = await load('dashboard.js');
  const lines = keyFindings({
    summary: { pax_total: 120, group_count: 50, avg_wait_minutes: 8.25, sla_compliance_pct: 75 },
    hourly: { items: [
      { hour: 8, pax_total: 30, avg_wait_minutes: 4 },
      { hour: 9, pax_total: 60, avg_wait_minutes: 9 },
      { hour: 10, pax_total: 30, avg_wait_minutes: 14 },
    ] },
    bottlenecks: { items: [
      { checkpoint_name: 'Security', avg_wait_minutes: 12, sla_wait_minutes: 10, sla_status: 'breach', c: 2, recommended_servers: 3 },
      { checkpoint_name: 'Gate', avg_wait_minutes: 1, sla_wait_minutes: 15, sla_status: 'ok', c: 2, recommended_servers: 1 },
    ] },
    trend: { items: [{ date: '2026-10-01', avg_wait_minutes: 5, sla_compliance_pct: 90 }, { date: '2026-10-02', avg_wait_minutes: 11, sla_compliance_pct: 60 }] },
  });
  const text = lines.join('\n');
  assert.match(text, /^120 passengers in 50 groups waited 8\.3 min/);
  assert.match(text, /Busiest hour: 09:00, with 60 passengers/);
  assert.match(text, /Longest waits at 10:00: 14\.0 min/);
  assert.match(text, /above the SLA at: Security \(12\.0 \/ 10 min\)/);
  assert.doesNotMatch(text, /Gate \(/);
  assert.match(text, /More counters needed to meet the SLA: Security \(2 → 3\)/);
  assert.match(text, /Worst day: 2026-10-02/);
  assert.deepEqual(keyFindings({ summary: { pax_total: 0 } }), []);
});
