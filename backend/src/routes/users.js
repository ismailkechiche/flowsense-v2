'use strict';

const express = require('express');
const { validate, v } = require('../middleware/validate');
const { requireRole, ROLES } = require('../middleware/rbac');

const USER_STATUSES = ['pending', 'approved', 'rejected', 'disabled'];

function userRoutes({ services }) {
  const router = express.Router();
  const admin = requireRole('admin');
  const idParam = { params: { id: v.id() } };

  router.get('/', admin, validate({ query: { status: v.oneOf(USER_STATUSES, { optional: true }) } }), (req, res) => {
    res.json({ items: services.users.list(req.valid.query) });
  });

  router.post('/:id/approve', admin, validate({ ...idParam, body: { role: v.oneOf(ROLES) } }), (req, res) => {
    res.json({ user: services.users.approve(req.user, req.valid.params.id, req.valid.body.role) });
  });

  router.post('/:id/reject', admin, validate(idParam), (req, res) => {
    res.json({ user: services.users.reject(req.user, req.valid.params.id) });
  });

  router.patch('/:id/role', admin, validate({ ...idParam, body: { role: v.oneOf(ROLES) } }), (req, res) => {
    res.json({ user: services.users.changeRole(req.user, req.valid.params.id, req.valid.body.role) });
  });

  router.post('/:id/disable', admin, validate(idParam), (req, res) => {
    res.json({ user: services.users.disable(req.user, req.valid.params.id) });
  });

  router.post('/:id/enable', admin, validate(idParam), (req, res) => {
    res.json({ user: services.users.enable(req.user, req.valid.params.id) });
  });

  return router;
}

module.exports = { userRoutes };
