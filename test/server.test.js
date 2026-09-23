const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const KEY = 'sk-ant-test-SECRET-should-never-leak-123';
process.env.ANTHROPIC_API_KEY = KEY;
process.env.DEKA_PASSCODE = 'letmein';
const { createApp } = require('../server');

// A stand in that streams one short reply.
const client = { messages: { stream() {
  let onText = () => {};
  return { on(e, cb) { if (e === 'text') onText = cb; return this; }, abort() {}, async finalMessage() { onText('One gym '); onText('day.'); return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'One gym day.' }] }; } };
} } };
const days = Array.from({ length: 10 }, (_, i) => ({ day: i + 1, date: `2026-09-${22 + i}`, weekday: 'X' }));

let server, base;
test.before(async () => {
  server = createApp({ client }).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const post = (p, body, cookie) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });

test('api is locked without a session', async () => {
  const r = await post('/api/chat', { phase: 'planning', days, message: 'hi' });
  assert.equal(r.status, 401);
  assert.equal((await fetch(base + '/api/session')).status, 401);
});

test('wrong passcode fails, right one returns an HttpOnly cookie', async () => {
  assert.equal((await post('/api/login', { passcode: 'nope' })).status, 401);
  const r = await post('/api/login', { passcode: 'letmein' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /HttpOnly/i);
});

test('session cookie is Lax, host only, and Secure over HTTPS', async () => {
  const plain = (await post('/api/login', { passcode: 'letmein' })).headers.get('set-cookie');
  assert.match(plain, /SameSite=Lax/i);
  assert.doesNotMatch(plain, /Domain=/i);
  assert.doesNotMatch(plain, /Secure/i);
  const https = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
    body: JSON.stringify({ passcode: 'letmein' }),
  });
  assert.match(https.headers.get('set-cookie'), /;\s*Secure/i);
});

const YEAR = 365 * 24 * 60 * 60;
const cookieOf = r => r.headers.get('set-cookie').split(';')[0];
const maxAge = r => Number((r.headers.get('set-cookie').match(/Max-Age=(\d+)/i) || [])[1]);

test('a signed in device stays signed in for a year, renewed on every use', async () => {
  const login = await post('/api/login', { passcode: 'letmein' });
  assert.equal(maxAge(login), YEAR);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
  const again = await fetch(base + '/api/session', { headers: { Cookie: cookieOf(login) } });
  assert.equal(again.status, 200);
  assert.equal(maxAge(again), YEAR, 'the expiry is pushed out again');
  assert.match(again.headers.get('set-cookie'), /Expires=/i);
});

test('the session survives a restart and fails after a passcode change', async () => {
  const cookie = cookieOf(await post('/api/login', { passcode: 'letmein' }));
  const open = async opts => {
    const s = createApp({ client, ...opts }).listen(0);
    await new Promise(r => s.once('listening', r));
    const r = await fetch(`http://127.0.0.1:${s.address().port}/api/session`, { headers: { Cookie: cookie } });
    s.close();
    return r.status;
  };
  assert.equal(await open({}), 200, 'a fresh server with the same passcode still knows the device');
  assert.equal(await open({ passcode: 'a new passcode' }), 401, 'a new passcode signs every device out');
});

test('a message over 2,000 characters is turned away before any call to Claude', async () => {
  let calls = 0;
  const counting = { messages: { stream(...a) { calls++; return client.messages.stream(...a); } } };
  const s = createApp({ client: counting }).listen(0);
  await new Promise(r => s.once('listening', r));
  const at = `http://127.0.0.1:${s.address().port}`;
  const cookie = (await fetch(at + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: 'letmein' }) })).headers.get('set-cookie').split(';')[0];
  const r = await fetch(at + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ phase: 'planning', days, message: 'x'.repeat(2001) }) });
  s.close();
  assert.equal(r.status, 413);
  assert.match((await r.json()).error, /under 2,000 characters/);
  assert.equal(calls, 0);
});

test('each device gets its own daily turn limit, with a calm note when it is reached', async () => {
  const s = createApp({ client, dailyTurns: 2 }).listen(0);
  await new Promise(r => s.once('listening', r));
  const at = `http://127.0.0.1:${s.address().port}`;
  const login = async () => {
    const r = await fetch(at + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: 'letmein' }) });
    return r.headers.get('set-cookie').split(';')[0];
  };
  const session = await login();
  const ask = async cookie => {
    const r = await fetch(at + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ phase: 'planning', days, today: 'Wednesday 2026-09-23', message: 'hi' }) });
    const device = (r.headers.get('set-cookie') || '').match(/deka_device=([a-f0-9]+)/);
    await r.text();
    return { status: r.status, device: device && device[1] };
  };
  const first = await ask(session);
  assert.ok(first.device, 'a device id is set');
  const phone = `${session}; deka_device=${first.device}`;
  assert.equal((await ask(phone)).status, 200);
  const third = await fetch(at + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: phone }, body: JSON.stringify({ phase: 'planning', days, today: 'Wednesday 2026-09-23', message: 'hi' }) });
  assert.equal(third.status, 429);
  assert.match((await third.json()).error, /works by hand until tomorrow/);
  const tomorrow = await fetch(at + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: phone }, body: JSON.stringify({ phase: 'planning', days, today: 'Thursday 2026-09-24', message: 'hi' }) });
  assert.equal(tomorrow.status, 200, 'a new day starts fresh');
  await tomorrow.text();
  const laptop = await ask(session);
  assert.equal(laptop.status, 200, 'another device has its own count');
  s.close();
});

test('the module default export is the app, for Vercel', () => {
  const mod = require('../server');
  assert.equal(typeof mod, 'function');
  assert.equal(typeof mod.handle, 'function');
});

test('plan works with a session and never echoes the key', async () => {
  const login = await post('/api/login', { passcode: 'letmein' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const r = await post('/api/chat', { phase: 'planning', days, message: 'gym once', goals: [], schedule: [] }, cookie);
  const text = await r.text();
  assert.equal(r.status, 200, text);
  assert.match(r.headers.get('content-type'), /text\/event-stream/);
  assert.match(text, /event: text\ndata: \{"delta":"One gym"\}[\s\S]*"delta":" day\."[\s\S]*event: done/);
  assert.ok(!text.includes(KEY));
  assert.ok(!r.headers.get('set-cookie')?.includes(KEY));
});

test('no served file contains the key or reads it', async () => {
  const pub = path.join(__dirname, '..', 'public');
  const files = fs.readdirSync(pub, { recursive: true }).filter(f => fs.statSync(path.join(pub, f)).isFile());
  for (const f of files) {
    const res = await fetch(`${base}/${f.split(path.sep).join('/')}`);
    const body = Buffer.from(await res.arrayBuffer()).toString('latin1');
    assert.ok(!body.includes(KEY), `${f} leaks the key`);
    assert.ok(!/ANTHROPIC|x-api-key|api\.anthropic\.com/i.test(body), `${f} mentions the API`);
  }
  const root = await (await fetch(base + '/')).text();
  assert.ok(!root.includes(KEY));
});

test('rate limit kicks in on /api/chat', async () => {
  const login = await post('/api/login', { passcode: 'letmein' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  let limited = false;
  for (let i = 0; i < 45; i++) {
    const r = await post('/api/chat', { phase: 'planning', days, message: 'x' }, cookie);
    if (r.status === 429) { limited = true; break; }
  }
  assert.ok(limited);
});
