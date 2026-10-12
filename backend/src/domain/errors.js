'use strict';

/**
 * An error that maps cleanly to an HTTP response.
 * Services throw these; the central error handler turns them into
 * `{ error: { code, message, details } }` with the given status.
 */
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details, code = 'validation_error') => new AppError(400, code, message, details);
const unauthorized = (message = 'Authentication required', code = 'unauthenticated') => new AppError(401, code, message);
const forbidden = (message = 'You do not have permission to do this', code = 'forbidden') => new AppError(403, code, message);
const notFound = (message = 'Not found', code = 'not_found') => new AppError(404, code, message);
const conflict = (message, code = 'conflict', details) => new AppError(409, code, message, details);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict };
