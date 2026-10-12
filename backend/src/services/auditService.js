'use strict';

const { pageWindow, pageResult } = require('../domain/pagination');

/** Read-only access to the audit log (spec §12.2). Entries are written by the services they describe. */
function createAuditService({ repos }) {
  return {
    list(filters, paging) {
      const window = pageWindow(paging);
      const { items, total } = repos.audit.list(filters, window);
      return pageResult(items, total, window);
    },
  };
}

module.exports = { createAuditService };
