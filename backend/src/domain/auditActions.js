'use strict';

/** Every action the audit log records (spec §12.2). */
const AUDIT_ACTIONS = Object.freeze({
  USER_APPROVED: 'user_approved',
  USER_REJECTED: 'user_rejected',
  USER_ROLE_CHANGED: 'user_role_changed',
  USER_DISABLED: 'user_disabled',
  IMPORT_COMMITTED: 'import_committed',
  IMPORT_ROLLED_BACK: 'import_rolled_back',
  SESSION_DELETED: 'session_deleted',
  CHECKPOINT_CREATED: 'checkpoint_created',
  CHECKPOINT_UPDATED: 'checkpoint_updated',
  BACKUP_CREATED: 'backup_created',
  BACKUP_FAILED: 'backup_failed',
});

module.exports = { AUDIT_ACTIONS };
