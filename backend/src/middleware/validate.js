'use strict';

const { badRequest } = require('../domain/errors');
const { parseLocalDate } = require('../domain/timeParse');

/**
 * Tiny schema helper. A rule is `{ check, optional, nullable, default }`
 * where `check(raw)` returns the normalised value or throws a message.
 *
 *   validate({ body: { name: v.string({ max: 100 }) }, params: { id: v.id() } })
 *
 * Validated values land in `req.valid.{body,query,params}`. Unknown body
 * fields are rejected; unknown query parameters are ignored.
 */

class RuleError extends Error {}
const fail = (message) => { throw new RuleError(message); };

function makeRule(check, { optional = false, nullable = false, default: def } = {}) {
  return { check, optional, nullable, default: def };
}

function toNumber(raw) {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return fail('must be a number');
}

const v = {
  string({ min = 1, max = 200, pattern, patternMessage, trim = true, ...opts } = {}) {
    return makeRule((raw) => {
      if (typeof raw !== 'string') fail('must be a string');
      const s = trim ? raw.trim() : raw;
      if (s.length < min) fail(min <= 1 ? 'is required' : `must be at least ${min} characters`);
      if (s.length > max) fail(`must be at most ${max} characters`);
      if (pattern && !pattern.test(s)) fail(patternMessage || 'has an invalid format');
      return s;
    }, opts);
  },
  email(opts = {}) {
    return makeRule((raw) => {
      if (typeof raw !== 'string') fail('must be a string');
      const s = raw.trim().toLowerCase();
      if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) fail('must be a valid email address');
      return s;
    }, opts);
  },
  int({ min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, ...opts } = {}) {
    return makeRule((raw) => {
      const n = toNumber(raw);
      if (!Number.isInteger(n)) fail('must be a whole number');
      if (n < min) fail(`must be at least ${min}`);
      if (n > max) fail(`must be at most ${max}`);
      return n;
    }, opts);
  },
  number({ min, max, exclusiveMin, ...opts } = {}) {
    return makeRule((raw) => {
      const n = toNumber(raw);
      if (!Number.isFinite(n)) fail('must be a finite number');
      if (exclusiveMin !== undefined && n <= exclusiveMin) fail(`must be greater than ${exclusiveMin}`);
      if (min !== undefined && n < min) fail(`must be at least ${min}`);
      if (max !== undefined && n > max) fail(`must be at most ${max}`);
      return n;
    }, opts);
  },
  bool(opts = {}) {
    return makeRule((raw) => {
      if (raw === true || raw === 'true') return true;
      if (raw === false || raw === 'false') return false;
      return fail('must be true or false');
    }, opts);
  },
  oneOf(values, opts = {}) {
    return makeRule((raw) => {
      if (!values.includes(raw)) fail(`must be one of: ${values.join(', ')}`);
      return raw;
    }, opts);
  },
  id(opts = {}) {
    return v.int({ min: 1, ...opts });
  },
  /** Escape hatch for structured values: `check(raw)` returns the value or calls `fail`. */
  custom(check, opts = {}) {
    return makeRule(check, opts);
  },
  /** A calendar date 'YYYY-MM-DD'. */
  date(opts = {}) {
    return makeRule((raw) => {
      const parsed = typeof raw === 'string' ? parseLocalDate(raw) : null;
      if (!parsed) fail('must be a date in the form YYYY-MM-DD');
      return parsed;
    }, opts);
  },
  /**
   * A string or number passed through unchanged, for fields whose rules
   * live in the domain layer (e.g. observation rows, which report
   * row-level reasons rather than generic field errors).
   */
  scalar(opts = {}) {
    return makeRule((raw) => {
      if (typeof raw !== 'string' && typeof raw !== 'number') fail('must be a string or a number');
      if (typeof raw === 'string' && raw.length > 100) fail('is too long');
      return raw;
    }, opts);
  },
};

/** page / page_size query parameters (spec §12.1). */
const pagination = {
  page: v.int({ min: 1, max: 1_000_000, default: 1 }),
  page_size: v.int({ min: 1, max: 100, default: 25 }),
};

function checkSection(location, rules, input, details) {
  const source = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const [field, rule] of Object.entries(rules)) {
    const raw = source[field];
    if (raw === undefined || (raw === '' && location === 'query')) {
      if (rule.default !== undefined) out[field] = rule.default;
      else if (!rule.optional) details.push({ location, field, message: 'is required' });
      continue;
    }
    if (raw === null) {
      if (rule.nullable) out[field] = null;
      else details.push({ location, field, message: 'must not be null' });
      continue;
    }
    try {
      out[field] = rule.check(raw);
    } catch (err) {
      if (!(err instanceof RuleError)) throw err;
      details.push({ location, field, message: err.message });
    }
  }
  return out;
}

function validate(schema = {}) {
  return function validateRequest(req, _res, next) {
    const details = [];
    const valid = {};
    for (const location of ['params', 'query', 'body']) {
      const rules = schema[location] || {};
      const input = req[location];
      if (location === 'body' && Buffer.isBuffer(input)) {
        // Raw uploads (express.raw) are checked by the service, not here.
        if (Object.keys(rules).length > 0) details.push({ location, field: null, message: 'must be a JSON object' });
        continue;
      }
      if (location === 'body') {
        if (input !== undefined && (typeof input !== 'object' || Array.isArray(input))) {
          details.push({ location, field: null, message: 'must be a JSON object' });
          continue;
        }
        for (const key of Object.keys(input || {})) {
          if (!(key in rules)) details.push({ location, field: key, message: 'is not an allowed field' });
        }
      }
      valid[location] = checkSection(location, rules, input, details);
    }
    if (details.length > 0) return next(badRequest('Some fields are invalid', details));
    req.valid = valid;
    return next();
  };
}

module.exports = { validate, v, pagination, fail };
