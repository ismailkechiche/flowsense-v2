'use strict';

const express = require('express');
const { validate, v } = require('../middleware/validate');
const { requireRole } = require('../middleware/rbac');

/**
 * Body for manual entry. pax and the timestamps are optional here and
 * passed through as-is, so the domain row validator (spec §5.2) is what
 * reports missing or invalid values, with row-level reasons.
 */
const observationBody = Object.freeze({
  passenger_group_code: v.string({ max: 40, optional: true }),
  pax: v.scalar({ optional: true, nullable: true }),
  flight_no: v.string({ max: 20, optional: true, nullable: true }),
  counter: v.string({ max: 20, optional: true, nullable: true }),
  arrival_time: v.scalar({ optional: true, nullable: true }),
  service_start: v.scalar({ optional: true, nullable: true }),
  service_end: v.scalar({ optional: true, nullable: true }),
});

function observationRoutes({ services }) {
  const router = express.Router();
  const writers = requireRole('collector', 'admin');
  const idParam = { id: v.id() };

  router.patch('/:id', writers, validate({ params: idParam, body: observationBody }), (req, res) => {
    res.json({ observation: services.observations.update(req.user, req.valid.params.id, req.valid.body) });
  });

  router.delete('/:id', writers, validate({ params: idParam }), (req, res) => {
    services.observations.remove(req.user, req.valid.params.id);
    res.status(204).end();
  });

  return router;
}

module.exports = { observationRoutes, observationBody };
