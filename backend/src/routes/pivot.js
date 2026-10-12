'use strict';

const express = require('express');
const { validate, v } = require('../middleware/validate');
const { requireRole } = require('../middleware/rbac');

// Pivot configurations are checked by the pivot service against its fixed
// whitelist (unknown keys → 400 unknown_pivot_key); here we only make sure
// the body has the expected top-level shape.
const configBody = {
  rows: v.custom((raw) => raw),
  columns: v.custom((raw) => raw, { optional: true, nullable: true }),
  metrics: v.custom((raw) => raw),
  visualization: v.custom((raw) => raw, { optional: true }),
  title: v.custom((raw) => raw, { optional: true, nullable: true }),
  filters: v.custom((raw) => raw, { optional: true, nullable: true }),
};

function pivotRoutes({ services }) {
  const router = express.Router();
  const analysts = () => requireRole('analyst', 'admin');

  router.get('/options', analysts(), (_req, res) => {
    res.json(services.pivot.options());
  });

  router.post('/', analysts(), validate({ body: configBody }), (req, res) => {
    res.json(services.pivot.query(req.body));
  });

  return router;
}

function reportRoutes({ services, logger }) {
  const router = express.Router();

  // Builds the whole report model first (validation, every query), so any
  // error is still a normal JSON response; only then does the PDF stream.
  router.post('/', requireRole('analyst', 'admin'), validate({
    body: {
      scope: v.custom((raw) => raw),
      sections: v.custom((raw) => raw, { optional: true }),
      title: v.custom((raw) => raw, { optional: true, nullable: true }),
    },
  }), (req, res) => {
    const { filename, model } = services.reports.build(req.user, req.body);
    const doc = services.reports.createDocument(model);
    res.status(200);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    doc.on('error', (err) => {
      logger.error('PDF generation failed', err);
      res.destroy(err);
    });
    doc.pipe(res);
    services.reports.render(doc, model);
  });

  return router;
}

module.exports = { pivotRoutes, reportRoutes };
