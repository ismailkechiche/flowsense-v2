'use strict';

const crypto = require('node:crypto');
const { notFound } = require('../domain/errors');

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_PREVIEWS_PER_USER = 5;

/**
 * Server-side store for parsed uploads awaiting confirmation (spec §7.1).
 * In memory: a restart drops pending previews and the user re-uploads.
 * Each preview belongs to the uploading user and expires after 30 minutes;
 * someone else's or an expired preview id behaves as not found.
 */
function createPreviewStore({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
  const entries = new Map();

  function sweep() {
    const t = now();
    for (const [id, entry] of entries) if (entry.expiresAt <= t) entries.delete(id);
  }

  return {
    put(ownerId, data) {
      sweep();
      const mine = [...entries.entries()].filter(([, e]) => e.ownerId === ownerId).sort((a, b) => a[1].createdAt - b[1].createdAt);
      while (mine.length >= MAX_PREVIEWS_PER_USER) entries.delete(mine.shift()[0]);
      const id = crypto.randomBytes(18).toString('base64url');
      entries.set(id, { ownerId, data, createdAt: now(), expiresAt: now() + ttlMs });
      return { id, expiresAt: new Date(now() + ttlMs) };
    },
    get(id, ownerId) {
      sweep();
      const entry = entries.get(id);
      if (!entry || entry.ownerId !== ownerId) {
        throw notFound('This import preview has expired or does not exist; upload the file again', 'preview_not_found');
      }
      return { data: entry.data, expiresAt: new Date(entry.expiresAt) };
    },
    delete(id) {
      entries.delete(id);
    },
    size: () => entries.size,
  };
}

module.exports = { createPreviewStore, DEFAULT_TTL_MS };
