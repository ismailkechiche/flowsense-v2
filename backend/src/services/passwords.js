'use strict';

const bcrypt = require('bcrypt');

const BCRYPT_COST = 12;
const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_BYTES = 72; // bcrypt ignores anything beyond 72 bytes

// Compared against when the email is unknown, so a login for a missing
// account takes as long as one for an existing account.
const DUMMY_HASH = bcrypt.hashSync('flowsense-timing-equaliser', BCRYPT_COST);

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_COST);
const verifyPassword = (password, hash) => bcrypt.compare(password, hash ?? DUMMY_HASH);

/** Returns a reason string when the password is unacceptable, else null. */
function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) return `must be at most ${MAX_PASSWORD_BYTES} bytes`;
  return null;
}

module.exports = { BCRYPT_COST, MIN_PASSWORD_LENGTH, hashPassword, verifyPassword, passwordProblem };
