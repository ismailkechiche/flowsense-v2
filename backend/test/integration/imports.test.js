'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTestApp } = require('../helpers/testApp');

const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', name));

function setup() {
  const t = createTestApp();
  const admin = t.createUser({ role: 'admin' });
  const collector = t.createUser({ role: 'collector' });
  const other = t.createUser({ role: 'collector' });
  const count = (table) => t.db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get();

  async function upload(user, name, buffer = fixture(name)) {
    return t.as(user).post(`/api/imports/preview?filename=${encodeURIComponent(name)}`)
      .set('Content-Type', 'application/octet-stream').send(buffer);
  }
  async function preview(user, name) {
    const res = await upload(user, name);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.preview;
  }
  const commit = (user, previewId, body = {}) => t.as(user).post(`/api/imports/previews/${previewId}/commit`).send(body);
  return { t, admin, collector, other, count, upload, preview, commit };
}

describe('preview', () => {
  test('writes nothing and shows mapping, groups, rejected rows', async () => {
    const { collector, count, preview } = setup();
    const before = ['sessions', 'observations', 'import_batches', 'audit_log'].map(count);
    const p = await preview(collector, 'bad-rows.xlsx');
    assert.deepEqual(['sessions', 'observations', 'import_batches', 'audit_log'].map(count), before);

    assert.equal(p.mapping.arrival_time.header, 'Arrival');
    assert.equal(p.mapping.arrival_time.confidence, 1);
    assert.equal(p.accepted_count, 2);
    assert.equal(p.rejected_count, 5);
    assert.deepEqual(p.rejected_rows.map((r) => r.rowNumber), [3, 4, 5, 7, 8]);
    assert.match(p.rejected_rows.find((r) => r.rowNumber === 8).reasons[0], /"Lounge" does not match/);
    assert.deepEqual(p.unknown_checkpoint_values, ['Lounge']);
    assert.match(p.midnight_rule, /next day/);
    assert.equal(p.can_commit, true);
    assert.equal(p.duplicate, null);
  });

  test('messy headers in a second sheet are found and mapped', async () => {
    const { collector, preview } = setup();
    const p = await preview(collector, 'messy-headers.xlsx');
    assert.deepEqual(p.sheets.map((s) => s.name), ['Notes', 'Observations']);
    assert.equal(p.sheet, 1);
    assert.equal(p.mapping.date.header, 'Dep Date');
    assert.equal(p.mapping.observer.header, 'Observateur');
    assert.deepEqual(p.groups.map((g) => [g.date, g.checkpoint_name, g.row_count, g.pax_total]), [['2026-05-01', 'Security', 3, 11]]);
  });

  test('legacy .xls with serial date-times and no date column', async () => {
    const { collector, preview } = setup();
    const p = await preview(collector, 'serial-dates.xls');
    assert.deepEqual(p.groups.map((g) => [g.date, g.checkpoint_name, g.shift]), [['2026-05-04', 'Boarding Gate', 'afternoon']]);
  });

  test('French CSV needs a file-level checkpoint, then imports', async () => {
    const { t, collector, preview } = setup();
    const p = await preview(collector, 'french-headers.csv');
    assert.equal(p.can_commit, false);
    assert.match(p.blocking_reasons.join(), /choose the checkpoint/);
    assert.equal(p.mapping.arrival_time.header, "Heure d'arrivée");
    const refreshed = (await t.as(collector).post(`/api/imports/previews/${p.preview_id}`).send({ file_checkpoint_id: 3 })).body.preview;
    assert.equal(refreshed.can_commit, true);
    assert.deepEqual(refreshed.groups.map((g) => [g.date, g.checkpoint_name, g.row_count]), [['2026-05-03', 'Passport Control', 3]]);
  });

  test('midnight crossings are counted and resolved', async () => {
    const { collector, preview } = setup();
    const p = await preview(collector, 'midnight-crossing.xlsx');
    assert.equal(p.midnight_crossings, 3);
    assert.equal(p.rejected_count, 0);
    assert.equal(p.groups[0].shift, 'night');
  });

  test('mapping overrides: unmapping a required column blocks; remapping a checkpoint value fixes rows', async () => {
    const { t, collector, preview } = setup();
    const p = await preview(collector, 'bad-rows.xlsx');
    const unmapped = (await t.as(collector).post(`/api/imports/previews/${p.preview_id}`).send({ mapping: { pax: null } })).body.preview;
    assert.equal(unmapped.can_commit, false);
    assert.deepEqual(unmapped.missing_fields, ['pax']);
    const lounge = (await t.as(collector).post(`/api/imports/previews/${p.preview_id}`).send({ checkpoint_values: { Lounge: 1 } })).body.preview;
    assert.equal(lounge.accepted_count, 3);
    assert.deepEqual(lounge.groups.map((g) => g.checkpoint_name).sort(), ['Check-in', 'Security']);
    const twice = await t.as(collector).post(`/api/imports/previews/${p.preview_id}`).send({ mapping: { pax: 0 } });
    assert.equal(twice.status, 400);
    assert.match(twice.body.error.message, /mapped to both/);
  });

  test('upload limits and file types', async () => {
    const { collector, upload } = setup();
    const big = await upload(collector, 'big.csv', Buffer.alloc(10 * 1024 * 1024 + 1, 'a'));
    assert.equal(big.status, 413);
    assert.equal((await upload(collector, 'notes.txt', Buffer.from('a,b,c'))).status, 400);
    assert.equal((await upload(collector, 'empty.csv', Buffer.alloc(0))).status, 400);
    const noHeader = await upload(collector, 'x.csv', Buffer.from('1\n2\n'));
    assert.equal(noHeader.body.error.code, 'no_header_row');
  });

  test('a preview belongs to its uploader', async () => {
    const { t, collector, other, preview, commit } = setup();
    const p = await preview(collector, 'bad-rows.xlsx');
    assert.equal((await t.as(other).post(`/api/imports/previews/${p.preview_id}`).send({})).status, 404);
    assert.equal((await commit(other, p.preview_id)).status, 404);
  });
});

describe('commit', () => {
  test('two checkpoints on one date produce two sessions (plus one for the second date)', async () => {
    const { t, collector, count, preview, commit } = setup();
    const p = await preview(collector, 'two-checkpoints-one-date.xlsx');
    assert.equal(p.groups.length, 3);
    const res = await commit(collector, p.preview_id);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const batch = res.body.batch;
    assert.equal(batch.status, 'committed');
    assert.equal(batch.row_count, 5);
    assert.equal(batch.session_ids.length, 3);

    const sessions = t.db.prepare('SELECT name, date, checkpoint_id, import_batch_id, shift FROM sessions ORDER BY id').all();
    assert.deepEqual(sessions.map((s) => [s.name, s.date, s.checkpoint_id]), [
      ['Security — 2026-05-01', '2026-05-01', 2],
      ['Passport Control — 2026-05-01', '2026-05-01', 3],
      ['Security — 2026-05-02', '2026-05-02', 2],
    ]);
    assert.ok(sessions.every((s) => s.import_batch_id === batch.id && s.shift));
    assert.equal(count('observations'), 5);
    assert.equal(t.db.prepare('SELECT COUNT(*) FROM observations WHERE import_batch_id = ?').pluck().get(batch.id), 5);
    const [audit] = t.repos.audit.listByAction('import_committed');
    assert.equal(audit.target_id, batch.id);
    assert.equal(audit.details.sessions_created, 3);
    // Committed previews cannot be reused.
    assert.equal((await commit(collector, p.preview_id)).status, 404);
  });

  test('a second import never pre-selects the previous session; duplicates need confirmation', async () => {
    const { t, collector, preview, commit } = setup();
    const first = await preview(collector, 'two-checkpoints-one-date.xlsx');
    await commit(collector, first.preview_id);

    const second = await preview(collector, 'two-checkpoints-one-date.xlsx');
    assert.ok(second.duplicate);
    for (const group of second.groups) {
      assert.deepEqual(group.default_target, { mode: 'new', name: group.proposed_name });
      assert.equal(group.existing_sessions.length, 1, 'the earlier session is offered, not selected');
    }
    const refused = await commit(collector, second.preview_id);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'duplicate_import');

    const ok = await commit(collector, second.preview_id, { confirm_duplicate: true });
    assert.equal(ok.status, 201);
    assert.equal(t.db.prepare('SELECT COUNT(*) FROM sessions').pluck().get(), 6, 'new sessions, nothing appended');
  });

  test('appending is limited to sessions with the same checkpoint and date', async () => {
    const { t, collector, preview, commit } = setup();
    const target = (await t.as(collector).post('/api/sessions').send({ name: 'Manual security', date: '2026-05-01', checkpoint_id: 2 })).body.session;
    const wrongDate = (await t.as(collector).post('/api/sessions').send({ name: 'Other day', date: '2026-05-02', checkpoint_id: 3 })).body.session;
    const p = await preview(collector, 'two-checkpoints-one-date.xlsx');
    const securityKey = '2026-05-01|2';
    const passportKey = '2026-05-01|3';
    assert.deepEqual(p.groups.find((g) => g.key === securityKey).existing_sessions.map((s) => s.id), [target.id]);
    assert.deepEqual(p.groups.find((g) => g.key === passportKey).existing_sessions, []);

    const mismatch = await commit(collector, p.preview_id, { targets: [{ key: passportKey, mode: 'existing', session_id: target.id }] });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.body.error.code, 'target_mismatch');
    const mismatchDate = await commit(collector, p.preview_id, { targets: [{ key: passportKey, mode: 'existing', session_id: wrongDate.id }] });
    assert.equal(mismatchDate.body.error.code, 'target_mismatch');
    assert.equal(t.db.prepare('SELECT COUNT(*) FROM observations').pluck().get(), 0);

    const ok = await commit(collector, p.preview_id, { targets: [{ key: securityKey, mode: 'existing', session_id: target.id }, { key: passportKey, mode: 'new', name: 'PC morning' }] });
    assert.equal(ok.status, 201);
    assert.equal(t.db.prepare('SELECT COUNT(*) FROM observations WHERE session_id = ?').pluck().get(target.id), 2);
    assert.ok(t.db.prepare("SELECT 1 FROM sessions WHERE name = 'PC morning'").get());
    assert.deepEqual(ok.body.batch.split_summary.map((s) => s.mode).sort(), ['appended', 'created', 'created']);
  });

  test('collectors cannot append to someone else’s session', async () => {
    const { t, collector, other, preview, commit } = setup();
    const theirs = (await t.as(other).post('/api/sessions').send({ name: 'Theirs', date: '2026-05-01', checkpoint_id: 2 })).body.session;
    const p = await preview(collector, 'two-checkpoints-one-date.xlsx');
    assert.deepEqual(p.groups.find((g) => g.key === '2026-05-01|2').existing_sessions, []);
    const res = await commit(collector, p.preview_id, { targets: [{ key: '2026-05-01|2', mode: 'existing', session_id: theirs.id }] });
    assert.equal(res.status, 403);
  });

  test('a commit that fails midway leaves zero rows', async () => {
    const { t, collector, count, preview, commit } = setup();
    const p = await preview(collector, 'two-checkpoints-one-date.xlsx');
    const original = t.repos.observations.insert;
    let calls = 0;
    t.repos.observations.insert = (row) => {
      calls += 1;
      if (calls === 4) throw new Error('disk full');
      return original(row);
    };
    try {
      const res = await commit(collector, p.preview_id);
      assert.equal(res.status, 500);
    } finally {
      t.repos.observations.insert = original;
    }
    assert.equal(calls, 4);
    for (const table of ['sessions', 'observations', 'import_batches']) assert.equal(count(table), 0, table);
    assert.equal(t.repos.audit.listByAction('import_committed').length, 0);
    // The preview survives a failed commit, so the user can retry.
    assert.equal((await commit(collector, p.preview_id)).status, 201);
  });

  test('blocked previews cannot be committed', async () => {
    const { collector, preview, commit } = setup();
    const p = await preview(collector, 'french-headers.csv');
    const res = await commit(collector, p.preview_id);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'import_blocked');
  });
});

describe('rollback (admin)', () => {
  test('removes exactly what the batch created, after confirming rows added later', async () => {
    const { t, admin, collector, count, preview, commit } = setup();
    // Unrelated manual data that must survive.
    const manual = (await t.as(collector).post('/api/sessions').send({ name: 'Manual', date: '2026-05-01', checkpoint_id: 2 })).body.session;
    await t.as(collector).post(`/api/sessions/${manual.id}/observations`).send({ pax: 1, arrival_time: '2026-05-01T07:00', service_start: '2026-05-01T07:01', service_end: '2026-05-01T07:02' });

    // Batch A: creates three sessions, but appends its Security rows to the manual session.
    const pA = await preview(collector, 'two-checkpoints-one-date.xlsx');
    const batchA = (await commit(collector, pA.preview_id, { targets: [{ key: '2026-05-01|2', mode: 'existing', session_id: manual.id }] })).body.batch;
    assert.equal(batchA.session_ids.length, 2);
    const passportSession = batchA.split_summary.find((s) => s.key === '2026-05-01|3').session_id;

    // Later, someone adds a row by hand to one of batch A's sessions.
    await t.as(collector).post(`/api/sessions/${passportSession}/observations`).send({ pax: 2, arrival_time: '2026-05-01T09:00', service_start: '2026-05-01T09:01', service_end: '2026-05-01T09:02' });

    const check = (await t.as(admin).get(`/api/imports/${batchA.id}/rollback`)).body;
    assert.deepEqual(check.sessions_to_delete.sort(), batchA.session_ids.sort());
    assert.equal(check.batch_observation_count, 5);
    assert.equal(check.added_rows.length, 1);
    assert.equal(check.added_rows[0].session_id, passportSession);

    const unconfirmed = await t.as(admin).post(`/api/imports/${batchA.id}/rollback`).send({});
    assert.equal(unconfirmed.status, 409);
    assert.equal(unconfirmed.body.error.code, 'rollback_needs_confirmation');
    assert.equal(unconfirmed.body.error.details.added_rows.length, 1);
    assert.equal(count('observations'), 7);

    const res = await t.as(admin).post(`/api/imports/${batchA.id}/rollback`).send({ confirm_added_rows: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.batch.status, 'rolled_back');
    assert.equal(res.body.batch.rolled_back_by, admin.id);

    // Only the manual session and its own row remain.
    assert.deepEqual(t.db.prepare('SELECT id FROM sessions').pluck().all(), [manual.id]);
    assert.deepEqual(t.db.prepare('SELECT session_id, import_batch_id FROM observations').all(), [{ session_id: manual.id, import_batch_id: null }]);
    const [audit] = t.repos.audit.listByAction('import_rolled_back');
    assert.equal(audit.target_id, batchA.id);
    assert.equal(audit.details.sessions_deleted, 2);
    assert.equal(audit.details.batch_observations_deleted, 5);
    assert.equal(audit.details.added_observations_deleted, 1);

    assert.equal((await t.as(admin).post(`/api/imports/${batchA.id}/rollback`).send({})).status, 409);
    // A rolled-back file is no longer a duplicate.
    assert.equal((await preview(collector, 'two-checkpoints-one-date.xlsx')).duplicate, null);
  });

  test('only admins roll back; batches are listed for admins', async () => {
    const { t, admin, collector, preview, commit } = setup();
    const batch = (await commit(collector, (await preview(collector, 'bad-rows.xlsx')).preview_id)).body.batch;
    assert.equal((await t.as(collector).post(`/api/imports/${batch.id}/rollback`).send({})).status, 403);
    const list = (await t.as(admin).get('/api/imports')).body;
    assert.equal(list.total, 1);
    assert.equal(list.items[0].rejected_row_count, 5);
    assert.equal(list.items[0].uploaded_by_name, 'collector user');
  });
});
