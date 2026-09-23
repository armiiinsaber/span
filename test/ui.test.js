// Browser tests for the app. They drive headless Chrome over the DevTools protocol
// against the app with the scripted stand in for Claude. Skipped when Chrome is not
// installed. Set CHROME_PATH to point at another Chrome or Chromium.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

process.env.DEKA_PASSCODE = 'uitest';
process.env.MOCK_DELAY = '4';
const { createApp } = require('../server');
const mock = require('../lib/mock');
// Every request the app makes to Claude, as the server built it.
const sent = [];
const spy = { messages: { stream: params => { sent.push(params); return mock.messages.stream(params); } } };
const lastContext = () => JSON.parse(sent.at(-1).messages.at(-1).content.match(/<deka>\n(.*)\n<\/deka>/)[1]);

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
  await S('Network.setBypassServiceWorker', { bypass: true });
  const js = async expr => {
    const r = await S('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'page error');
    return r.result.result.value;
  };
  const waitFor = async (expr, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await js(`Boolean(${expr})`).catch(() => false)) return; await sleep(40); }
    throw new Error(`timed out waiting for ${expr}`);
  };
  const go = async () => { await S('Page.navigate', { url: base }); await waitFor('document.readyState === "complete" && document.getElementById("main").children.length > 0'); };
  const size = w => S('Emulation.setDeviceMetricsOverride', { width: w, height: { 375: 812, 390: 844, 430: 932 }[w], deviceScaleFactor: 3, mobile: true });
  return { S, js, go, waitFor, size, close: () => ws.close() };
}

const click = sel => page.js(`document.querySelector(${JSON.stringify(sel)}).click()`);
const say = text => page.js(`(() => { const t = document.getElementById('msg'); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input', { bubbles: true })); t.closest('form').requestSubmit(); })()`);
const idle = () => page.waitFor("!document.querySelector('#chat[aria-busy]') && !document.querySelector('.say .mk.live')", 10000);
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
function liveState(day = 4, extra = {}) {
  const occ = [];
  for (const [id, days] of [['run', [1, 3, 4, 6, 8]], ['gym', [2, 4, 7]], ['sober', [5, 9]]]) for (const d of days) occ.push({ intention_id: id, day: d, done: false, detail: '' });
  return {
    v: 1, seen: true, next: null, spans: [], settings: { checkin: '23:59' },
    current: {
      id: 'c1', start: daysAgo(day - 1), status: 'live', notes: {}, log: [], chat: [], summary: '', summarizedUpTo: 0, checked: [], checkin: {},
      note: '', question: '', reflection: '', review: '',
      intentions: [{ id: 'run', name: 'Run', type: 'do', tag: '', target: 5 }, { id: 'gym', name: 'Gym', type: 'do', tag: '', target: 3 }, { id: 'sober', name: 'Sober night', type: 'abstain', tag: '', target: 2 }],
      occurrences: occ, ...extra,
    },
  };
}
// Seeds storage, first stopping the page that is open from writing its own state over it.
const seed = async (state, key = 'deka.v1') => {
  await page.js(`(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {};
    localStorage.clear();
    ${state ? `set.call(localStorage, ${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))});` : ''}
  })()`);
  await page.go();
};
const fresh = () => seed(null);
const text = sel => page.js(`(document.querySelector(${JSON.stringify(sel)})?.textContent || '').replace(/\u00a0/g, ' ')`);
const stored = () => page.js("JSON.parse(localStorage.getItem('deka.v1'))");
const lastDeka = () => page.js("[...document.querySelectorAll('.msg.deka .t')].pop()?.textContent || ''");

test.describe('Deka app', { skip }, () => {
  test.before(async () => {
    server = createApp({ client: spy }).listen(0);
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

  test('first run: the intro with the large mark, then straight into the chat', async () => {
    await fresh();
    assert.match(await page.js("document.querySelector('h1').textContent"), /Ten days at a/);
    assert.equal(await page.js("document.querySelector('.intro .mk-large circle[data-day=\"10\"]') !== null"), true);
    assert.equal(await page.js("getComputedStyle(document.getElementById('tabs')).display"), 'none');
    await click('[data-a=intro-start]');
    await page.waitFor("document.getElementById('msg')");
    assert.equal(await page.js("document.querySelector('[data-tab=chat]').getAttribute('aria-current')"), 'page');
    assert.match(await page.js("document.querySelector('.chat-empty').textContent"), /What do the next 10/);
    assert.equal(await page.js("document.querySelectorAll('.bar .mk-header circle').length"), 10, 'still mark in the header');
  });

  test('goals typed in plain language land in Goals, with a reply and Undo', async () => {
    await fresh(); await click('[data-a=intro-start]');
    await say('at least six runs, gym four times and three sober nights');
    await page.waitFor("document.querySelector('.say .mk-inline.live')", 2000);
    await idle();
    assert.match(await lastDeka(), /Got it: run 6, gym 4, sober night 3/);
    assert.match(await text('.card'), /Added Run, 6 times/);
    assert.deepEqual((await stored()).current.intentions.map(g => [g.id, g.target]), [['run', 6], ['gym', 4], ['sober', 3]]);
    assert.match(await page.js("document.querySelector('.toast').textContent"), /Goals updated\.\s*Undo/);
    await click('[data-tab=goals]');
    assert.equal(await page.js("document.querySelectorAll('.rows li').length"), 3);
    await click('.toast [data-a=toast-undo]');
    assert.equal((await stored()).current.intentions.length, 0);
    assert.equal(await page.js("document.querySelectorAll('.rows li').length"), 0);
  });

  test('a proposal waits for Confirm; Tweak opens the composer; Confirm applies it and highlights the days', async () => {
    await fresh(); await click('[data-a=intro-start]');
    await say('six runs and gym four times'); await idle();
    await say('plan it'); await idle();
    assert.equal(await page.js("document.querySelectorAll('.card [data-a=confirm]').length"), 1);
    assert.equal((await stored()).current.occurrences.length, 0, 'nothing applied before Confirm');
    await click('[data-a=tweak]');
    assert.equal(await page.js("document.activeElement.id"), 'msg');
    assert.equal(await page.js("document.getElementById('msg').placeholder"), 'What should change?');
    await say('keep day 4 free'); await idle();
    const open = sent.at(-1) && lastContext().open_card;
    assert.ok(open && open.sessions.length === 10, 'the tweak carries the open card with every session');
    assert.match(await page.js("document.querySelectorAll('.card')[1].textContent"), /Replaced by a newer plan/);
    await click('[data-a=confirm]');
    const st = await stored();
    assert.equal(st.current.status, 'live');
    assert.equal(st.current.occurrences.length, 10);
    assert.equal(st.current.occurrences.some(o => o.day === 4), false);
    assert.match(await page.js("[...document.querySelectorAll('.card .state')].pop().textContent"), /Confirmed/);
    await click('[data-tab=days]');
    assert.ok(await page.js("document.querySelectorAll('.day.flash').length") > 0, 'changed days flash');
  });

  test('check in after the set time asks about a skipped day too, logs both, and proposes the rest', async () => {
    const st = liveState(5, { checked: [1, 2, 3] });
    st.settings.checkin = '00:00';
    await seed(st);
    await page.waitFor("document.querySelector('.msg.deka')");
    assert.equal(await lastDeka(), 'How did yesterday and today go?');
    await say('did the run yesterday, missed gym'); await idle();
    let cur = (await stored()).current;
    const on = (c, id, d) => c.occurrences.find(o => o.intention_id === id && o.day === d);
    assert.equal(on(cur, 'run', 4).done, true);
    assert.equal(on(cur, 'gym', 4).missed, true);
    assert.equal(Boolean(on(cur, 'sober', 5).done || on(cur, 'sober', 5).missed), false, 'an unmentioned sober night is never assumed');
    assert.match(await lastDeka(), /Did the sober night happen\?/);
    assert.deepEqual(cur.checked.sort(), [1, 2, 3], 'the check in stays open for the answer');
    assert.equal(await page.js("document.querySelectorAll('.card [data-a=confirm]').length"), 0, 'no plan before the answer');
    await say('yes, the sober night held'); await idle();
    cur = (await stored()).current;
    assert.equal(sent.at(-1).messages.at(-1).content.includes('answers the question in your last reply'), true, 'the answer carries the check in marker');
    assert.equal(on(cur, 'sober', 5).done, true);
    assert.deepEqual(cur.checked.sort(), [1, 2, 3, 4, 5]);
    assert.match(await page.js("[...document.querySelectorAll('.card .eyebrow')].map(e => e.textContent).join('|')"), /Day 4\|Day 5\|Proposed plan/);
    // Tapping a logged result corrects it.
    await click('[data-a=log-flip]');
    assert.equal((await stored()).current.occurrences.find(o => o.intention_id === 'run' && o.day === 4).done, false);
    // It asks once per day.
    await page.go();
    assert.equal(await page.js("[...document.querySelectorAll('.msg.deka')].filter(m => /How did/.test(m.textContent)).length"), 1);
  });

  test('a question left unanswered shows the session as not confirmed, and the next check in asks about it first', async () => {
    const st = liveState(4, { checked: [1, 2], chat: [
      { id: 'a1', role: 'deka', text: 'How did today go?', ts: 1, cards: [], checkin: { days: [3], answered: true } },
      { id: 'u1', role: 'user', text: 'gym was fine', ts: 2, cards: [] },
      { id: 'q1', role: 'deka', text: 'Did the run happen?', ts: 3, cards: [], checkin: { days: [3], answered: false, followup: true } },
    ] });
    st.current.occurrences.find(o => o.intention_id === 'run' && o.day === 1).done = true;
    st.current.occurrences.find(o => o.intention_id === 'gym' && o.day === 2).done = true;
    st.settings.checkin = '00:00';
    await seed(st);
    await page.waitFor("document.querySelectorAll('.msg.deka').length === 3");
    assert.equal(await lastDeka(), "Did yesterday's run happen, and how did today go?");
    await click('[data-tab=days]');
    assert.equal(await page.js("document.querySelectorAll('.day[data-day=\"3\"] .s.unsure').length"), 1, 'the day 3 run is outlined, not missed');
    assert.equal(await page.js("document.querySelectorAll('.days .s.missed').length"), 0);
    assert.match(await page.js("document.querySelector('.day[data-day=\"3\"] .dl').textContent"), /1 not confirmed/);
    await click('.day[data-day="3"] .dl');
    assert.match(await page.js("document.querySelector('#sheet .item.unconfirmed')?.textContent || ''"), /Run[\s\S]*Not confirmed/);
    await click('#sheet [data-a=sheet-close]');
    await click('[data-tab=chat]');
    await say('yes the run happened, and today I did the run and the gym'); await idle();
    const cur = (await stored()).current;
    assert.equal(cur.occurrences.find(o => o.intention_id === 'run' && o.day === 3).done, true);
    assert.deepEqual(cur.checked.sort(), [1, 2, 3, 4]);
    assert.equal(cur.chat.find(m => m.id === 'q1').checkin.answered, true, 'the old question is closed by the new check in');
  });

  test('Day 10 opens the review in the chat and rolls into the next deka', async () => {
    const st = liveState(10);
    st.current.occurrences.forEach((o, i) => { o.done = i % 2 === 0; });
    st.current.chat = [{ id: 'old1', role: 'user', text: 'hello', ts: 1 }];
    await seed(st);
    await page.waitFor("document.querySelectorAll('.card [data-a=confirm]').length === 1", 10000);
    await idle();
    assert.match(await lastDeka(), /Mock read, not Claude/);
    let s = await stored();
    assert.equal(s.next.intentions.length, 3);
    assert.match(s.current.review, /Runs held/);
    await click('[data-tab=goals]');
    assert.match(await page.js("document.querySelector('.head .eyebrow').textContent"), /Next deka/);
    await click('[data-tab=chat]');
    await click('[data-a=confirm]');
    s = await stored();
    assert.equal(s.spans.length, 1);
    assert.equal(s.current.status, 'live');
    assert.equal(s.current.chat.length, 0, 'a new deka starts a fresh thread');
    assert.equal(s.spans[0].chat.some(m => m.text === 'hello'), true);
    await click('[data-a=more]'); await click('[data-a=go-past]'); await click('[data-a=open-past]'); await click('[data-a=open-thread]');
    assert.match(await page.js("document.querySelector('.chat').textContent"), /hello[\s\S]*Mock read/);
  });

  test('messages sent offline wait, then send when the connection returns', async () => {
    await seed(liveState(4));
    await page.S('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    try {
      await page.waitFor('navigator.onLine === false');
      assert.equal(await page.js("document.getElementById('offline').hidden"), false);
      await say('plan the rest');
      assert.match(await page.js("document.querySelector('.msg.user .msg-state').textContent"), /Waiting for connection/);
      assert.equal((await stored()).current.chat.at(-1).status, 'waiting');
      // Everything but Deka keeps working offline.
      await click('[data-tab=days]'); await click('[data-a=toggle][data-iid=run][data-day="4"]');
      assert.equal((await stored()).current.occurrences.find(o => o.intention_id === 'run' && o.day === 4).done, true);
      await click('[data-tab=chat]');
    } finally {
      await page.S('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
    await page.waitFor("document.querySelector('.card [data-a=confirm]')", 10000);
    await idle();
    const chat = (await stored()).current.chat;
    assert.equal(chat.find(m => m.role === 'user').status, 'sent');
    assert.equal(await page.js("document.querySelector('.msg-state')"), null);
  });

  test('saved data and exports from before the chat still load', async () => {
    const old = liveState(4);
    delete old.settings;
    for (const k of ['chat', 'summary', 'summarizedUpTo', 'checked', 'checkin']) delete old.current[k];
    old.current.log = [{ role: 'user', text: 'six runs please' }, { role: 'claude', text: 'Done. Six runs.' }];
    await seed(old, 'span.v1');
    assert.match(await page.js("document.querySelector('.chat').textContent"), /six runs please[\s\S]*Done\. Six runs\./);
    const s = await stored();
    assert.equal(s.settings.checkin, '20:00');
    assert.deepEqual(s.current.log, old.current.log, 'the old log is kept too');
    // Import an old export file into an empty device.
    await fresh();
    await page.js(`window.confirm = () => true; (() => { const f = new File([${JSON.stringify(JSON.stringify(old))}], 'deka-old.json', { type: 'application/json' }); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('importFile'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await page.waitFor("document.querySelector('.waiting .mk-medium.live')", 2000);
    await page.waitFor("JSON.parse(localStorage.getItem('deka.v1') || '{}').current?.chat?.length === 2", 4000);
  });

  test('checking off is instant with Undo; tabs keep their scroll', async () => {
    const st = liveState(4);
    for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) {
      st.current.intentions.push({ id: n, name: `Thing ${n}`, type: 'do', tag: '', target: 1 });
      st.current.occurrences.push({ intention_id: n, day: 4, done: false, detail: '' });
    }
    await seed(st);
    await click('[data-tab=days]');
    const first = "document.querySelector('[data-a=toggle]')";
    assert.equal(await page.js(`(() => { ${first}.click(); return ${first}.classList.contains('done'); })()`), true);
    assert.match(await page.js("document.querySelector('.toast').textContent"), /Run done\.\s*Undo/);
    await click('.toast [data-a=toast-undo]');
    assert.equal(await page.js(`${first}.classList.contains('done')`), false);
    const y = await page.js('(window.scrollTo(0, 400), window.scrollY)');
    assert.ok(y > 100);
    await click('[data-tab=goals]');
    await click('[data-tab=days]');
    assert.equal(await page.js('window.scrollY'), y);
  });

  test('tap a dot, then a day, moves it in the goal sheet', async () => {
    await seed(liveState(4));
    await click('[data-tab=goals]');
    await click('.row-btn[data-iid=gym]');
    await click('[data-a=pick][data-day="7"]');
    await click('[data-a=pick][data-day="8"]');
    assert.deepEqual((await stored()).current.occurrences.filter(o => o.intention_id === 'gym').map(o => o.day).sort(), [2, 4, 8]);
    await click('#sheet [data-a=sheet-close]');
    assert.match(await page.js("document.querySelector('.toast').textContent"), /Goal updated\.\s*Undo/);
  });

  test('a tall sheet opens at medium, drags up to large, and swipes down to close', async () => {
    await seed(liveState(4));
    await click('[data-tab=goals]');
    await click('.row-btn[data-iid=run]');
    await click('[data-a=icon-open]');
    const drag = dy => page.js(`(() => {
      const h = document.getElementById('sheetHandle'), r = h.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      const ev = (type, y2) => new PointerEvent(type, { bubbles: true, clientX: x, clientY: y2, pointerId: 1, button: 0 });
      h.dispatchEvent(ev('pointerdown', y)); document.dispatchEvent(ev('pointermove', y + ${dy})); document.dispatchEvent(ev('pointerup', y + ${dy}));
    })()`);
    const cls = () => page.js("document.getElementById('sheet')?.className || 'closed'");
    assert.match(await cls(), /medium/, 'opens at medium');
    await drag(-120); assert.doesNotMatch(await cls(), /medium/, 'up to large');
    await drag(120); assert.match(await cls(), /medium/, 'down to medium');
    await drag(120); assert.equal(await cls(), 'closed', 'down again closes it');
    // A short sheet fits its content and one swipe closes it.
    await click('[data-a=more]');
    assert.doesNotMatch(await cls(), /medium/);
    await drag(120); assert.equal(await cls(), 'closed');
  });

  test('the living mark moves while Deka thinks and settles when done', async () => {
    await seed(liveState(4));
    await say('plan it');
    await page.waitFor("document.querySelector('.say .mk-inline.live')", 2000);
    const a = await page.js("document.querySelector('.say .mk-inline.live').getAnimations({ subtree: true }).filter(x => x.playState === 'running').length");
    assert.equal(a, 10, 'all ten dots animate');
    await idle();
    await sleep(1300);
    assert.equal(await page.js("document.querySelector('.say .mk')"), null, 'mark fades out when finished');
    // Reduced motion: the dots stay still and the mark breathes.
    await page.S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await say('keep day 5 free');
    await page.waitFor("document.querySelector('.say .mk-inline.live')", 2000);
    const r = await page.js("(() => { const m = document.querySelector('.say .mk-inline.live'); return { dots: [...m.querySelectorAll('circle')].filter(c => getComputedStyle(c).animationName !== 'none').length, mark: getComputedStyle(m).animationName }; })()");
    assert.deepEqual(r, { dots: 0, mark: 'breathe-mark' });
    await idle();
    await page.S('Emulation.setEmulatedMedia', { features: [] });
  });

  test('the composer rides above the keyboard', async () => {
    await seed(liveState(4));
    const r = await page.js(`(() => {
      const vv = window.visualViewport, kb = 336, h = window.innerHeight - kb;
      Object.defineProperty(vv, 'height', { configurable: true, get: () => h });
      Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 });
      vv.dispatchEvent(new Event('resize'));
      const send = document.querySelector('#dock .send').getBoundingClientRect();
      return { bottom: Math.round(document.getElementById('dock').getBoundingClientRect().bottom), limit: h, send: send.bottom, tabs: getComputedStyle(document.getElementById('tabs')).display };
    })()`);
    assert.ok(r.bottom <= r.limit, `composer bottom ${r.bottom} is above the keyboard at ${r.limit}`);
    assert.ok(r.send <= r.limit);
    assert.equal(r.tabs, 'none');
  });

  test('the login screen says the home screen app signs in once too, only in Safari', async () => {
    const at = async standalone => {
      const { result } = await page.S('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator, 'standalone', { value: ${standalone}, configurable: true })` });
      await page.js("fetch('/api/logout', { method: 'POST' })");
      await page.go();
      const hint = await page.js("document.querySelector('.login .hint')?.textContent || ''");
      await page.S('Page.removeScriptToEvaluateOnNewDocument', { identifier: result.identifier });
      return hint;
    };
    assert.match(await at(false), /home screen app asks for this once/);
    assert.equal(await at(true), '', 'not in the installed app');
    assert.equal(await page.js("fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: 'uitest' }) }).then(r => r.status)"), 200);
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
    // No line of copy may end with a single word on its own.
    const orphans = `(() => {
      const bad = [];
      for (const el of document.querySelectorAll('main p, main h1, main h2, .say .t, .summary, .dayopen li > span, #sheet p, .toast span, .lede')) {
        if (!el.getClientRects().length) continue;
        const tops = [];
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          if (n.parentElement.closest('.sr')) continue;
          for (const m of n.textContent.matchAll(/\\S+/g)) {
            const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
            const rect = r.getClientRects()[0]; if (rect) tops.push(Math.round(rect.top));
          }
        }
        const lines = [...new Set(tops)];
        if (lines.length > 1 && tops.filter(t => t === lines[lines.length - 1]).length === 1) bad.push(el.textContent.trim().slice(0, 40));
      }
      return bad;
    })()`;
    for (const w of [375, 390, 430]) {
      await page.size(w);
      await seed(liveState(4));
      await say('plan it'); await idle();
      for (const tab of ['chat', 'days', 'goals']) {
        await click(`[data-tab=${tab}]`);
        assert.deepEqual(await page.js(audit), [], `${w}px ${tab}`);
        assert.deepEqual(await page.js(orphans), [], `${w}px ${tab} orphans`);
      }
      await click('.row-btn[data-iid=run]');
      assert.deepEqual(await page.js(audit), [], `${w}px sheet`);
    }
    await page.size(390);
  });
});
