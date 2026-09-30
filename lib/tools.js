// The tools Deka can call, and the checks every call must pass before anything
// reaches the app. Each check runs against a working copy of the deka, so a turn
// that adds goals and then proposes a schedule is judged on the goals it just added.

const { cleanText } = require('./validate');
const { ICON_KEYS, CATEGORIES } = require('./icons');

const WORK_DAYS = 9;
// fixed: a one time commitment on a set day, like an interview. It is never moved.
const TYPES = ['do', 'see', 'abstain', 'fixed'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// Hours a session takes, when that matters for the load, like three hours of prep.
const MAX_HOURS = 12;
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
    description: 'Add, edit or remove goals for the deka. Goals are what the person wants done in these 10 days, each with a target count, an icon, a category and a few planning tags. A fixed commitment, like an interview, is a goal of type fixed with target 1, its day and its time. A goal can take set hours each session and end by a day or a fixed commitment, like prep for an interview. Use op "add" with a new id and every field set, "edit" with an existing id (empty name, target 0, day 0, empty time, hours 0, until_day 0, empty until_goal and "unchanged" for any other field keep the old value), or "remove" with an existing id.',
    strict: true,
    input_schema: {
      type: 'object', additionalProperties: false, required: ['changes'],
      properties: {
        changes: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            required: ['op', 'id', 'name', 'type', 'tag', 'target', ...TAG_NAMES, 'day', 'time', 'hours', 'until_day', 'until_goal'],
            properties: {
              op: { type: 'string', enum: ['add', 'edit', 'remove'] },
              id: { type: 'string', description: 'Short stable id in lower snake case, like run or see_mom.' },
              name: { type: 'string', description: 'Short plain name, like "Run" or "See mom". Empty keeps the old name on edit.' },
              type: { type: 'string', enum: ['do', 'see', 'abstain', 'fixed', 'unchanged'], description: 'fixed for a one time commitment on a set day, like an interview or a flight.' },
              tag: { type: 'string', description: 'Optional one or two word hint like "evening". Empty for none.' },
              target: { type: 'integer', description: 'Times in the 10 days, 1 to 9. 0 keeps the old target on edit.' },
              icon: { type: 'string', enum: [...ICON_KEYS, 'unchanged'], description: 'The icon that shows this goal everywhere in the app. Pick the closest one: run, gym, family for a parent, date for a date night, drinks or party for a night out, moon for a sober night or sleep, laptop for a side project, music for making music.' },
              category: { type: 'string', enum: [...CATEGORIES, 'unchanged'], description: 'body, people, fun, work, mind or rest. Sets the tint of the icon.' },
              energy: { type: 'string', enum: ['light', 'heavy', 'unchanged'], description: 'heavy for hard training or long focused work, light for the rest.' },
              social: { type: 'string', enum: ['yes', 'no', 'unchanged'], description: 'yes when it is time with other people.' },
              fun: { type: 'string', enum: ['yes', 'no', 'unchanged'], description: 'yes for a night out or a treat, like a date night or a boys night.' },
              time_of_day: { type: 'string', enum: ['morning', 'day', 'evening', 'any', 'unchanged'] },
              weekend: { type: 'string', enum: ['yes', 'no', 'unchanged'], description: 'yes when it belongs on a Friday or Saturday if one is free, like a date night or a boys night.' },
              day: { type: 'integer', description: 'For a fixed commitment, its day, 1 to 10. 0 for any other goal.' },
              time: { type: 'string', description: 'For a fixed commitment, its time as HH:MM in 24 hours, like 15:00. Empty when there is none.' },
              hours: { type: 'number', description: 'Hours each session takes, like 3, when that matters for how full a day is. 0 for none.' },
              until_day: { type: 'integer', description: 'The last day its sessions may go on, 1 to 9, for a goal with a deadline. 0 for none.' },
              until_goal: { type: 'string', description: 'The id of a fixed commitment its sessions lead up to: they may go on that day or before, never after. Empty for none.' },
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
    description: 'Propose where the remaining sessions go. Fixed commitments stay on their own day and are added if you leave them out. Sessions of a goal with until_day or until_goal go only on days inside that window. Call it once per turn, with the whole plan; never send an empty call as a placeholder, and if you are also calling update_goals or log_day, list the plan as it will be after those. List every session that is still to happen, for every goal: exactly its target minus the sessions already done. A missed session does not count as done, so it needs a new day, and done and missed sessions are fixed and must not be listed. Count each goal against its target before you call. The person sees a card with your changes and confirms or asks for tweaks; nothing changes until they confirm.',
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
              day: { type: 'integer', description: 'Day 1 to 9. Day 10 is review; only a fixed commitment can be on it.' },
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

// A suggested trim, shown on the goals card as faded dots with Use suggestion and Keep mine.
// It changes nothing until they tap Use suggestion; then the app lowers the targets itself.
const TRIM_TOOL = {
  name: 'suggest_trim',
  description: 'Suggest lower counts when the goals do not fit the days left well. Call it in the same turn as update_goals, after it, with each goal you would lower: its requested count (its current target) and the count you suggest. The card shows the change as faded dots and a load meter, with Use suggestion and Keep mine, so your reply never lists goals or counts.',
  strict: true,
  input_schema: {
    type: 'object', additionalProperties: false, required: ['trims', 'reason'],
    properties: {
      trims: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['goal_id', 'requested', 'suggested'],
          properties: {
            goal_id: { type: 'string' },
            requested: { type: 'integer', description: 'The goal\'s current target.' },
            suggested: { type: 'integer', description: 'The lower count you suggest, at least 1.' },
          },
        },
      },
      reason: { type: 'string', description: 'A few words on why, like "time alone every other day".' },
    },
  },
};

// The same choice as the two buttons on the trim card, for when they answer in words.
const RESOLVE_TRIM_TOOL = {
  name: 'resolve_trim',
  description: 'Answer the open trim on the goals card the way its buttons would, when they accept it ("sounds good", "yes do that") or turn it down ("keep my numbers") in their own words. use lowers the counts to the suggestion; keep leaves them. Then propose the schedule in the same turn.',
  strict: true,
  input_schema: { type: 'object', additionalProperties: false, required: ['choice'], properties: { choice: { type: 'string', enum: ['use', 'keep'] } } },
};

// Changes nothing. It only tells the app this turn was a redirect, so the app can count a streak.
const OFF_TOPIC_TOOL = {
  name: 'mark_off_topic',
  description: 'Call this when you redirect a message that is not about their deka. It changes nothing in the plan; the app only counts redirects in a row.',
  strict: true,
  input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
};

// The brief pinned at the top of the chat. Goals and fixed commitments show in it by themselves;
// Deka keeps the rest: the rules they have stated, and the questions it is waiting on.
const BRIEF_TOOL = {
  name: 'update_brief',
  description: 'Keep the brief at the top of the chat current. Call it in the same turn whenever a rule or an open question is added, changed or settled, with the whole list each time. rules are the preferences and decisions they have stated for this deka, each in a few plain words, like "Day 4 free", "Prep 3 hours a day until Oct 6" or "Mom only on weekends". questions are what you are waiting on them to answer. Goals and fixed commitments show in the brief by themselves; never list them as rules.',
  strict: true,
  input_schema: {
    type: 'object', additionalProperties: false, required: ['rules', 'questions'],
    properties: {
      rules: { type: 'array', items: { type: 'string' }, description: 'At most 8, only what still holds.' },
      questions: { type: 'array', items: { type: 'string' }, description: 'At most 3. Empty when nothing is waiting.' },
    },
  },
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
    goals: (state.goals || []).map(g => ({ id: String(g.id), name: String(g.name), type: g.type, tag: g.tag || '', target: g.target, ...Object.fromEntries(TAG_NAMES.filter(k => TAGS[k].includes(g[k])).map(k => [k, g[k]])), ...timing(g) })),
    brief: { rules: Array.isArray(state.brief && state.brief.rules) ? state.brief.rules.slice(0, 8) : [], questions: Array.isArray(state.brief && state.brief.questions) ? state.brief.questions.slice(0, 3) : [] },
    days: Array.isArray(state.days) ? state.days : [],
    // The newest trim card still waiting for an answer, as the app sends it.
    openTrim: state.open_trim && Array.isArray(state.open_trim.trims) ? { trims: state.open_trim.trims.slice(0, 20).map(t => ({ goal_id: String(t.goal_id), requested: t.requested, suggested: t.suggested })) } : null,
    schedule: (state.schedule || []).map(o => ({ goal_id: String(o.goal_id), day: o.day, status: o.status || 'planned', detail: o.detail || '' })),
  };
}

// A goal's day and time when it is a fixed commitment, and its hours and window when it has them.
function timing(g) {
  const out = {};
  if (g.type === 'fixed' && Number.isInteger(g.day)) { out.day = g.day; out.time = TIME.test(g.time || '') ? g.time : ''; }
  if (typeof g.hours === 'number' && g.hours > 0 && g.hours <= MAX_HOURS) out.hours = g.hours;
  if (Number.isInteger(g.until_day) && g.until_day > 0) out.until_day = g.until_day;
  if (typeof g.until_goal === 'string' && g.until_goal) out.until_goal = g.until_goal;
  return out;
}

const findGoal = (w, id) => w.goals.find(g => g.id === id);
// The last day a goal's sessions may go on: its window, or day 9. A fixed commitment's own day.
function lastDay(w, g) {
  if (g.type === 'fixed') return g.day;
  let last = WORK_DAYS;
  if (g.until_day) last = Math.min(last, g.until_day);
  const f = g.until_goal && findGoal(w, g.until_goal);
  if (f && f.type === 'fixed' && f.day) last = Math.min(last, f.day);
  return last;
}
// A fixed commitment's session, in place on its day.
function placeFixed(w, g) {
  w.schedule = w.schedule.filter(o => !(o.goal_id === g.id && o.status === 'planned'));
  if (!w.schedule.some(o => o.goal_id === g.id)) w.schedule.push({ goal_id: g.id, day: g.day, status: 'planned', detail: g.time || '' });
}
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
      if (!TYPES.includes(c.type)) errors.push(`New goal "${id}" needs type do, see, abstain or fixed.`);
      if (!Number.isInteger(c.target) || c.target < 1 || c.target > WORK_DAYS) errors.push(`New goal "${id}" target must be 1 to ${WORK_DAYS}.`);
      for (const k of TAG_NAMES) if (!TAGS[k].includes(c[k])) errors.push(`New goal "${id}" needs ${k}, one of ${TAGS[k].join(', ')}.`);
      const g = { id, name: name.slice(0, 40), type: c.type, tag: cleanText(c.tag).slice(0, 24), target: c.target, ...Object.fromEntries(TAG_NAMES.map(k => [k, c[k]])) };
      checkTiming(g, c, next, w, errors, `New goal "${id}"`, true);
      if (errors.length) continue;
      next.goals.push(g);
      if (g.type === 'fixed') placeFixed(next, g);
      out.push({ op: 'add', ...g });
    } else if (c.op === 'edit') {
      if (!existing) { errors.push(`No goal with id "${id}" to edit.`); continue; }
      if (c.type !== 'unchanged' && !TYPES.includes(c.type)) errors.push(`Goal "${id}" type must be do, see, abstain, fixed or unchanged.`);
      if (!Number.isInteger(c.target) || c.target < 0 || c.target > WORK_DAYS) errors.push(`Goal "${id}" target must be 0 (unchanged) or 1 to ${WORK_DAYS}.`);
      const done = next.schedule.filter(o => o.goal_id === id && o.status === 'done').length;
      if (c.target > 0 && c.target < done) errors.push(`Goal "${id}" already has ${done} done, so the target cannot go below ${done}.`);
      for (const k of TAG_NAMES) if (c[k] !== undefined && c[k] !== 'unchanged' && !TAGS[k].includes(c[k])) errors.push(`Goal "${id}" ${k} must be one of ${TAGS[k].join(', ')} or unchanged.`);
      const g = { ...existing };
      if (TYPES.includes(c.type)) g.type = c.type;
      if (c.target > 0) g.target = c.target;
      checkTiming(g, c, next, w, errors, `Goal "${id}"`, false);
      if (errors.length) continue;
      if (cleanText(c.name)) g.name = cleanText(c.name).slice(0, 40);
      if (c.tag !== undefined && cleanText(c.tag)) g.tag = cleanText(c.tag).slice(0, 24);
      for (const k of TAG_NAMES) if (TAGS[k].includes(c[k])) g[k] = c[k];
      Object.assign(existing, g);
      if (existing.type === 'fixed') placeFixed(next, existing);
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

// The day, time, hours and window of an added or edited goal, checked against the rest.
function checkTiming(g, c, next, w, errors, who, adding) {
  const from = firstOpenDay(w);
  if (Number.isInteger(c.day) && c.day > 0) g.day = c.day;
  if (typeof c.time === 'string' && c.time) g.time = c.time;
  if (typeof c.hours === 'number' && c.hours > 0) g.hours = c.hours;
  if (Number.isInteger(c.until_day) && c.until_day > 0) g.until_day = c.until_day;
  if (typeof c.until_goal === 'string' && c.until_goal) g.until_goal = c.until_goal;
  if (typeof c.hours === 'number' && (c.hours < 0 || c.hours > MAX_HOURS)) errors.push(`${who} hours must be 0 or up to ${MAX_HOURS}.`);
  if (g.type === 'fixed') {
    if (!Number.isInteger(g.day) || g.day < 1 || g.day > 10) errors.push(`${who} is a fixed commitment, so it needs its day, 1 to 10.`);
    else if (adding && g.day < from) errors.push(`${who} is on day ${g.day}, which has passed. Today is day ${from}.`);
    if (g.time && !TIME.test(g.time)) errors.push(`${who} time must be HH:MM in 24 hours, like 15:00, or empty.`);
    if (g.target !== 1) errors.push(`${who} is a fixed commitment, so its target is 1.`);
    if (g.until_day || g.until_goal) errors.push(`${who} is a fixed commitment and has no window.`);
    return;
  }
  if (Number.isInteger(c.day) && c.day > 0) errors.push(`${who} is not a fixed commitment, so its day is 0. Days go in propose_schedule.`);
  if (typeof c.time === 'string' && c.time) errors.push(`${who} is not a fixed commitment, so its time is empty.`);
  delete g.day; delete g.time;
  if (g.until_day && (g.until_day < from || g.until_day > WORK_DAYS)) errors.push(`${who} until_day must be ${from} to ${WORK_DAYS}.`);
  if (g.until_goal) {
    const f = next.goals.find(x => x.id === g.until_goal);
    if (!f || f.type !== 'fixed') errors.push(`${who} until_goal "${g.until_goal}" must be the id of a fixed commitment, added before it.`);
  }
  const last = lastDay(next, g);
  const room = Math.max(0, last - from + 1);
  if (g.until_day || g.until_goal) {
    const done = next.schedule.filter(o => o.goal_id === g.id && o.status === 'done').length;
    if (g.target - done > room) errors.push(`${who} has ${g.target - done} sessions to place but only ${room} days from day ${from} to day ${last}.`);
  }
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
    if (g.type === 'fixed') {
      if (o.day !== g.day) errors.push(`"${o.goal_id}" is a fixed commitment on day ${g.day}; it cannot move to day ${o.day}.`);
      continue;
    }
    if (!Number.isInteger(o.day) || o.day < 1 || o.day > WORK_DAYS) { errors.push(`"${o.goal_id}" is on day ${o.day}. Work days are 1 to 9; day 10 is review.`); continue; }
    if (o.day > lastDay(w, g)) { errors.push(`"${o.goal_id}" is on day ${o.day}, after its window ends on day ${lastDay(w, g)}.`); continue; }
    if (o.day < from) { errors.push(`"${o.goal_id}" is on day ${o.day}, which has passed. Today is day ${from}.`); continue; }
    const key = `${o.goal_id}@${o.day}`;
    if (seen.has(key)) errors.push(`"${o.goal_id}" is scheduled twice on day ${o.day}.`);
    if (lockedKeys.has(key)) errors.push(`"${o.goal_id}" is already done or missed on day ${o.day}; do not list it, and do not put another one there.`);
    seen.add(key);
    counts.set(o.goal_id, (counts.get(o.goal_id) || 0) + 1);
  }
  for (const g of w.goals) {
    if (g.type === 'fixed') continue;
    const need = Math.max(0, g.target - doneCount(w, g.id));
    const got = counts.get(g.id) || 0;
    if (got !== need) errors.push(`"${g.id}" has target ${g.target} with ${g.target - need} done, so it needs ${need} upcoming sessions, not ${got}.`);
  }
  const summary = cleanText(input.summary || '');
  if (!summary) errors.push('summary must say in one short line what this proposal changes.');
  if (errors.length) return { ok: false, errors };

  // Fixed commitments keep their day, listed or not.
  const pending = occ.filter(o => findGoal(w, o.goal_id).type !== 'fixed').map(o => ({ goal_id: o.goal_id, day: o.day, detail: cleanText(o.detail || '') }));
  for (const g of w.goals.filter(x => x.type === 'fixed' && x.day >= from && !lockedKeys.has(`${x.id}@${x.day}`))) pending.push({ goal_id: g.id, day: g.day, detail: g.time || '' });
  const before = new Map(), after = new Map();
  for (const o of w.schedule.filter(o => o.status === 'planned')) before.set(o.day, [...(before.get(o.day) || []), o.goal_id].sort());
  for (const o of pending) after.set(o.day, [...(after.get(o.day) || []), o.goal_id].sort());
  const changedDays = [];
  for (let d = 1; d <= 10; d++) if (String(before.get(d) || '') !== String(after.get(d) || '')) changedDays.push(d);
  w.schedule = [...locked, ...pending.map(o => ({ ...o, status: 'planned' }))];
  return {
    ok: true,
    event: { type: 'proposal', occurrences: pending, summary: summary.slice(0, 80), changes: [summary.slice(0, 80)], changed_days: changedDays },
    result: 'Shown to the person as a card with Confirm and Tweak. It is not applied until they confirm.',
  };
}

function suggestTrim(input, w) {
  const errors = [];
  const trims = Array.isArray(input && input.trims) ? input.trims : [];
  if (!trims.length) return { ok: false, errors: ['trims must list at least one goal to lower.'] };
  const seen = new Set();
  for (const t of trims) {
    const g = findGoal(w, t.goal_id);
    if (!g) { errors.push(`No goal with id "${t.goal_id}".`); continue; }
    if (seen.has(t.goal_id)) errors.push(`"${t.goal_id}" is listed twice.`);
    seen.add(t.goal_id);
    if (t.requested !== g.target) errors.push(`"${t.goal_id}" has target ${g.target}, so requested must be ${g.target}.`);
    const floor = Math.max(1, doneCount(w, g.id));
    if (!Number.isInteger(t.suggested) || t.suggested < floor || t.suggested >= g.target) errors.push(`"${t.goal_id}" suggested must be from ${floor} to ${g.target - 1}.`);
  }
  if (errors.length) return { ok: false, errors };
  const out = trims.map(t => ({ goal_id: t.goal_id, requested: t.requested, suggested: t.suggested }));
  return { ok: true, event: { type: 'trim', trims: out, reason: cleanText(input.reason || '').slice(0, 80) }, result: 'Shown on the goals card with Use suggestion and Keep mine. Nothing changes until they choose. Do not list goals or counts in your reply.' };
}

function resolveTrim(input, w) {
  const open = w.openTrim;
  if (!open) return { ok: false, errors: ['There is no open trim to answer.'] };
  if (!['use', 'keep'].includes(input && input.choice)) return { ok: false, errors: ['choice must be use or keep.'] };
  if (input.choice === 'use') {
    const errors = [];
    for (const t of open.trims) {
      const g = findGoal(w, t.goal_id);
      if (!g) errors.push(`No goal with id "${t.goal_id}".`);
      else if (g.target !== t.requested) errors.push(`"${t.goal_id}" is at ${g.target} now, not the ${t.requested} the trim was for. Ask them again.`);
    }
    if (errors.length) return { ok: false, errors };
    for (const t of open.trims) findGoal(w, t.goal_id).target = t.suggested;
  }
  w.openTrim = null;
  return {
    ok: true,
    event: { type: 'trim_resolved', choice: input.choice, trims: open.trims },
    result: input.choice === 'use' ? `Trim applied. Goals now: ${w.goals.map(g => `${g.name} (${g.id}) x${g.target}`).join(', ')}. Now propose the schedule.` : 'Kept their numbers. Now propose the schedule for those counts.',
  };
}

function markOffTopic() {
  return { ok: true, event: { type: 'off_topic' }, result: 'Noted.' };
}

function showStatus() {
  return { ok: true, event: { type: 'status' }, result: 'Shown.' };
}

function updateBrief(input, w) {
  const list = (v, n, what) => {
    if (!Array.isArray(v)) return { error: `${what} must be a list.` };
    const out = v.map(x => cleanText(x).slice(0, 90)).filter(Boolean);
    return out.length > n ? { error: `${what} can have at most ${n}. Keep only what still holds.` } : { out };
  };
  const rules = list(input && input.rules, 8, 'rules'), questions = list(input && input.questions, 3, 'questions');
  const errors = [rules.error, questions.error].filter(Boolean);
  if (errors.length) return { ok: false, errors };
  w.brief = { rules: rules.out, questions: questions.out };
  return { ok: true, event: { type: 'brief', rules: rules.out, questions: questions.out }, result: 'Saved. It shows at the top of the chat.' };
}

function saveSummary(input) {
  const summary = cleanText(input && input.summary);
  if (!summary) return { ok: false, errors: ['summary must not be empty.'] };
  return { ok: true, event: { type: 'summary', summary: summary.slice(0, 1500) }, result: 'Saved.' };
}

const HANDLERS = { update_brief: updateBrief, update_goals: updateGoals, log_day: logDay, propose_schedule: proposeSchedule, show_status: showStatus, mark_off_topic: markOffTopic, suggest_trim: suggestTrim, resolve_trim: resolveTrim, save_summary: saveSummary };

function runTool(name, input, w) {
  const h = HANDLERS[name];
  if (!h) return { ok: false, errors: [`Unknown tool ${name}.`] };
  return h(input, w);
}

module.exports = { TOOLS, STATUS_TOOL, SUMMARY_TOOL, BRIEF_TOOL, OFF_TOPIC_TOOL, TRIM_TOOL, RESOLVE_TRIM_TOOL, TAGS, TAG_NAMES, working, runTool, lastDay, WORK_DAYS };
