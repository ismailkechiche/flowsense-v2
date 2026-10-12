'use strict';

/** One log line per request: method, path, status, duration, user id. */
function requestLog({ logger }) {
  return function logRequest(req, res, next) {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      logger.info(`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(1)}ms user=${req.user?.id ?? '-'}`);
    });
    next();
  };
}

module.exports = { requestLog };
