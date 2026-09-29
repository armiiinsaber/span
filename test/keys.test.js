// Sign up, the code, a signed in data request and an attachment, in the browser, once with
// Supabase's new keys (sb_publishable_ and sb_secret_, sent only as apikey, sessions checked
// against the published signing keys) and once with the legacy JWT keys. The stand in answers
// a key sent as a Bearer token with a 401, as Supabase does.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

process.env.MOCK_DELAY = '4';
const { createApp } = require('../server');
const { createDb } = require('../lib/db');
const mock = require('../lib/mock');
const { startFake } = require('./fake-supabase');

const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(p => fs.existsSync(p));
const skip = !CHROME || typeof WebSocket === 'undefined' ? 'needs Chrome and Node 22 or newer' : false;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Starts Chrome and opens a page over the DevTools protocol. Every step has a time limit and a
// clear error, and a start that fails is retried with a fresh Chrome, so a slow machine running
// other test files at once never leaves a test waiting forever or a Chrome behind.
const within = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`timed out: ${what}`)), ms))]);
async function launchChrome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deka-keys-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let ws = null;
  const kill = async () => {
    try { ws && ws.close(); } catch {}
    if (proc.exitCode === null) { const gone = new Promise(r => proc.once('exit', r)); proc.kill(); await within(gone, 5000, 'Chrome to quit').catch(() => proc.kill('SIGKILL')); }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  try {
    // The file names the port once its second line, the browser's path, is written too.
    let port;
    for (let i = 0; i < 150 && !port; i++) {
      try { const lines = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n'); if (lines.length > 1 && lines[1]) port = lines[0]; } catch {}
      if (!port) await sleep(100);
    }
    if (!port) throw new Error('Chrome did not open its DevTools port');
    const v = await within(fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json()), 5000, 'the DevTools address');
    ws = new WebSocket(v.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
    await within(new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('the DevTools socket failed')); }), 5000, 'the DevTools socket');
    const send = (method, params = {}, sessionId) => within(new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); }), 15000, method);
    const created = await send('Target.createTarget', { url: 'about:blank' });
    if (!created.result) throw new Error(`Target.createTarget: ${JSON.stringify(created.error || created)}`);
    const attached = await send('Target.attachToTarget', { targetId: created.result.targetId, flatten: true });
    if (!attached.result) throw new Error(`Target.attachToTarget: ${JSON.stringify(attached.error || attached)}`);
    const S = (m, p) => send(m, p, attached.result.sessionId);
    await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable');
    await S('Network.setBypassServiceWorker', { bypass: true });
    await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    const js = async expr => {
      const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'page error');
      return r.result.result.value;
    };
    const waitFor = async (expr, ms = 8000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if (await js(`Boolean(${expr})`).catch(() => false)) return; await sleep(40); }
      throw new Error(`timed out waiting for ${expr}`);
    };
    return { S, js, waitFor, close: kill };
  } catch (err) { await kill(); throw err; }
}
async function openChrome() {
  let last;
  for (let tries = 0; tries < 3; tries++) {
    try { return await launchChrome(); } catch (err) { last = err; }
  }
  throw last;
}

for (const keys of ['new', 'legacy']) {
  test(`with ${keys} keys: sign up, the code, a signed in request and an attachment`, { skip }, async () => {
    const fake = await startFake({ keys });
    const db = createDb(fake.databaseUrl);
    const server = createApp({ client: mock, db, chatPerTenMinutes: 1000, supabase: { url: fake.url, anonKey: fake.anonKey, serviceKey: fake.serviceKey, jwtSecret: fake.jwtSecret } }).listen(0);
    await new Promise(r => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}/`;
    const page = await openChrome();
    const type = (id, v) => page.js(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const email = `kai.${keys}@example.com`;
    try {
      if (keys === 'new') {
        assert.match(fake.anonKey, /^sb_publishable_/);
        assert.equal(fake.jwtSecret, '', 'sessions are checked against the published keys only');
      }
      await page.S('Page.navigate', { url: base });
      await page.waitFor("document.getElementById('email')");
      assert.equal(await page.js("JSON.parse(localStorage.getItem('deka.config')).anonKey"), fake.anonKey, 'the public key reached the browser');
      // Sign up: the username is checked live, then the code is sent.
      await page.js("document.querySelector('[data-a=auth-go][data-v=signup]').click()");
      await type('first', 'Kai'); await type('last', 'Moreau'); await type('username', `kai.${keys}`);
      await page.waitFor("document.querySelector('.af-hint')?.textContent.includes('Available')");
      await type('email', email); await type('confirm', email);
      await page.js("document.querySelector('.auth [type=submit]').click()");
      await page.waitFor("document.getElementById('code')");
      assert.equal((await fake.pool.query('select count(*) from auth.users where email = $1', [email])).rows[0].count, '1', 'the account was made');
      // The code signs them in.
      await type('code', fake.codeFor(email));
      await page.waitFor("document.querySelector('.choose')");
      await page.js("document.querySelector('[data-a=theme][data-v=light]').click()");
      await page.waitFor("document.querySelector('[data-a=intro-start]')");
      await page.js("document.querySelector('[data-a=intro-start]').click()");
      const uid = (await fake.pool.query('select id from auth.users where email = $1', [email])).rows[0].id;
      // A signed in data request: the theme lands on the profile row, under row level security.
      await page.waitFor(`true`);
      for (let i = 0; i < 100 && (await fake.pool.query('select theme from public.profiles where id = $1', [uid])).rows[0].theme !== 'light'; i++) await sleep(80);
      assert.equal((await fake.pool.query('select theme from public.profiles where id = $1', [uid])).rows[0].theme, 'light');
      // An attachment: up to the bucket from the browser, then read by the server with the secret key.
      await page.waitFor("document.querySelector('#dock [data-a=attach]')");
      await page.js(`(async () => {
        const c = document.createElement('canvas'); c.width = 60; c.height = 40; c.getContext('2d').fillRect(0, 0, 60, 40);
        const f = await new Promise(r => c.toBlob(b => r(new File([b], 'list.png', { type: 'image/png' })), 'image/png'));
        const dt = new DataTransfer(); dt.items.add(f);
        const i = document.getElementById('pickPhotos'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await page.waitFor("document.querySelector('#tray img')");
      await page.js("document.querySelector('#dock .send').click()");
      await page.waitFor("[...document.querySelectorAll('.msg.deka .t')].some(t => /Got 1 photo/.test(t.textContent))", 10000);
      assert.ok([...fake.files.keys()].some(k => k.startsWith(`attachments/${uid}/`)), 'the file is in the account\'s folder');
      // The server checked the session and counted the turn for this person.
      const used = (await fake.pool.query('select count(*) from public.usage where user_id = $1', [uid])).rows[0].count;
      assert.equal(used, '1');
      assert.equal(fake.seen.bearerKey, 0, 'no key was ever sent as a Bearer token');
    } finally {
      await page.close(); server.close(); await db.end(); await fake.stop();
    }
  });
}
