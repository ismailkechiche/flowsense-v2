'use strict';

const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/**
 * Parses a duration like "8h", "30m", "45s", "2d" (the subset of the
 * jsonwebtoken `expiresIn` syntax we accept) into milliseconds.
 * Returns null when the value is not in that form.
 */
function parseDurationMs(value) {
  const match = /^(\d+)\s*([smhd])$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const amount = Number(match[1]);
  if (amount <= 0) return null;
  return amount * UNIT_MS[match[2]];
}

module.exports = { parseDurationMs };
