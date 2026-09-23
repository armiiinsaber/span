const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const KEY = 'sk-ant-test-SECRET-should-never-leak-123';
process.env.ANTHROPIC_API_KEY = KEY;
process.env.DEKA_PASSCODE = 'letmein';
const { createApp } = require('../server');

const valid = {
  intentions: [{ id: 'gym', name: 'Gym', type: 'do', tag: '', target: 1 }],
  occurrences: [{ intention_id: 'gym', day: 4, detail: '' }],
  question: '', note: 'One gym day.', review: '',
};
const client = { messages: { create: async () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'set_plan', input: valid }] }) } };
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
  const r = await post('/api/plan', { mode: 'plan', days });
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

test('the module default export is the app, for Vercel', () => {
  const mod = require('../server');
  assert.equal(typeof mod, 'function');
  assert.equal(typeof mod.handle, 'function');
});

test('plan works with a session and never echoes the key', async () => {
  const login = await post('/api/login', { passcode: 'letmein' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const r = await post('/api/plan', { mode: 'plan', days, message: 'gym once', plan: { intentions: [], occurrences: [] } }, cookie);
  const text = await r.text();
  assert.equal(r.status, 200, text);
  assert.equal(JSON.parse(text).plan.occurrences[0].day, 4);
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

test('rate limit kicks in on /api/plan', async () => {
  const login = await post('/api/login', { passcode: 'letmein' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  let limited = false;
  for (let i = 0; i < 35; i++) {
    const r = await post('/api/plan', { mode: 'plan', days, message: 'x', plan: { intentions: [], occurrences: [] } }, cookie);
    if (r.status === 429) { limited = true; break; }
  }
  assert.ok(limited);
});
