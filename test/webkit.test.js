// Typing in Safari's engine: Playwright's WebKit with an iPhone profile. Every field gets real
// keystrokes, a whole email pasted as one insert, an autocorrect style replacement, and IME
// composition, and each must leave the full value in the field and the field itself in place.
// A suggestion on iOS lands in two steps into the same element, so a field that is redrawn after
// the first step keeps only the first letter; the replacement check copies that. Skipped when
// Playwright's WebKit is not installed (npx playwright install webkit).
const test = require('node:test');
const assert = require('node:assert');

process.env.MOCK_DELAY = '4';
const { createApp } = require('../server');
const { createDb } = require('../lib/db');
const mock = require('../lib/mock');
const { startFake } = require('./fake-supabase');

let webkit, devices;
try { ({ webkit, devices } = require('playwright')); } catch {}

let browser = null, why = false;
test.before(async () => {
  if (!webkit) { why = 'needs playwright'; return; }
  try { browser = await webkit.launch(); } catch { why = 'needs Playwright WebKit (npx playwright install webkit)'; }
});
test.after(async () => { if (browser) await browser.close(); });

// Each way text can arrive, run on the element the keyboard holds. Returns what the page shows after.
async function arrive(page, sel, how, text) {
  if (how === 'type') { await page.locator(sel).click(); await page.locator(sel).fill(''); await page.locator(sel).pressSequentially(text, { delay: 15 }); }
  else if (how === 'paste') { await page.locator(sel).click(); await page.locator(sel).fill(''); await page.keyboard.insertText(text); }
  else await page.evaluate(({ sel, how, text }) => {
    const el = document.querySelector(sel);
    el.focus();
    el.value = '';
    const fire = (type, init) => el.dispatchEvent(new InputEvent(type, { bubbles: true, cancelable: type === 'beforeinput', ...init }));
    if (how === 'replace') {
      // An autocorrect or QuickType suggestion: the first letter, then the rest, into the same element.
      fire('beforeinput', { inputType: 'insertReplacementText', data: text });
      el.value = text.slice(0, 1);
      fire('input', { inputType: 'insertReplacementText', data: text.slice(0, 1) });
      el.value = text;
      fire('input', { inputType: 'insertReplacementText', data: text });
    } else {
      // IME composition: marked text grows, then commits.
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      for (let i = 1; i <= text.length; i++) {
        el.value = text.slice(0, i);
        fire('input', { inputType: 'insertCompositionText', data: text.slice(0, i), isComposing: true });
      }
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
    }
  }, { sel, how, text });
  await page.waitForTimeout(60);
  return page.evaluate(sel => document.querySelector(sel).value, sel);
}
const HOWS = ['type', 'paste', 'replace', 'compose'];

async function setup(keysSignedIn, { empty = false } = {}) {
  const fake = await startFake();
  const db = createDb(fake.databaseUrl);
  const server = createApp({ client: mock, db, chatPerTenMinutes: 1000, supabase: { url: fake.url, anonKey: fake.anonKey, serviceKey: fake.serviceKey, jwtSecret: fake.jwtSecret } }).listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const context = await browser.newContext({ ...devices['iPhone 15'], viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(base);
  const config = { url: fake.url, anonKey: fake.anonKey };
  if (keysSignedIn) {
    const who = await fake.user('typing@example.com', { first_name: 'Ana', last_name: 'Silva', username: 'ana.typing' });
    const d = new Date(); d.setDate(d.getDate() - 3);
    const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const state = empty ? { v: 1, seen: true, next: null, spans: [], owner: who.user.id, settings: { checkin: '23:59', theme: 'light' }, current: null } : { v: 1, seen: true, next: null, spans: [], owner: who.user.id, settings: { checkin: '23:59', theme: 'light' },
      current: { id: 'c1', start, status: 'live', notes: {}, log: [], chat: [], summary: '', summarizedUpTo: 0, checked: [], checkin: {}, intentions: [{ id: 'run', name: 'Run', type: 'do', tag: '', target: 3 }], occurrences: [{ intention_id: 'run', day: 4, done: false, detail: '' }] } };
    // The page already open saves its own state a moment later; stop it before writing ours.
    await page.evaluate(({ config, session, state }) => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function () {};
      set.call(localStorage, 'deka.config', JSON.stringify(config));
      set.call(localStorage, 'deka.session', JSON.stringify(session));
      set.call(localStorage, 'deka.v1', JSON.stringify(state));
    }, { config, session: { access_token: who.access_token, refresh_token: who.refresh_token, expires_at: who.expires_at, user: { id: who.user.id, email: who.user.email } }, state });
  } else await page.evaluate(config => localStorage.setItem('deka.config', JSON.stringify(config)), config);
  await page.goto(base);
  const done = async () => { await context.close(); server.close(); await db.end(); await fake.stop(); };
  return { page, fake, done };
}

// Every way of typing leaves the whole value, in the same element, and nothing redraws the form.
async function checkFields(page, fields) {
  for (const [sel, text] of fields) {
    for (const how of HOWS) {
      const before = await page.evaluateHandle(s => document.querySelector(s), sel);
      const got = await arrive(page, sel, how, text);
      assert.equal(got, text, `${sel} by ${how}`);
      assert.equal(await page.evaluate(([s, el]) => document.querySelector(s) === el, [sel, before]), true, `${sel} by ${how}: the field was never replaced`);
    }
  }
}

test('sign in, sign up and the code: every way of typing keeps the whole value', async t => {
  if (why) return t.skip(why);
  const { page, fake, done } = await setup(false);
  try {
    await page.waitForSelector('#email');
    assert.equal(await page.evaluate(() => document.getElementById('barIn').innerHTML), '', 'no header mark on sign in');
    await checkFields(page, [['#email', 'kai.moreau@example.com']]);
    assert.equal(await page.locator('.auth [type=submit]').isDisabled(), false, 'the button follows the field');
    await page.click('[data-a=auth-go][data-v=signup]');
    await page.waitForSelector('#first');
    assert.equal(await page.evaluate(() => document.getElementById('barIn').innerHTML), '', 'no header mark on sign up');
    await checkFields(page, [['#first', 'Kai'], ['#last', 'Moreau'], ['#username', 'Kai.Moreau'], ['#email', 'kai@example.com'], ['#confirm', 'kai@example.com']]);
    // A composed username is not tidied while it is typed, only once the field is left.
    assert.equal(await page.inputValue('#username'), 'kai.moreau', 'left for the email fields, so already tidy');
    await arrive(page, '#username', 'compose', 'Kai.Moreau');
    assert.equal(await page.inputValue('#username'), 'Kai.Moreau');
    await page.locator('#username').focus(); await page.locator('#first').focus();
    assert.equal(await page.inputValue('#username'), 'kai.moreau', 'lowercase once the field is left');
    await page.waitForFunction(() => /Available/.test(document.getElementById('note-username').textContent));
    assert.equal(await page.locator('.auth [type=submit]').isDisabled(), false);
    // The attributes iOS reads for autofill and suggestions.
    const attrs = await page.evaluate(() => Object.fromEntries(['first', 'last', 'username', 'email', 'confirm'].map(id => { const e = document.getElementById(id); return [id, ['type', 'autocomplete', 'autocapitalize', 'autocorrect', 'spellcheck', 'inputmode'].map(a => e.getAttribute(a)).join(' ')]; })));
    assert.deepEqual(attrs, {
      first: 'text given-name words   ',
      last: 'text family-name words   ',
      username: 'text username none off false ',
      email: 'email email none off false email',
      confirm: 'email email none off false email',
    });
    // Selection and callouts are on for fields, whatever the page around them says.
    const css = await page.evaluate(() => [...document.querySelectorAll('input')].map(i => [getComputedStyle(i).webkitUserSelect, getComputedStyle(i).webkitTouchCallout || 'default']));
    assert.ok(css.every(([sel, call]) => sel === 'text' && call !== 'none'), JSON.stringify(css));
    // The code: typed, pasted, suggested from Mail, or composed, it is read whole.
    await page.click('.auth [type=submit]');
    await page.waitForSelector('#code');
    assert.deepEqual(await page.evaluate(() => { const c = document.getElementById('code'); return [c.getAttribute('inputmode'), c.getAttribute('autocomplete')]; }), ['numeric', 'one-time-code']);
    for (const how of HOWS) {
      const el = await page.evaluateHandle(() => document.getElementById('code'));
      await arrive(page, '#code', how, '12345');
      assert.equal(await page.inputValue('#code'), '12345', `code by ${how}`);
      assert.equal(await page.evaluate(e => document.getElementById('code') === e, el), true);
    }
    const code = fake.codeFor('kai@example.com');
    await page.evaluate(() => { document.getElementById('code').value = ''; });
    await page.locator('#code').click();
    await page.keyboard.insertText(code);
    await page.waitForSelector('.choose', { timeout: 8000 });
  } finally { await done(); }
});

test('the account sheet, the composer and the thumbs down field keep every word', async t => {
  if (why) return t.skip(why);
  const { page, done } = await setup(true);
  try {
    await page.waitForSelector('#msg');
    // The composer keeps normal suggestions.
    assert.deepEqual(await page.evaluate(() => { const m = document.getElementById('msg'); return [m.getAttribute('autocorrect'), m.getAttribute('spellcheck'), m.getAttribute('autocapitalize')]; }), [null, null, null]);
    await checkFields(page, [['#msg', 'Keep day five light please']]);
    await page.fill('#msg', 'keep day 5 free');
    await page.click('#dock .send');
    await page.waitForSelector('.msg.deka [data-a=rate][data-v=down]', { timeout: 8000 });
    await page.waitForTimeout(1300);
    await page.click('.msg.deka [data-a=rate][data-v=down]');
    await page.waitForSelector('#fbText');
    await checkFields(page, [['#fbText', 'I wanted day five light, not empty']]);
    await page.click('#sheet [data-a=sheet-close]');
    // Name and username in Profile.
    await page.click('[data-a=more]'); await page.click('#sheet [data-a=go-profile]');
    await page.click('[data-a=edit-account]');
    await page.waitForSelector('#sheet #username');
    await checkFields(page, [['#sheet #first', 'Anna'], ['#sheet #last', 'Silva Costa'], ['#sheet #username', 'anna.costa']]);
    // A day's notes.
    await page.click('#sheet [data-a=sheet-close]');
    await page.click('[data-tab=days]');
    await page.click('.day[data-day="4"] .dl');
    await page.waitForSelector('#note-4');
    await checkFields(page, [['#note-4', 'Slept well, legs heavy']]);
  } finally { await done(); }
});

test('autofilled fields look like any other field, in light and dark', async t => {
  if (why) return t.skip(why);
  const { page, done } = await setup(false);
  try {
    await page.waitForSelector('#email');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(th => { document.documentElement.dataset.theme = th; }, theme);
      const r = await page.evaluate(() => {
        const rules = [];
        for (const sheet of document.styleSheets) for (const rule of sheet.cssRules) if (rule.selectorText && /autofill/.test(rule.selectorText)) rules.push(rule);
        const field = document.getElementById('email');
        const out = { selectors: rules.map(x => x.selectorText), valid: [] };
        for (const sel of ['input:-webkit-autofill', 'input:autofill']) { try { field.matches(sel); out.valid.push(sel); } catch {} }
        // What an autofilled field gets: the same declarations, on a field in the same place.
        const probe = field.cloneNode(); probe.id = 'probe'; field.parentNode.appendChild(probe);
        out.fields = rules.map(rule => {
          probe.style.cssText = rule.style.cssText;
          const cs = getComputedStyle(probe);
          return { shadow: cs.boxShadow, fill: cs.webkitTextFillColor, caret: cs.caretColor, border: `${cs.borderBottomStyle} ${cs.borderBottomWidth} ${cs.borderBottomColor}` };
        });
        probe.remove();
        const plain = getComputedStyle(field);
        out.page = getComputedStyle(document.body).backgroundColor;
        out.ink = getComputedStyle(document.body).color;
        out.border = `${plain.borderBottomStyle} ${plain.borderBottomWidth} ${plain.borderBottomColor}`;
        return out;
      });
      assert.deepEqual(r.valid, ['input:-webkit-autofill', 'input:autofill'], 'WebKit knows both selectors');
      assert.equal(r.selectors.length, 2, 'one rule for each, so neither can drop the other');
      for (const sel of r.selectors) for (const state of ['', ':hover', ':focus', ':active']) assert.ok(sel.includes(`autofill${state},`) || sel.endsWith(`autofill${state}`), `${sel} covers ${state || 'rest'}`);
      for (const f of r.fields) {
        assert.ok(f.shadow.startsWith(r.page) && /inset/.test(f.shadow), `${theme}: the page color over the yellow, got ${f.shadow}`);
        assert.equal(f.fill, r.ink, `${theme}: text in ink`);
        assert.equal(f.caret, r.ink, `${theme}: caret in ink`);
        assert.equal(f.border, r.border, `${theme}: the same underline`);
      }
      assert.equal(r.page, theme === 'dark' ? 'rgb(20, 19, 15)' : 'rgb(245, 243, 236)');
    }
  } finally { await done(); }
});

// A keyboard, as WebKit sees one: the visual viewport shrinks, and iOS may also pan it down by
// offsetTop to keep the composer in view. The layout viewport stays as it was.
const keyboard = (page, { kb = 336, pan = 0 } = {}) => page.evaluate(({ kb, pan }) => {
  const vv = window.visualViewport, full = document.documentElement.clientHeight;
  Object.defineProperty(vv, 'height', { configurable: true, get: () => full - kb });
  Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => pan });
  vv.dispatchEvent(new Event('resize'));
}, { kb, pan });
const noKeyboard = page => page.evaluate(() => {
  const vv = window.visualViewport;
  delete vv.height; delete vv.offsetTop;
  document.activeElement && document.activeElement.blur();
  vv.dispatchEvent(new Event('resize'));
});
const layout = page => page.evaluate(() => {
  const r = el => el.getBoundingClientRect();
  const vv = window.visualViewport, dock = r(document.getElementById('dock')), tabs = document.getElementById('tabs');
  const empty = document.querySelector('.chat-empty.float');
  const e = empty && r(empty.querySelector('.mk')), h = empty && r(empty.querySelector('h1'));
  return {
    kb: document.body.classList.contains('kb'),
    visibleTop: vv.offsetTop, visibleBottom: vv.offsetTop + vv.height,
    dockTop: dock.top, dockBottom: dock.bottom,
    tabs: getComputedStyle(tabs).visibility, tabsTop: r(tabs).top,
    empty: empty ? { top: e.top, bottom: h.bottom, mid: (e.top + h.bottom) / 2, shown: getComputedStyle(empty).display !== 'none' && h.height > 0 } : null,
    header: r(document.querySelector('.bar')).bottom,
  };
});

test('with the keyboard up: the empty chat stays centred in view, the tab bar slides away, the composer sits on the keyboard', async t => {
  if (why) return t.skip(why);
  const { page, done } = await setup(true, { empty: true });
  try {
    await page.waitForSelector('.chat-empty.float');
    // No keyboard: centred between the header and the composer, tabs in place.
    let l = await layout(page);
    assert.equal(l.kb, false);
    assert.equal(l.tabs, 'visible');
    assert.ok(Math.abs(l.empty.mid - (l.header + l.dockTop) / 2) < 24, `centred above the composer: ${l.empty.mid} in ${l.header} to ${l.dockTop}`);
    // The composer is one card: the text field on top, the plus on the left and send on the right below it.
    const card = await page.evaluate(() => {
      const r = sel => document.querySelector(sel).getBoundingClientRect();
      const ta = r('#msg'), plus = r('#dock [data-a=attach]'), send = r('#dock .send');
      return { textAbove: ta.bottom <= plus.top + 1 && ta.bottom <= send.top + 1, plusLeft: plus.left < ta.left + 24, sendRight: send.right > ta.right - 24, sizes: [plus.width, plus.height, send.width, send.height].map(Math.round), wide: ta.width > 250 };
    });
    assert.deepEqual(card, { textAbove: true, plusLeft: true, sendRight: true, sizes: [44, 44, 44, 44], wide: true });
    for (const pan of [0, 336]) {
      await page.focus('#msg');
      await keyboard(page, { pan });
      await page.waitForTimeout(450);
      l = await layout(page);
      assert.equal(l.kb, true, `pan ${pan}: the keyboard is seen`);
      assert.equal(l.tabs, 'hidden', `pan ${pan}: the tab bar slides away`);
      assert.ok(Math.abs(l.dockBottom - l.visibleBottom) <= 1, `pan ${pan}: the composer sits on the keyboard, ${l.dockBottom} against ${l.visibleBottom}`);
      assert.ok(l.empty.shown && l.empty.top >= l.visibleTop && l.empty.bottom <= l.dockTop, `pan ${pan}: the mark and line stay in view`);
      assert.ok(Math.abs(l.empty.mid - (l.visibleTop + 12 + l.dockTop) / 2) < 24, `pan ${pan}: centred in what is left`);
      // Typing keeps it flush as the field grows.
      await page.fill('#msg', 'one\ntwo\nthree\nfour');
      await page.evaluate(() => document.getElementById('msg').dispatchEvent(new Event('input', { bubbles: true })));
      await page.waitForTimeout(100);
      l = await layout(page);
      assert.ok(Math.abs(l.dockBottom - l.visibleBottom) <= 1, `pan ${pan}: still flush as the text grows`);
      await page.fill('#msg', '');
      await noKeyboard(page);
      await page.waitForTimeout(450);
      l = await layout(page);
      assert.equal(l.kb, false);
      assert.equal(l.tabs, 'visible', `pan ${pan}: the tab bar comes back`);
      assert.ok(l.dockBottom < l.tabsTop, 'the composer floats above the tab bar again');
    }
    // The first message sent: the mark and line go.
    await page.fill('#msg', 'at least six runs');
    await page.click('#dock .send');
    await page.waitForFunction(() => !document.querySelector('.chat-empty'));
  } finally { await done(); }
});

// Reads the pixels of a PNG screenshot: 8 bit RGB or RGBA, not interlaced, as WebKit writes them.
function readPng(buf) {
  const zlib = require('zlib');
  let pos = 8, width = 0, height = 0, channels = 4;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = data[9] === 6 ? 4 : 3; }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * channels, px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = y && x >= channels ? px[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      px[y * stride + x] = (row[x] + pred) & 255;
    }
  }
  return { width, height, at: (x, y) => { const i = y * stride + x * channels; return [px[i], px[i + 1], px[i + 2]]; } };
}
const rgbOf = css => css.match(/\d+/g).slice(0, 3).map(Number);
const near = (a, b, tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test('with the keyboard up, the composer carries on under the keyboard: no strip, no edge, in light and dark', async t => {
  if (why) return t.skip(why);
  const { page, done } = await setup(true);
  try {
    await page.waitForSelector('#msg');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(th => { document.documentElement.dataset.theme = th; }, theme);
      // Keyboard down: the glass card above the tab bar, with no extension.
      let st = await page.evaluate(() => { const d = document.getElementById('dock'); return { after: getComputedStyle(d, '::after').content, glass: getComputedStyle(d).webkitBackdropFilter || getComputedStyle(d).backdropFilter }; });
      assert.ok(st.after === 'none' || st.after === 'normal', `${theme}: no extension with the keyboard down`);
      assert.notEqual(st.glass, 'none', `${theme}: glass with the keyboard down`);
      await page.focus('#msg');
      await keyboard(page, { kb: 336 });
      await page.waitForTimeout(450);
      const m = await page.evaluate(() => {
        const d = document.getElementById('dock'), cs = getComputedStyle(d), after = getComputedStyle(d, '::after'), r = d.getBoundingClientRect();
        const below = document.elementFromPoint(r.left + r.width / 2, r.bottom + 60);
        return {
          dockBottom: r.bottom, dockTop: r.top, full: document.documentElement.clientHeight,
          surface: cs.backgroundColor, extension: after.backgroundColor, extensionHeight: parseFloat(after.height), events: after.pointerEvents,
          page: getComputedStyle(document.body).backgroundColor, keyboard: getComputedStyle(document.documentElement).getPropertyValue('--keyboard').trim(),
          glass: cs.webkitBackdropFilter || cs.backdropFilter, borderBottom: cs.borderBottomWidth, radius: [cs.borderTopLeftRadius, cs.borderBottomLeftRadius],
          tapsBelow: Boolean(below && below.closest('#dock')),
          scroll: [document.documentElement.scrollHeight - document.documentElement.clientHeight, document.body.scrollHeight - document.body.clientHeight],
        };
      });
      assert.equal(m.surface, m.extension, `${theme}: the extension is the composer's own colour`);
      assert.deepEqual(rgbOf(m.surface), theme === 'dark' ? [44, 44, 46] : [209, 211, 217], `${theme}: the iOS keyboard surface`);
      assert.ok(m.extensionHeight >= 336 + 45 && m.dockBottom + m.extensionHeight >= m.full + 336, `${theme}: taller than the keyboard and its bar`);
      assert.equal(m.events, 'none', `${theme}: the extension takes no taps`);
      assert.equal(m.tapsBelow, false, `${theme}: a tap below the composer does not land on it`);
      assert.deepEqual(m.scroll, [0, 0], `${theme}: nothing scrolls because of it`);
      assert.equal(m.glass, 'none', `${theme}: no glass with the keyboard up`);
      assert.equal(m.borderBottom, '0px');
      assert.deepEqual(m.radius, ['26px', '0px'], `${theme}: rounded on top only`);
      // The pixels: from just inside the composer's bottom down to the bottom of the screen, where
      // iOS draws its bar and keyboard, every sample is the keyboard surface, never the page.
      const png = readPng(await page.screenshot());
      const scale = png.width / 390, surface = rgbOf(m.surface), pageBg = rgbOf(m.page);
      const seen = [];
      for (const y of [m.dockBottom - 2, m.dockBottom, m.dockBottom + 1, m.dockBottom + 3, m.dockBottom + 45, m.dockBottom + 200, m.full - 2]) {
        for (const x of [2, 60, 195, 330, 388]) {
          const c = png.at(Math.min(png.width - 1, Math.round(x * scale)), Math.min(png.height - 1, Math.round(y * scale)));
          seen.push(c);
          assert.ok(near(c, surface), `${theme}: at ${x},${Math.round(y)} ${c} is the keyboard surface ${surface}`);
          assert.ok(!near(c, pageBg, 1), `${theme}: at ${x},${Math.round(y)} no page background`);
        }
      }
      // Keyboard down again: the extension goes with it, and the card is back above the tab bar.
      await noKeyboard(page);
      await page.waitForTimeout(450);
      st = await page.evaluate(() => { const d = document.getElementById('dock'); return { after: getComputedStyle(d, '::after').content, kb: document.body.classList.contains('kb'), bottom: d.getBoundingClientRect().bottom, tabs: document.getElementById('tabs').getBoundingClientRect().top }; });
      assert.equal(st.kb, false);
      assert.ok(st.after === 'none' || st.after === 'normal', `${theme}: the extension is gone`);
      assert.ok(st.bottom < st.tabs, `${theme}: the card floats above the tab bar again`);
    }
  } finally { await done(); }
});

test('the color scheme is the resolved theme, before paint, on the root, the meta tag and every field', async t => {
  if (why) return t.skip(why);
  const { page, done } = await setup(true);
  try {
    await page.waitForSelector('#msg');
    // What the head script set before the body existed.
    await page.addInitScript(() => {
      new MutationObserver((l, o) => { if (document.body) { window.__atBody = document.documentElement.style.colorScheme || 'none'; o.disconnect(); } }).observe(document, { childList: true, subtree: true });
    });
    const read = () => page.evaluate(() => {
      const root = document.documentElement, cs = el => el && getComputedStyle(el).colorScheme;
      return { atBody: window.__atBody, inline: root.style.colorScheme, root: cs(root), meta: document.querySelector('meta[name=color-scheme]').content, composer: cs(document.getElementById('msg')), time: cs(document.getElementById('checkinTime')) };
    });
    for (const system of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: system });
      for (const choice of ['light', 'dark', 'system']) {
        const want = choice === 'system' ? system : choice;
        // The choice as a device would have it saved, then a fresh load.
        await page.evaluate(choice => {
          const set = Storage.prototype.setItem;
          Storage.prototype.setItem = function () {};
          const st = JSON.parse(localStorage.getItem('deka.v1'));
          st.settings.theme = choice;
          set.call(localStorage, 'deka.v1', JSON.stringify(st));
          set.call(localStorage, 'deka.theme', choice);
        }, choice);
        await page.reload();
        await page.waitForSelector('#msg');
        let r = await read();
        const where = `${choice} on a ${system} phone`;
        assert.equal(r.atBody, want, `${where}: set before paint`);
        assert.equal(r.inline, want, `${where}: on the root`);
        assert.equal(r.root, want, `${where}: computed on the root`);
        assert.equal(r.meta, want, `${where}: the meta tag`);
        assert.equal(r.composer, want, `${where}: the composer`);
        // And an input in Profile.
        await page.click('[data-a=more]'); await page.click('#sheet [data-a=go-profile]');
        await page.waitForSelector('#checkinTime');
        r = await read();
        assert.equal(r.time, want, `${where}: an input in Profile`);
        await page.click('[data-a=back]');
      }
      // Match iPhone follows the phone when its appearance changes.
      await page.emulateMedia({ colorScheme: system === 'light' ? 'dark' : 'light' });
      await page.waitForTimeout(100);
      const flipped = system === 'light' ? 'dark' : 'light';
      const r = await read();
      assert.deepEqual([r.inline, r.meta, r.composer], [flipped, flipped, flipped], `Match iPhone on a ${system} phone that turns ${flipped}`);
    }
    // Changing it in Profile changes it at once.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.click('[data-a=more]'); await page.click('#sheet [data-a=go-profile]');
    for (const [choice, want] of [['dark', 'dark'], ['light', 'light'], ['system', 'light']]) {
      await page.click(`[data-a=theme][data-v=${choice}]`);
      await page.waitForTimeout(250);
      const r = await read();
      assert.deepEqual([r.inline, r.root, r.meta, r.time], [want, want, want, want], `Profile set to ${choice}`);
    }
  } finally { await done(); }
});

