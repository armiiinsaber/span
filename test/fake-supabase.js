// A stand in for Supabase in tests: the parts of GoTrue, PostgREST and Storage that Deka uses,
// on top of a real Postgres started from node_modules (embedded-postgres) with setup.sql applied.
// Every query runs as the role the request's token names, so row level security is the real thing.
// Codes are never emailed: codeFor(email) hands the test the 6 digit code.
//
// keys: 'legacy' gives JWT anon and service_role keys and sessions signed with a shared secret,
// as older projects have. 'new' gives sb_publishable_ and sb_secret_ keys, which go only in the
// apikey header, and sessions signed with a key pair published at /auth/v1/.well-known/jwks.json.
// Like Supabase, a key sent as a Bearer token that is not a valid JWT gets a 401.
//
//   const fake = await startFake({ keys: 'new' }); ... await fake.stop();

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { Pool, types } = require('pg');

types.setTypeParser(1082, v => v);            // date as text
types.setTypeParser(20, v => Number(v));     // bigint as number
types.setTypeParser(1700, v => Number(v));   // numeric as number

const ROOT = path.join(__dirname, '..');
const b64url = b => Buffer.from(b).toString('base64url');
const SQL_ID = /^[a-z_]+$/;

function signJwt(payload, secret) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function readJwt(token, secret) {
  const [h, b, s] = String(token || '').split('.');
  if (!h || !b || !s) return null;
  const sig = crypto.createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url');
  if (sig.length !== s.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(s))) return null;
  const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
  if (claims.exp && claims.exp < Date.now() / 1000) return null;
  return claims;
}

async function startPostgres(port) {
  const EmbeddedPostgres = require('embedded-postgres').default;
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'deka-pg-'));
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: false, onLog() {}, onError() {} });
  await pg.initialise();
  await pg.start();
  const pool = new Pool({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres', max: 8 });
  await pool.query(fs.readFileSync(path.join(__dirname, 'supabase-shim.sql'), 'utf8'));
  await pool.query(fs.readFileSync(path.join(ROOT, 'supabase', 'setup.sql'), 'utf8'));
  return { pool, stop: async () => { await pool.end(); await pg.stop(); fs.rmSync(dir, { recursive: true, force: true }); }, url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres` };
}

async function startFake({ pgPort = 54300 + Math.floor(Math.random() * 200), keys = 'legacy' } = {}) {
  const db = await startPostgres(pgPort);
  const { pool } = db;
  const jwtSecret = 'deka-test-jwt-secret-with-at-least-32-chars';
  const far = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
  const anonKey = keys === 'new' ? `sb_publishable_${crypto.randomBytes(12).toString('hex')}` : signJwt({ role: 'anon', iss: 'supabase', exp: far }, jwtSecret);
  const serviceKey = keys === 'new' ? `sb_secret_${crypto.randomBytes(12).toString('hex')}` : signJwt({ role: 'service_role', iss: 'supabase', exp: far }, jwtSecret);
  // New projects sign sessions with a key pair and publish the public half.
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'deka-test-key', alg: 'ES256', use: 'sig' };
  const signSession = payload => {
    if (keys !== 'new') return signJwt(payload, jwtSecret);
    const head = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: jwk.kid }));
    const body = b64url(JSON.stringify(payload));
    const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `${head}.${body}.${sig}`;
  };
  const readSession = token => {
    if (keys !== 'new') return readJwt(token, jwtSecret);
    const [h, b, sg] = String(token || '').split('.');
    if (!h || !b || !sg) return null;
    try {
      if (JSON.parse(Buffer.from(h, 'base64url').toString()).alg !== 'ES256') return null;
      if (!crypto.verify('sha256', Buffer.from(`${h}.${b}`), { key: pair.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sg, 'base64url'))) return null;
      const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
      return claims.exp && claims.exp < Date.now() / 1000 ? null : claims;
    } catch { return null; }
  };
  const seen = { bearerKey: 0 };
  const codes = new Map(), refresh = new Map(), authCodes = new Map();
  let base = '';
  const oauth = { email: 'sam.rivera@example.com', full_name: 'Sam Rivera' };

  // Runs a query as the role and claims a request carries.
  async function asRole(claims, fn) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      if (claims.role !== 'service_role') {
        await c.query(`set local role ${claims.role === 'authenticated' ? 'authenticated' : 'anon'}`);
        await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      }
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
  }
  // Who a request is, the way the Supabase gateway decides it.
  function claimsOf(req) {
    const key = req.headers.apikey || '';
    const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (keys === 'new') {
      if (key !== anonKey && key !== serviceKey) return null;
      if (auth) {
        // Only a user's session belongs here. A key in Authorization is not a JWT: 401.
        if (auth === anonKey || auth === serviceKey) seen.bearerKey += 1;
        return readSession(auth);
      }
      return { role: key === serviceKey ? 'service_role' : 'anon' };
    }
    // Legacy: the JWT in Authorization, or the apikey when there is none, says the role.
    if (key && key !== anonKey && key !== serviceKey) return null;
    const c = readJwt(auth || key, jwtSecret);
    return c && ['anon', 'service_role', 'authenticated'].includes(c.role) ? c : null;
  }
  const session = async user => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const access_token = signSession({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iss: `${base}/auth/v1`, exp, iat: exp - 3600, session_id: crypto.randomUUID() });
    const refresh_token = crypto.randomBytes(12).toString('hex');
    refresh.set(refresh_token, user.id);
    return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token, user: { id: user.id, email: user.email, user_metadata: user.raw_user_meta_data } };
  };
  const userById = async id => (await pool.query('select * from auth.users where id = $1', [id])).rows[0];
  const userByEmail = async email => (await pool.query('select * from auth.users where email = $1', [email])).rows[0];
  const pgError = (res, e) => {
    const status = e.code === '42501' ? 403 : e.code === '23505' ? 409 : 400;
    res.status(status).json({ code: e.code || 'error', message: e.message, details: null, hint: null });
  };

  const app = express.Router();
  // Supabase answers from another origin, so it says who may call it. So does this stand in.
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, prefer, x-upsert, x-client-info');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  // Uploads come as bytes; the list and delete calls come as JSON like everything else.
  app.use('/storage/v1/object', express.raw({ type: req => !/json/.test(req.headers['content-type'] || ''), limit: '25mb' }));
  app.use(express.json({ limit: '4mb' }));

  /* GoTrue */
  // The published signing keys: public, no key needed.
  app.get('/auth/v1/.well-known/jwks.json', (req, res) => res.json({ keys: keys === 'new' ? [jwk] : [] }));
  // Every other GoTrue call needs a valid key, and a key in Authorization only when it is a JWT.
  app.use('/auth/v1', (req, res, next) => {
    if (req.path.startsWith('/authorize') || req.path === '/logout') return next();
    if (!claimsOf(req)) return res.status(401).json({ message: 'Invalid API key or JWT' });
    next();
  });
  app.post('/auth/v1/otp', async (req, res) => {
    const { email, create_user = true, data = {} } = req.body || {};
    if (!email) return res.status(400).json({ error_code: 'validation_failed', msg: 'email is required' });
    let user = await userByEmail(email);
    if (!user) {
      if (!create_user) return res.status(422).json({ code: 422, error_code: 'otp_disabled', msg: 'Signups not allowed for otp' });
      user = (await pool.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning *', [email, JSON.stringify(data)])).rows[0];
    }
    codes.set(email, String(100000 + Math.floor(Math.random() * 900000)));
    res.json({});
  });
  app.post('/auth/v1/verify', async (req, res) => {
    const { email, token } = req.body || {};
    if (!email || codes.get(email) !== token) return res.status(403).json({ code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
    codes.delete(email);
    res.json(await session(await userByEmail(email)));
  });
  app.post('/auth/v1/token', async (req, res) => {
    const grant = req.query.grant_type;
    if (grant === 'refresh_token') {
      const id = refresh.get((req.body || {}).refresh_token);
      if (!id) return res.status(400).json({ error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      refresh.delete(req.body.refresh_token);
      const user = await userById(id);
      if (!user) return res.status(400).json({ error_code: 'user_not_found', msg: 'User not found' });
      return res.json(await session(user));
    }
    if (grant === 'pkce') {
      const { auth_code, code_verifier } = req.body || {};
      const pending = authCodes.get(auth_code);
      if (!pending) return res.status(400).json({ error_code: 'bad_code_verifier', msg: 'invalid code' });
      const challenge = crypto.createHash('sha256').update(code_verifier || '').digest('base64url');
      if (pending.challenge !== challenge) return res.status(400).json({ error_code: 'bad_code_verifier', msg: 'code challenge does not match' });
      authCodes.delete(auth_code);
      return res.json(await session(await userById(pending.user)));
    }
    res.status(400).json({ error_code: 'unsupported_grant_type', msg: 'unsupported' });
  });
  // Apple or Google: the provider's part is skipped; a user with the provider's details comes back with a code.
  app.get('/auth/v1/authorize', async (req, res) => {
    let user = await userByEmail(oauth.email);
    if (!user) user = (await pool.query('insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning *', [oauth.email, JSON.stringify({ full_name: oauth.full_name, name: oauth.full_name, provider: req.query.provider })])).rows[0];
    const code = crypto.randomBytes(8).toString('hex');
    authCodes.set(code, { user: user.id, challenge: String(req.query.code_challenge || '') });
    const to = new URL(String(req.query.redirect_to));
    to.searchParams.set('code', code);
    res.redirect(to.toString());
  });
  app.get('/auth/v1/user', async (req, res) => {
    const claims = claimsOf(req);
    if (!claims || !claims.sub) return res.status(401).json({ msg: 'invalid claim' });
    const user = await userById(claims.sub);
    if (!user) return res.status(401).json({ msg: 'user not found' });
    res.json({ id: user.id, email: user.email, user_metadata: user.raw_user_meta_data });
  });
  app.post('/auth/v1/logout', (req, res) => res.status(204).end());
  app.delete('/auth/v1/admin/users/:id', async (req, res) => {
    const claims = claimsOf(req);
    if (!claims || claims.role !== 'service_role') return res.status(401).json({ msg: 'service role required' });
    await pool.query('delete from auth.users where id = $1', [req.params.id]);
    res.json({});
  });

  /* PostgREST */
  const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
  function whereOf(query, params) {
    const conds = [];
    for (const [k, v] of Object.entries(query)) {
      if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
      if (!SQL_ID.test(k)) throw new Error(`bad column ${k}`);
      const m = String(v).match(/^(eq|neq|gt|gte|lt|lte|is|in)\.([\s\S]*)$/);
      if (!m) throw new Error(`bad filter ${k}`);
      if (m[1] === 'is') conds.push(`${k} is ${m[2] === 'null' ? 'null' : m[2] === 'true' ? 'true' : 'false'}`);
      else if (m[1] === 'in') { params.push(m[2].replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, ''))); conds.push(`${k} = any($${params.length})`); }
      else { params.push(m[2]); conds.push(`${k} ${OPS[m[1]]} $${params.length}`); }
    }
    return conds.length ? ` where ${conds.join(' and ')}` : '';
  }
  const cols = sel => (!sel || sel === '*') ? '*' : sel.split(',').map(c => { if (!SQL_ID.test(c)) throw new Error('bad select'); return c; }).join(', ');
  const orderOf = o => { if (!o) return ''; const [c, d] = o.split('.'); if (!SQL_ID.test(c)) throw new Error('bad order'); return ` order by ${c} ${d === 'desc' ? 'desc' : 'asc'}`; };
  const val = v => (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;
  const cast = v => (v !== null && typeof v === 'object') ? '::jsonb' : '';
  app.all('/rest/v1/rpc/:fn', async (req, res) => {
    const claims = claimsOf(req);
    if (!claims) return res.status(401).json({ message: 'No API key found in request' });
    if (!SQL_ID.test(req.params.fn)) return res.status(404).json({ message: 'no such function' });
    const args = req.method === 'GET' ? req.query : (req.body || {});
    const keys = Object.keys(args);
    if (keys.some(k => !SQL_ID.test(k))) return res.status(400).json({ message: 'bad argument' });
    try {
      const r = await asRole(claims, c => c.query(`select public.${req.params.fn}(${keys.map((k, i) => `${k} := $${i + 1}`).join(', ')}) as result`, keys.map(k => args[k])));
      res.json(r.rows[0].result);
    } catch (e) { pgError(res, e); }
  });
  app.all('/rest/v1/:table', async (req, res) => {
    const claims = claimsOf(req);
    if (!claims) return res.status(401).json({ message: 'No API key found in request' });
    const table = req.params.table;
    if (!SQL_ID.test(table)) return res.status(404).json({ message: 'no such table' });
    const prefer = String(req.headers.prefer || '');
    const wantRows = /return=representation/.test(prefer);
    try {
      const params = [];
      let sql;
      if (req.method === 'GET') {
        sql = `select ${cols(req.query.select)} from public.${table}${whereOf(req.query, params)}${orderOf(req.query.order)}`;
        if (req.query.limit) sql += ` limit ${Number(req.query.limit) || 1000}`;
      } else if (req.method === 'POST') {
        const rows = Array.isArray(req.body) ? req.body : [req.body];
        if (!rows.length) return res.json([]);
        const keys = Object.keys(rows[0]);
        if (keys.some(k => !SQL_ID.test(k)) || rows.some(r => Object.keys(r).length !== keys.length || keys.some(k => !(k in r)))) return res.status(400).json({ message: 'All object keys must match' });
        const tuples = rows.map(r => `(${keys.map(k => { params.push(val(r[k])); return `$${params.length}${cast(r[k])}`; }).join(', ')})`);
        sql = `insert into public.${table} (${keys.join(', ')}) values ${tuples.join(', ')}`;
        if (/resolution=merge-duplicates/.test(prefer)) {
          const on = String(req.query.on_conflict || '').split(',').filter(Boolean);
          if (on.some(k => !SQL_ID.test(k))) throw new Error('bad on_conflict');
          sql += ` on conflict (${on.join(', ')}) do update set ${keys.filter(k => !on.includes(k)).map(k => `${k} = excluded.${k}`).join(', ') || `${on[0]} = excluded.${on[0]}`}`;
        }
        if (wantRows) sql += ' returning *';
      } else if (req.method === 'PATCH') {
        const keys = Object.keys(req.body || {});
        if (!keys.length || keys.some(k => !SQL_ID.test(k))) return res.status(400).json({ message: 'nothing to update' });
        const sets = keys.map(k => { params.push(val(req.body[k])); return `${k} = $${params.length}${cast(req.body[k])}`; });
        sql = `update public.${table} set ${sets.join(', ')}${whereOf(req.query, params)}${wantRows ? ' returning *' : ''}`;
      } else if (req.method === 'DELETE') {
        sql = `delete from public.${table}${whereOf(req.query, params)}${wantRows ? ' returning *' : ''}`;
      } else return res.status(405).end();
      const r = await asRole(claims, c => c.query(sql, params));
      if (req.method === 'GET' || wantRows) return res.json(r.rows);
      res.status(req.method === 'POST' ? 201 : 204).end();
    } catch (e) { pgError(res, e); }
  });

  /* Storage */
  const files = new Map();
  const storageDenied = res => res.status(403).json({ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
  const notFound = res => res.status(400).json({ statusCode: '404', error: 'not_found', message: 'Object not found' });
  app.post('/storage/v1/object/list/:bucket', async (req, res) => {
    const claims = claimsOf(req);
    if (!claims) return res.status(401).json({ message: 'no key' });
    const prefix = String((req.body && req.body.prefix) || '');
    try {
      const r = await asRole(claims, c => c.query('select name, id, created_at from storage.objects where bucket_id = $1 and name like $2', [req.params.bucket, `${prefix}%`]));
      res.json(r.rows.map(o => ({ name: o.name.slice(prefix.length).replace(/^\//, ''), id: o.id, created_at: o.created_at })));
    } catch (e) { pgError(res, e); }
  });
  app.delete('/storage/v1/object/:bucket', async (req, res) => {
    const claims = claimsOf(req);
    if (!claims) return res.status(401).json({ message: 'no key' });
    const names = (req.body && req.body.prefixes) || [];
    try {
      const r = await asRole(claims, c => c.query('delete from storage.objects where bucket_id = $1 and name = any($2) returning name', [req.params.bucket, names]));
      for (const o of r.rows) files.delete(`${req.params.bucket}/${o.name}`);
      res.json(r.rows.map(o => ({ name: o.name })));
    } catch (e) { pgError(res, e); }
  });
  app.post(/^\/storage\/v1\/object\/([a-z_]+)\/(.+)$/, async (req, res) => {
    const claims = claimsOf(req);
    if (!claims) return res.status(401).json({ message: 'no key' });
    const [bucket, name] = [req.params[0], req.params[1]];
    const type = req.headers['content-type'] || 'application/octet-stream';
    try {
      const b = (await pool.query('select * from storage.buckets where id = $1', [bucket])).rows[0];
      if (!b) return notFound(res);
      if (b.allowed_mime_types && !b.allowed_mime_types.includes(type)) return res.status(415).json({ statusCode: '415', error: 'invalid_mime_type', message: `mime type ${type} is not supported` });
      if (b.file_size_limit && req.body.length > b.file_size_limit) return res.status(413).json({ statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
      await asRole(claims, c => c.query('insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3::uuid, $4, $5::jsonb) on conflict (bucket_id, name) do update set metadata = excluded.metadata', [bucket, name, claims.sub || null, claims.sub || null, JSON.stringify({ mimetype: type, size: req.body.length })]));
      files.set(`${bucket}/${name}`, { buf: Buffer.from(req.body), type });
      res.json({ Key: `${bucket}/${name}`, Id: crypto.randomUUID() });
    } catch (e) { if (e.code === '42501') return storageDenied(res); pgError(res, e); }
  });
  const download = async (req, res, bucket, name) => {
    const claims = claimsOf(req);
    if (!claims) return res.status(401).json({ message: 'no key' });
    try {
      const r = await asRole(claims, c => c.query('select name from storage.objects where bucket_id = $1 and name = $2', [bucket, name]));
      const f = files.get(`${bucket}/${name}`);
      if (!r.rows.length || !f) return notFound(res);
      res.set('Content-Type', f.type).send(f.buf);
    } catch (e) { pgError(res, e); }
  };
  app.get(/^\/storage\/v1\/object\/authenticated\/([a-z_]+)\/(.+)$/, (req, res) => download(req, res, req.params[0], req.params[1]));
  app.get(/^\/storage\/v1\/object\/([a-z_]+)\/(.+)$/, (req, res) => download(req, res, req.params[0], req.params[1]));

  const server = express().use(app).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return {
    url: base, anonKey, serviceKey, jwtSecret: keys === 'new' ? '' : jwtSecret, keys, seen, pool, router: app, oauth, files, sign: signSession,
    databaseUrl: db.url,
    codeFor: email => codes.get(email),
    // A signed in user for tests, with the profile the trigger made.
    async user(email, data = {}) {
      await fetch(`${base}/auth/v1/otp`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anonKey }, body: JSON.stringify({ email, create_user: true, data }) });
      const r = await fetch(`${base}/auth/v1/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anonKey }, body: JSON.stringify({ type: 'email', email, token: codes.get(email) }) });
      return r.json();
    },
    async stop() { server.close(); await db.stop(); },
  };
}

module.exports = { startFake, signJwt };
