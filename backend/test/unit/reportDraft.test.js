'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// The frontend module is plain ES and touches no DOM, so it runs in Node.
const load = () => import(pathToFileURL(path.join(__dirname, '../../../frontend/js/reportDraft.js')).href);

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data };
}

test('builder and draft reset only after a successful download', async () => {
  const { generateAndReset } = await load();
  const calls = [];
  const file = { blob: 'pdf-bytes', filename: 'r.pdf' };
  const result = await generateAndReset({
    request: async () => { calls.push('request'); return file; },
    save: (f) => calls.push(`save ${f.filename}`),
    reset: () => calls.push('reset'),
  });
  assert.equal(result, file);
  assert.deepEqual(calls, ['request', 'save r.pdf', 'reset']);
});

test('a failed generation or download keeps everything (no reset)', async () => {
  const { generateAndReset } = await load();
  for (const failing of ['request', 'save']) {
    let reset = false;
    await assert.rejects(generateAndReset({
      request: async () => { if (failing === 'request') throw new Error('400'); return { blob: 1, filename: 'x' }; },
      save: () => { if (failing === 'save') throw new Error('blocked'); },
      reset: () => { reset = true; },
    }));
    assert.equal(reset, false, `no reset when ${failing} fails`);
  }
});

test('the draft keeps configurations in order, survives a reload, and clears', async () => {
  const { createReportDraft } = await load();
  const storage = memoryStorage();
  const draft = createReportDraft(storage);
  draft.add({ title: 'A' });
  draft.add({ title: 'B' });
  draft.add({ title: 'C' });
  draft.move(2, -1);
  draft.move(0, -1); // no-op at the top
  assert.deepEqual(draft.sections().map((s) => s.title), ['A', 'C', 'B']);
  draft.remove(0);
  const reloaded = createReportDraft(storage);
  assert.deepEqual(reloaded.sections().map((s) => s.title), ['C', 'B']);
  reloaded.clear();
  assert.equal(reloaded.size, 0);
  assert.equal(createReportDraft(storage).size, 0);
});

test('the draft still works when storage is unavailable', async () => {
  const { createReportDraft } = await load();
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  const draft = createReportDraft(broken);
  draft.add({ title: 'A' });
  assert.equal(draft.size, 1);
  draft.clear();
  assert.equal(draft.size, 0);
});
