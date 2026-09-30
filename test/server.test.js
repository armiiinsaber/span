// The server with accounts: every request carries a Supabase session, usage and limits live in
// the database, attachments come out of storage by reference. Runs against the Supabase stand in.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY = 'sk-ant-test-SECRET-should-never-leak-123';
process.env.ANTHROPIC_API_KEY = KEY;
const { createApp } = require('../server');
const { createDb } = require('../lib/db');
const { createStorage } = require('../lib/storage');
const { verifyToken } = require('../lib/auth');
const { startFake, signJwt } = require('./fake-supabase');

// A stand in that streams one short reply and reports what it used.
const client = { messages: { stream(params) {
  let onText = () => {};
  const image = Array.isArray(params.messages.at(-1).content) && params.messages.at(-1).content.some(b => b.type === 'image' || b.type === 'document');
  return { on(e, cb) { if (e === 'text') onText = cb; return this; }, abort() {}, async finalMessage() {
    onText(image ? 'I see ' : 'One gym '); onText(image ? 'it.' : 'day.');
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'One gym day.' }], usage: { input_tokens: 1200, output_tokens: 30, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 } };
  } };
} } };
const days = Array.from({ length: 10 }, (_, i) => ({ day: i + 1, date: `2026-09-${22 + i}`, weekday: 'X' }));

let fake, db, server, base, ana, bo;
const open = async (opts = {}) => {
  const s = createApp({ client, supabase: { url: fake.url, anonKey: fake.anonKey, serviceKey: fake.serviceKey, jwtSecret: fake.jwtSecret }, db, ...opts }).listen(0);
  await new Promise(r => s.once('listening', r));
  return { server: s, base: `http://127.0.0.1:${s.address().port}` };
};
test.before(async () => {
  fake = await startFake();
  db = createDb(fake.databaseUrl);
  ({ server, base } = await open());
  ana = await fake.user('ana@example.com', { first_name: 'Ana', last_name: 'Silva', username: 'ana.silva' });
  bo = await fake.user('bo@example.com', { first_name: 'Bo', last_name: 'Chen', username: 'bo.chen' });
});
test.after(async () => { server?.close(); await db?.end(); if (fake) await fake.stop(); });

const post = (p, body, who, at = base) => fetch(at + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${who.access_token}` } : {}) }, body: JSON.stringify(body) });
const chat = (body, who, at) => post('/api/chat', { phase: 'planning', days, today: 'Monday 2026-09-28', message: 'hi', ...body }, who, at);

test('the config is public; everything else needs a live session', async () => {
  const cfg = await (await fetch(base + '/api/config')).json();
  assert.deepEqual(Object.keys(cfg).sort(), ['anonKey', 'model', 'url']);
  assert.equal(cfg.url, fake.url);
  assert.equal((await fetch(base + '/api/session')).status, 401);
  assert.equal((await fetch(base + '/api/session', { headers: { Authorization: 'Bearer not.a.token' } })).status, 401);
  const expired = signJwt({ sub: ana.user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) - 10 }, fake.jwtSecret);
  assert.equal((await fetch(base + '/api/session', { headers: { Authorization: `Bearer ${expired}` } })).status, 401, 'expired');
  const forged = signJwt({ sub: ana.user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600 }, 'another secret');
  assert.equal((await fetch(base + '/api/session', { headers: { Authorization: `Bearer ${forged}` } })).status, 401, 'wrong secret');
  const ok = await fetch(base + '/api/session', { headers: { Authorization: `Bearer ${ana.access_token}` } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ai, true);
});

test('tokens signed with a key pair verify through the published keys', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'ES256', use: 'sig' };
  const head = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: 'k1' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ sub: bo.user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const token = `${head}.${body}.${sig}`;
  const fetchJwks = async url => ({ ok: true, json: async () => ({ keys: [jwk] }), status: 200, headers: new Headers() });
  const claims = await verifyToken(token, { url: 'https://x.supabase.co', fetch: fetchJwks });
  assert.equal(claims.sub, bo.user.id);
  assert.equal(await verifyToken(`${head}.${body}.${sig.slice(0, -2)}AA`, { url: 'https://x.supabase.co', fetch: fetchJwks }), null, 'a bad signature fails');
  // The server takes such a token too.
  const { server: s, base: at } = await open({ fetch: fetchJwks, supabase: { url: 'https://x.supabase.co', anonKey: 'a', serviceKey: 's', jwtSecret: '' } });
  assert.equal((await fetch(at + '/api/session', { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  s.close();
});

test('a turn streams the reply, records its usage for that person, and never echoes the key', async () => {
  const r = await chat({ message: 'gym once', goals: [], schedule: [] }, ana);
  const text = await r.text();
  assert.equal(r.status, 200, text);
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  assert.match(text, /event: text\ndata: \{"delta":"One gym"\}[\s\S]*"delta":" day\."[\s\S]*event: done/);
  assert.ok(!text.includes(KEY));
  await new Promise(x => setTimeout(x, 100));
  const rows = (await fake.pool.query('select day, kind, model, input_tokens, output_tokens, cache_read_tokens, cost_usd from public.usage where user_id = $1', [ana.user.id])).rows;
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].day, rows[0].kind, rows[0].input_tokens, rows[0].output_tokens, rows[0].cache_read_tokens], ['2026-09-28', 'chat', 1200, 30, 800]);
  assert.ok(rows[0].cost_usd > 0.005 && rows[0].cost_usd < 0.01, `cost ${rows[0].cost_usd}`);
  assert.equal((await fake.pool.query('select count(*) from public.usage where user_id = $1', [bo.user.id])).rows[0].count, '0');
});

test('the daily limit counts per person in the database, across server instances', async () => {
  const cy = await fake.user('cy@example.com', { username: 'cy.li' });
  const { server: other, base: at } = await open();
  const { LIMITS } = require('../lib/plans');
  const was = LIMITS.trial.turnsPerDay;
  LIMITS.trial.turnsPerDay = 2;
  try {
    assert.equal((await chat({}, cy)).status, 200);
    assert.equal((await chat({}, cy, at)).status, 200, 'a second instance sees the first turn');
    const third = await chat({}, cy);
    assert.equal(third.status, 429);
    assert.match((await third.json()).error, /works by hand until tomorrow/);
    assert.equal((await chat({ today: 'Tuesday 2026-09-29' }, cy)).status, 200, 'a new day starts fresh');
    assert.equal((await chat({}, bo)).status, 200, 'someone else has their own count');
  } finally { LIMITS.trial.turnsPerDay = was; other.close(); }
});

test('a message over 2,000 characters is turned away before any call to Claude', async () => {
  const r = await chat({ message: 'x'.repeat(2001) }, ana);
  assert.equal(r.status, 413);
  assert.match((await r.json()).error, /under 2,000 characters/);
});

test('feedback lands in the database for that person', async () => {
  const r = await post('/api/feedback', { message_id: 'm7', rating: 'down', reason: 'Too many runs', message: 'Here is the plan.' }, ana);
  assert.equal(r.status, 200);
  assert.equal((await post('/api/feedback', { rating: 'meh' }, ana)).status, 400);
  assert.equal((await post('/api/feedback', { rating: 'up' })).status, 401);
  const row = (await fake.pool.query('select message_id, rating, reason, message from public.feedback where user_id = $1', [ana.user.id])).rows[0];
  assert.deepEqual(row, { message_id: 'm7', rating: 'down', reason: 'Too many runs', message: 'Here is the plan.' });
});

test('attachments come from the person\'s own folder in storage, PDFs up to 20 MB', async () => {
  const up = (who, p, body, type) => fetch(`${fake.url}/storage/v1/object/attachments/${p}`, { method: 'POST', headers: { apikey: fake.anonKey, Authorization: `Bearer ${who.access_token}`, 'Content-Type': type }, body });
  assert.equal((await up(ana, `${ana.user.id}/photo1.jpg`, Buffer.from('jpegbytes'), 'image/jpeg')).status, 200);
  assert.equal((await up(ana, `${ana.user.id}/notes.pdf`, Buffer.from('%PDF-1.4'), 'application/pdf')).status, 200);
  const sent = [];
  const spy = { messages: { stream(p) { sent.push(p); return client.messages.stream(p); } } };
  const { server: s, base: at } = await open({ client: spy });
  try {
    const ok = await chat({ message: '', attachments: [{ path: `${ana.user.id}/photo1.jpg`, kind: 'image', name: 'photo1.jpg' }, { path: `${ana.user.id}/notes.pdf`, kind: 'pdf', name: 'notes.pdf' }] }, ana, at);
    const okText = await ok.text();
    assert.equal(ok.status, 200, okText);
    const blocks = sent.at(-1).messages.at(-1).content;
    assert.deepEqual(blocks.filter(b => b.type !== 'text').map(b => [b.type, b.source.media_type, b.source.data]), [['image', 'image/jpeg', Buffer.from('jpegbytes').toString('base64')], ['document', 'application/pdf', Buffer.from('%PDF-1.4').toString('base64')]]);
    // Someone else's file, a path outside your folder, or too many: turned away with no call.
    const before = sent.length;
    const theirs = await chat({ attachments: [{ path: `${ana.user.id}/photo1.jpg`, kind: 'image' }] }, bo, at);
    assert.deepEqual([theirs.status, (await theirs.json()).error], [400, 'Those attachments cannot be sent.']);
    const outside = await chat({ attachments: [{ path: `../${ana.user.id}/photo1.jpg`, kind: 'image' }] }, ana, at);
    assert.equal(outside.status, 400);
    const many = await chat({ attachments: Array(6).fill({ path: `${ana.user.id}/photo1.jpg`, kind: 'image' }) }, ana, at);
    assert.deepEqual([many.status, (await many.json()).error], [400, 'Up to 5 attachments per message.']);
    const missing = await chat({ attachments: [{ path: `${ana.user.id}/nothere.jpg`, kind: 'image' }] }, ana, at);
    assert.deepEqual([missing.status, (await missing.json()).error], [400, 'An attachment is missing. Send it again.']);
    assert.equal(sent.length, before);
    // The PDF ceiling is 20 MB now: 19 MB passes the server, 21 MB does not get into the bucket.
    const storage = createStorage({ url: fake.url, serviceKey: fake.serviceKey });
    fake.files.set(`attachments/${ana.user.id}/big.pdf`, { buf: Buffer.alloc(19 * 1024 * 1024), type: 'application/pdf' });
    await fake.pool.query("insert into storage.objects (bucket_id, name, owner) values ('attachments', $1, $2)", [`${ana.user.id}/big.pdf`, ana.user.id]);
    assert.equal((await storage.fetchAttachments([{ path: `${ana.user.id}/big.pdf`, kind: 'pdf' }], ana.user.id)).ok, true);
    assert.equal((await up(ana, `${ana.user.id}/huge.pdf`, Buffer.alloc(21 * 1024 * 1024), 'application/pdf')).status, 413);
  } finally { s.close(); }
});

test('deleting the account empties the folder and removes the user and every row', async () => {
  const dee = await fake.user('dee@example.com', { username: 'dee.k' });
  await fetch(`${fake.url}/storage/v1/object/attachments/${dee.user.id}/a.jpg`, { method: 'POST', headers: { apikey: fake.anonKey, Authorization: `Bearer ${dee.access_token}`, 'Content-Type': 'image/jpeg' }, body: 'x' });
  await fetch(`${fake.url}/rest/v1/dekas`, { method: 'POST', headers: { apikey: fake.anonKey, Authorization: `Bearer ${dee.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: dee.user.id, id: 'd1' }) });
  await chat({}, dee).then(r => r.text());
  const r = await fetch(base + '/api/account', { method: 'DELETE', headers: { Authorization: `Bearer ${dee.access_token}` } });
  assert.equal(r.status, 200, await r.text());
  assert.equal(fake.files.has(`attachments/${dee.user.id}/a.jpg`), false);
  for (const [t, col] of [['profiles', 'id'], ['dekas', 'user_id'], ['usage', 'user_id']]) {
    assert.equal((await fake.pool.query(`select count(*) from public.${t} where ${col} = $1`, [dee.user.id])).rows[0].count, '0', t);
  }
  assert.equal((await fake.pool.query('select count(*) from auth.users where id = $1', [dee.user.id])).rows[0].count, '0');
  assert.equal((await fetch(base + '/api/session', { headers: { Authorization: `Bearer ${dee.access_token}` } })).status, 200, 'the token itself still parses until it expires');
});

test('a secret key, a service_role key, or the same key twice: the browser gets no key and the log says why', async () => {
  const { signJwt: sign } = require('./fake-supabase');
  const serviceJwt = sign({ role: 'service_role', iss: 'supabase', exp: Math.floor(Date.now() / 1000) + 3600 }, 'x'.repeat(32));
  const anonJwt = sign({ role: 'anon', iss: 'supabase', exp: Math.floor(Date.now() / 1000) + 3600 }, 'x'.repeat(32));
  const cases = [
    ['a secret key in the public variable', { anonKey: 'sb_secret_abc123', serviceKey: 'sb_secret_other' }, 503, /is a secret key \(sb_secret_\)/],
    ['the legacy service_role key in the public variable', { anonKey: serviceJwt, serviceKey: serviceJwt + 'x' }, 503, /legacy service_role key/],
    ['the same value in both', { anonKey: 'sb_publishable_same', serviceKey: 'sb_publishable_same' }, 200, /hold the same value/],
    ['a secret key in both', { anonKey: 'sb_secret_both', serviceKey: 'sb_secret_both' }, 503, /is a secret key[\s\S]*hold the same value/],
  ];
  for (const [what, keys, status, said] of cases) {
    const lines = [];
    const err = console.error;
    console.error = (...a) => lines.push(a.join(' '));
    try {
      const { server: s, base: at } = await open({ supabase: { url: fake.url, jwtSecret: '', ...keys } });
      const startup = lines.join('\n');
      const r = await fetch(at + '/api/config');
      const body = await r.text();
      s.close();
      assert.match(startup, said, `${what}: logged at startup`);
      assert.equal(r.status, status, `${what}: /api/config status`);
      for (const k of Object.values(keys)) if (k.startsWith('sb_secret_') || k === serviceJwt) assert.ok(!body.includes(k), `${what}: no secret in /api/config`);
      if (status === 503) assert.ok(lines.length > 1, `${what}: logged again when asked`);
      for (const l of lines) for (const k of Object.values(keys)) assert.ok(!l.includes(k), `${what}: the log never shows a key`);
    } finally { console.error = err; }
  }
  // The right keys, new or legacy, go out as they are, with nothing logged.
  for (const keys of [{ anonKey: 'sb_publishable_ok', serviceKey: 'sb_secret_ok' }, { anonKey: anonJwt, serviceKey: serviceJwt }]) {
    const lines = [];
    const err = console.error;
    console.error = (...a) => lines.push(a.join(' '));
    try {
      const { server: s, base: at } = await open({ supabase: { url: fake.url, jwtSecret: '', ...keys } });
      const cfg = await (await fetch(at + '/api/config')).json();
      s.close();
      assert.equal(cfg.anonKey, keys.anonKey);
      assert.deepEqual(lines, []);
    } finally { console.error = err; }
  }
});

test('the setup check: each required setting, pass or fail, never a value', async () => {
  const { checkSetup, failingLine } = require('../lib/health');
  const { signJwt: sign } = require('./fake-supabase');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const anon = sign({ role: 'anon', exp }, 'x'.repeat(32)), service = sign({ role: 'service_role', exp }, 'x'.repeat(32));
  const works = { models: { list: async () => ({ data: [] }) } };
  const rejects = { models: { list: async () => { throw Object.assign(new Error('invalid x-api-key sk-ant-SECRET'), { status: 401 }); } } };
  const good = { anthropicKey: 'sk-ant-test-value', client: works, url: 'https://abcd.supabase.co', publicKey: 'sb_publishable_abc', secretKey: 'sb_secret_abc', databaseUrl: fake.databaseUrl };
  const run = async over => {
    const r = await checkSetup({ ...good, ...over });
    return Object.fromEntries(r.checks.map(c => [c.name, c.ok ? 'pass' : c.detail]));
  };
  const all = await checkSetup(good);
  assert.equal(all.ok, true, JSON.stringify(all));
  assert.deepEqual(all.checks.map(c => c.name), ['ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY', 'DATABASE_URL']);
  assert.equal((await checkSetup({ ...good, publicKey: anon, secretKey: service })).ok, true, 'legacy keys pass too');
  const cases = [
    [{ anthropicKey: '' }, 'ANTHROPIC_API_KEY', 'missing'],
    [{ client: rejects }, 'ANTHROPIC_API_KEY', 'rejected, the key is not valid'],
    [{ client: { models: { list: async () => { throw Object.assign(new Error('x'), { status: 529 }); } } } }, 'ANTHROPIC_API_KEY', 'the test call failed (529)'],
    [{ url: '' }, 'SUPABASE_URL', 'missing'],
    [{ url: 'abcd.supabase.co' }, 'SUPABASE_URL', 'not a URL'],
    [{ url: 'http://abcd.supabase.co' }, 'SUPABASE_URL', 'not an https URL'],
    [{ url: 'https://[YOUR-PROJECT].supabase.co' }, 'SUPABASE_URL', 'still has a placeholder'],
    [{ publicKey: '' }, 'SUPABASE_PUBLISHABLE_KEY', 'missing'],
    [{ publicKey: 'sb_secret_xyz' }, 'SUPABASE_PUBLISHABLE_KEY', 'is a secret key, not the publishable key'],
    [{ publicKey: service, secretKey: 'sb_secret_abc' }, 'SUPABASE_PUBLISHABLE_KEY', 'is the service_role key, not the anon key'],
    [{ publicKey: 'hello' }, 'SUPABASE_PUBLISHABLE_KEY', 'not a Supabase key'],
    [{ secretKey: '' }, 'SUPABASE_SECRET_KEY', 'missing'],
    [{ secretKey: 'sb_publishable_zzz' }, 'SUPABASE_SECRET_KEY', 'is a publishable key, not the secret key'],
    [{ secretKey: anon }, 'SUPABASE_SECRET_KEY', 'is the anon key, not the service_role key'],
    [{ secretKey: 'sb_publishable_abc' }, 'SUPABASE_SECRET_KEY', 'the same value as the public key'],
    [{ databaseUrl: '' }, 'DATABASE_URL', 'missing'],
    [{ databaseUrl: 'postgresql://postgres:[YOUR-PASSWORD]@db.abcd.supabase.co:5432/postgres' }, 'DATABASE_URL', 'still has a placeholder, like [YOUR-PASSWORD]'],
    [{ databaseUrl: 'https://abcd.supabase.co' }, 'DATABASE_URL', 'not a postgres connection string'],
    [{ databaseUrl: fake.databaseUrl.replace(':postgres@', ':wrong@') }, 'DATABASE_URL', 'the password was refused'],
    [{ databaseUrl: 'postgres://postgres:pw@127.0.0.1:1/postgres' }, 'DATABASE_URL', 'could not connect'],
  ];
  for (const [over, name, detail] of cases) {
    const r = await run(over);
    assert.equal(r[name], detail, `${name} with ${JSON.stringify(Object.keys(over))}`);
    for (const [k, v] of Object.entries(r)) if (k !== name) assert.equal(v, 'pass', `${k} still passes when only ${name} is wrong`);
    // No value, and no raw error text, anywhere in what comes back or what is logged.
    const out = JSON.stringify(await checkSetup({ ...good, ...over })) + failingLine(await checkSetup({ ...good, ...over }));
    for (const v of ['sk-ant-test-value', 'sb_publishable_abc', 'sb_secret_abc', 'abcd.supabase.co', 'sk-ant-SECRET', 'postgres:', '127.0.0.1', anon, service]) assert.ok(!out.includes(v), `${name}: never shows ${v.slice(0, 12)}`);
  }
});

test('GET /api/health: the same list, signed in only; a request that fails for the setup logs which setting', async () => {
  const works = { models: { list: async () => ({ data: [] }) }, messages: client.messages };
  const settings = { anthropicKey: '', databaseUrl: 'postgresql://postgres:[YOUR-PASSWORD]@db.x.supabase.co:5432/postgres' };
  const lines = [];
  const err = console.error;
  console.error = (...a) => lines.push(a.join(' '));
  try {
    const { server: s, base: at } = await open({ client: null, ...settings });
    assert.equal((await fetch(at + '/api/health')).status, 401, 'signed out: nothing');
    const r = await fetch(at + '/api/health', { headers: { Authorization: `Bearer ${ana.access_token}` } });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.ok, false);
    assert.deepEqual(body.checks.filter(c => !c.ok).map(c => [c.name, c.detail]), [['ANTHROPIC_API_KEY', 'missing'], ['DATABASE_URL', 'still has a placeholder, like [YOUR-PASSWORD]']]);
    for (const c of body.checks) assert.deepEqual(Object.keys(c).sort(), ['detail', 'name', 'ok']);
    // The chat fails for the setup: short for the person, one line for the log.
    lines.length = 0;
    const chat = await post('/api/chat', { phase: 'planning', days, message: 'hi' }, ana, at);
    assert.equal(chat.status, 503);
    assert.equal((await chat.json()).setup, true);
    await new Promise(x => setTimeout(x, 300));
    const line = lines.find(l => l.startsWith('[setup]'));
    assert.equal(line, '[setup] ANTHROPIC_API_KEY: missing; DATABASE_URL: still has a placeholder, like [YOUR-PASSWORD]');
    s.close();
    // With everything in place, the list passes.
    const ok = await open({ client: works, anthropicKey: 'sk-ant-x', databaseUrl: fake.databaseUrl, supabase: { url: 'https://abcd.supabase.co', anonKey: 'sb_publishable_a', serviceKey: 'sb_secret_b', jwtSecret: fake.jwtSecret } });
    const all = await (await fetch(ok.base + '/api/health', { headers: { Authorization: `Bearer ${ana.access_token}` } })).json();
    ok.server.close();
    assert.equal(all.ok, true, JSON.stringify(all.checks));
  } finally { console.error = err; }
});

test('the module default export is the app, for Vercel', () => {
  const mod = require('../server');
  assert.equal(typeof mod, 'function');
  assert.equal(typeof mod.handle, 'function');
});

test('no served file contains the key or reads it', async () => {
  const pub = path.join(__dirname, '..', 'public');
  const files = fs.readdirSync(pub, { recursive: true }).filter(f => fs.statSync(path.join(pub, f)).isFile());
  for (const f of files) {
    const res = await fetch(`${base}/${f.split(path.sep).join('/')}`);
    const body = Buffer.from(await res.arrayBuffer()).toString('latin1');
    assert.ok(!body.includes(KEY), `${f} leaks the key`);
    assert.ok(!/ANTHROPIC|x-api-key|api\.anthropic\.com|service_role/i.test(body), `${f} mentions the API or the service key`);
  }
});

test('rate limit kicks in on /api/chat', async () => {
  let limited = false;
  for (let i = 0; i < 45; i++) {
    const r = await chat({}, ana);
    const body = r.status === 429 ? await r.json() : (await r.text(), null);
    if (body && !body.limit) { limited = true; break; }
  }
  assert.ok(limited);
});
