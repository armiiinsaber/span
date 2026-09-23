// Lighthouse on every screen of the app, at three phone widths, in light and dark, in Safari and
// as the installed home screen app. Chrome cannot emulate the standalone display mode, so the two
// modes differ by navigator.standalone, the one thing the app reads to tell them apart.
// One navigation of a live deka gives the performance and accessibility scores of the
// launch; snapshots after tapping through the app give accessibility for each screen.
// Runs the real server with the scripted stand in for Claude, so it costs nothing.
//
//   LIGHTHOUSE_DIR=/path/to/node_modules node scripts/audit.mjs [out.json]
//
// LIGHTHOUSE_DIR holds lighthouse and puppeteer-core, which are not app dependencies.

import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const DIR = process.env.LIGHTHOUSE_DIR;
if (!DIR) { console.error('Set LIGHTHOUSE_DIR to a node_modules folder with lighthouse and puppeteer-core.'); process.exit(1); }
const { startFlow } = await import(path.join(DIR, 'lighthouse', 'core', 'index.js'));
const puppeteer = (await import(path.join(DIR, 'puppeteer-core', 'lib', 'puppeteer', 'puppeteer-core.js'))).default;

process.env.DEKA_PASSCODE = 'audit';
process.env.MOCK_DELAY = '0';
const { createApp } = require(path.join(ROOT, 'server'));
const mock = require(path.join(ROOT, 'lib', 'mock'));
const { ICONS } = require(path.join(ROOT, 'lib', 'icons'));

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// AUDIT_WIDTHS and AUDIT_MODES narrow a run, like AUDIT_WIDTHS=390 AUDIT_MODES=safari.
const WIDTHS = (process.env.AUDIT_WIDTHS || '375,390,430').split(',').map(Number);
const HEIGHTS = { 375: 812, 390: 844, 430: 932 };
const THEMES = ['light', 'dark'];
const MODES = (process.env.AUDIT_MODES || 'safari,standalone').split(',');
const OUT = process.argv[2] || '';

// A live deka on day 4: some done, one missed, one not confirmed, and a chat with a plan card and a status card.
function state() {
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const start = new Date(); start.setDate(start.getDate() - 3);
  const G = (id, name, type, target, icon) => { const [, category, energy, social, fun, time_of_day, weekend] = ICONS[icon]; return { id, name, type, tag: '', target, icon, category, energy, social, fun, time_of_day, weekend }; };
  const intentions = [G('date', 'Date night', 'see', 1, 'date'), G('mom', 'See mom', 'see', 2, 'family'), G('run', 'Run', 'do', 4, 'run'), G('gym', 'Gym', 'do', 4, 'gym'),
    G('music', 'Make music', 'do', 3, 'music'), G('work', 'Rentletter', 'do', 5, 'laptop'), G('sober', 'Sober night', 'abstain', 3, 'moon')];
  const plan = { 1: ['gym', 'work'], 2: ['run', 'music', 'sober'], 3: ['gym', 'date'], 4: ['run', 'mom', 'work'], 5: ['gym', 'sober'], 6: ['run', 'work', 'music'], 7: ['gym', 'mom'], 8: ['run', 'work', 'sober'], 9: ['music', 'work'] };
  const occurrences = [];
  for (const [d, ids] of Object.entries(plan)) for (const id of ids) {
    const n = Number(d);
    occurrences.push({ intention_id: id, day: n, done: n < 4 && !(n === 2 && id === 'music') && !(n === 3 && id === 'gym'), missed: n === 2 && id === 'music', detail: '' });
  }
  const upcoming = occurrences.filter(o => o.day >= 4).map(o => ({ goal_id: o.intention_id, day: o.day, detail: '' }));
  const chat = [
    { id: 'u1', role: 'user', text: 'keep day 5 light', ts: 1, cards: [] },
    { id: 'd1', role: 'deka', text: 'Day 5 keeps just the gym and a sober night.', ts: 2, cards: [
      { type: 'proposal', id: 'p1', target: 'current', occurrences: upcoming, summary: 'Day 5 light, runs spread out', changes: [], changed_days: [5, 6], status: 'open', moved: { 'work@6': 5 } },
    ] },
    { id: 'u2', role: 'user', text: 'how is it going?', ts: 3, cards: [] },
    { id: 'd2', role: 'deka', text: 'Steady. Protect the run tomorrow.', ts: 4, cards: [
      { type: 'status', span: 'c1', day: 4, goals: intentions.map(g => ({ id: g.id, name: g.name, type: g.type, icon: g.icon, category: g.category, done: occurrences.filter(o => o.intention_id === g.id && o.done).length, target: g.target })) },
    ] },
  ];
  return { v: 1, seen: true, next: null, spans: [], settings: { checkin: '23:59', theme: 'system' },
    current: { id: 'c1', start: iso(start), status: 'live', notes: { 4: 'Slept well.' }, log: [], chat, summary: '', summarizedUpTo: 0, checked: [1, 2], checkin: {}, intentions, occurrences } };
}

// A fresh server for each run: the login limit (10 tries in 15 minutes) lives in its memory.
let server = null, base = '';
async function serve() {
  if (server) server.close();
  server = createApp({ client: mock }).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/`;
}
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
const results = [];

try {
  for (const width of WIDTHS) {
    for (const mode of MODES) for (const theme of THEMES) {
      await serve();
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(standalone => { Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true }); }, mode === 'standalone');
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
      await page.goto(base);
      await page.evaluate(async s => {
        await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: 'audit' }) });
        // Stop the running page from saving its own state over the seed before the audit reloads it.
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function () {};
        set.call(localStorage, 'deka.v1', JSON.stringify(s));
      }, state());
      const config = { extends: 'lighthouse:default', settings: {
        formFactor: 'mobile', disableStorageReset: true, onlyCategories: ['performance', 'accessibility'],
        screenEmulation: { mobile: true, width, height: HEIGHTS[width], deviceScaleFactor: 3, disabled: false },
      } };
      const flow = await startFlow(page, { config, flags: { disableStorageReset: true } });
      const tap = async sel => { await page.waitForSelector(sel, { timeout: 3000 }).catch(() => {}); const ok = await page.evaluate(q => { const el = document.querySelector(q); if (el) el.click(); return Boolean(el); }, sel); if (!ok) throw new Error(`nothing to tap at ${sel} (${width}px ${mode} ${theme})`); await new Promise(r => setTimeout(r, 450)); };
      const snap = name => flow.snapshot({ name });
      await flow.navigate(base, { name: 'launch' });
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
      await snap('chat');
      await tap('.msg.deka [data-a=rate][data-v=down]'); await snap('feedback sheet'); await tap('#sheet [data-a=sheet-close]');
      await tap('#dock [data-a=attach]'); await snap('attach menu'); await tap('.ctx-catch');
      await tap('[data-tab=days]'); await snap('days');
      await tap('.day[data-day="4"] .dl'); await snap('day sheet'); await tap('#sheet [data-a=sheet-close]');
      await tap('[data-tab=goals]'); await snap('goals');
      await tap('.row-btn'); await tap('[data-a=icon-open]'); await snap('goal sheet'); await tap('#sheet [data-a=sheet-close]');
      await tap('[data-a=more]'); await snap('more sheet');
      await tap('[data-a=go-past]'); await snap('past');
      await tap('[data-a=back]'); await tap('[data-a=more]'); await tap('[data-a=go-profile]'); await snap('profile');
      await page.evaluate(() => { localStorage.clear(); location.reload(); }); await new Promise(r => setTimeout(r, 900)); await snap('theme choice');
      await tap('[data-a=theme][data-v=system]'); await snap('intro');
      await page.evaluate(() => fetch('/api/logout', { method: 'POST' }).then(() => location.reload())); await new Promise(r => setTimeout(r, 900)); await snap('login');
      const res = await flow.createFlowResult();
      for (const step of res.steps) {
        const lhr = step.lhr;
        // Performance is only measured on a navigation; a snapshot has no load to time.
        const cat = k => lhr.categories[k] && (k !== 'performance' || lhr.gatherMode === 'navigation') ? Math.round(lhr.categories[k].score * 100) : null;
        const failing = Object.values(lhr.audits).filter(a => a.scoreDisplayMode === 'binary' && a.score === 0 && (lhr.categories.accessibility?.auditRefs || []).some(r => r.id === a.id)).map(a => a.id);
        results.push({ width, mode, theme, step: step.name, performance: cat('performance'), accessibility: cat('accessibility'), failing });
      }
      await page.close();
      const mine = results.filter(r => r.width === width && r.mode === mode && r.theme === theme);
      console.log(`${width}px ${mode} ${theme}: ${mine.map(r => `${r.step} ${r.performance != null ? `perf ${r.performance} ` : ''}a11y ${r.accessibility}${r.failing.length ? ` (${r.failing.join(', ')})` : ''}`).join(' | ')}`);
    }
  }
} finally {
  await browser.close();
  if (server) server.close();
}
if (OUT) fs.writeFileSync(OUT, `${JSON.stringify(results, null, 1)}\n`);
const perf = results.filter(r => r.performance != null).map(r => r.performance);
const a11y = results.map(r => r.accessibility);
console.log(`performance ${Math.min(...perf)} to ${Math.max(...perf)}, accessibility ${Math.min(...a11y)} to ${Math.max(...a11y)} across ${results.length} audits`);
process.exit(0);
