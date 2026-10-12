'use strict';

/** SQL expression for "now" in local airport time, matching the column defaults. */
const NOW_LOCAL = "strftime('%Y-%m-%dT%H:%M:%S', 'now', 'localtime')";

function isUniqueViolation(err) {
  return err?.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

module.exports = { NOW_LOCAL, isUniqueViolation };
