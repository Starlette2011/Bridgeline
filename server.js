'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// ---- tiny .env loader (no dependencies) ------------------------------------------------
function loadEnv(file) {
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no .env file: fine */
  }
}
loadEnv(path.join(__dirname, '.env'));

const { LANGUAGES } = require('./src/languages');
const { aiEnabled, callJson, MODEL } = require('./src/llm');
const { createEngine, HttpError } = require('./src/engine');

const engine = createEngine({ ai: { enabled: aiEnabled, callJson } });

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 9 * 1024 * 1024;
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN || 30);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};


// ---- rate limiting (in-memory, per IP) -----------------------------------------------
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.reset) {
    hits.set(ip, { count: 1, reset: now + 60_000 });
    return false;
  }
  rec.count += 1;
  return rec.count > RATE_LIMIT;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of hits) if (now > rec.reset) hits.delete(ip);
}, 60_000).unref();

function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || 'unknown';
}

// ---- helpers ------------------------------------------------------------------------
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'That file is too large. Try a smaller photo.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(self), microphone=(self), geolocation=()',
  'content-security-policy': [
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "connect-src 'self' https://cdn.jsdelivr.net https://tessdata.projectnaptha.com",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const abs = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!abs.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden', SECURITY_HEADERS);
  fs.readFile(abs, (err, data) => {
    if (err) return send(res, 404, 'Not found', SECURITY_HEADERS);
    const ext = path.extname(abs);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' || abs.endsWith('sw.js') ? 'no-cache' : 'public, max-age=3600',
      ...SECURITY_HEADERS,
    });
    res.end(data);
  });
}

const ROUTES = {
  'POST /api/analyze': (b) => engine.analyze(b),
  'POST /api/reply': (b) => engine.reply(b),
  'POST /api/ask': (b) => engine.ask(b),
  'POST /api/compose': (b) => engine.compose(b),
};

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return send(res, 200, { ok: true, mode: aiEnabled() ? 'ai' : 'demo', model: aiEnabled() ? MODEL() : null }, SECURITY_HEADERS);
      }
      if (req.method === 'GET' && url.pathname === '/api/languages') return send(res, 200, LANGUAGES, SECURITY_HEADERS);

      const handler = ROUTES[`${req.method} ${url.pathname}`];
      if (handler) {
        if (rateLimited(clientIp(req))) return send(res, 429, { error: 'Too many requests. Please wait a minute and try again.' }, SECURITY_HEADERS);
        const body = await readJson(req);
        return send(res, 200, await handler(body), SECURITY_HEADERS);
      }
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' }, SECURITY_HEADERS);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', SECURITY_HEADERS);
      return serveStatic(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error('[server]', err);
      return send(res, status, { error: status === 500 ? 'Something went wrong. Please try again.' : err.message }, SECURITY_HEADERS);
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, () => {
    console.log(`Bridgeline running at http://localhost:${port}`);
    console.log(aiEnabled() ? `Mode: AI (${MODEL()})` : 'Mode: DEMO (offline rules). Set ANTHROPIC_API_KEY in .env to enable AI.');
  });
}

module.exports = { createServer };
