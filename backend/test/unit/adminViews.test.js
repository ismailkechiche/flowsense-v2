'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// These helpers are plain ES and touch no DOM until a view renders.
const load = (name) => import(pathToFileURL(path.join(__dirname, '../../../frontend/js/views', name)).href);

test('audit details: changed fields only for before/after, plain pairs otherwise', async () => {
  const { detailLines } = await load('audit.js');
  assert.deepEqual(detailLines({
    before: { name: 'Security', sla_wait_minutes: 12, active: true },
    after: { name: 'Security', sla_wait_minutes: 8, active: true },
  }), ['sla_wait_minutes: 12 → 8']);
  assert.deepEqual(detailLines({ file: 'flowsense-2026-10-12-0930.db', pruned: [], role: null }),
    ['file: flowsense-2026-10-12-0930.db', 'pruned: []', 'role: —']);
  assert.deepEqual(detailLines({ before: 'collector' }), ['before: collector']);
  assert.deepEqual(detailLines({ after: { id: 5, name: 'Transfer' } }), ['id: 5', 'name: Transfer']);
  assert.deepEqual(detailLines({}), []);
  assert.deepEqual(detailLines(null), []);
});

test('backup sizes', async () => {
  const { formatSize } = await load('backups.js');
  assert.equal(formatSize(512), '512 B');
  assert.equal(formatSize(2048), '2.0 KB');
  assert.equal(formatSize(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatSize(300 * 1024 * 1024), '300 MB');
});

test('audit targets', async () => {
  const { targetText } = await load('audit.js');
  assert.equal(targetText({ target_type: 'checkpoint', target_id: 5, target_name: 'Transfer' }), 'checkpoint #5 · Transfer');
  assert.equal(targetText({ target_type: 'import_batch', target_id: 2, target_name: null }), 'import batch #2');
  assert.equal(targetText({ target_type: 'backup', target_id: null, target_name: 'flowsense-2026-10-12-0930.db' }), 'flowsense-2026-10-12-0930.db');
  assert.equal(targetText({ target_type: null }), '—');
});
