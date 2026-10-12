'use strict';

const { AppError, notFound } = require('../domain/errors');

function apiNotFound(req, _res, next) {
  next(notFound(`No API route for ${req.method} ${req.path}`, 'route_not_found'));
}

/** The single error handler: consistent JSON shape, no stack traces sent. */
function errorHandler({ config, logger }) {
  // Express recognises error handlers by their four-argument signature.
  // eslint-disable-next-line no-unused-vars
  return function handleError(err, req, res, _next) {
    let status = 500;
    let body = { code: 'internal_error', message: 'Something went wrong on the server' };

    if (err instanceof AppError) {
      status = err.status;
      body = { code: err.code, message: err.message };
      if (err.details !== undefined) body.details = err.details;
    } else if (err?.type === 'entity.parse.failed') {
      status = 400;
      body = { code: 'invalid_json', message: 'The request body is not valid JSON' };
    } else if (err?.type === 'entity.too.large') {
      status = 413;
      body = { code: 'payload_too_large', message: 'The request body is too large' };
    } else if (err?.status && err.status >= 400 && err.status < 500) {
      status = err.status;
      body = { code: 'bad_request', message: err.expose ? err.message : 'Bad request' };
    }

    if (status >= 500) {
      logger.error(`${req.method} ${req.originalUrl} failed (user ${req.user?.id ?? '-'})`, err);
      if (!config.isProduction && err?.message) body.message = `${body.message}: ${err.message}`;
    }
    if (res.headersSent) return req.socket.destroy();
    return res.status(status).json({ error: body });
  };
}

module.exports = { apiNotFound, errorHandler };
