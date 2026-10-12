'use strict';

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

function localTimestamp() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Minimal levelled logger writing one line per event to stdout/stderr. */
function createLogger(level = 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const write = (name, stream) => (message, extra) => {
    if (LEVELS[name] > threshold) return;
    let line = `${localTimestamp()} ${name.toUpperCase()} ${message}`;
    if (extra instanceof Error) line += `\n${extra.stack}`;
    else if (extra !== undefined) line += ` ${JSON.stringify(extra)}`;
    stream.write(`${line}\n`);
  };
  return {
    error: write('error', process.stderr),
    warn: write('warn', process.stderr),
    info: write('info', process.stdout),
    debug: write('debug', process.stdout),
  };
}

module.exports = { createLogger };
