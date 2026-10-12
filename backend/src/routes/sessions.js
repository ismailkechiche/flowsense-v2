'use strict';

const express = require('express');
const { validate, v, pagination } = require('../middleware/validate');
const { requireRole, ANY_ROLE } = require('../middleware/rbac');
const { SHIFTS } = require('../domain/shifts');
const { observationBody } = require('./observations');

const sessionFields = (optional) => ({
  name: v.string({ max: 120, optional }),
  date: v.date({ optional }),
  checkpoint_id: v.id({ optional }),
  observer: v.string({ max: 120, optional: true, nullable: true }),
  notes: v.string({ max: 2000, optional: true, nullable: true }),
});

function sessionRoutes({ services }) {
  const router = express.Router();
  const writers = requireRole('collector', 'admin');
  const idParam = { id: v.id() };

  router.get('/', requireRole(...ANY_ROLE), validate({
    query: {
      ...pagination,
      checkpoint_id: v.id({ optional: true }),
      from: v.date({ optional: true }),
      to: v.date({ optional: true }),
      shift: v.oneOf(SHIFTS, { optional: true }),
    },
  }), (req, res) => {
    const { page, page_size: pageSize, checkpoint_id: checkpointId, from, to, shift } = req.valid.query;
    res.json(services.sessions.list({ checkpointId, from, to, shift }, { page, page_size: pageSize }));
  });

  router.post('/', writers, validate({ body: sessionFields(false) }), (req, res) => {
    res.status(201).json({ session: services.sessions.create(req.user, req.valid.body) });
  });

  router.get('/:id', requireRole(...ANY_ROLE), validate({ params: idParam }), (req, res) => {
    res.json({ session: services.sessions.get(req.valid.params.id) });
  });

  router.patch('/:id', writers, validate({ params: idParam, body: sessionFields(true) }), (req, res) => {
    res.json({ session: services.sessions.update(req.user, req.valid.params.id, req.valid.body) });
  });

  router.delete('/:id', requireRole('admin'), validate({ params: idParam }), (req, res) => {
    services.sessions.remove(req.user, req.valid.params.id);
    res.status(204).end();
  });

  router.get('/:id/observations', requireRole(...ANY_ROLE), validate({ params: idParam, query: pagination }), (req, res) => {
    res.json(services.observations.listForSession(req.valid.params.id, req.valid.query));
  });

  router.post('/:id/observations', writers, validate({ params: idParam, body: observationBody }), (req, res) => {
    res.status(201).json({ observation: services.observations.create(req.user, req.valid.params.id, req.valid.body) });
  });

  return router;
}

module.exports = { sessionRoutes };
