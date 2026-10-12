'use strict';

require('dotenv').config({ path: require('node:path').join(__dirname, '.env'), quiet: true });

const { loadConfig, ConfigError } = require('./src/config');
const { createLogger } = require('./src/logger');
const { openDatabase, runMigrations } = require('./src/db');
const { createApp } = require('./src/app');
const { startBackupScheduler } = require('./src/jobs/backupScheduler');

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`FLOWSENSE cannot start.\n${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
  const logger = createLogger(config.logLevel);

  const db = openDatabase(config.dbPath);
  const applied = runMigrations(db, config.migrationsDir);
  if (applied.length > 0) logger.info(`Applied migrations: ${applied.join(', ')}`);

  const app = createApp({ config, db, logger });
  await app.locals.ctx.services.auth.ensureBootstrapAdmin({
    email: config.bootstrapAdminEmail,
    password: config.bootstrapAdminPassword,
  });

  const server = app.listen(config.port, () => {
    logger.info(`FLOWSENSE listening on http://localhost:${config.port}`);
  });

  // One backup now, then every BACKUP_INTERVAL_HOURS (never in tests).
  const scheduler = config.nodeEnv === 'test' ? null : startBackupScheduler({
    backups: app.locals.ctx.services.backups,
    intervalHours: config.backupIntervalHours,
    logger,
  });

  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`);
    scheduler?.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write(`FLOWSENSE failed to start: ${err.stack}\n`);
  process.exit(1);
});
