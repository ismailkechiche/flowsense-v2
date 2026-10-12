'use strict';

const express = require('express');
const { validate, v } = require('../middleware/validate');
const { requireRole } = require('../middleware/rbac');
const { badRequest } = require('../domain/errors');
const { MAX_SERVERS } = require('../domain/queueing');

/** The filters every analytics endpoint accepts (spec §8). */
const filterQuery = {
  checkpoint_id: v.idList({ optional: true }),
  from: v.date({ optional: true }),
  to: v.date({ optional: true }),
  session_id: v.id({ optional: true }),
};

/** Turns validated query values into repository filters. */
function toFilters(query) {
  if (query.from && query.to && query.from > query.to) {
    throw badRequest('Some fields are invalid', [{ location: 'query', field: 'to', message: 'must be on or after from' }]);
  }
  return { checkpointIds: query.checkpoint_id ?? [], from: query.from, to: query.to, sessionId: query.session_id };
}

const analysts = () => requireRole('analyst', 'admin');

function analyticsRoutes({ services }) {
  const router = express.Router();
  const sections = {
    '/summary': (f) => services.analytics.summary(f),
    '/bottlenecks': (f) => services.analytics.bottlenecks(f),
    '/hourly': (f) => services.analytics.hourly(f),
    '/breakdown': (f) => services.analytics.breakdown(f),
    '/distribution': (f) => services.analytics.distribution(f),
    '/trend': (f) => services.analytics.trend(f),
  };
  for (const [path, handler] of Object.entries(sections)) {
    router.get(path, analysts(), validate({ query: filterQuery }), (req, res) => {
      res.json(handler(toFilters(req.valid.query)));
    });
  }
  return router;
}

function simulatorRoutes({ services }) {
  const router = express.Router();

  router.get('/defaults', analysts(), validate({
    query: { ...filterQuery, checkpoint_id: v.id() },
  }), (req, res) => {
    const { checkpoint_id: checkpointId, ...rest } = req.valid.query;
    res.json(services.analytics.simulatorDefaults(checkpointId, toFilters(rest)));
  });

  router.get('/run', analysts(), validate({
    query: {
      lambda: v.number({ min: 0, max: 10_000 }),
      mu: v.number({ exclusiveMin: 0, max: 10_000 }),
      c: v.int({ min: 1, max: MAX_SERVERS }),
      sla_minutes: v.number({ exclusiveMin: 0, max: 1440 }),
    },
  }), (req, res) => {
    res.json(services.analytics.simulate(req.valid.query));
  });

  return router;
}

module.exports = { analyticsRoutes, simulatorRoutes, filterQuery, toFilters };
