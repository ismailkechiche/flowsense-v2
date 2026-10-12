'use strict';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** Turns validated page/page_size into SQL limit/offset. */
function pageWindow({ page = 1, page_size: pageSize = DEFAULT_PAGE_SIZE } = {}) {
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

/** The response envelope shared by every paginated list (spec §12.1). */
function pageResult(items, total, { page, pageSize }) {
  return { items, page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) };
}

module.exports = { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageWindow, pageResult };
