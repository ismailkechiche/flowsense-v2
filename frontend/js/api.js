// The only place the frontend talks to the server. Sends cookies, attaches
// the CSRF header on state-changing requests, and sends the user to the
// login page on 401.

const CSRF_COOKIE = 'fs_csrf';
const CSRF_HEADER = 'X-CSRF-Token';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class ApiError extends Error {
  constructor(status, error) {
    super(error?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = error?.code;
    this.details = error?.details;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

function readCookie(name) {
  const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/** Makes sure the CSRF cookie exists before the first state-changing call. */
export async function ensureCsrf() {
  if (!readCookie(CSRF_COOKIE)) await request('GET', '/auth/csrf');
}

async function request(method, path, body, { redirectOn401 = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (UNSAFE.has(method)) headers[CSRF_HEADER] = readCookie(CSRF_COOKIE) ?? '';

  let res;
  try {
    res = await fetch(`/api${path}`, {
      method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { code: 'network_error', message: 'network' });
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401 && redirectOn401) onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, data?.error);
  return data;
}

export const api = {
  get: (path, opts) => request('GET', path, undefined, opts),
  post: async (path, body = {}, opts) => { await ensureCsrf(); return request('POST', path, body, opts); },
  patch: async (path, body = {}, opts) => { await ensureCsrf(); return request('PATCH', path, body, opts); },
  put: async (path, body = {}, opts) => { await ensureCsrf(); return request('PUT', path, body, opts); },
  delete: async (path, opts) => { await ensureCsrf(); return request('DELETE', path, undefined, opts); },
};

/** Builds a query string, skipping empty values. */
export function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    for (const v of Array.isArray(value) ? value : [value]) search.append(key, v);
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}
