// Deka server: checks each request's Supabase session, plans with Claude, and keeps the
// records only the server may write, usage and feedback. On Vercel this file is the one
// function. The default export is the app, and files in public/ are served by Vercel
// directly. Locally, npm start serves both.

const path = require('path');
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { runChat, MODEL, checkAttachments } = require('./lib/chat');
const { verifyToken } = require('./lib/auth');
const { createDb, allowTurn } = require('./lib/db');
const { createStorage } = require('./lib/storage');
const { costOf } = require('./lib/plans');

const PORT = process.env.PORT || 3000;
// Hard limits, checked before any call to Claude.
const MAX_MESSAGE = 2000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Everything Supabase, from the environment. The service role key stays in this process.
const SUPABASE = {
  url: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
  anonKey: process.env.SUPABASE_ANON_KEY || '',
  serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  jwtSecret: process.env.SUPABASE_JWT_SECRET || '',
};
if (!SUPABASE.url || !SUPABASE.anonKey) console.warn('SUPABASE_URL and SUPABASE_ANON_KEY are not set. Nobody can sign in until they are.');

// Fixed window limiter, in memory. Enough for one instance; the daily limit lives in the database.
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

// chatPerTenMinutes: the per address limit on chat, lowered or raised in tests.
function createApp({ client, supabase = SUPABASE, db = createDb(process.env.DATABASE_URL), storage = createStorage(supabase), fetch: fetchImpl = fetch, chatPerTenMinutes = 40 } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') { req.resume(); res.set('Connection', 'close'); return res.status(413).json({ error: 'That is too large to send.' }); }
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request.' });
    next(err);
  });

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  // What the app needs to talk to Supabase itself: the project URL and the public key.
  app.get('/api/config', (req, res) => res.json({ url: supabase.url, anonKey: supabase.anonKey, model: MODEL }));

  // Everything else under /api needs a signed in person.
  app.use('/api', async (req, res, next) => {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const claims = token ? await verifyToken(token, { url: supabase.url, secret: supabase.jwtSecret, fetch: fetchImpl }) : null;
    if (!claims) return res.status(401).json({ error: 'Signed out.' });
    req.user = { id: claims.sub, email: claims.email || '' };
    next();
  });

  app.get('/api/session', (req, res) => res.json({ ok: true, model: MODEL, ai: Boolean(client) }));

  // A thumbs up or down on a reply: a row for review, and a line in the log. Nothing goes to Claude.
  app.post('/api/feedback', limiter({ windowMs: 10 * 60 * 1000, max: 60 }), async (req, res) => {
    const b = req.body || {};
    if (![null, 'up', 'down'].includes(b.rating ?? null)) return res.status(400).json({ error: 'Unknown rating.' });
    const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    const row = { userId: req.user.id, messageId: clip(b.message_id, 80), rating: b.rating ?? null, reason: clip(b.reason, 1000), message: clip(b.message, 4000) };
    try { await db.addFeedback(row); } catch (err) { console.error('[feedback] not saved', err.message); }
    console.log(`[feedback] ${JSON.stringify({ ...row, ts: new Date().toISOString() })}`);
    res.json({ ok: true });
  });

  // One chat turn, streamed back as server sent events: text, goals, log, proposal, summary, error, done.
  app.post('/api/chat', limiter({ windowMs: 10 * 60 * 1000, max: chatPerTenMinutes }), async (req, res) => {
    const body = req.body || {};
    if (!['planning', 'live', 'review'].includes(body.phase)) return res.status(400).json({ error: 'Unknown phase.' });
    if (!Array.isArray(body.days) || body.days.length !== 10) return res.status(400).json({ error: 'Need the 10 day mapping.' });
    if (body.message != null && typeof body.message !== 'string') return res.status(400).json({ error: 'Nothing to say.' });
    if (body.message && body.message.length > MAX_MESSAGE) return res.status(413).json({ error: 'That is a long one. Keep it under 2,000 characters and send it again.' });
    // Attachments arrive as references to the person's own folder; the server reads them itself.
    const attached = await storage.fetchAttachments(body.attachments, req.user.id).catch(() => ({ ok: false, status: 502, error: 'An attachment could not be read. Try again.' }));
    if (!attached.ok) return res.status(attached.status).json({ error: attached.error });
    const check = checkAttachments(attached.list);
    if (!check.ok) return res.status(check.status).json({ error: check.error });
    body.attachments = attached.list;
    if (!body.message && !body.event && !attached.list.length) return res.status(400).json({ error: 'Nothing to say.' });
    if (!client) return res.status(503).json({ error: 'Claude is not set up on the server.' });
    // The day comes from the app's own date, so the limit resets at the person's midnight.
    const day = (String(body.today || '').match(/\d{4}-\d{2}-\d{2}/) || [new Date().toISOString().slice(0, 10)])[0];
    let allowed;
    try { allowed = await allowTurn(db, req.user.id, day); } catch (err) { console.error('[chat] usage check failed', err.message); return res.status(503).json({ error: 'Deka cannot reach its records right now. Try again soon.' }); }
    if (!allowed.ok) return res.status(429).json({ error: allowed.why === 'month' ? 'That is all the chat for this month. Everything else works by hand.' : 'That is all the chat for today. Everything else works by hand until tomorrow.', limit: allowed.why });

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
    const stats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };
    try {
      await runChat(client, body, send, { signal: abort.signal, log: msg => console.log(`[chat] ${msg}`), stats });
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error('[chat] API error', err.status || '', err.message);
        send('error', { message: err.status === 429 ? 'Deka is busy. Try again soon.' : 'Deka did not answer.' });
      }
    } finally {
      clearInterval(ping);
      send('done', {});
      res.end();
      const kind = body.event && body.event.kind ? body.event.kind : 'chat';
      db.recordUsage({ userId: req.user.id, day, kind, model: MODEL, ...stats, cost: costOf(MODEL, stats) }).catch(err => console.error('[chat] usage not saved', err.message));
    }
  });

  // Deleting the account: the files first, then the user, and every row goes with it.
  app.delete('/api/account', limiter({ windowMs: 10 * 60 * 1000, max: 5 }), async (req, res) => {
    if (!storage.ready) return res.status(503).json({ error: 'Deka is not set up for that yet.' });
    try {
      await storage.emptyFolder(req.user.id);
      await storage.deleteUser(req.user.id);
    } catch (err) {
      console.error('[account] delete failed', err.message);
      return res.status(502).json({ error: 'The account could not be deleted. Try again.' });
    }
    console.log(`[account] deleted ${req.user.id}`);
    res.json({ ok: true });
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
