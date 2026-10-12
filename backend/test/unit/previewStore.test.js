'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPreviewStore } = require('../../src/services/previewStore');

test('previews belong to their uploader and expire after the TTL', () => {
  let clock = 0;
  const store = createPreviewStore({ ttlMs: 1000, now: () => clock });
  const { id } = store.put(7, { rows: 1 });
  assert.deepEqual(store.get(id, 7).data, { rows: 1 });
  assert.throws(() => store.get(id, 8), /expired or does not exist/);
  clock = 999;
  assert.ok(store.get(id, 7));
  clock = 1000;
  assert.throws(() => store.get(id, 7), /expired or does not exist/);
  assert.equal(store.size(), 0);
});

test('ids are random and each user keeps at most five previews', () => {
  const store = createPreviewStore();
  const ids = Array.from({ length: 6 }, () => store.put(1, {}).id);
  assert.equal(new Set(ids).size, 6);
  assert.throws(() => store.get(ids[0], 1));
  assert.ok(store.get(ids[5], 1));
});
