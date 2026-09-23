// Runs Deka against the real Claude API through the real server and tool loop, the
// way the app would: it logs in, sends each turn to POST /api/chat, reads the event
// stream, and applies goals, logs and confirmed proposals to a copy of the app state.
// The Anthropic client is the real SDK, wrapped only to record usage, raw text (before
// the server tidies dashes) and tool inputs. Nothing secret is written out.
//
//   node --env-file=.env.local scripts/real-runs.js [--runs 2] [--out test/real-runs]
//
// Costs real money: a full run is about a dozen turns.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.env.DEKA_PASSCODE = crypto.randomBytes(16).toString('hex');
if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY is not set.'); process.exit(1); }

const Anthropic = require('@anthropic-ai/sdk');
const { createApp } = require('../server');
const { MODEL } = require('../lib/chat');

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const RUNS = Number(arg('runs', 1));
const OUT = arg('out', '');
const ONLY = arg('only', '');

// Claude Opus 5.5 list prices, dollars per million tokens.
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };
const DASH = /[\u2014\u2013]| -{1,2} /;

/* Dates, as the app does them */

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = s => { const d = parse(s); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const range = start => `${fmt(start)} to ${fmt(addDays(start, 9))}`;
const weekday = s => WEEKDAYS[parse(s).getDay()];
const dayMap = start => Array.from({ length: 10 }, (_, i) => ({ day: i + 1, date: addDays(start, i), weekday: weekday(addDays(start, i)) }));

/* The app state, ported from public/index.html */

let uidN = 0;
const uid = () => `u${++uidN}`;
const newSpan = start => ({ id: uid(), start, status: 'planning', intentions: [], occurrences: [], notes: {}, chat: [], summary: '', summarizedUpTo: 0, checked: [], checkin: {}, reflection: '', review: '' });
const occStatus = o => o.done ? 'done' : o.missed ? 'missed' : 'planned';
const doneOf = (span, id) => span.occurrences.filter(o => o.intention_id === id && o.done).length;
const findOcc = (span, id, day) => span.occurrences.find(o => o.intention_id === id && o.day === day);

class App {
  constructor(today) { this.today = today; this.S = { current: newSpan(today), next: null, spans: [] }; }
  dayNum(span = this.S.current) { return diffDays(span.start, this.today) + 1; }
  phase() { const c = this.S.current; if (c.status !== 'live') return 'planning'; return this.dayNum(c) >= 10 ? 'review' : 'live'; }
  summary(span) {
    const parts = span.intentions.map(it => `${it.name} ${doneOf(span, it.id)}/${it.target}`);
    const bits = [`Deka ${range(span.start)}: ${parts.join(', ') || 'nothing planned'}.`];
    if (span.reflection) bits.push(`Their reflection: ${span.reflection}`);
    if (span.review) bits.push(`Your read: ${span.review}`);
    return bits.join(' ');
  }

  buildRequest(span, text, event) {
    const p = this.phase();
    if (p === 'planning' && span.start < this.today && !span.occurrences.some(o => o.done)) span.start = this.today;
    let target = span;
    if (p === 'review') { if (!this.S.next) this.S.next = newSpan(addDays(span.start, 10) < this.today ? this.today : addDays(span.start, 10)); target = this.S.next; }
    const history = span.chat.filter(m => m.text && !m.pending);
    if (text) { const i = history.map(m => m.role === 'user' && m.text === text).lastIndexOf(true); if (i >= 0) history.splice(i, 1); }
    const lines = m => {
      let t = m.text;
      for (const c of m.cards || []) {
        if (c.type === 'goals') t += `\n[Goals updated: ${c.lines.join('; ')}]`;
        if (c.type === 'log') t += `\n[Logged day ${c.day}]`;
        if (c.type === 'proposal') t += `\n[Proposed a plan: ${c.changes.join('; ')}. ${c.status === 'open' ? 'Waiting for them to confirm' : c.status}]`;
      }
      return { role: m.role === 'user' ? 'user' : 'assistant', text: t };
    };
    const all = history.map(lines);
    const older = all.slice(span.summarizedUpTo, Math.max(span.summarizedUpTo, all.length - 30));
    const body = {
      phase: p,
      today: `${weekday(this.today)} ${this.today}`,
      current_day: p === 'live' ? this.dayNum(span) : null,
      days: dayMap(target.start),
      goals: target.intentions.map(({ id, name, type, tag, target: n }) => ({ id, name, type, tag: tag || '', target: n })),
      schedule: target.occurrences.map(o => ({ goal_id: o.intention_id, day: o.day, status: occStatus(o), detail: o.detail || '' })),
      notes: target === span ? span.notes : {},
      summary: span.summary || '',
      past: this.S.spans.slice(0, 3).map(s => this.summary(s)),
      messages: all.slice(-30),
      message: text || null,
      event: event || null,
    };
    if (older.length) body.to_summarize = older;
    if (p === 'review') {
      body.ended = {
        range: range(span.start),
        goals: span.intentions.map(g => ({ id: g.id, name: g.name, type: g.type, tag: g.tag || '', target: g.target, done: doneOf(span, g.id) })),
        schedule: span.occurrences.map(o => ({ goal_id: o.intention_id, day: o.day, status: occStatus(o) })),
        notes: span.notes,
        reflection: span.reflection || '',
      };
    }
    return { body, target: target === this.S.next ? 'next' : 'current' };
  }

  applyGoals(span, changes) {
    const lines = [];
    for (const c of changes) {
      if (c.op === 'add') {
        if (!span.intentions.some(g => g.id === c.id)) span.intentions.push({ id: c.id, name: c.name, type: c.type, tag: c.tag || '', target: c.target });
        lines.push(`Added ${c.name}, ${c.target} ${c.target === 1 ? 'time' : 'times'}`);
      } else if (c.op === 'edit') {
        const g = span.intentions.find(x => x.id === c.id);
        if (!g) continue;
        const was = g.target;
        Object.assign(g, { name: c.name, type: c.type, tag: c.tag || '', target: c.target });
        lines.push(was !== c.target ? `${c.name} now ${c.target} ${c.target === 1 ? 'time' : 'times'}` : `Updated ${c.name}`);
      } else if (c.op === 'remove') {
        span.intentions = span.intentions.filter(g => g.id !== c.id);
        span.occurrences = span.occurrences.filter(o => o.intention_id !== c.id);
        lines.push(`Removed ${c.name}`);
      }
    }
    return lines;
  }

  applyLog(span, data) {
    for (const e of data.entries) {
      let o = findOcc(span, e.goal_id, data.day);
      if (!o && e.moved_from) { o = findOcc(span, e.goal_id, e.moved_from); if (o) o.day = data.day; }
      if (!o && e.extra) {
        o = { intention_id: e.goal_id, day: data.day, done: false, detail: '' };
        span.occurrences.push(o);
        const g = span.intentions.find(x => x.id === e.goal_id);
        if (g && doneOf(span, g.id) + 1 > g.target) g.target = Math.min(9, g.target + 1);
      }
      if (!o) continue;
      o.done = e.status === 'done'; o.missed = e.status === 'missed';
    }
  }

  proposalFits(span, card) {
    const from = span.status === 'live' ? Math.min(9, Math.max(1, this.dayNum(span))) : 1;
    for (const g of span.intentions) {
      const need = Math.max(0, g.target - doneOf(span, g.id));
      if (card.occurrences.filter(o => o.goal_id === g.id).length !== need) return false;
    }
    return card.occurrences.every(o => span.intentions.some(g => g.id === o.goal_id) && o.day >= from && o.day <= 9 &&
      !span.occurrences.some(x => x.intention_id === o.goal_id && x.day === o.day && (x.done || x.missed)));
  }

  // Taps Confirm on the newest open card. Returns false when the app would call it stale.
  confirm() {
    const card = this.openCard();
    if (!card) return false;
    const span = card.target === 'next' ? this.S.next : this.S.current;
    if (!this.proposalFits(span, card)) { card.status = 'stale'; return false; }
    const keep = span.occurrences.filter(o => o.done || o.missed);
    span.occurrences = [...keep, ...card.occurrences.map(o => ({ intention_id: o.goal_id, day: o.day, done: false, detail: o.detail || '' }))];
    card.status = 'confirmed';
    if (card.target === 'next') {
      const cur = this.S.current; cur.status = 'done'; this.S.spans.unshift(cur);
      this.S.current = span; this.S.next = null; span.status = 'live';
    } else if (span.status !== 'live') {
      if (span.start < this.today) span.start = this.today;
      span.status = 'live';
    }
    return true;
  }

  openCard() {
    for (const m of [...this.S.current.chat].reverse()) for (const c of [...(m.cards || [])].reverse()) if (c.type === 'proposal' && c.status === 'open') return c;
    return null;
  }

  // The evening question, as maybeCheckin writes it.
  askCheckin() {
    const cur = this.S.current;
    const n = this.dayNum(cur);
    const days = [];
    for (let d = 1; d <= n; d++) {
      if (cur.checked.includes(d)) continue;
      const planned = cur.occurrences.some(o => o.day === d);
      const open = cur.occurrences.some(o => o.day === d && !o.done && !o.missed);
      if (open || (d === n && (planned || n > 1))) days.push(d);
    }
    if (!days.length) return null;
    const names = days.map(d => d === n ? 'today' : d === n - 1 ? 'yesterday' : `Day ${d}`);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
    const msg = { id: uid(), role: 'deka', text: `How did ${list} go?`, cards: [], checkin: { days, answered: false } };
    cur.chat.push(msg);
    return msg;
  }
}

/* The instrumented client */

function recordingClient(sink) {
  const real = new Anthropic();
  return {
    messages: {
      stream(params) {
        const rec = { raw: '', started: Date.now(), firstText: null, usage: null, stop: null, tools: [], thinking: 0 };
        sink.calls.push(rec);
        // A call that failed its checks comes back to Claude as an error result in the next request.
        const back = params.messages[params.messages.length - 1];
        if (Array.isArray(back.content)) for (const b of back.content) if (b.type === 'tool_result' && b.is_error) sink.invalid.push(b.content);
        const s = real.messages.stream(params);
        s.on('text', d => { if (rec.firstText == null) rec.firstText = Date.now(); rec.raw += d; });
        const final = s.finalMessage.bind(s);
        s.finalMessage = async () => {
          const m = await final();
          rec.usage = m.usage; rec.stop = m.stop_reason; rec.ended = Date.now();
          rec.tools = m.content.filter(b => b.type === 'tool_use').map(b => ({ name: b.name, input: b.input }));
          rec.thinking = m.content.filter(b => b.type === 'thinking').length;
          return m;
        };
        return s;
      },
    },
  };
}

/* One turn over HTTP */

async function turn(ctx, text, event, ask) {
  const { app } = ctx;
  const span = app.S.current;
  if (text) span.chat.push({ id: uid(), role: 'user', text, cards: [] });
  const msg = { id: uid(), role: 'deka', text: '', cards: [], pending: true };
  span.chat.push(msg);
  const { body, target } = app.buildRequest(span, text, event);
  const sink = { calls: [], invalid: [] };
  ctx.sink.current = sink;
  const events = [];
  const t0 = Date.now();
  let firstWord = null;
  const res = await fetch(`${ctx.base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ctx.cookie }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`chat ${res.status}`);
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let cut;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut); buf = buf.slice(cut + 2);
      const ev = (block.match(/^event: (.*)$/m) || [])[1];
      const data = (block.match(/^data: (.*)$/m) || [])[1];
      if (!ev || !data) continue;
      const d = JSON.parse(data);
      events.push([ev, d]);
      if (ev === 'text') { if (firstWord == null && d.delta.trim()) firstWord = Date.now(); msg.text += d.delta; }
      else if (ev === 'error') msg.error = d.message;
      else if (ev === 'goals') msg.cards.push({ type: 'goals', lines: app.applyGoals(target === 'next' ? app.S.next : span, d.changes), changes: d.changes });
      else if (ev === 'log') { app.applyLog(span, d); msg.cards.push({ type: 'log', day: d.day, entries: d.entries }); }
      else if (ev === 'proposal') {
        for (const m of span.chat) for (const c of m.cards || []) if (c.type === 'proposal' && c.status === 'open') c.status = 'replaced';
        msg.cards.push({ type: 'proposal', target, occurrences: d.occurrences, changes: d.changes, changed_days: d.changed_days, status: 'open' });
      }
    }
  }
  const t1 = Date.now();
  delete msg.pending;
  msg.text = msg.text.trim();
  if (!msg.error && event && event.kind === 'checkin' && ask) { ask.checkin.answered = true; span.checked = [...new Set([...span.checked, ...event.days])]; }
  if (!msg.error && event && event.kind === 'review') span.review = msg.text;
  if (!msg.text && !msg.cards.length && !msg.error) span.chat = span.chat.filter(m => m !== msg);

  const usage = sink.calls.reduce((a, c) => {
    const u = c.usage || {};
    a.input += u.input_tokens || 0; a.output += u.output_tokens || 0;
    a.cacheWrite += u.cache_creation_input_tokens || 0; a.cacheRead += u.cache_read_input_tokens || 0;
    return a;
  }, { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
  const cost = (usage.input * PRICE.input + usage.output * PRICE.output + usage.cacheWrite * PRICE.cacheWrite + usage.cacheRead * PRICE.cacheRead) / 1e6;
  const raw = sink.calls.map(c => c.raw).join(' ');
  const toolStrings = sink.calls.flatMap(c => c.tools).flatMap(t => JSON.stringify(t.input).match(/"(?:[^"\\]|\\.)*"/g) || []).map(s => JSON.parse(s));
  const record = {
    who: text ? 'person' : 'app',
    said: text || (event && event.kind === 'review' ? '(Day 10: the app opens the review)' : ''),
    event: event || null,
    today: `${weekday(app.today)} ${app.today}`,
    day: app.phase() === 'planning' ? null : app.dayNum(),
    reply: msg.text,
    error: msg.error || null,
    cards: msg.cards.map(c => ({ ...c })),
    tools: sink.calls.flatMap(c => c.tools),
    rounds: sink.calls.length,
    calls: sink.calls.map(c => ({ ms: (c.ended || t1) - c.started, firstTextMs: c.firstText ? c.firstText - c.started : null, text: c.raw.length, tools: c.tools.map(x => x.name), thinking: c.thinking, out: (c.usage || {}).output_tokens, stop: c.stop })),
    invalid: sink.invalid,
    rawDashes: DASH.test(raw),
    toolDashes: toolStrings.some(s => DASH.test(s)),
    rawText: raw,
    ttfw: firstWord ? (firstWord - t0) / 1000 : null,
    total: (t1 - t0) / 1000,
    usage, cost,
  };
  ctx.turns.push(record);
  return record;
}

/* Checks */

const words = s => (s.match(/\S+/g) || []).length;
function turnChecks(t, { maxWords = 70 } = {}) {
  const f = [];
  if (t.error) f.push(`error event: ${t.error}`);
  if (t.invalid.length) f.push(`tool call failed validation: ${t.invalid.join(' | ')}`);
  if (t.rawDashes) f.push('dash used as punctuation in the raw reply');
  if (t.toolDashes) f.push('dash used as punctuation in a tool input');
  if (words(t.reply) > maxWords) f.push(`reply is ${words(t.reply)} words (max ${maxWords})`);
  if (/!/.test(t.reply)) f.push('exclamation mark');
  if (/^\s*([-*#]|\d+\.)\s/m.test(t.reply)) f.push('markdown list or heading');
  if (!t.reply) f.push('no reply text');
  return f;
}
const lastProposal = t => [...t.cards].reverse().find(c => c.type === 'proposal');
const goalByWord = (span, re) => span.intentions.find(g => re.test(`${g.id} ${g.name}`));
const byDay = occ => { const m = new Map(); for (let d = 1; d <= 9; d++) m.set(d, []); for (const o of occ) m.get(o.day).push(o.goal_id); return m; };

// Checks a schedule proposal against the planning rules. `occ` is upcoming plus done/missed.
function planChecks(app, span, occ, { freeDays = [], momWeekends = false, from = 1 } = {}) {
  const f = [];
  const days = dayMap(span.start);
  const wd = d => days[d - 1].weekday;
  const date = goalByWord(span, /date/i);
  const sober = goalByWord(span, /sober/i);
  const mom = goalByWord(span, /mom/i);
  const run = goalByWord(span, /\brun/i);
  const gym = goalByWord(span, /gym/i);
  const map = byDay(occ);
  if (date) {
    for (const o of occ.filter(o => o.goal_id === date.id)) {
      if (!['Friday', 'Saturday'].includes(wd(o.day))) f.push(`date night on day ${o.day}, a ${wd(o.day)}`);
      if (sober && map.get(o.day).includes(sober.id)) f.push(`sober night on the date night, day ${o.day}`);
    }
  } else f.push('no date night goal');
  for (const d of freeDays) if (map.get(d).length) f.push(`day ${d} should be free but has ${map.get(d).join(', ')}`);
  if (momWeekends && mom) for (const o of occ.filter(o => o.goal_id === mom.id && !o.locked)) if (!['Saturday', 'Sunday'].includes(wd(o.day))) f.push(`mom on day ${o.day}, a ${wd(o.day)}`);
  if (run && gym) {
    const open = [...map.keys()].filter(d => d >= from && !freeDays.includes(d)).length;
    const need = occ.filter(o => o.day >= from && (o.goal_id === run.id || o.goal_id === gym.id)).length;
    const both = [...map].filter(([d, g]) => d >= from && g.includes(run.id) && g.includes(gym.id)).length;
    if (both > Math.max(0, need - open)) f.push(`run and gym share ${both} days; the counts force ${Math.max(0, need - open)}`);
  }
  // Load is judged on the days still ahead; after an evening check in, today is over.
  const ahead = byDay(occ.filter(o => !o.locked));
  // A date night day may be kept light on purpose.
  const loads = [...ahead].filter(([d, g]) => d > (from > 1 ? from : 0) && !freeDays.includes(d) && !(date && g.includes(date.id))).map(([, g]) => g.length);
  if (from > 1 && ahead.get(from).length) f.push(`new sessions on day ${from}, which the check in just closed`);
  if (loads.length && Math.max(...loads) - Math.min(...loads) > 2) f.push(`unbalanced days: loads ${loads.join(' ')}`);
  return f;
}
// Upcoming sessions on the card, plus the done and missed ones already fixed in the deka.
const cardOcc = (span, card) => [...span.occurrences.filter(o => o.done || o.missed).map(o => ({ goal_id: o.intention_id, day: o.day, locked: true })), ...card.occurrences];

/* The scenarios */

const START = '2026-09-23';

async function run(n) {
  const app = new App(START);
  const sink = {};
  const client = recordingClient(new Proxy({}, { get: (_, k) => sink.current[k] }));
  const origLog = console.log;
  const server = createApp({ client }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: process.env.DEKA_PASSCODE }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const ctx = { app, base, cookie, sink, turns: [] };
  const results = [];
  const scenario = async (name, fn) => {
    const from = ctx.turns.length;
    const fails = [], notes = [];
    try { await fn(fails, notes); } catch (e) { fails.push(`crashed: ${e.message}`); }
    const turns = ctx.turns.slice(from);
    results.push({ name, pass: !fails.length, fails, notes, turns });
    origLog(`  run ${n} ${name}: ${fails.length ? `FAIL\n    ${fails.join('\n    ')}` : 'pass'}`);
  };
  const say = (text, event, ask) => turn(ctx, text, event, ask);
  const span = () => app.S.current;
  const occNow = () => span().occurrences.map(o => ({ goal_id: o.intention_id, day: o.day }));

  try {
    await scenario('1 full dump', async f => {
      const t = await say('In the next 10 days I want at least one date night, see my mom at least five times, at least six runs, gym at least eight times, make music at least four nights, work on Rentletter at least eight nights, three sober nights with no drinking or smoking, and finish my book.');
      f.push(...turnChecks(t, { maxWords: 90 }));
      const s = span();
      const want = [[/date/i, 1, 'see'], [/mom/i, 5, 'see'], [/\brun/i, 6, 'do'], [/gym/i, 8, 'do'], [/music/i, 4, 'do'], [/rentletter/i, 8, 'do'], [/sober/i, 3, 'abstain'], [/book|read/i, null, 'do']];
      const trimmedNow = t.cards.some(c => c.type === 'goals' && c.changes.some(ch => ch.op === 'edit'));
      for (const [re, n, type] of want) {
        const g = goalByWord(s, re);
        if (!g && !(re.source.includes('book') && /book/i.test(t.reply))) { f.push(`no goal for ${re.source}`); continue; }
        if (!g) continue;
        if (g.type !== type) f.push(`${g.name} has type ${g.type}, not ${type}`);
        if (n && g.target !== n && !trimmedNow) f.push(`${g.name} target ${g.target}, asked for ${n}`);
      }
      if (!/(book|pages?|chapters?|left)[^.?]*\?/i.test(t.reply)) f.push('does not ask how much of the book is left');
      else if (!/\?\s*$/.test(t.reply)) f.push('the book question is not last');
      if (!/too much|a lot|won.t fit|doesn.t fit|not fit|more than|heavy|stretch|overload|packed|crowd/i.test(t.reply)) f.push('does not say plainly it is too much');
      if (!/\b(\d+|fourteen|thirty\w*)\b/i.test(t.reply)) f.push('gives no count');
      if (!/(cut|drop|trim|down to|fewer|lower|reduce|I.d do|I would do|I.d go with|I.d suggest)[^.]*\d/i.test(t.reply)) f.push('no specific trim suggestion');
      if (t.cards.some(c => c.type === 'proposal')) f.push('proposed a schedule before the book size was known');
    });

    let base2 = null;
    await scenario('2 book and trim', async f => {
      const t = await say('About 120 pages left. Your trim sounds good.');
      f.push(...turnChecks(t));
      const card = lastProposal(t);
      if (!card) { f.push('no proposal'); return; }
      const s = span();
      const total = s.intentions.reduce((a, g) => a + g.target, 0);
      if (total >= 35) f.push(`nothing trimmed, ${total} sessions`);
      const book = goalByWord(s, /book|read/i);
      if (book && card.occurrences.filter(o => o.goal_id === book.id).some(o => !o.detail)) f.push('book sessions have no page portions');
      f.push(...planChecks(app, s, cardOcc(s, card)));
      base2 = card;
    });

    await scenario('3 tweaks', async (f, notes) => {
      const a = await say('keep day 4 free');
      f.push(...turnChecks(a).map(x => `day 4: ${x}`));
      const cut = a.cards.filter(c => c.type === 'goals').flatMap(c => c.lines);
      if (cut.length) f.push(`day 4: changed targets nobody asked about: ${cut.join('; ')}`);
      const ca = lastProposal(a);
      if (!ca) f.push('day 4: no new proposal');
      else f.push(...planChecks(app, span(), cardOcc(span(), ca), { freeDays: [4] }).map(x => `day 4: ${x}`));
      const b = await say('mom on weekends only');
      f.push(...turnChecks(b).map(x => `weekends: ${x}`));
      const cb = lastProposal(b);
      if (!cb) { f.push('weekends: no new proposal'); return; }
      f.push(...planChecks(app, span(), cardOcc(span(), cb), { freeDays: [4], momWeekends: true }).map(x => `weekends: ${x}`));
      const mom = goalByWord(span(), /mom/i);
      if (mom) notes.push(`mom target is ${mom.target}; weekend days open: ${dayMap(span().start).filter(d => d.day <= 9 && d.day !== 4 && ['Saturday', 'Sunday'].includes(d.weekday)).map(d => d.day).join(', ')}`);
      if (!app.confirm()) f.push('the app would reject the card as stale');
    });

    await scenario('4 add coffee', async (f, notes) => {
      const before = occNow();
      const t = await say('also add 2 coffee catch ups with friends');
      f.push(...turnChecks(t));
      const coffee = goalByWord(span(), /coffee|catch/i);
      if (!coffee) { f.push('no coffee goal'); return; }
      if (coffee.target !== 2) f.push(`coffee target ${coffee.target}`);
      const card = lastProposal(t);
      if (!card) { f.push('no proposal'); return; }
      const key = o => `${o.goal_id}@${o.day}`;
      const was = new Set(before.map(key));
      const moved = card.occurrences.filter(o => o.goal_id !== coffee.id && !was.has(key(o))).length;
      notes.push(`${moved} existing sessions moved`);
      if (moved > 4) f.push(`rebuilt the plan: ${moved} existing sessions moved`);
      f.push(...planChecks(app, span(), cardOcc(span(), card), { freeDays: [4], momWeekends: true }));
      if (!app.confirm()) f.push('the app would reject the card as stale');
    });

    await scenario('5 check in day 2', async (f, notes) => {
      // Day 1 went to plan and was ticked off by hand in the Days tab.
      for (const o of span().occurrences) if (o.day === 1) o.done = true;
      app.today = addDays(START, 1);
      // The person made sure gym, Rentletter and a run were on today, as the scenario needs.
      for (const re of [/gym/i, /rentletter/i, /\brun/i]) {
        const g = goalByWord(span(), re);
        if (!g || findOcc(span(), g.id, 2)) continue;
        const later = span().occurrences.filter(o => o.intention_id === g.id && !o.done && o.day > 2).sort((x, y) => y.day - x.day)[0];
        if (later) { notes.push(`moved ${g.id} from day ${later.day} to day 2 by hand`); later.day = 2; }
      }
      const planned2 = span().occurrences.filter(o => o.day === 2).map(o => o.intention_id);
      notes.push(`day 2 plan: ${planned2.join(', ')}`);
      const ask = app.askCheckin();
      if (!ask || String(ask.checkin.days) !== '2') f.push(`check in asked about ${ask && ask.checkin.days}`);
      const t = await say('did the gym and rentletter, skipped the run, saw mom', { kind: 'checkin', days: ask.checkin.days }, ask);
      f.push(...turnChecks(t));
      const logs = t.cards.filter(c => c.type === 'log' && c.day === 2).flatMap(c => c.entries);
      const st = re => { const g = goalByWord(span(), re); return g && (logs.find(e => e.goal_id === g.id) || {}).status; };
      if (st(/gym/i) !== 'done') f.push('gym not logged done');
      if (st(/rentletter/i) !== 'done') f.push('Rentletter not logged done');
      if (st(/\brun/i) !== 'missed') f.push('run not logged missed');
      if (st(/mom/i) !== 'done') f.push('mom not logged done');
      const unsaid = planned2.filter(id => !/gym|rentletter|run|mom/i.test(id));
      if (unsaid.length) notes.push(`also planned on day 2 and not mentioned: ${unsaid.join(', ')}; logged as ${unsaid.map(id => (logs.find(e => e.goal_id === id) || {}).status || 'left open').join(', ')}`);
      const card = lastProposal(t);
      if (!card) f.push('no proposal after the check in');
      else {
        f.push(...planChecks(app, span(), cardOcc(span(), card), { freeDays: [4], momWeekends: true, from: 2 }));
        if (!/run/i.test(t.reply + card.changes.join(' '))) f.push('does not say where the run went');
        if (!app.confirm()) f.push('the app would reject the card as stale');
      }
    });

    await scenario('6 skipped check in', async (f, notes) => {
      app.today = addDays(START, 3);
      const ask = app.askCheckin();
      if (!ask || String(ask.checkin.days) !== '3,4') { f.push(`check in asked about ${ask && ask.checkin.days}`); if (!ask) return; }
      const names = id => (span().intentions.find(g => g.id === id) || { name: id }).name.toLowerCase();
      const d3 = span().occurrences.filter(o => o.day === 3 && !o.done && !o.missed).map(o => o.intention_id);
      const d4 = span().occurrences.filter(o => o.day === 4 && !o.done && !o.missed).map(o => o.intention_id);
      const did3 = d3.slice(0, -1), skip3 = d3.slice(-1);
      const list = a => a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0] || '';
      let text = `sorry, forgot to check in yesterday. yesterday I did ${list(did3.map(names))}${skip3.length ? ` but skipped ${names(skip3[0])}` : ''}.`;
      text += d4.length ? ` today I did ${list(d4.map(names))}.` : ' today was my free day, just rested.';
      notes.push(`said: ${text}`);
      const t = await say(text, { kind: 'checkin', days: ask.checkin.days }, ask);
      f.push(...turnChecks(t));
      const logs = t.cards.filter(c => c.type === 'log');
      const got = (day, id) => (logs.filter(c => c.day === day).flatMap(c => c.entries).find(e => e.goal_id === id) || {}).status;
      for (const id of did3) if (got(3, id) !== 'done') f.push(`day 3 ${id} not logged done`);
      for (const id of skip3) if (got(3, id) !== 'missed') f.push(`day 3 ${id} not logged missed`);
      for (const id of d4) if (got(4, id) !== 'done') f.push(`day 4 ${id} not logged done`);
      const card = lastProposal(t);
      if (!card) f.push('no proposal after the check in');
      else {
        f.push(...planChecks(app, span(), cardOcc(span(), card), { freeDays: [4], momWeekends: true, from: 4 }));
        if (!app.confirm()) f.push('the app would reject the card as stale');
      }
    });

    await scenario('7 day 10 review', async (f, notes) => {
      // Days 4 to 9 are lived and ticked by hand: everything holds except workouts late in the deka.
      const run = goalByWord(span(), /\brun/i), gym = goalByWord(span(), /gym/i);
      for (const o of span().occurrences) {
        if (o.day < 4 || o.done || o.missed) continue;
        const workout = [run && run.id, gym && gym.id].includes(o.intention_id);
        if (!(workout && o.day >= 7)) o.done = true;
      }
      app.today = addDays(START, 9);
      const ended = span().intentions.map(g => `${g.name} ${doneOf(span(), g.id)}/${g.target}`).join(', ');
      notes.push(`deka ended at: ${ended}`);
      const t = await say(null, { kind: 'review' });
      f.push(...turnChecks(t, { maxWords: 130 }));
      if (!/run|gym|workout|train/i.test(t.reply)) f.push('review does not name the slipped workouts');
      if (/amazing|incredible|crushed|proud of you|fantastic/i.test(t.reply)) f.push('gushing');
      if (/^[^.]*\b(below|here is|here's|written up)\b/i.test(t.reply)) f.push('opens with a preamble');
      if (!/\?\s*$/.test(t.reply)) f.push('does not end by asking if it looks right');
      const next = app.S.next;
      if (!next || !next.intentions.length) { f.push('no goals drafted for the next deka'); return; }
      notes.push(`next deka goals: ${next.intentions.map(g => `${g.name} ${g.target}`).join(', ')}`);
      const card = lastProposal(t);
      if (!card) { f.push('no schedule for the next deka'); return; }
      if (card.target !== 'next') f.push('proposal is not for the next deka');
      // A whole free day in the next deka is a deliberate rest day, not an imbalance.
      const rest = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => !card.occurrences.some(o => o.day === d));
      if (rest.length > 1) f.push(`next deka leaves ${rest.length} days empty`);
      f.push(...planChecks(app, next, card.occurrences, { freeDays: rest }));
      const wk = s => s.intentions.filter(g => /run|gym/i.test(g.id)).reduce((a, g) => a + g.target, 0);
      if (wk(next) > wk(span())) f.push(`next deka has more workouts (${wk(next)}) than the one where they slipped (${wk(span())})`);
    });
  } finally {
    server.close();
  }
  return { n, results, turns: ctx.turns, app };
}

/* Output */

function transcript(r, s) {
  const out = [`# Scenario ${s.name}`, '', `Run ${r.n}, model ${MODEL}. ${s.pass ? 'Pass.' : `Fail: ${s.fails.join('; ')}.`}`, ''];
  if (s.notes.length) out.push(...s.notes.map(x => `- ${x}`), '');
  for (const t of s.turns) {
    out.push(`**${t.who === 'person' ? 'Person' : 'App'}** (${t.today}${t.day ? `, day ${t.day}` : ''}${t.event ? `, ${t.event.kind}${t.event.days ? ` for day ${t.event.days.join(' and ')}` : ''}` : ''}): ${t.said}`, '');
    out.push(`**Deka**: ${t.reply || '(no text)'}`, '');
    for (const c of t.cards) {
      if (c.type === 'goals') out.push(`> Goals: ${c.lines.join('; ')}`);
      if (c.type === 'log') out.push(`> Logged day ${c.day}: ${c.entries.map(e => `${e.goal_id} ${e.status}${e.moved_from ? ` (from day ${e.moved_from})` : ''}`).join(', ')}`);
      if (c.type === 'proposal') {
        out.push(`> Card: ${c.changes.join(' / ')}`);
        const m = byDay(c.occurrences);
        for (const [d, g] of m) out.push(`>   Day ${d}: ${g.join(', ') || '(free)'}`);
      }
    }
    if (t.error) out.push(`> Error: ${t.error}`);
    for (const x of t.invalid) out.push(`> Failed validation: ${x.replace(/\n/g, ' ')}`);
    out.push('', `_${t.rounds} rounds, first word ${t.ttfw ?? '-'} s, total ${t.total} s, ${t.usage.input} in + ${t.usage.cacheRead} cached + ${t.usage.output} out tokens, $${t.cost.toFixed(4)}${t.invalid.length ? `, invalid: ${t.invalid.join(' | ')}` : ''}${t.rawDashes || t.toolDashes ? ', dashes before cleanup' : ''}_`, '');
  }
  return out.join('\n');
}

(async () => {
  console.log(`Deka real runs: ${RUNS} x 7 scenarios on ${MODEL}`);
  const runs = await Promise.all(Array.from({ length: RUNS }, (_, i) => run(i + 1)));
  const rows = [];
  for (const r of runs) for (const s of r.results) for (const t of s.turns) rows.push({ run: r.n, scenario: s.name, said: t.said.slice(0, 40), ttfw: t.ttfw, total: t.total, ...t.usage, cost: +t.cost.toFixed(4), rounds: t.rounds });
  console.log('\nrun  scenario            ttfw   total  in     cached  out    cost    said');
  for (const x of rows) console.log(`${x.run}    ${x.scenario.padEnd(19)} ${String(x.ttfw).padEnd(6)} ${String(x.total).padEnd(6)} ${String(x.input).padEnd(6)} ${String(x.cacheRead).padEnd(7)} ${String(x.output).padEnd(6)} ${x.cost.toFixed(4)}  ${x.said}`);
  console.log(`\ntotal cost $${rows.reduce((a, x) => a + x.cost, 0).toFixed(3)}`);
  for (const r of runs) console.log(`run ${r.n}: ${r.results.map(s => `${s.name.split(' ')[0]} ${s.pass ? 'pass' : 'FAIL'}`).join(', ')}`);
  const dir = process.env.REAL_RUNS_RAW || path.join(require('os').tmpdir(), 'deka-real-runs');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const r of runs) fs.writeFileSync(path.join(dir, `${stamp}-run${r.n}.json`), JSON.stringify({ model: MODEL, results: r.results }, null, 1));
  if (OUT) {
    for (const r of runs) {
      const dir = path.join(OUT, `run-${r.n}`);
      fs.mkdirSync(dir, { recursive: true });
      for (const s of r.results) fs.writeFileSync(path.join(dir, `${s.name.replace(/\s+/g, '-')}.md`), transcript(r, s));
    }
    fs.writeFileSync(path.join(OUT, 'metrics.json'), `${JSON.stringify({ model: MODEL, date: new Date().toISOString().slice(0, 10), runs: runs.map(x => ({ run: x.n, scenarios: x.results.map(s => ({ name: s.name, pass: s.pass, fails: s.fails })) })), turns: rows }, null, 1)}\n`);
  }
})();
