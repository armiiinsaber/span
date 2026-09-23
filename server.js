// Deka server: gates /api with one passcode and plans with Claude.
// On Vercel this file is the one function. The default export is the app, and
// files in public/ are served by Vercel directly. Locally, npm start serves both.

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { runChat, MODEL } = require('./lib/chat');

const PORT = process.env.PORT || 3000;
// SPAN_PASSCODE is the name from before the rename, read only when DEKA_PASSCODE is unset.
const PASSCODE = process.env.DEKA_PASSCODE || process.env.SPAN_PASSCODE || '';
const COOKIE = 'span_session';
const IS_PROD = process.env.NODE_ENV === 'production';

if (!PASSCODE) console.warn('DEKA_PASSCODE is not set. Every login will fail until it is.');

// The session token is derived from the passcode, so changing it signs everyone out.
const sessionToken = () => crypto.createHmac('sha256', PASSCODE).update('span session v1').digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

// Fixed window limiter, in memory. Enough for one person on one instance.
function limiter({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || now > entry.reset) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    if (++entry.count > max) {
      res.set('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return res.status(429).json({ error: 'Too many requests. Try again in a few minutes.' });
    }
    next();
  };
}

function createApp({ client } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  app.post('/api/login', limiter({ windowMs: 15 * 60 * 1000, max: 10 }), (req, res) => {
    const given = (req.body && req.body.passcode) || '';
    if (!PASSCODE || !safeEqual(given, PASSCODE)) return res.status(401).json({ error: 'Wrong passcode.' });
    res.cookie(COOKIE, sessionToken(), {
      httpOnly: true,
      // Host only (no Domain), so it stays on dekaapp.com. Secure whenever the
      // request came in over HTTPS, which Vercel reports through the proxy.
      secure: req.secure || IS_PROD,
      sameSite: 'lax',
      maxAge: 180 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // Everything else under /api needs a valid session.
  app.use('/api', (req, res, next) => {
    if (PASSCODE && safeEqual(readCookie(req, COOKIE), sessionToken())) return next();
    res.status(401).json({ error: 'Locked.' });
  });

  app.get('/api/session', (req, res) => res.json({ ok: true, model: MODEL, ai: Boolean(client) }));

  // One chat turn, streamed back as server sent events: text, goals, log, proposal, summary, error, done.
  app.post('/api/chat', limiter({ windowMs: 10 * 60 * 1000, max: 40 }), async (req, res) => {
    const body = req.body || {};
    if (!['planning', 'live', 'review'].includes(body.phase)) return res.status(400).json({ error: 'Unknown phase.' });
    if (!Array.isArray(body.days) || body.days.length !== 10) return res.status(400).json({ error: 'Need the 10 day mapping.' });
    if (body.message != null && (typeof body.message !== 'string' || body.message.length > 4000)) return res.status(400).json({ error: 'That message is too long.' });
    if (!body.message && !body.event) return res.status(400).json({ error: 'Nothing to say.' });
    if (!client) return res.status(503).json({ error: 'Claude is not set up on the server.' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    const send = (event, data) => { if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
    const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableFinished) abort.abort(); });
    try {
      await runChat(client, body, send, { signal: abort.signal, log: msg => console.log(`[chat] ${msg}`) });
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error('[chat] API error', err.status || '', err.message);
        send('error', { message: err.status === 429 ? 'Deka is busy. Try again soon.' : 'Deka did not answer.' });
      }
    } finally {
      clearInterval(ping);
      send('done', {});
      res.end();
    }
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  const pub = path.join(__dirname, 'public');
  app.use(express.static(pub, {
    setHeaders(res, file) {
      if (file.endsWith('sw.js') || file.endsWith('.html')) res.set('Cache-Control', 'no-cache');
      else if (file.includes(`${path.sep}fonts${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }));
  app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html'), err => {
    if (err && !res.headersSent) res.status(404).end();
  }));
  return app;
}

function defaultClient() {
  if (process.env.ANTHROPIC_API_KEY) return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  if ((process.env.DEKA_MOCK || process.env.SPAN_MOCK) === '1' && !IS_PROD) {
    console.warn('DEKA_MOCK is on. Plans come from a local stand in, not Claude.');
    return require('./lib/mock');
  }
  console.warn('ANTHROPIC_API_KEY is not set. The app works by hand only.');
  return null;
}

const app = createApp({ client: defaultClient() });

if (require.main === module) {
  app.listen(PORT, () => console.log(`Deka on http://localhost:${PORT} using ${MODEL}`));
}

module.exports = app;
module.exports.createApp = createApp;
