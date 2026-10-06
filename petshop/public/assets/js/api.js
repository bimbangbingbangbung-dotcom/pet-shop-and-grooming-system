/**
 * Thin fetch wrapper. Mirrors the server contract: success is the payload,
 * failure is `{ error: { code, message, details } }` turned into an ApiError
 * so callers can read `err.fields` and paint field-level messages.
 */

export class ApiError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** { fieldName: message } for driving inline validation. */
  get fields() {
    const out = {};
    for (const d of this.details) if (d && d.field) out[d.field] = d.message;
    return out;
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'network_error', 'We could not reach the server. Check your connection and try again.');
  }

  if (res.status === 204) return null;

  const text = await res.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (_) {
      throw new ApiError(res.status, 'invalid_response', 'The server sent something we could not read.');
    }
  }

  if (!res.ok) {
    const e = (payload && payload.error) || {};
    throw new ApiError(res.status, e.code || 'error', e.message || 'Something went wrong.', e.details || []);
  }

  return payload;
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
};
