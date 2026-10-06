'use strict';

/**
 * Snip & Snout server. Node's standard library only: node:http for the
 * server, node:sqlite for storage, node:zlib for brotli. `npm start`.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { URL } = require('node:url');

const { routes, HttpError, SHOP } = require('./api');
const { seed } = require('./seed');

const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY = 100 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const compressCache = new Map();

/* ------------------------------------------------------------- responses */

function send(res, status, payload, headers = {}) {
  const body = Buffer.from(payload);
  res.writeHead(status, {
    'Content-Length': body.length,
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, value, extra = {}) {
  send(res, status, JSON.stringify(value), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extra,
  });
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "script-src 'self'",
      "connect-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; ')
  );
}

/* ------------------------------------------------------------ body + csrf */

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'payload_too_large', 'That request is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') throw new Error('not an object');
        resolve(parsed);
      } catch (_) {
        reject(new HttpError(400, 'invalid_json', 'The request body was not valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Cross-site request forgery guard for cookie-authenticated mutations.
 * SameSite=Lax already blocks cross-site POSTs in current browsers; this
 * is the belt to that pair of braces.
 */
function sameOrigin(req, url) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetches from file:// or curl
  try {
    return new URL(origin).host === url.host;
  } catch (_) {
    return false;
  }
}

/* ------------------------------------------------------------ static file */

const etagCache = new Map();

function staticFile(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.join(PUBLIC_DIR, path.normalize(pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: { code: 'forbidden', message: 'Nope.' } });
    return;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (_) {
    // Unknown extension gets the HTML fallback so /shop renders /shop.html.
    const withHtml = `${filePath}.html`;
    try {
      stat = fs.statSync(withHtml);
      return serve(res, req, withHtml, stat, '.html');
    } catch (_) {
      return notFoundPage(res);
    }
  }

  if (stat.isDirectory()) return notFoundPage(res);
  return serve(res, req, filePath, stat, path.extname(filePath));
}

function serve(res, req, filePath, stat, ext) {
  const mime = MIME[ext] || 'application/octet-stream';
  const etag = `"${stat.mtimeMs.toString(36)}-${stat.size.toString(36)}"`;
  etagCache.set(filePath, etag);

  const isHtml = ext === '.html';
  const cacheControl = isHtml ? 'no-cache' : 'public, max-age=300';

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl });
    return res.end();
  }

  const acceptsBrotli = /\bbr\b/.test(req.headers['accept-encoding'] || '');
  let body = null;
  let encoding;

  if (acceptsBrotli && stat.size > 1024 && ['.html', '.css', '.js', '.svg', '.json'].includes(ext)) {
    const key = `${filePath}:${etag}`;
    if (!compressCache.has(key)) {
      if (compressCache.size > 200) compressCache.clear();
      compressCache.set(key, zlib.brotliCompressSync(fs.readFileSync(filePath), {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 },
      }));
    }
    body = compressCache.get(key);
    encoding = 'br';
  }

  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': (body || fs.readFileSync(filePath)).length,
    ETag: etag,
    'Cache-Control': cacheControl,
    ...(encoding ? { 'Content-Encoding': encoding, Vary: 'Accept-Encoding' } : {}),
  });

  if (req.method === 'HEAD') return res.end();
  if (body) return res.end(body);

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function notFoundPage(res) {
  send(res, 404,
    '<!doctype html><meta charset="utf-8"><title>Not found</title>' +
    '<p style="font:16px/1.6 system-ui;padding:2rem">Nothing here. ' +
    '<a href="/">Back to Snip &amp; Snout</a></p>',
    { 'Content-Type': 'text/html; charset=utf-8' });
}

/* --------------------------------------------------------------- dispatch */

async function handle(req, res) {
  securityHeaders(res);

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    if (!sameOrigin(req, url)) {
      return sendJson(res, 403, {
        error: { code: 'cross_origin', message: 'That request came from somewhere else.' },
      });
    }

    for (const route of routes) {
      if (route.method !== req.method) continue;
      const match = route.rx.exec(url.pathname);
      if (!match) continue;

      const params = {};
      route.names.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]); });

      let body = {};
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        try {
          body = await readBody(req);
        } catch (err) {
          return errorResponse(res, err);
        }
      }

      try {
        const result = await route.handler({ req, res, url, params, body });
        const [payload, status] = Array.isArray(result) ? result : [result, 200];
        return sendJson(res, status, payload);
      } catch (err) {
        return errorResponse(res, err);
      }
    }

    return sendJson(res, 404, {
      error: { code: 'not_found', message: `No ${req.method} route for ${url.pathname}.` },
    });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, {
      error: { code: 'method_not_allowed', message: 'Only GET is allowed outside the API.' },
    }, { Allow: 'GET, HEAD' });
  }

  return staticFile(req, res, url);
}

function errorResponse(res, err) {
  if (err instanceof HttpError) {
    return sendJson(res, err.status, {
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }
  console.error('[error]', err);
  return sendJson(res, 500, {
    error: { code: 'internal_error', message: 'Something went wrong on our side. It has been logged.' },
  });
}

/* ------------------------------------------------------------------- boot */

const boot = seed();
const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => errorResponse(res, err));
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log(`  ${SHOP.name} - ${SHOP.strapline}`);
  console.log(`  http://${HOST}:${PORT}`);
  console.log('');
  console.log(`  Admin: http://${HOST}:${PORT}/admin  ` +
    `(admin@snipandsnout.co.uk / ${process.env.ADMIN_PASSWORD || 'groom1234'})`);
  console.log(boot.seeded ? '  Database: created and seeded.' : '  Database: ready.');
  console.log('');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
