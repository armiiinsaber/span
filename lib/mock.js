// Dev only (DEKA_MOCK=1): a stand in for Claude so the chat can be worked on without a key.
// It streams replies word by word and calls the same tools, with simple rules:
// counts like "six runs" become goals, "plan" gets a schedule, check ins log the day,
// and the Day 10 review drafts the next deka. It is not a planner.

const DELAY = Number(process.env.MOCK_DELAY ?? 25);
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, once: 1, twice: 2 };
const KINDS = [
  [/date/, 'date_night', 'Date night', 'see', 'evening'],
  [/mom|mum|mother/, 'see_mom', 'See mom', 'see', ''],
  [/run/, 'run', 'Run', 'do', ''],
  [/gym|lift/, 'gym', 'Gym', 'do', ''],
  [/music/, 'music', 'Make music', 'do', 'night'],
  [/rentletter/, 'rentletter', 'Rentletter', 'do', 'night'],
  [/sober|no drinking/, 'sober', 'Sober night', 'abstain', ''],
  [/book|read/, 'read', 'Read', 'do', ''],
];

function goalsFrom(text) {
  const out = [];
  for (const part of text.toLowerCase().split(/,|\band\b|\n/)) {
    const kind = KINDS.find(k => k[0].test(part));
    if (!kind || out.some(g => g.id === kind[1])) continue;
    const m = part.match(/\b(\d|one|two|three|four|five|six|seven|eight|nine|once|twice)\b/);
    const n = kind[1] === 'read' ? 5 : m ? (WORDS[m[1]] || Number(m[1])) : 1;
    out.push({ id: kind[1], name: kind[2], type: kind[3], tag: kind[4], target: Math.min(9, n) });
  }
  return out;
}

// Spreads every goal's remaining sessions over the open days, lightest days first.
function schedule(ctx, goals, { avoid = [] } = {}) {
  const from = ctx.phase === 'live' && ctx.current_day ? ctx.current_day : 1;
  const locked = (ctx.schedule || []).filter(o => o.status === 'done' || o.status === 'missed');
  const load = new Map();
  const occ = [];
  goals.forEach((g, gi) => {
    const done = locked.filter(o => o.goal_id === g.id && o.status === 'done').length;
    let need = Math.max(0, g.target - done);
    const blocked = new Set(locked.filter(o => o.goal_id === g.id).map(o => o.day));
    const open = [];
    for (let d = from; d <= 9; d++) if (!blocked.has(d) && !avoid.includes(d)) open.push(d);
    need = Math.min(need, open.length);
    const picks = new Set();
    for (let i = 0; i < need; i++) {
      let d = open[(Math.floor((i + .5) * open.length / need) + gi) % open.length];
      if (picks.has(d)) d = open.filter(x => !picks.has(x)).sort((a, b) => (load.get(a) || 0) - (load.get(b) || 0))[0];
      picks.add(d);
      load.set(d, (load.get(d) || 0) + 1);
      occ.push({ goal_id: g.id, day: d, detail: g.id === 'read' ? `${(i + 1) * 30} pages` : '' });
    }
    if (need < Math.max(0, g.target - done)) g.target = done + need;
  });
  return occ;
}

function tool(name, input) { return { type: 'tool_use', id: `mock_${name}_${Math.random().toString(36).slice(2, 8)}`, name, input }; }

function plan(params) {
  const last = params.messages[params.messages.length - 1];
  if (Array.isArray(last.content)) {
    const prev = params.messages[params.messages.length - 2].content;
    const proposed = prev.some(b => b.type === 'tool_use' && b.name === 'propose_schedule');
    return { text: proposed ? 'Confirm when it looks right.' : '', tools: [] };
  }
  const body = last.content;
  const ctx = JSON.parse((body.match(/<deka>\n([\s\S]*?)\n<\/deka>/) || [])[1] || '{}');
  const said = ((body.match(/Person: ([\s\S]*)$/) || [])[1] || '').trim();
  const lower = said.toLowerCase();
  const tools = [];
  const summary = ctx.older_messages_to_summarize ? [tool('save_summary', { summary: 'Earlier: goals set, plan confirmed. Mock summary.' })] : [];

  if (/Event: review/.test(body)) {
    const ended = ctx.deka_that_ended || { goals: [] };
    const goals = ended.goals.map(g => ({ ...g }));
    tools.push(tool('update_goals', { changes: goals.map(g => ({ op: 'add', id: g.id, name: g.name, type: g.type, tag: g.tag || '', target: g.target })) }));
    const occ = schedule({ ...ctx, phase: 'planning', schedule: [] }, goals);
    tools.push(tool('propose_schedule', { occurrences: occ, changes: [`Kept ${goals.length} goals`, 'Spread over days 1 to 9'] }));
    return { text: 'Runs held. Nights slipped late in the deka. Mock read, not Claude. Here is a draft for the next one. Does it look right?', tools: [...summary, ...tools] };
  }

  const checkin = body.match(/Event: check in for (.*)\. Their answer follows\./);
  if (checkin) {
    const days = [...checkin[1].matchAll(/day (\d+)/g)].map(m => Number(m[1]));
    const sched = (ctx.schedule || []).map(o => ({ ...o }));
    for (const day of days) {
      const planned = sched.filter(o => o.day === day && o.status === 'planned');
      if (!planned.length) continue;
      const entries = planned.map(o => {
        const g = ctx.goals.find(x => x.id === o.goal_id) || { name: o.goal_id };
        const word = g.name.toLowerCase().split(' ').pop();
        const missed = new RegExp(`(missed|skipped|no)\\s+(the\\s+)?${word}`).test(lower) || /missed everything|nothing/.test(lower);
        o.status = missed ? 'missed' : 'done';
        return { goal_id: o.goal_id, status: o.status };
      });
      tools.push(tool('log_day', { day, entries }));
    }
    const occ = schedule({ ...ctx, schedule: sched }, ctx.goals.map(g => ({ ...g })));
    tools.push(tool('propose_schedule', { occurrences: occ, changes: ['Logged your day', 'Moved what is left onto the days ahead'] }));
    return { text: 'Thanks. Logged it. Here is the rest of the deka.', tools: [...summary, ...tools] };
  }

  const found = goalsFrom(said);
  if (found.length) {
    const existing = new Set((ctx.goals || []).map(g => g.id));
    const changes = found.map(g => existing.has(g.id)
      ? { op: 'edit', id: g.id, name: '', type: 'unchanged', tag: '', target: g.target }
      : { op: 'add', ...g });
    tools.push(tool('update_goals', { changes }));
    const names = found.map(g => `${g.name.toLowerCase()} ${g.target}`).join(', ');
    const ask = found.some(g => g.id === 'read') ? ' How many pages are left?' : ' Anything else, or shall I plan it?';
    return { text: `Got it: ${names}.${ask}`, tools: [...summary, ...tools] };
  }

  if ((ctx.goals || []).length && /plan|schedule|lay|spread|go ahead|yes|free|move|tweak|sure/.test(lower)) {
    const avoid = [...lower.matchAll(/day (\d) free/g)].map(m => Number(m[1]));
    const goals = ctx.goals.map(g => ({ ...g }));
    const occ = schedule(ctx, goals, { avoid });
    const edits = goals.filter(g => g.target !== ctx.goals.find(x => x.id === g.id).target);
    if (edits.length) tools.push(tool('update_goals', { changes: edits.map(g => ({ op: 'edit', id: g.id, name: '', type: 'unchanged', tag: '', target: g.target })) }));
    const total = goals.reduce((n, g) => n + g.target, 0);
    tools.push(tool('propose_schedule', { occurrences: occ, changes: [avoid.length ? `Kept day ${avoid.join(' and ')} free` : 'Spread every goal over the days', `${total} sessions across ${new Set(occ.map(o => o.day)).size} days`] }));
    return { text: total > 30 ? 'This is a lot for nine days. Here it is anyway; trim if it feels heavy.' : 'Here is a plan.', tools: [...summary, ...tools] };
  }

  return { text: 'Tell me what you want from these ten days. As much as you like.', tools: summary };
}

function stream(params) {
  const reply = plan(params);
  let onText = () => {};
  let aborted = false;
  return {
    on(event, cb) { if (event === 'text') onText = cb; return this; },
    abort() { aborted = true; },
    async finalMessage() {
      const words = reply.text.split(/(?<= )/);
      for (const w of words) {
        if (aborted) break;
        if (DELAY) await new Promise(r => setTimeout(r, DELAY));
        onText(w);
      }
      const content = [];
      if (reply.text) content.push({ type: 'text', text: reply.text });
      content.push(...reply.tools);
      return { stop_reason: reply.tools.length ? 'tool_use' : 'end_turn', content };
    },
  };
}

module.exports = { messages: { stream } };
