'use strict';

const express = require('express');
const { validate, v, pagination } = require('../middleware/validate');
const { requireRole } = require('../middleware/rbac');
const { badRequest } = require('../domain/errors');
const { AUDIT_ACTIONS } = require('../domain/auditActions');

/**
 * Admin operations. Backups can be created and listed, never downloaded
 * (spec §12.3): the files stay on the server. The audit log is read-only:
 * there are no update or delete routes for it (spec §12.2).
 */
function backupRoutes({ services, config }) {
  const router = express.Router();
  const admin = requireRole('admin');

  router.get('/', admin, (_req, res) => {
    res.json({
      items: services.backups.list(),
      directory: config.backupDir,
      retention_count: config.backupRetentionCount,
      interval_hours: config.backupIntervalHours,
    });
  });

  router.post('/', admin, validate({ body: {} }), async (req, res) => {
    res.status(201).json({ backup: await services.backups.create(req.user, 'manual') });
  });

  return router;
}

function auditRoutes({ services }) {
  const router = express.Router();

  router.get('/', requireRole('admin'), validate({
    query: {
      ...pagination,
      action: v.oneOf(Object.values(AUDIT_ACTIONS), { optional: true }),
      from: v.date({ optional: true }),
      to: v.date({ optional: true }),
    },
  }), (req, res) => {
    const { page, page_size: pageSize, action, from, to } = req.valid.query;
    if (from && to && from > to) throw badRequest('Some fields are invalid', [{ location: 'query', field: 'to', message: 'must be on or after from' }]);
    res.json(services.audit.list({ action, from, to }, { page, page_size: pageSize }));
  });

  router.get('/actions', requireRole('admin'), (_req, res) => {
    res.json({ items: Object.values(AUDIT_ACTIONS) });
  });

  return router;
}

module.exports = { backupRoutes, auditRoutes };
