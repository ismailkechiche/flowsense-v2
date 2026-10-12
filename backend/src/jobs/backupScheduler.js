'use strict';

/**
 * Automatic backups (spec §12.3): one when the server starts, then one
 * every BACKUP_INTERVAL_HOURS. A failure is logged and audit-logged by the
 * backup service and never stops the server or the schedule.
 */
function startBackupScheduler({ backups, intervalHours, logger }) {
  const run = () => backups.create(null, 'scheduled').catch(() => {
    // Already logged and audit-logged by the backup service.
  });
  const first = run();
  const timer = setInterval(run, intervalHours * 60 * 60 * 1000);
  timer.unref(); // never keeps the process alive on its own
  logger.info(`Automatic backups every ${intervalHours} h`);
  return {
    first,
    stop: () => clearInterval(timer),
  };
}

module.exports = { startBackupScheduler };
