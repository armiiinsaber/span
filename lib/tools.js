// The tools Deka can call, and the checks every call must pass before anything
// reaches the app. Each check runs against a working copy of the deka, so a turn
// that adds goals and then proposes a schedule is judged on the goals it just added.

const { cleanText } = require('./validate');
const { ICON_KEYS, CATEGORIES } = require('./icons');

const WORK_DAYS = 9;
const TYPES = ['do', 'see', 'abstain'];
// What Deka knows about each goal beyond its name: how it looks and how it plans.
const TAGS = {
  icon: ICON_KEYS,
  category: CATEGORIES,
  energy: ['light', 'heavy'],
  social: ['yes', 'no'],
  fun: ['yes', 'no'],
  time_of_day: ['morning', 'day', 'evening', 'any'],
  weekend: ['yes', 'no'],
};
const TAG_NAMES = Object.keys(TAGS);

const TOOLS = [
  {
    name: 'update_goals',
    description: 'Add, edit or remove goals for the deka. Goals are what the person wants done in these 10 days, each with a target count, an icon, a category and a few planning tags. Use op "add" with a new id and every field set, "edit" with an existing id (empty name, target 0 and "unchanged" for any other field keep the old value), or "remove" with an existing id.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false, required: ['changes'],
      properties: {
        changes: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['op', 'id', 'name', 'type', 'tag', 'target', ...TAG_NAMES],
            properties: {
              op: { type: 'string', enum: ['add', 'edit', 'remove'] },
              id: { type: 'string', description: 'Short stable id in lower snake case, like run or see_mom.' },
              name: { type: 'string', description: 'Short plain name, like "Run" or "See mom". Empty keeps the old name on edit.' },
              type: { type: 'string', enum: ['do', 'see', 'abstain', 'unchanged'] },
              tag: { type: 'string', description: 'Optional one or two word hint like "evening". Empty for none.' },
              target: { type: 'integer', description: 'Times in the 10 days, 1 to 9. 0 keeps the old target on edit.' },
              icon: { type: 'string', enum: [...ICON_KEYS, 'unchanged'], description: 'The icon that shows this goal everywhere in the app. Pick the closest one: run, gym, family for a parent, date for a date night, drinks or party for a night out, moon for a sober night or sleep, laptop for a side project, music for making music.' },
              category: { type: 'string', enum: [...CATEGORIES, 'unchanged'], description: 'body, people, fun, work, mind or rest. Sets the tint of the icon.' },
              energy: { type: 'string', enum: ['light', 'heavy', 'unchanged'], description: 'heavy for hard training or long focused work, light for the rest.' },
              social: { type: 'string', enum: ['yes', 'no', 'unchanged'], description: 'yes when it is time with other people.' },
              fun: { type: 'string', enum: ['yes', 'no', 'unchanged'], description: 'yes for a night out or a treat, like a date night or a boys night.' },
              time_of_day: { type: 'string', enum: ['morning', 'day', 'evening', 'any', 'unchanged'] },
              weekend: { type: 'string', enum: ['yes', 'no', 'unchanged'], description: 'yes when it belongs on a Friday or Saturday if one is free, like a date night or a boys night.' },
            },
          },
        },
      },
    },
  },
  {
    name: 'log_day',
    description: 'Mark what got done or missed on one day that has already started. Use it during check ins, only for a day with at least one entry, and mark a session missed only when they said it did not happen. Marking done something that was planned for a later day moves one of those later sessions to this day.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false, required: ['day', 'entries'],
      properties: {
        day: { type: 'integer', description: 'Day number, 1 to 9, today or earlier.' },
        entries: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['goal_id', 'status'],
            properties: { goal_id: { type: 'string' }, status: { type: 'string', enum: ['done', 'missed'] } },
          },
        },
      },
    },
  },
  {
    name: 'propose_schedule',
    description: 'Propose where the remaining sessions go. Call it once per turn, with the whole plan; never send an empty call as a placeholder, and if you are also calling update_goals or log_day, list the plan as it will be after those. List every session that is still to happen, for every goal: exactly its target minus the sessions already done. A missed session does not count as done, so it needs a new day, and done and missed sessions are fixed and must not be listed. Count each goal against its target before you call. The person sees a card with your changes and confirms or asks for tweaks; nothing changes until they confirm.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false, required: ['occurrences', 'summary'],
      properties: {
        occurrences: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['goal_id', 'day', 'detail'],
            properties: {
              goal_id: { type: 'string' },
              day: { type: 'integer', description: 'Day 1 to 9. Day 10 is review.' },
              detail: { type: 'string', description: 'Optional portion, like "pages 40 to 80". Empty for none.' },
            },
          },
        },
        summary: { type: 'string', description: 'One short line under the plan saying what changed, at most about 8 words, like "Runs spread out, day 4 free".' },
      },
    },
  },
];

const STATUS_TOOL = {
  name: 'show_status',
  description: 'Show the where we are card under your reply: the day, and each goal with its progress. Call it when they ask how things are going. After a check in or a confirmed change the app shows it by itself.',
  strict: true,
  input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
};

// Changes nothing. It only tells the app this turn was a redirect, so the app can count a streak.
const OFF_TOPIC_TOOL = {
  name: 'mark_off_topic',
  description: 'Call this when you redirect a message that is not about their deka. It changes nothing in the plan; the app only counts redirects in a row.',
  strict: true,
  input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
};

const SUMMARY_TOOL = {
  name: 'save_summary',
  description: 'Save a short summary of the older messages in this deka, so they can be dropped from the conversation. Keep what matters for planning: goals, preferences, constraints, how things went.',
  strict: true,
  input_schema: {
    type: 'object', additionalProperties: false, required: ['summary'],
    properties: { summary: { type: 'string', description: 'Under 120 words.' } },
  },
};

/* Working state */

function working(state) {
  return {
    phase: state.phase,
    currentDay: Number.isInteger(state.current_day) ? state.current_day : null,
    goals: (state.goals || []).map(g => ({ id: String(g.id), name: String(g.name), type: g.type, tag: g.tag || '', target: g.target, ...Object.fromEntries(TAG_NAMES.filter(k => TAGS[k].includes(g[k])).map(k => [k, g[k]])) })),
    days: Array.isArray(state.days) ? state.days : [],
    schedule: (state.schedule || []).map(o => ({ goal_id: String(o.goal_id), day: o.day, status: o.status || 'planned', detail: o.detail || '' })),
  };
}

const findGoal = (w, id) => w.goals.find(g => g.id === id);
const doneCount = (w, id) => w.schedule.filter(o => o.goal_id === id && o.status === 'done').length;
const isLocked = o => o.status === 'done' || o.status === 'missed';
// The first day new sessions may go on.
const firstOpenDay = w => (w.phase === 'live' && w.currentDay ? w.currentDay : 1);

/* update_goals */

function updateGoals(input, w) {
  const errors = [];
  const changes = Array.isArray(input && input.changes) ? input.changes : null;
  if (!changes || !changes.length) return { ok: false, errors: ['changes must list at least one change.'] };
  const next = { goals: w.goals.map(g => ({ ...g })), schedule: w.schedule.map(o => ({ ...o })) };
  const out = [];
  for (const [i, c] of changes.entries()) {
    const id = typeof c.id === 'string' ? c.id.trim() : '';
    if (!id) { errors.push(`changes[${i}] has no id.`); continue; }
    const existing = next.goals.find(g => g.id === id);
    if (c.op === 'add') {
      if (existing) { errors.push(`Goal id "${id}" already exists. Use edit.`); continue; }
      if (!/^[a-z0-9_]{1,32}$/.test(id)) errors.push(`Goal id "${id}" must be lower snake case.`);
      const name = cleanText(c.name);
      if (!name) errors.push(`New goal "${id}" needs a name.`);
      if (!TYPES.includes(c.type)) errors.push(`New goal "${id}" needs type do, see or abstain.`);
      if (!Number.isInteger(c.target) || c.target < 1 || c.target > WORK_DAYS) errors.push(`New goal "${id}" target must be 1 to ${WORK_DAYS}.`);
      for (const k of TAG_NAMES) if (!TAGS[k].includes(c[k])) errors.push(`New goal "${id}" needs ${k}, one of ${TAGS[k].join(', ')}.`);
      if (errors.length) continue;
      const g = { id, name: name.slice(0, 40), type: c.type, tag: cleanText(c.tag).slice(0, 24), target: c.target, ...Object.fromEntries(TAG_NAMES.map(k => [k, c[k]])) };
      next.goals.push(g);
      out.push({ op: 'add', ...g });
    } else if (c.op === 'edit') {
      if (!existing) { errors.push(`No goal with id "${id}" to edit.`); continue; }
      if (c.type !== 'unchanged' && !TYPES.includes(c.type)) errors.push(`Goal "${id}" type must be do, see, abstain or unchanged.`);
      if (!Number.isInteger(c.target) || c.target < 0 || c.target > WORK_DAYS) errors.push(`Goal "${id}" target must be 0 (unchanged) or 1 to ${WORK_DAYS}.`);
      const done = next.schedule.filter(o => o.goal_id === id && o.status === 'done').length;
      if (c.target > 0 && c.target < done) errors.push(`Goal "${id}" already has ${done} done, so the target cannot go below ${done}.`);
      for (const k of TAG_NAMES) if (c[k] !== undefined && c[k] !== 'unchanged' && !TAGS[k].includes(c[k])) errors.push(`Goal "${id}" ${k} must be one of ${TAGS[k].join(', ')} or unchanged.`);
      if (errors.length) continue;
      if (cleanText(c.name)) existing.name = cleanText(c.name).slice(0, 40);
      if (TYPES.includes(c.type)) existing.type = c.type;
      if (c.tag !== undefined && cleanText(c.tag)) existing.tag = cleanText(c.tag).slice(0, 24);
      if (c.target > 0) existing.target = c.target;
      for (const k of TAG_NAMES) if (TAGS[k].includes(c[k])) existing[k] = c[k];
      out.push({ op: 'edit', ...existing });
    } else if (c.op === 'remove') {
      if (!existing) { errors.push(`No goal with id "${id}" to remove.`); continue; }
      next.goals = next.goals.filter(g => g.id !== id);
      next.schedule = next.schedule.filter(o => o.goal_id !== id);
      out.push({ op: 'remove', id, name: existing.name });
    } else {
      errors.push(`changes[${i}] op must be add, edit or remove.`);
    }
  }
  if (errors.length) return { ok: false, errors };
  w.goals = next.goals; w.schedule = next.schedule;
  return { ok: true, event: { type: 'goals', changes: out }, result: `Saved. Goals now: ${w.goals.map(g => `${g.name} (${g.id}) x${g.target}`).join(', ') || 'none'}.` };
}

/* log_day */

function logDay(input, w) {
  const errors = [];
  if (w.phase !== 'live' || !w.currentDay) return { ok: false, errors: ['Days can only be logged while a deka is running.'] };
  const day = input && input.day;
  const last = Math.min(w.currentDay, WORK_DAYS);
  if (!Number.isInteger(day) || day < 1 || day > last) return { ok: false, errors: [`day must be 1 to ${last}; later days have not happened yet.`] };
  const entries = Array.isArray(input.entries) ? input.entries : [];
  if (!entries.length) return { ok: false, errors: ['entries must not be empty.'] };
  const seen = new Set();
  for (const e of entries) {
    if (!findGoal(w, e.goal_id)) errors.push(`No goal with id "${e.goal_id}".`);
    if (!['done', 'missed'].includes(e.status)) errors.push(`Status for "${e.goal_id}" must be done or missed.`);
    if (seen.has(e.goal_id)) errors.push(`"${e.goal_id}" is listed twice.`);
    seen.add(e.goal_id);
  }
  if (errors.length) return { ok: false, errors };
  const applied = [], skipped = [];
  for (const e of entries) {
    const here = w.schedule.find(o => o.goal_id === e.goal_id && o.day === day);
    if (here) { here.status = e.status; applied.push({ goal_id: e.goal_id, status: e.status }); continue; }
    if (e.status === 'missed') { skipped.push(`${e.goal_id} was not planned on day ${day}`); continue; }
    // Done on a day it was not planned: pull the latest later session forward, or count it as extra.
    const later = w.schedule.filter(o => o.goal_id === e.goal_id && o.status === 'planned' && o.day > day).sort((a, b) => b.day - a.day)[0];
    if (later) { applied.push({ goal_id: e.goal_id, status: 'done', moved_from: later.day }); later.day = day; later.status = 'done'; }
    else {
      w.schedule.push({ goal_id: e.goal_id, day, status: 'done', detail: '' });
      const g = findGoal(w, e.goal_id);
      if (doneCount(w, e.goal_id) > g.target) g.target = Math.min(WORK_DAYS, doneCount(w, e.goal_id));
      applied.push({ goal_id: e.goal_id, status: 'done', extra: true });
    }
  }
  return {
    ok: true,
    event: { type: 'log', day, entries: applied },
    result: `Logged day ${day}: ${applied.map(a => `${a.goal_id} ${a.status}${a.moved_from ? ` (moved from day ${a.moved_from})` : ''}`).join(', ') || 'nothing'}.${skipped.length ? ` Skipped: ${skipped.join('; ')}.` : ''}`,
  };
}

/* propose_schedule */

function proposeSchedule(input, w) {
  const errors = [];
  const occ = Array.isArray(input && input.occurrences) ? input.occurrences : null;
  if (!occ) return { ok: false, errors: ['occurrences must be an array.'] };
  if (w.phase === 'live' && w.currentDay > WORK_DAYS) return { ok: false, errors: ['This deka has no work days left. Plan the next one instead.'] };
  const from = firstOpenDay(w);
  const locked = w.schedule.filter(isLocked);
  const lockedKeys = new Set(locked.map(o => `${o.goal_id}@${o.day}`));
  const seen = new Set();
  const counts = new Map();
  for (const [i, o] of occ.entries()) {
    const g = o && findGoal(w, o.goal_id);
    if (!g) { errors.push(`occurrences[${i}] points at unknown goal "${o && o.goal_id}".`); continue; }
    if (!Number.isInteger(o.day) || o.day < 1 || o.day > WORK_DAYS) { errors.push(`"${o.goal_id}" is on day ${o.day}. Work days are 1 to 9; day 10 is review.`); continue; }
    if (o.day < from) { errors.push(`"${o.goal_id}" is on day ${o.day}, which has passed. Today is day ${from}.`); continue; }
    const key = `${o.goal_id}@${o.day}`;
    if (seen.has(key)) errors.push(`"${o.goal_id}" is scheduled twice on day ${o.day}.`);
    if (lockedKeys.has(key)) errors.push(`"${o.goal_id}" is already done or missed on day ${o.day}; do not list it, and do not put another one there.`);
    seen.add(key);
    counts.set(o.goal_id, (counts.get(o.goal_id) || 0) + 1);
  }
  for (const g of w.goals) {
    const need = Math.max(0, g.target - doneCount(w, g.id));
    const got = counts.get(g.id) || 0;
    if (got !== need) errors.push(`"${g.id}" has target ${g.target} with ${g.target - need} done, so it needs ${need} upcoming sessions, not ${got}.`);
  }
  const summary = cleanText(input.summary || '');
  if (!summary) errors.push('summary must say in one short line what this proposal changes.');
  if (errors.length) return { ok: false, errors };

  const pending = occ.map(o => ({ goal_id: o.goal_id, day: o.day, detail: cleanText(o.detail || '') }));
  const before = new Map(), after = new Map();
  for (const o of w.schedule.filter(o => o.status === 'planned')) before.set(o.day, [...(before.get(o.day) || []), o.goal_id].sort());
  for (const o of pending) after.set(o.day, [...(after.get(o.day) || []), o.goal_id].sort());
  const changedDays = [];
  for (let d = 1; d <= WORK_DAYS; d++) if (String(before.get(d) || '') !== String(after.get(d) || '')) changedDays.push(d);
  w.schedule = [...locked, ...pending.map(o => ({ ...o, status: 'planned' }))];
  return {
    ok: true,
    event: { type: 'proposal', occurrences: pending, summary: summary.slice(0, 80), changes: [summary.slice(0, 80)], changed_days: changedDays },
    result: 'Shown to the person as a card with Confirm and Tweak. It is not applied until they confirm.',
  };
}

function markOffTopic() {
  return { ok: true, event: { type: 'off_topic' }, result: 'Noted.' };
}

function showStatus() {
  return { ok: true, event: { type: 'status' }, result: 'Shown.' };
}

function saveSummary(input) {
  const summary = cleanText(input && input.summary);
  if (!summary) return { ok: false, errors: ['summary must not be empty.'] };
  return { ok: true, event: { type: 'summary', summary: summary.slice(0, 1500) }, result: 'Saved.' };
}

const HANDLERS = { update_goals: updateGoals, log_day: logDay, propose_schedule: proposeSchedule, show_status: showStatus, mark_off_topic: markOffTopic, save_summary: saveSummary };

function runTool(name, input, w) {
  const h = HANDLERS[name];
  if (!h) return { ok: false, errors: [`Unknown tool ${name}.`] };
  return h(input, w);
}

module.exports = { TOOLS, STATUS_TOOL, SUMMARY_TOOL, OFF_TOPIC_TOOL, TAGS, TAG_NAMES, working, runTool, WORK_DAYS };
