// Browser tests for the mobile flows. They drive headless Chrome over the DevTools
// protocol against the app with the scripted stand in for Claude. Skipped when Chrome
// is not installed. Set CHROME_PATH to point at another Chrome or Chromium.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

process.env.DEKA_PASSCODE = 'uitest';
const { createApp } = require('../server');
const mock = require('../lib/mock');

const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find(p => fs.existsSync(p));
const skip = !CHROME || typeof WebSocket === 'undefined' ? 'needs Chrome and Node 22 or newer' : false;

const sleep = ms => new Promise(r => setTimeout(r, ms));
let server, base, chrome, dir, page;

async function openPage(port) {
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
  const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable');
  const js = async expr => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'page error');
    return r.result.result.value;
  };
  const go = async () => { await S('Page.navigate', { url: base }); await waitFor('document.readyState === "complete" && document.getElementById("main").children.length > 0'); };
  const waitFor = async (expr, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await js(`Boolean(${expr})`).catch(() => false)) return; await sleep(50); }
    throw new Error(`timed out waiting for ${expr}`);
  };
  const size = w => S('Emulation.setDeviceMetricsOverride', { width: w, height: { 375: 812, 390: 844, 430: 932 }[w], deviceScaleFactor: 3, mobile: true });
  return { S, js, go, waitFor, size, close: () => ws.close() };
}

const click = sel => page.js(`document.querySelector(${JSON.stringify(sel)}).click()`);
const say = text => page.js(`(() => { const t = document.getElementById('msg'); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input', { bubbles: true })); t.closest('form').requestSubmit(); })()`);
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
function liveState(day = 4) {
  const occ = [];
  for (const [id, days] of [['run', [1, 3, 4, 6, 8]], ['gym', [2, 4, 7]], ['sober', [5, 9]]]) for (const d of days) occ.push({ intention_id: id, day: d, done: false, detail: '' });
  return {
    v: 1, seen: true, next: null, spans: [],
    current: {
      id: 'c1', start: daysAgo(day - 1), status: 'live', notes: {}, log: [], note: '', question: '', reflection: '', review: '',
      intentions: [{ id: 'run', name: 'Run', type: 'do', tag: '', target: 5 }, { id: 'gym', name: 'Gym', type: 'do', tag: '', target: 3 }, { id: 'sober', name: 'Sober night', type: 'abstain', tag: '', target: 2 }],
      occurrences: occ,
    },
  };
}
const seed = async (state, key = 'deka.v1') => {
  await page.js(`localStorage.clear(); localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))})`);
  await page.go();
};
const stored = () => page.js("JSON.parse(localStorage.getItem('deka.v1'))");

test.describe('mobile app', { skip }, () => {
  test.before(async () => {
    server = createApp({ client: mock }).listen(0);
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}/`;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deka-ui-'));
    chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
    let port;
    for (let i = 0; i < 100 && !port; i++) {
      try { port = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await sleep(100); }
    }
    page = await openPage(port);
    await page.size(390);
    await page.S('Page.navigate', { url: base });
    await page.waitFor('document.readyState === "complete"');
    assert.equal(await page.js("fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: 'uitest' }) }).then(r => r.status)"), 200);
  });
  test.after(async () => {
    page?.close(); server?.close();
    if (chrome) { const gone = new Promise(r => chrome.once('exit', r)); chrome.kill(); await gone; }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test('first run shows one intro, then Plan with Claude', async () => {
    await page.js('localStorage.clear()'); await page.go();
    assert.match(await page.js("document.querySelector('h1').textContent"), /Ten days at a/);
    assert.equal(await page.js("getComputedStyle(document.getElementById('tabs')).display"), 'none');
    await click('[data-a=intro-start]');
    await page.waitFor("document.getElementById('msg')");
    assert.equal(await page.js("document.querySelector('[data-tab=plan]').getAttribute('aria-current')"), 'page');
    await say('six runs and gym four times');
    await page.waitFor("document.querySelector('.loading')", 1000);
    await page.waitFor("document.querySelectorAll('.rows li').length === 2", 8000);
    assert.equal(await page.js("document.querySelectorAll('.tiles li').length"), 10);
    await click('[data-a=accept]');
    assert.equal((await stored()).current.status, 'live');
    assert.equal(await page.js("document.querySelector('[data-tab=today]').getAttribute('aria-current')"), 'page');
  });

  test('checking off is instant and can be undone from the toast', async () => {
    await seed(liveState(4));
    const first = "document.querySelector('[data-a=toggle]')";
    const done = await page.js(`(() => { ${first}.click(); return ${first}.classList.contains('done'); })()`);
    assert.equal(done, true, 'marked done in the same tick as the tap');
    assert.match(await page.js("document.querySelector('.toast').textContent"), /Run done\.\s*Undo/);
    await click('.toast [data-a=toast-undo]');
    assert.equal(await page.js(`${first}.classList.contains('done')`), false);
    assert.equal((await stored()).current.occurrences.find(o => o.intention_id === 'run' && o.day === 4).done, false);
    await click('[data-a=toggle]');
    await sleep(4300);
    assert.equal(await page.js("document.querySelector('.toast')"), null, 'toast leaves after 4 seconds');
  });

  test('tap a dot, then a day, moves it; the sheet renames, counts and deletes', async () => {
    await seed(liveState(4));
    await click('[data-tab=span]');
    await click('.row-btn[data-iid=gym]');
    await page.waitFor("document.getElementById('sheet')");
    await click('[data-a=pick][data-day="7"]');
    assert.match(await page.js("document.querySelector('.pick-hint').textContent"), /Tap a free day/);
    await click('[data-a=pick][data-day="8"]');
    let gym = (await stored()).current.occurrences.filter(o => o.intention_id === 'gym').map(o => o.day).sort();
    assert.deepEqual(gym, [2, 4, 8]);
    await click('[data-a=sheet-count][data-v="1"]');
    gym = (await stored()).current.occurrences.filter(o => o.intention_id === 'gym');
    assert.equal(gym.length, 4);
    assert.ok(gym.every(o => o.day >= 4 || [2].includes(o.day)), 'new sessions land today or later');
    await page.js("(() => { const i = document.getElementById('intName'); i.value = 'Lift'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await click('#sheet [data-a=sheet-close]');
    assert.equal((await stored()).current.intentions.find(i => i.id === 'gym').name, 'Lift');
    assert.match(await page.js("document.querySelector('.row-btn[data-iid=gym]').textContent"), /Lift/);
    await click('.row-btn[data-iid=gym]');
    await click('[data-a=delete-int]');
    assert.match(await page.js("document.querySelector('[data-a=delete-int]').textContent"), /Tap again/);
    await click('[data-a=delete-int]');
    assert.equal((await stored()).current.intentions.some(i => i.id === 'gym'), false);
    await click('.toast [data-a=toast-undo]');
    assert.equal((await stored()).current.intentions.some(i => i.id === 'gym'), true);
  });

  test('adding an intention by hand spreads it over the days left', async () => {
    await seed(liveState(4));
    await click('[data-tab=span]');
    await click('[data-a=add-int]');
    await page.js("(() => { const i = document.getElementById('intName'); i.value = 'Read'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
    await click('#sheetAdd');
    const read = (await stored()).current.occurrences.filter(o => o.intention_id === 'read');
    assert.equal(read.length, 3);
    assert.ok(read.every(o => o.day >= 4 && o.day <= 9));
  });

  test('tabs switch without reload and keep their scroll position', async () => {
    const st = liveState(4);
    for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) {
      st.current.intentions.push({ id: n, name: `Thing ${n}`, type: 'do', tag: '', target: 2 });
      st.current.occurrences.push({ intention_id: n, day: 2, done: false, detail: '' }, { intention_id: n, day: 6, done: false, detail: '' });
    }
    await seed(st);
    await page.js("window.__same = 1");
    await click('[data-tab=span]');
    const y = await page.js('(window.scrollTo(0, 300), window.scrollY)');
    assert.ok(y > 100, 'the Deka tab is long enough to scroll');
    await click('[data-tab=today]');
    assert.equal(await page.js('window.scrollY'), 0, 'Today opens at its own position');
    await click('[data-tab=span]');
    assert.equal(await page.js('window.scrollY'), y);
    assert.equal(await page.js('window.__same'), 1, 'no page reload');
  });

  test('Today draws from local data with the network off', async () => {
    await seed(liveState(4));
    await page.S('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    try {
      await page.go();
      assert.match(await page.js("document.querySelector('h1').textContent"), /Day 4/);
      assert.equal(await page.js("document.querySelectorAll('.items .item').length"), 2);
      await click('[data-tab=plan]');
      assert.equal(await page.js("document.getElementById('offline').hidden"), false);
      assert.equal(await page.js("document.querySelector('#dock .send').disabled"), true);
    } finally {
      await page.S('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
  });

  test('the Plan input rides above the keyboard', async () => {
    await seed(liveState(4));
    await click('[data-tab=plan]');
    // Stand in for iOS: the visual viewport shrinks by the keyboard height.
    const r = await page.js(`(() => {
      const vv = window.visualViewport, kb = 336, h = window.innerHeight - kb;
      Object.defineProperty(vv, 'height', { configurable: true, get: () => h });
      Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 });
      vv.dispatchEvent(new Event('resize'));
      const dock = document.getElementById('dock').getBoundingClientRect();
      const send = document.querySelector('#dock .send').getBoundingClientRect();
      return { bottom: Math.round(dock.bottom), limit: h, sendBottom: send.bottom, tabs: getComputedStyle(document.getElementById('tabs')).display };
    })()`);
    assert.ok(r.bottom <= r.limit + 1, `dock bottom ${r.bottom} is above the keyboard at ${r.limit}`);
    assert.ok(r.sendBottom <= r.limit, 'send button is visible');
    assert.equal(r.tabs, 'none', 'tabs step aside while typing');
  });

  test('no horizontal scroll, 44px targets and 16px inputs at every width', async () => {
    const audit = `(() => {
      const bad = [];
      if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('overflow');
      for (const el of document.querySelectorAll('button, input, textarea, [data-a]')) {
        const r = el.getBoundingClientRect();
        if (!r.width || el.disabled || el.closest('[hidden]') || getComputedStyle(el).display === 'none') continue;
        if (el.matches('input, textarea') && parseFloat(getComputedStyle(el).fontSize) < 16) bad.push('zoom ' + el.id);
        if (!el.matches('input, textarea, .scrim, .strip *') && (r.width < 43.5 || r.height < 43.5)) bad.push((el.getAttribute('aria-label') || el.textContent).trim().slice(0, 30) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      }
      return bad;
    })()`;
    for (const w of [375, 390, 430]) {
      await page.size(w);
      await seed(liveState(4));
      for (const tab of ['today', 'span', 'plan']) {
        await click(`[data-tab=${tab}]`);
        assert.deepEqual(await page.js(audit), [], `${w}px ${tab}`);
      }
      await click('[data-tab=span]'); await click('.row-btn[data-iid=run]');
      assert.deepEqual(await page.js(audit), [], `${w}px sheet`);
    }
    await page.size(390);
  });

  test('data saved before the rename still loads', async () => {
    await seed(liveState(4), 'span.v1');
    assert.match(await page.js("document.querySelector('h1').textContent"), /Day 4/);
    assert.ok(await page.js("localStorage.getItem('span.v1') !== null"));
    assert.equal((await stored()).current.id, 'c1');
  });
});
