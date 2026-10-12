'use strict';

const express = require('express');
const { validate, v } = require('../middleware/validate');
const { requireRole, ANY_ROLE } = require('../middleware/rbac');

const fields = (optional) => ({
  name: v.string({ max: 80, optional }),
  area: v.string({ max: 120, optional: true, nullable: true }),
  servers: v.int({ min: 1, max: 500, optional }),
  sla_wait_minutes: v.number({ exclusiveMin: 0, max: 1440, optional }),
  active: v.bool({ optional: true }),
});

function checkpointRoutes({ services }) {
  const router = express.Router();
  const admin = requireRole('admin');

  // Everyone signed in needs the list (session forms, filters).
  router.get('/', requireRole(...ANY_ROLE), (_req, res) => {
    res.json({ items: services.checkpoints.list() });
  });

  router.get('/:id', requireRole(...ANY_ROLE), validate({ params: { id: v.id() } }), (req, res) => {
    res.json({ checkpoint: services.checkpoints.get(req.valid.params.id) });
  });

  router.post('/', admin, validate({ body: { ...fields(false), servers: v.int({ min: 1, max: 500, default: 1 }) } }), (req, res) => {
    res.status(201).json({ checkpoint: services.checkpoints.create(req.user, req.valid.body) });
  });

  // Checkpoints are never deleted (sessions reference them); set active=false instead.
  router.patch('/:id', admin, validate({ params: { id: v.id() }, body: fields(true) }), (req, res) => {
    res.json({ checkpoint: services.checkpoints.update(req.user, req.valid.params.id, req.valid.body) });
  });

  return router;
}

module.exports = { checkpointRoutes };
