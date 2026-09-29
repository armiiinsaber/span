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

async function setup(keysSignedIn) {
  const fake = await startFake();
  const db = createDb(fake.databaseUrl);
  const server = createApp({ client: mock, db, chatPerTenMinutes: 1000, supabase: { url: fake.url, anonKey: fake.anonKey, serviceKey: fake.serviceKey, jwtSecret: fake.jwtSecret } }).listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const context = await browser.newContext({ ...devices['iPhone 15'] });
  const page = await context.newPage();
  await page.goto(base);
  const config = { url: fake.url, anonKey: fake.anonKey };
  if (keysSignedIn) {
    const who = await fake.user('typing@example.com', { first_name: 'Ana', last_name: 'Silva', username: 'ana.typing' });
    const d = new Date(); d.setDate(d.getDate() - 3);
    const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const state = { v: 1, seen: true, next: null, spans: [], owner: who.user.id, settings: { checkin: '23:59', theme: 'light' },
      current: { id: 'c1', start, status: 'live', notes: {}, log: [], chat: [], summary: '', summarizedUpTo: 0, checked: [], checkin: {}, intentions: [{ id: 'run', name: 'Run', type: 'do', tag: '', target: 3 }], occurrences: [{ intention_id: 'run', day: 4, done: false, detail: '' }] } };
    await page.evaluate(({ config, session, state }) => {
      localStorage.setItem('deka.config', JSON.stringify(config));
      localStorage.setItem('deka.session', JSON.stringify(session));
      localStorage.setItem('deka.v1', JSON.stringify(state));
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

