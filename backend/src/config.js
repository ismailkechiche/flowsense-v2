'use strict';

const path = require('node:path');
const { parseDurationMs } = require('./domain/duration');

const BACKEND_DIR = path.resolve(__dirname, '..');
const PLACEHOLDER_SECRET = 'change-me-to-a-long-random-string';

class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/**
 * Builds the runtime configuration from environment variables and fails
 * fast, listing every problem at once, when something is missing or wrong.
 * Relative paths are resolved against the backend directory so the server
 * behaves the same whatever directory it is started from.
 */
function loadConfig(env = process.env) {
  const problems = [];
  const required = (name) => {
    const value = env[name];
    if (value === undefined || String(value).trim() === '') {
      problems.push(`${name} is required (see backend/.env.example)`);
      return undefined;
    }
    return String(value).trim();
  };
  const positiveInt = (name) => {
    const raw = required(name);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) problems.push(`${name} must be a positive integer (got "${raw}")`);
    return n;
  };
  const positiveNumber = (name) => {
    const raw = required(name);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) problems.push(`${name} must be a positive number (got "${raw}")`);
    return n;
  };
  const bool = (name) => {
    const raw = required(name);
    if (raw === undefined) return undefined;
    const v = raw.toLowerCase();
    if (v !== 'true' && v !== 'false') problems.push(`${name} must be "true" or "false" (got "${raw}")`);
    return v === 'true';
  };

  const port = positiveInt('PORT');
  const jwtSecret = required('JWT_SECRET');
  if (jwtSecret !== undefined) {
    if (jwtSecret.length < 32) problems.push('JWT_SECRET must be at least 32 characters long');
    else if (jwtSecret === PLACEHOLDER_SECRET) problems.push('JWT_SECRET is still the placeholder from .env.example; generate a random one');
  }
  const jwtExpiresIn = required('JWT_EXPIRES_IN');
  const jwtExpiresInMs = jwtExpiresIn === undefined ? undefined : parseDurationMs(jwtExpiresIn);
  if (jwtExpiresIn !== undefined && jwtExpiresInMs === null) {
    problems.push(`JWT_EXPIRES_IN must look like 30m, 8h or 1d (got "${jwtExpiresIn}")`);
  }
  const dbPath = required('DB_PATH');
  const backupDir = required('BACKUP_DIR');
  const backupIntervalHours = positiveNumber('BACKUP_INTERVAL_HOURS');
  const backupRetentionCount = positiveInt('BACKUP_RETENTION_COUNT');
  const cookieSecure = bool('COOKIE_SECURE');
  const bootstrapAdminEmail = required('BOOTSTRAP_ADMIN_EMAIL');
  if (bootstrapAdminEmail !== undefined && !/^[^\s@]+@[^\s@]+$/.test(bootstrapAdminEmail)) {
    problems.push('BOOTSTRAP_ADMIN_EMAIL must be an email address');
  }
  const bootstrapAdminPassword = required('BOOTSTRAP_ADMIN_PASSWORD');

  if (problems.length > 0) throw new ConfigError(problems);

  const nodeEnv = env.NODE_ENV || 'development';
  return Object.freeze({
    nodeEnv,
    isProduction: nodeEnv === 'production',
    isTest: nodeEnv === 'test',
    port,
    jwtSecret,
    jwtExpiresIn,
    jwtExpiresInMs,
    dbPath: dbPath === ':memory:' ? dbPath : path.resolve(BACKEND_DIR, dbPath),
    backupDir: path.resolve(BACKEND_DIR, backupDir),
    backupIntervalHours,
    backupRetentionCount,
    cookieSecure,
    bootstrapAdminEmail: bootstrapAdminEmail.toLowerCase(),
    bootstrapAdminPassword,
    logLevel: env.LOG_LEVEL || (nodeEnv === 'test' ? 'silent' : 'info'),
    frontendDir: path.resolve(BACKEND_DIR, '..', 'frontend'),
    migrationsDir: path.resolve(BACKEND_DIR, 'migrations'),
  });
}

module.exports = { loadConfig, ConfigError, BACKEND_DIR };
