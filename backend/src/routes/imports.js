'use strict';

const express = require('express');
const { validate, v, pagination, fail } = require('../middleware/validate');
const { requireRole } = require('../middleware/rbac');
const { TARGET_FIELDS } = require('../domain/headerMatch');

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

const mappingRule = v.custom((raw) => {
  if (!isPlainObject(raw)) fail('must be an object of field → column index');
  for (const [field, index] of Object.entries(raw)) {
    if (!TARGET_FIELDS.includes(field)) fail(`"${field}" is not a known field`);
    if (index !== null && !(Number.isInteger(index) && index >= 0 && index < 500)) fail(`column for ${field} must be a column index or null`);
  }
  return raw;
}, { optional: true });

const checkpointValuesRule = v.custom((raw) => {
  if (!isPlainObject(raw)) fail('must be an object of sheet value → checkpoint id');
  for (const [value, id] of Object.entries(raw)) {
    if (value.length > 100) fail('sheet values must be at most 100 characters');
    if (!Number.isInteger(id) || id < 1) fail(`checkpoint for "${value}" must be a checkpoint id`);
  }
  return raw;
}, { optional: true });

const targetsRule = v.custom((raw) => {
  if (!Array.isArray(raw) || raw.length > 500) fail('must be a list of session targets');
  return raw.map((t) => {
    if (!isPlainObject(t) || typeof t.key !== 'string' || t.key.length > 64) fail('each target needs a group key');
    if (t.mode === 'new') {
      if (t.name !== undefined && (typeof t.name !== 'string' || t.name.length > 120)) fail('session name must be text up to 120 characters');
      return { key: t.key, mode: 'new', name: t.name };
    }
    if (t.mode === 'existing') {
      if (!Number.isInteger(t.session_id) || t.session_id < 1) fail('appending needs a session_id');
      return { key: t.key, mode: 'existing', session_id: t.session_id };
    }
    return fail('mode must be "new" or "existing"');
  });
}, { optional: true });

const choices = {
  sheet: v.int({ min: 0, max: 200, optional: true }),
  mapping: mappingRule,
  checkpoint_values: checkpointValuesRule,
  file_checkpoint_id: v.id({ optional: true, nullable: true }),
};

function importRoutes({ services }) {
  const router = express.Router();
  const importers = requireRole('collector', 'admin');
  const admin = requireRole('admin');

  // The file is the raw request body; its name comes in the query string.
  router.post('/preview', importers,
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    validate({ query: { filename: v.string({ max: 255 }) } }),
    (req, res) => {
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      res.status(201).json({ preview: services.imports.preview(req.user, { filename: req.valid.query.filename, buffer }) });
    });

  router.post('/previews/:previewId', importers, validate({
    params: { previewId: v.string({ max: 64, pattern: /^[\w-]+$/ }) },
    body: choices,
  }), (req, res) => {
    res.json({ preview: services.imports.refresh(req.user, req.valid.params.previewId, req.valid.body) });
  });

  router.post('/previews/:previewId/commit', importers, validate({
    params: { previewId: v.string({ max: 64, pattern: /^[\w-]+$/ }) },
    body: { ...choices, targets: targetsRule, confirm_duplicate: v.bool({ optional: true }) },
  }), (req, res) => {
    res.status(201).json({ batch: services.imports.commit(req.user, req.valid.params.previewId, req.valid.body) });
  });

  router.get('/', admin, validate({ query: pagination }), (req, res) => {
    res.json(services.imports.list(req.valid.query));
  });

  router.get('/:id/rollback', admin, validate({ params: { id: v.id() } }), (req, res) => {
    res.json(services.imports.rollbackCheck(req.valid.params.id));
  });

  router.post('/:id/rollback', admin, validate({
    params: { id: v.id() },
    body: { confirm_added_rows: v.bool({ optional: true }) },
  }), (req, res) => {
    res.json({ batch: services.imports.rollback(req.user, req.valid.params.id, req.valid.body) });
  });

  return router;
}

module.exports = { importRoutes, MAX_UPLOAD_BYTES };
