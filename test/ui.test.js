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
// The context of the newest turn. Later rounds add tool results after it, in the same list.
const lastContext = () => {
  for (const m of [...sent.at(-1).messages].reverse()) {
    const t = typeof m.content === 'string' ? m.content : m.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const hit = m.role === 'user' && t.match(/<deka>\n(.*)\n<\/deka>/);
    if (hit) return JSON.parse(hit[1]);
  }
  return null;
};

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
    v: 1, seen: true, next: null, spans: [], settings: { checkin: '23:59', theme: 'system' },
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
// A new device that has already answered the theme question.
const fresh = () => seed({ v: 1, current: null, next: null, spans: [], settings: { theme: 'system' } });
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
    // The card: one row per goal, no "Added", counts as dots in one column.
    assert.equal(await page.js("document.querySelectorAll('.goals-card .gr').length"), 3);
    assert.doesNotMatch(await text('.goals-card'), /Added/);
    assert.equal(await page.js("document.querySelectorAll('.goals-card .gr.c-body .dots i').length"), 10, 'run 6 and gym 4 as dots');
    assert.equal(await page.js("document.querySelectorAll('.goals-card [data-a=trim-use]').length"), 0, 'no trim, no buttons');
    assert.deepEqual((await stored()).current.intentions.map(g => [g.id, g.target]), [['run', 6], ['gym', 4], ['sober', 3]]);
    assert.match(await page.js("document.querySelector('.toast').textContent"), /Goals updated\.\s*Undo/);
    await click('[data-tab=goals]');
    assert.equal(await page.js("document.querySelectorAll('.rows li').length"), 3);
    await click('.toast [data-a=toast-undo]');
    assert.equal((await stored()).current.intentions.length, 0);
    assert.equal(await page.js("document.querySelectorAll('.rows li').length"), 0);
  });

  test('a trim shows as faded dots and a meter, Use suggestion lowers the counts and plans, Undo puts them back', async () => {
    await fresh(); await click('[data-a=intro-start]');
    await say('eight runs, gym eight times, rentletter eight nights, make music eight nights, see mom five times');
    await idle();
    assert.match(await lastDeka(), /Too full/);
    assert.doesNotMatch(await lastDeka(), /\d/, 'the reply names no counts');
    const card = await page.js(`(() => { const c = document.querySelector('.goals-card'); return {
      cut: c.querySelectorAll('.dots i.cut').length, arrows: [...c.querySelectorAll('.num')].filter(n => /→/.test(n.textContent)).length,
      meter: c.querySelector('.meter .ml').textContent, buttons: c.querySelectorAll('[data-a=trim-use], [data-a=trim-keep]').length,
      aligned: new Set([...c.querySelectorAll('.num')].map(n => Math.round(n.getBoundingClientRect().right))).size }; })()`);
    assert.ok(card.cut > 0, 'faded dots for the cut');
    assert.equal(card.arrows, 5, 'each trimmed goal shows old and new');
    assert.match(card.meter, /Very full.*→.*/);
    assert.equal(card.buttons, 2);
    assert.equal(card.aligned, 1, 'the counts line up in one column');
    const green = await page.js(`[...document.querySelectorAll('.goals-card, .goals-card *')].some(e => /184, 240, 110/.test(getComputedStyle(e).backgroundColor + getComputedStyle(e).color + getComputedStyle(e).borderColor))`);
    assert.equal(green, false, 'no chartreuse on the card');
    await click('[data-a=trim-use]');
    await page.waitFor("document.querySelector('.card [data-a=confirm]')", 10000);
    await idle();
    let cur = (await stored()).current;
    assert.equal(cur.intentions.find(g => g.id === 'run').target, 6, 'eight runs became six');
    assert.match(await text('.goals-card .state'), /Trim applied/);
    assert.equal(cur.chat.filter(m => m.role === 'user').at(-1).text, 'Use the suggestion');
    await click('.toast [data-a=toast-undo]');
    cur = (await stored()).current;
    assert.equal(cur.intentions.find(g => g.id === 'run').target, 8, 'Undo restores the counts');
  });

  // A trim card from the stand in: eight runs, gym and Rentletter trimmed to six, music and mom to five and four.
  const trimmed = async () => {
    await fresh(); await click('[data-a=intro-start]');
    await say('eight runs, gym eight times, rentletter eight nights, make music eight nights, see mom five times');
    await idle();
  };
  const cardState = () => page.js(`(() => { const c = [...document.querySelectorAll('.goals-card')].pop(); return {
    buttons: c.querySelectorAll('[data-a=trim-use], [data-a=trim-keep]').length, cut: c.querySelectorAll('.dots i.cut').length,
    arrows: [...c.querySelectorAll('.num')].filter(n => /→/.test(n.textContent)).length, state: (c.querySelector('.state') || {}).textContent || '',
    runDots: c.querySelectorAll('.gr.c-body .dots')[0].children.length, meterArrow: /→/.test(c.querySelector('.meter').textContent) }; })()`);

  test('accepting a trim by text applies it through the same path as the button, and the card settles', async () => {
    await trimmed();
    await say('your trim sounds good'); await idle();
    const sent0 = sent.at(-1).tools.map(t => t.name);
    assert.ok(sent0.includes('resolve_trim'), 'Deka can answer the open trim');
    assert.deepEqual(await cardState(), { buttons: 0, cut: 0, arrows: 0, state: 'Trim applied', runDots: 6, meterArrow: false });
    const cur = (await stored()).current;
    assert.equal(cur.intentions.find(g => g.id === 'run').target, 6);
    assert.equal(await page.js("document.querySelectorAll('.card [data-a=confirm]').length"), 1, 'and Deka plans in the same turn');
    assert.equal(sent.at(-1).messages.at(-1).content.includes('"open_trim"'), true, 'the open trim went with the message');
  });

  test('turning a trim down by text keeps the numbers, and the card settles', async () => {
    await trimmed();
    await say('keep my numbers'); await idle();
    assert.deepEqual(await cardState(), { buttons: 0, cut: 0, arrows: 0, state: 'Kept your numbers', runDots: 8, meterArrow: false });
    assert.equal((await stored()).current.intentions.find(g => g.id === 'run').target, 8);
  });

  test('only the newest trim card can be answered; an older one goes quiet with no buttons', async () => {
    await trimmed();
    await say('also eight date nights and six sober nights'); await idle();
    const cards = await page.js(`[...document.querySelectorAll('.goals-card')].map(c => ({ buttons: c.querySelectorAll('[data-a=trim-use]').length, quiet: c.classList.contains('quiet'), trim: c.querySelectorAll('.dots i.cut').length > 0 }))`);
    const withTrim = cards.filter(c => c.trim);
    assert.equal(withTrim.length, 2, 'two trim cards');
    assert.deepEqual(withTrim.map(c => c.buttons), [0, 1], 'only the newest has buttons');
    assert.equal(withTrim[0].quiet, true);
    // Tapping the old card, if it had buttons, would do nothing; the newest answers as usual.
    await click('[data-a=trim-use]'); await idle();
    const states = await page.js(`[...document.querySelectorAll('.goals-card .state')].map(s => s.textContent)`);
    assert.deepEqual(states, ['Trim applied']);
  });

  test('the goals card lines up at every width in both themes, with no orphan words', async () => {
    const G = (id, name, icon, category, target, type = 'do') => ({ id, name, icon, category, type, target, was: null, op: 'add' });
    const rows = [G('friends', 'Dinner with old friends', 'friends', 'people', 4, 'see'), G('parents', 'Sunday lunch with parents', 'family', 'people', 2, 'see'),
      G('date', 'Date night', 'date', 'fun', 2, 'see'), G('gym', 'Gym', 'gym', 'body', 5), G('run', 'Run', 'run', 'body', 4), G('climb', 'Climbing', 'hike', 'body', 2),
      G('piano', 'Piano practice', 'music', 'fun', 5), G('project', 'Side project', 'laptop', 'work', 6), G('meditate', 'Meditate', 'meditate', 'rest', 9), G('read', 'Read before bed', 'book', 'mind', 9)];
    const st = liveState(4);
    st.current.intentions = rows.map(r => ({ id: r.id, name: r.name, type: r.type, tag: '', target: r.target, icon: r.icon, category: r.category }));
    st.current.occurrences = [];
    st.current.status = 'planning';
    st.current.chat = [{ id: 'u1', role: 'user', text: 'a long message', ts: 1, cards: [] }, { id: 'd1', role: 'deka', text: 'Too full for real time alone. Here is a lighter version.', ts: 2, cards: [
      { type: 'goals', id: 'g1', lines: [], rows, target: 'current', load: { req: 48 / 9, sug: 40 / 9 },
        trim: { trims: [{ goal_id: 'friends', requested: 4, suggested: 2 }, { goal_id: 'project', requested: 6, suggested: 4 }, { goal_id: 'piano', requested: 5, suggested: 3 }], reason: 'time alone', choice: null } }] }];
    const check = `(() => {
      const c = document.querySelector('.goals-card'), right = sel => new Set([...c.querySelectorAll(sel)].map(n => Math.round(n.getBoundingClientRect().right)));
      const orphans = [...c.querySelectorAll('.gname, .meter .ml, .meter .mv')].filter(el => {
        const r = document.createRange(), tops = [];
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) for (const m of n.textContent.matchAll(/\\S+/g)) { r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length); const b = r.getClientRects()[0]; if (b) tops.push(Math.round(b.top)); }
        const lines = [...new Set(tops)];
        return lines.length > 1 && tops.filter(t => t === lines.at(-1)).length === 1;
      }).map(el => el.textContent);
      return { nums: right('.num').size, dots: right('.dots').size, daily: c.querySelectorAll('.daily').length, cut: c.querySelectorAll('.cut').length,
        overflow: c.scrollWidth > c.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1, orphans };
    })()`;
    for (const theme of ['light', 'dark']) {
      await page.S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      for (const w of [375, 390, 430]) {
        await page.size(w);
        await seed(st);
        const r = await page.js(check);
        assert.deepEqual(r, { nums: 1, dots: 1, daily: 2, cut: 6, overflow: false, orphans: [] }, `${w}px ${theme}`);
      }
    }
    await page.S('Emulation.setEmulatedMedia', { features: [] });
    await page.size(390);
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
    assert.match(await page.js("document.querySelector('h1').textContent"), /Light or/, 'old data has no theme choice yet');
    await click('[data-a=theme][data-v=system]');
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
    const y = await page.js("(document.getElementById('scroller').scrollTo(0, 400), document.getElementById('scroller').scrollTop)");
    assert.ok(y > 100);
    await click('[data-tab=goals]');
    await click('[data-tab=days]');
    assert.equal(await page.js("document.getElementById('scroller').scrollTop"), y);
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

  test('the goal sheet opens at large, steps down to medium, and swipes down to close', async () => {
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
    assert.match(await cls(), /large/, 'the goal sheet opens at large, every field in view');
    await drag(120); assert.match(await cls(), /medium/, 'down to medium');
    await drag(-120); assert.match(await cls(), /large/, 'up to large');
    await drag(120); assert.match(await cls(), /medium/);
    await drag(120); assert.equal(await cls(), 'closed', 'down again closes it');
    // A short sheet fits its content and one swipe closes it.
    await click('[data-a=more]');
    assert.doesNotMatch(await cls(), /medium/);
    await drag(120); assert.equal(await cls(), 'closed');
  });

  test('a message over 2,000 characters stays in the composer with a note, and nothing is sent', async () => {
    await seed(liveState(4));
    const before = sent.length;
    await say('x'.repeat(2100));
    assert.equal(await page.js("document.getElementById('tooLong').hidden"), false);
    assert.equal(await page.js("document.getElementById('msg').value.length"), 2100, 'the text is kept');
    assert.equal(sent.length, before, 'no request');
    await page.js("(() => { const t = document.getElementById('msg'); t.value = 'short'; t.dispatchEvent(new Event('input', { bubbles: true })); })()");
    assert.equal(await page.js("document.getElementById('tooLong').hidden"), true);
    await page.js("document.getElementById('msg').value = ''");
  });

  test('right after the passcode, one screen asks light or dark, once per device, applied before paint', async () => {
    const st = liveState(4);
    delete st.settings.theme;
    await seed(st);
    await page.js("fetch('/api/logout', { method: 'POST' })");
    // Signed out and never asked: the passcode comes first, and the theme screen never flashes before it.
    const { result: watch } = await page.S('Page.addScriptToEvaluateOnNewDocument', { source: `window.__seen = []; new MutationObserver(() => { const m = document.getElementById('main'); const k = m && (m.querySelector('.choose') ? 'theme' : m.querySelector('.login') ? 'login' : m.querySelector('.chat, .intro') ? 'app' : ''); if (k && window.__seen.at(-1) !== k) window.__seen.push(k); }).observe(document, { childList: true, subtree: true });` });
    await page.S('Page.navigate', { url: base });
    await page.waitFor("document.getElementById('pass')");
    await page.S('Page.removeScriptToEvaluateOnNewDocument', { identifier: watch.identifier });
    assert.deepEqual(await page.js('window.__seen'), ['login'], 'nothing before the passcode screen');
    // A slow session check shows the page color, then the still mark after 400 ms, and nothing else.
    await page.S('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
    try {
      await page.S('Page.navigate', { url: base });
      await page.waitFor("document.readyState !== 'loading' && document.getElementById('main')", 8000);
      await page.waitFor("document.querySelector('#main .center .mk')", 3000);
      assert.deepEqual(await page.js("({ live: document.querySelector('#main .mk').classList.contains('live'), bar: document.getElementById('barIn').innerHTML, tabs: getComputedStyle(document.getElementById('tabs')).display })"), { live: false, bar: '', tabs: 'none' });
      await page.waitFor("document.getElementById('pass')", 8000);
    } finally {
      await page.S('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
    await page.js("(() => { document.getElementById('pass').value = 'uitest'; document.querySelector('[data-form=login]').requestSubmit(); })()");
    await page.waitFor("document.querySelector('.choose')");
    assert.match(await page.js("document.querySelector('h1').textContent"), /Light or/);
    assert.equal(await page.js("document.querySelectorAll('.choice').length"), 2);
    assert.equal(await page.js("getComputedStyle(document.getElementById('tabs')).display"), 'none');
    await click('[data-a=theme][data-v=dark]');
    await page.waitFor("!document.querySelector('.choose')");
    // The crossfade applies the theme on the next frame.
    await page.waitFor("document.documentElement.dataset.theme === 'dark'", 1000);
    assert.equal(await page.js("localStorage.getItem('deka.theme')"), 'dark');
    assert.equal((await stored()).settings.theme, 'dark', 'saved with the data, so export carries it');
    assert.equal(await page.js("getComputedStyle(document.body).backgroundColor"), 'rgb(20, 19, 15)');
    assert.equal(await page.js("document.querySelector('meta[name=theme-color]').content"), '#14130F');
    // Before paint: the theme is on the root before the body exists.
    const { result } = await page.S('Page.addScriptToEvaluateOnNewDocument', { source: `new MutationObserver((l, o) => { if (document.body) { window.__atBody = document.documentElement.dataset.theme || 'none'; o.disconnect(); } }).observe(document, { childList: true, subtree: true });` });
    await page.go();
    await page.S('Page.removeScriptToEvaluateOnNewDocument', { identifier: result.identifier });
    assert.equal(await page.js('window.__atBody'), 'dark');
    assert.equal(await page.js("document.querySelector('.choose')"), null, 'asked only once');
  });

  test('Profile switches the theme at once, and Match iPhone follows the system again', async () => {
    await seed(liveState(4));
    await click('[data-a=more]'); await click('[data-a=go-profile]');
    assert.match(await page.js("document.querySelector('h1').textContent"), /Profile/);
    const bg = () => page.js("getComputedStyle(document.body).backgroundColor");
    await click('[data-a=theme][data-v=dark]');
    await page.waitFor("document.documentElement.dataset.theme === 'dark'", 1000);
    await page.waitFor(`getComputedStyle(document.body).backgroundColor === 'rgb(20, 19, 15)'`, 2000);
    assert.equal(await page.js("document.querySelector('[data-a=theme][data-v=dark]').getAttribute('aria-pressed')"), 'true');
    await click('[data-a=theme][data-v=system]');
    await page.waitFor("!document.documentElement.hasAttribute('data-theme')", 1000);
    await page.S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await page.waitFor(`getComputedStyle(document.body).backgroundColor === 'rgb(20, 19, 15)'`, 2000);
    await click('[data-a=theme][data-v=light]');
    await page.waitFor(`getComputedStyle(document.body).backgroundColor === 'rgb(245, 243, 236)'`, 2000);
    assert.ok(await bg());
    await page.S('Emulation.setEmulatedMedia', { features: [] });
    // An imported file brings its theme with it.
    const file = liveState(4); file.settings.theme = 'dark';
    await page.js(`window.confirm = () => true; (() => { const f = new File([${JSON.stringify(JSON.stringify(file))}], 'deka.json', { type: 'application/json' }); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('importFile'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await page.waitFor("document.documentElement.dataset.theme === 'dark'", 4000);
  });

  test('with Reduce Motion the theme switches at once, with no crossfade', async () => {
    await seed(liveState(4));
    await page.S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await click('[data-a=more]'); await click('[data-a=go-profile]');
    assert.equal(await page.js("(() => { document.querySelector('[data-a=theme][data-v=dark]').click(); return document.documentElement.dataset.theme; })()"), 'dark');
    await page.S('Emulation.setEmulatedMedia', { features: [] });
  });

  test('the top edge covers only the status bar, never the header, and shows only after scrolling', async () => {
   for (const theme of ['light', 'dark']) {
    const st = liveState(4);
    st.settings.theme = theme;
    for (let i = 0; i < 12; i++) st.current.chat.push({ id: `m${i}`, role: i % 2 ? 'deka' : 'user', text: 'A line of chat to scroll past.', ts: i, cards: [] });
    await seed(st);
    const check = () => page.js(`(() => {
      const edge = document.getElementById('topEdge'), bar = document.querySelector('.bar'), inner = document.querySelector('.bar-in');
      const e = edge.getBoundingClientRect(), b = inner.getBoundingClientRect(), cs = getComputedStyle(bar), ci = getComputedStyle(inner);
      const paper = getComputedStyle(document.body).backgroundColor;
      return { edgeBottom: e.bottom, headerTop: b.top, soft: getComputedStyle(edge, '::after').opacity, on: edge.classList.contains('on'),
        flat: getComputedStyle(edge).backgroundColor === paper && cs.backgroundColor === paper && bar.getBoundingClientRect().top <= 0,
        sharp: cs.filter === 'none' && ci.filter === 'none' && cs.opacity === '1' && ci.opacity === '1' && (cs.backdropFilter || 'none') === 'none' && cs.maskImage === 'none' };
    })()`);
    for (const screen of ['chat', 'days', 'goals', 'past', 'profile']) {
      if (screen === 'past' || screen === 'profile') { await click('[data-tab=chat]'); await click('[data-a=more]'); await click(`[data-a=go-${screen}]`); }
      else await click(`[data-tab=${screen}]`);
      await page.js("document.getElementById('scroller').scrollTo(0, 0)");
      // The soft edge fades out over 200 ms after the page is back at the top.
      await page.waitFor("getComputedStyle(document.getElementById('topEdge'), '::after').opacity === '0'", 2000).catch(() => {});
      const top = await check();
      assert.ok(top.edgeBottom <= top.headerTop, `${theme} ${screen}: the edge ends above the header`);
      assert.equal(top.soft, '0', `${screen}: no fade at the top of the page`);
      assert.equal(top.sharp, true, `${screen}: the header is sharp`);
      assert.equal(top.flat, true, `${theme} ${screen}: the strip and the header are the page color, with nothing between`);
      if (screen === 'chat' || screen === 'days') {
        await page.js("document.getElementById('scroller').scrollTo(0, 300)"); await sleep(260);
        const mid = await check();
        assert.equal(mid.on, true, `${screen}: the soft edge shows once scrolled`);
        assert.equal(mid.sharp, true, `${screen}: the header stays sharp while it scrolls away`);
      }
      if (screen === 'past' || screen === 'profile') await click('[data-a=back]');
    }
   }
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
  // Copies land here instead of the real clipboard.
  const clip = () => page.js("(() => { window.__copied = []; navigator.clipboard.writeText = t => { window.__copied.push(t); return Promise.resolve(); }; })()");
  const pick = (id, files) => page.js(`(async () => { const dt = new DataTransfer(); for (const f of await Promise.all([${files.join(',')}])) dt.items.add(f); const i = document.getElementById('${id}'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const png = (w, h, name = 'list.png') => `new Promise(r => { const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h}; const g = c.getContext('2d'); g.fillStyle = '#c84'; g.fillRect(0, 0, ${w}, ${h}); c.toBlob(b => r(new File([b], '${name}', { type: 'image/png' })), 'image/png'); })`;
  const PDF = '%PDF-1.4\\n1 0 obj<</Type /Catalog /Pages 2 0 R>>endobj 2 0 obj<</Type /Pages /Kids [3 0 R 4 0 R] /Count 2>>endobj 3 0 obj<</Type /Page /Parent 2 0 R>>endobj 4 0 obj<</Type /Page /Parent 2 0 R>>endobj\\n%%EOF';
  const pdf = (name, pad = 0) => `Promise.resolve(new File(['${PDF}', new Uint8Array(${pad})], '${name}', { type: 'application/pdf' }))`;

  test('a finished reply has Copy, the two ratings and Retry, and Copy copies only the words', async () => {
    await seed(liveState(4));
    await clip();
    await say('plan it');
    assert.equal(await page.js("document.querySelectorAll('.msg.deka .acts').length"), 0, 'no actions while it streams');
    await idle(); await sleep(1300);
    const acts = await page.js("[...document.querySelector('.msg.deka .acts').querySelectorAll('button')].map(b => [b.dataset.a, b.getAttribute('aria-label'), Math.round(b.getBoundingClientRect().width)])");
    assert.deepEqual(acts, [['copy', 'Copy', 44], ['rate', 'Good reply', 44], ['rate', 'Bad reply', 44], ['regen', 'Retry', 44]]);
    await click('.msg.deka [data-a=copy]');
    await page.waitFor("window.__copied.length === 1");
    assert.equal(await page.js('window.__copied[0]'), await lastDeka(), 'the reply text, without the card');
    assert.equal(await text('.msg.deka .act-note'), 'Copied');
    assert.equal(await page.js("document.querySelector('.msg.deka [data-a=copy]').getAttribute('aria-label')"), 'Copied');
    await page.waitFor("!document.querySelector('.msg.deka .act-note').textContent", 3000);
    // A second reply takes Retry; the first keeps the rest.
    await say('keep day 5 free'); await idle(); await sleep(1300);
    assert.deepEqual(await page.js("[...document.querySelectorAll('.msg.deka')].map(m => m.querySelectorAll('[data-a=regen]').length)"), [0, 1]);
  });

  test('your own message: a long press opens a small menu with Copy', async () => {
    await seed(liveState(4));
    await clip();
    await say('plan it'); await idle(); await sleep(1300);
    await page.js("document.querySelector('.msg.user .bubble').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 300 }))");
    await sleep(600);
    assert.equal(await page.js("document.querySelector('.ctx [role=menuitem]').textContent.trim()"), 'Copy');
    assert.equal(await page.js("document.querySelector('.bubble.held') !== null"), true);
    await page.js("document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))");
    await click('.ctx [data-a=copy-user]');
    await page.waitFor('window.__copied.length === 1');
    assert.equal(await page.js('window.__copied[0]'), 'plan it');
    assert.equal(await page.js("document.querySelector('.ctx')"), null, 'the menu closes');
    assert.match(await text('.toast'), /Copied/);
  });

  test('thumbs toggle one at a time; thumbs down asks what went wrong, saves it, exports it and logs it', async () => {
    const logs = [];
    const log = console.log;
    console.log = (...a) => { if (String(a[0]).startsWith('[feedback]')) logs.push(JSON.parse(String(a[0]).slice(11))); else log(...a); };
    try {
      await seed(liveState(4));
      await say('plan it'); await idle(); await sleep(1300);
      const pressed = () => page.js("[...document.querySelectorAll('.msg.deka [data-a=rate]')].map(b => b.getAttribute('aria-pressed'))");
      await click('.msg.deka [data-a=rate][data-v=up]');
      assert.deepEqual(await pressed(), ['true', 'false']);
      await page.waitFor('true'); await sleep(200);
      assert.equal(logs.at(-1).rating, 'up');
      await click('.msg.deka [data-a=rate][data-v=up]');
      assert.deepEqual(await pressed(), ['false', 'false'], 'a second tap clears it');
      await click('.msg.deka [data-a=rate][data-v=down]');
      assert.deepEqual(await pressed(), ['false', 'true']);
      await page.waitFor("document.getElementById('fbText')");
      assert.equal(await page.js("document.getElementById('fbText').placeholder"), 'What went wrong?');
      assert.equal(await text('#sheet [type=submit]'), 'Send');
      await page.js("(() => { const t = document.getElementById('fbText'); t.value = 'Put the gym on my rest day'; document.querySelector('[data-form=feedback]').requestSubmit(); })()");
      await page.waitFor("!document.getElementById('sheet')");
      await sleep(200);
      const reply = await lastDeka();
      const last = logs.at(-1);
      assert.equal(last.rating, 'down');
      assert.equal(last.reason, 'Put the gym on my rest day');
      assert.equal(last.message, reply);
      assert.ok(!Number.isNaN(Date.parse(last.ts)));
      const saved = (await stored()).current.chat.find(m => m.role === 'deka' && m.feedback);
      assert.deepEqual([saved.feedback.rating, saved.feedback.reason], ['down', 'Put the gym on my rest day']);
      // Export carries it.
      const exported = await page.js(`new Promise(r => { URL.createObjectURL = b => { b.text().then(r); return 'blob:x'; }; HTMLAnchorElement.prototype.click = () => {}; document.querySelector('[data-a=more]').click(); setTimeout(() => { document.querySelector('[data-a=go-profile]').click(); document.querySelector('[data-a=export]').click(); }, 50); })`);
      assert.match(exported, /"reason": "Put the gym on my rest day"/);
      assert.equal(sent.filter(p => JSON.stringify(p.messages).includes('rest day')).length, 0, 'feedback never goes to Claude');
    } finally { console.log = log; }
  });

  test('Retry undoes what the reply changed, then asks again the same way', async () => {
    await fresh(); await click('[data-a=intro-start]');
    await say('at least six runs and gym four times'); await idle(); await sleep(1300);
    assert.deepEqual((await stored()).current.intentions.map(g => [g.id, g.target]), [['run', 6], ['gym', 4]]);
    const before = sent.length;
    await click('.msg.deka [data-a=regen]');
    await page.waitFor(`${sent.length} > ${before}`.replace(/.*/, 'true'));
    await idle(); await sleep(1300);
    assert.equal(sent.length, before + 1, 'one more request');
    assert.deepEqual(lastContext().goals, [], 'the retry starts from before the goals were saved');
    assert.match(sent.at(-1).messages.at(-1).content, /Person: at least six runs and gym four times/);
    const st = await stored();
    assert.deepEqual(st.current.intentions.map(g => [g.id, g.target]), [['run', 6], ['gym', 4]], 'saved once, not twice');
    assert.deepEqual(st.current.chat.map(m => m.role), ['user', 'deka'], 'the old reply is gone');
    // A trim answered in words, then Retry: the trim is open again and the counts are back.
    await say('also eight date nights, eight sober nights and gym nine times'); await idle(); await sleep(1300);
    await say('sounds good'); await idle(); await sleep(1300);
    const lowered = (await stored()).current.intentions.find(g => g.id === 'date_night').target;
    assert.ok(lowered < 8);
    await click('.msg.deka:last-child [data-a=regen]');
    await idle(); await sleep(1300);
    assert.deepEqual(lastContext().open_trim.trims.map(t => [t.goal_id, t.requested]), [['date_night', 8], ['sober', 8], ['gym', 9]], 'the retry sees the trim still open');
    assert.equal(lastContext().goals.find(g => g.id === 'date_night').target, 8, 'at the counts asked for');
    assert.equal(await page.js("[...document.querySelectorAll('.goals-card')].filter(c => /Trim applied/.test(c.textContent)).length"), 1, 'answered once, by the retry');
  });

  test('attachments: the plus menu, thumbnails, limits, sending with no text, and the full screen photo', async () => {
    await seed(liveState(4));
    await click('#dock [data-a=attach]');
    assert.deepEqual(await page.js("[...document.querySelectorAll('.ctx [role=menuitem]')].map(b => b.textContent.trim())"), ['Photos', 'Camera', 'Files']);
    await click('.ctx-catch');
    // A big photo comes out at 1568 px on the long edge, as JPEG.
    await pick('pickPhotos', [png(3000, 2000)]);
    await page.waitFor("document.querySelector('#tray img')?.naturalWidth > 0");
    assert.deepEqual(await page.js("(() => { const i = document.querySelector('#tray img'); return [i.naturalWidth, i.naturalHeight, i.draggable]; })()"), [1568, 1045, false]);
    assert.equal(await page.js("document.querySelector('#dock .send').disabled"), false, 'can send with no text');
    // A PDF over 3 MB is turned away with one sentence.
    await pick('pickFiles', [pdf('huge.pdf', 3.2e6)]);
    await page.waitFor("!document.getElementById('attNote').hidden");
    assert.equal(await text('#attNote'), 'That PDF is over 3 MB.');
    // Two PDFs that fit alone but not together.
    await pick('pickFiles', [pdf('one.pdf', 2.2e6), pdf('two.pdf', 2.2e6)]);
    await page.waitFor("document.querySelectorAll('#tray .att').length === 2");
    await sleep(200);
    assert.equal(await text('#attNote'), 'That is too large. A message can carry up to 4 MB.');
    // Remove one; five at most.
    await click('#tray .att:nth-child(2) [data-a=att-rm]');
    assert.equal(await page.js("document.querySelectorAll('#tray .att').length"), 1);
    await pick('pickFiles', [pdf('syllabus.pdf'), png(40, 40, 'a.png'), png(40, 40, 'b.png'), png(40, 40, 'c.png'), png(40, 40, 'd.png')]);
    await page.waitFor("document.querySelectorAll('#tray .att').length === 5");
    await sleep(200);
    assert.equal(await text('#attNote'), 'Up to 5 attachments per message.');
    const rm = await page.js("[...document.querySelectorAll('#tray [data-a=att-rm]')].map(b => [Math.round(b.getBoundingClientRect().width), b.getAttribute('aria-label')])");
    assert.deepEqual(rm[0], [44, 'Remove photo']);
    assert.deepEqual(rm[1], [44, 'Remove syllabus.pdf']);
    await click('#tray .att:nth-child(5) [data-a=att-rm]');
    await click('#tray .att:nth-child(4) [data-a=att-rm]');
    await click('#tray .att:nth-child(3) [data-a=att-rm]');
    // Sent with no text: the photo and the PDF go as an image block and a document block.
    await click('#dock .send');
    await idle();
    const blocks = sent.at(-1).messages.at(-1).content;
    assert.deepEqual(blocks.filter(b => b.type !== 'text').map(b => [b.type, b.source.media_type]), [['image', 'image/jpeg'], ['document', 'application/pdf']]);
    assert.match(blocks.at(-1).text, /Person sent the attachments above with no message/);
    assert.match(await lastDeka(), /Got 1 photo and 1 PDF/);
    assert.equal(await page.js("document.querySelectorAll('.msg.user .bubble.only .sent button').length"), 2);
    assert.equal(await page.js("document.getElementById('tray').hidden"), true, 'the tray empties');
    // Stored in IndexedDB, not localStorage.
    const st = await stored();
    const meta = st.current.chat.find(m => m.attachments).attachments;
    assert.deepEqual(meta.map(a => [a.kind, a.name, a.pages || 0]), [['image', 'list.png', 0], ['pdf', 'syllabus.pdf', 2]]);
    assert.ok(JSON.stringify(st).length < 20000, 'no file data in localStorage');
    assert.equal(await page.js("new Promise(r => { const q = indexedDB.open('deka'); q.onsuccess = () => { const g = q.result.transaction('files').objectStore('files').count(); g.onsuccess = () => r(g.result); }; })"), 2);
    // Tap the photo: full screen. Tap the PDF: its name and page count.
    await click('.msg.user .sent button:first-child');
    await page.waitFor("document.querySelector('.viewer img')");
    assert.equal(await page.js("getComputedStyle(document.querySelector('.viewer img')).webkitUserDrag || 'auto'"), 'auto');
    await click('.viewer .icon-btn');
    await click('.msg.user .sent button:last-child');
    assert.match(await text('.toast'), /syllabus\.pdf, 2 pages\./);
    // Later turns only mention the files.
    await say('thanks'); await idle();
    assert.match(sent.at(-1).messages.map(m => typeof m.content === 'string' ? m.content : '').join('\n'), /\[Attached a photo, a PDF, syllabus\.pdf\]/);
    // Export and import bring them back.
    const exported = await page.js(`new Promise(r => { URL.createObjectURL = b => { b.text().then(r); return 'blob:x'; }; HTMLAnchorElement.prototype.click = () => {}; document.querySelector('[data-a=more]').click(); setTimeout(() => { document.querySelector('[data-a=go-profile]').click(); document.querySelector('[data-a=export]').click(); }, 50); })`);
    const d = JSON.parse(exported);
    assert.equal(Object.keys(d.attachments).length, 2);
  });

  test('feels like an app: only words worth copying select, nothing zooms on a double tap, only the content scrolls', async () => {
    const st = liveState(4);
    for (let i = 0; i < 12; i++) st.current.chat.push({ id: `m${i}`, role: i % 2 ? 'deka' : 'user', text: 'A line of chat to scroll past.', ts: i, cards: [] });
    await seed(st);
    await say('plan it'); await idle(); await sleep(1300);
    const sel = q => page.js(`[...document.querySelectorAll(${JSON.stringify(q)})].map(el => getComputedStyle(el).userSelect || getComputedStyle(el).webkitUserSelect)`);
    const none = async (q, tab) => { if (tab) await click(`[data-tab=${tab}]`); const v = await sel(q); assert.ok(v.length, `${q} is on the page`); assert.ok(v.every(x => x === 'none'), `${q}: ${v.join(', ')}`); };
    await none('header, .brand, .mark, nav.tabs, nav.tabs button, .card, .card .eyebrow, .strip10 .dn, .acts button');
    await none('.head .eyebrow, .head h1, .goal .gn b, .goal .gn span, .actions .link', 'goals');
    await none('.head h1, .day .dn, .day .dd, .day .s', 'days');
    await click('[data-tab=chat]');
    for (const q of ['.say', '.bubble .bt', '#msg']) assert.deepEqual([...new Set(await sel(q))], ['text'], q);
    await click('.day .dl'.replace('.day .dl', '[data-tab=days]'));
    await click('.day[data-day="4"] .dl');
    assert.deepEqual(await sel('#sheet textarea'), ['text'], 'notes');
    await click('#sheet [data-a=sheet-close]');
    await click('[data-tab=chat]');
    const app = await page.js(`(() => {
      const cs = el => getComputedStyle(el);
      const sc = document.getElementById('scroller');
      return { touch: cs(document.documentElement).touchAction, bodyTouch: cs(document.body).touchAction, scTouch: cs(sc).touchAction,
        bodyOver: cs(document.body).overscrollBehaviorY, htmlOver: cs(document.documentElement).overscrollBehaviorY, scOver: cs(sc).overscrollBehaviorY,
        body: cs(document.body).position, scrolls: sc.scrollHeight > sc.clientHeight, page: document.documentElement.scrollHeight <= innerHeight,
        cursor: cs(document.querySelector('.card')).cursor, tap: cs(document.body).webkitTapHighlightColor,
        viewport: document.querySelector('meta[name=viewport]').content,
        drag: [...document.querySelectorAll('img')].every(i => !i.draggable || i.closest('.viewer')) };
    })()`);
    assert.deepEqual(app, { touch: 'manipulation', bodyTouch: 'manipulation', scTouch: 'manipulation', bodyOver: 'none', htmlOver: 'none', scOver: 'contain',
      body: 'fixed', scrolls: true, page: true, cursor: 'default', tap: 'rgba(0, 0, 0, 0)', viewport: 'width=device-width, initial-scale=1, viewport-fit=cover', drag: true });
    assert.doesNotMatch(app.viewport, /user-scalable|maximum-scale/, 'pinch zoom stays');
  });
});
