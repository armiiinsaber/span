// A plain check of how well a valid schedule is laid out, run on every proposal next to
// the validation in tools.js. It never rejects a plan; it lists what could be better, and
// the chat loop gives Claude one chance to improve it. Each flag has a stable key, so a
// tweak is only asked to fix what it made worse, not what the plan already had.

const WORK_DAYS = 9;

const isFun = g => g && g.fun === 'yes';
const isSocial = g => g && g.social === 'yes';
const isHeavy = g => g && g.energy === 'heavy';
const isHeavyBody = g => isHeavy(g) && g.category === 'body';
const nightOut = g => (isFun(g) || isSocial(g)) && g.time_of_day === 'evening';
const isSober = g => g && g.type === 'abstain' && (g.time_of_day === 'evening' || /sober|drink|alcohol|dry/i.test(g.name));

/**
 * goals: [{ id, name, type, energy, social, fun, time_of_day, weekend, category }]
 * sessions: [{ goal_id, day, locked }] for the whole deka, locked for done or missed ones.
 * days: [{ day, weekday }]. from: the first day new sessions may go on.
 * Returns [{ key, text }].
 */
function scorePlan({ goals, sessions, days = [], from = 1 }) {
  const flags = [];
  const flag = (key, text) => { if (!flags.some(f => f.key === key)) flags.push({ key, text }); };
  const goal = id => goals.find(g => g.id === id);
  const name = id => (goal(id) || { name: id }).name;
  const weekday = d => (days.find(x => x.day === d) || {}).weekday || '';
  const range = [];
  for (let d = from; d <= WORK_DAYS; d++) range.push(d);
  const on = d => sessions.filter(s => s.day === d);
  const ahead = sessions.filter(s => !s.locked && s.day >= from && s.day <= WORK_DAYS);
  // A day with nothing on it may be a free day they asked for, so plans are never pushed onto one.
  const active = range.filter(d => on(d).length);
  const has = (d, test) => on(d).some(s => test(goal(s.goal_id)));
  const count = (d, test) => on(d).filter(s => test(goal(s.goal_id))).length;

  // Fun nights spread out: never the same day, and at least a day apart when the count allows.
  const fun = sessions.filter(s => isFun(goal(s.goal_id)) && s.day <= WORK_DAYS).sort((a, b) => a.day - b.day);
  const funAhead = fun.filter(s => s.day >= from).length;
  const roomy = funAhead <= Math.ceil(range.length / 2);
  for (let i = 0; i < fun.length; i++) {
    for (let j = i + 1; j < fun.length; j++) {
      const a = fun[i], b = fun[j];
      if (a.locked && b.locked) continue;
      const gap = b.day - a.day;
      if (gap === 0) flag(`fun-same-${a.day}`, `${name(a.goal_id)} and ${name(b.goal_id)} are both on day ${a.day}. Give each fun plan its own day.`);
      else if (gap === 1 && roomy) flag(`fun-next-${a.day}`, `${name(a.goal_id)} on day ${a.day} and ${name(b.goal_id)} on day ${b.day} are back to back. Leave at least one day between fun plans.`);
    }
  }
  // The same social goal on back to back days, when there is room to spread it.
  for (const g of goals.filter(x => isSocial(x) && !isFun(x))) {
    const ds = ahead.filter(s => s.goal_id === g.id).map(s => s.day).sort((a, b) => a - b);
    if (ds.length < 2 || ds.length * 2 - 1 > active.length) continue;
    for (let i = 1; i < ds.length; i++) if (ds[i] - ds[i - 1] === 1) flag(`social-${g.id}-${ds[i - 1]}`, `${g.name} is on days ${ds[i - 1]} and ${ds[i]} in a row. Spread it out.`);
  }

  // Weekend plans off weekdays while a Friday or Saturday is still open for them. Sunday is weekend too.
  const friSat = active.filter(d => ['Friday', 'Saturday'].includes(weekday(d)));
  for (const s of ahead) {
    const g = goal(s.goal_id);
    if (!g || g.weekend !== 'yes' || ['Friday', 'Saturday', 'Sunday'].includes(weekday(s.day))) continue;
    const open = friSat.filter(d => !on(d).some(x => x.goal_id === g.id) &&
      !(isFun(g) && [d - 1, d, d + 1].some(n => on(n).some(x => x !== s && isFun(goal(x.goal_id))))));
    if (open.length) flag(`weekend-${g.id}-${s.day}`, `${g.name} is on day ${s.day}, a ${weekday(s.day)}, while ${weekday(open[0])} day ${open[0]} is open. It belongs on a Friday or Saturday.`);
  }

  // Sober nights stay off nights out and off the night before one, when another day is open.
  const nights = new Set(sessions.filter(s => nightOut(goal(s.goal_id))).map(s => s.day));
  const calm = active.filter(d => !nights.has(d) && !nights.has(d + 1) && !has(d, isSober));
  for (const s of ahead.filter(x => isSober(goal(x.goal_id)))) {
    if (nights.has(s.day)) flag(`sober-on-${s.day}`, `${name(s.goal_id)} on day ${s.day} falls on a night out. Move it to a quiet night.`);
    else if (nights.has(s.day + 1) && calm.length) flag(`sober-before-${s.day}`, `${name(s.goal_id)} on day ${s.day} is the night before a night out, and day ${calm[0]} is free for it.`);
  }

  // Heavy days: two heavy body sessions only when the count forces it, heavy days not back to back,
  // and no day far above the rest.
  const heavyBody = ahead.filter(s => isHeavyBody(goal(s.goal_id))).length;
  const doubled = active.filter(d => count(d, isHeavyBody) >= 2);
  if (doubled.length > Math.max(0, heavyBody - active.length)) {
    flag('heavy-body', `Days ${doubled.join(', ')} each have two hard workouts, more than the counts need. Give each its own day.`);
  }
  const heavy = ahead.filter(s => isHeavy(goal(s.goal_id))).length;
  const heavyDays = active.filter(d => count(d, isHeavy) >= 2);
  if (Math.max(0, heavy - active.length) <= Math.ceil(active.length / 2)) {
    for (let i = 1; i < heavyDays.length; i++) {
      if (heavyDays[i] - heavyDays[i - 1] === 1) flag(`heavy-next-${heavyDays[i - 1]}`, `Days ${heavyDays[i - 1]} and ${heavyDays[i]} are both heavy, back to back. Put a lighter day between them.`);
    }
  }
  const loads = active.map(d => on(d).length);
  const avg = loads.reduce((a, b) => a + b, 0) / (loads.length || 1);
  for (const d of active) if (on(d).length > avg + 1.5) flag(`load-${d}`, `Day ${d} has ${on(d).length} things, well above the average of ${avg.toFixed(1)}. Move one to a lighter day.`);

  // A fun night stays light: no two hard workouts and no other evening plan that day.
  for (const d of new Set(ahead.filter(s => isFun(goal(s.goal_id)) && goal(s.goal_id).time_of_day === 'evening').map(s => s.day))) {
    if (count(d, isHeavyBody) >= 2) flag(`light-heavy-${d}`, `Day ${d} has a fun night and two hard workouts. Keep that day light.`);
    const other = on(d).filter(s => { const g = goal(s.goal_id); return g && !isFun(g) && g.type !== 'abstain' && g.time_of_day === 'evening'; });
    if (other.length) flag(`light-evening-${d}`, `Day ${d} has a fun night and ${other.map(s => name(s.goal_id)).join(' and ')} the same evening. Keep that evening free.`);
  }
  return flags;
}

module.exports = { scorePlan };
