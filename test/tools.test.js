const test = require('node:test');
const assert = require('node:assert');
const { working, runTool } = require('../lib/tools');

const goals = () => [
  { id: 'run', name: 'Run', type: 'do', tag: '', target: 3 },
  { id: 'gym', name: 'Gym', type: 'do', tag: '', target: 2 },
];
const live = (day, schedule) => working({ phase: 'live', current_day: day, goals: goals(), schedule });
const planning = () => working({ phase: 'planning', current_day: null, goals: goals(), schedule: [] });
const errs = r => (r.errors || []).join('\n');
const family = { icon: 'family', category: 'people', energy: 'light', social: 'yes', fun: 'no', time_of_day: 'any', weekend: 'no' };
const keep = { icon: 'unchanged', category: 'unchanged', energy: 'unchanged', social: 'unchanged', fun: 'unchanged', time_of_day: 'unchanged', weekend: 'unchanged' };

test('update_goals adds, edits and removes, cleaning names', () => {
  const w = planning();
  const r = runTool('update_goals', { changes: [
    { op: 'add', id: 'see_mom', name: 'See mom \u2014 Sundays', type: 'see', tag: '', target: 5, ...family },
    { op: 'edit', id: 'run', name: '', type: 'unchanged', tag: '', target: 6, ...keep, icon: 'run' },
    { op: 'remove', id: 'gym', name: '', type: 'unchanged', tag: '', target: 0 },
  ] }, w);
  assert.equal(r.ok, true, errs(r));
  assert.deepEqual(w.goals.map(g => [g.id, g.target]), [['run', 6], ['see_mom', 5]]);
  assert.equal(w.goals[1].name, 'See mom, Sundays');
  assert.equal(w.goals[1].icon, 'family');
  assert.equal(w.goals[0].icon, 'run', 'an edit can set the icon');
  assert.equal(w.goals[0].category, undefined, 'unchanged fields stay as they were');
  assert.equal(r.event.type, 'goals');
});

test('update_goals rejects bad input', () => {
  const w = planning();
  assert.match(errs(runTool('update_goals', { changes: [{ op: 'add', id: 'run', name: 'Run', type: 'do', tag: '', target: 2, ...family }] }, w)), /already exists/);
  assert.match(errs(runTool('update_goals', { changes: [{ op: 'add', id: 'x', name: 'X', type: 'do', tag: '', target: 12, ...family }] }, w)), /target must be 1 to 9/);
  assert.match(errs(runTool('update_goals', { changes: [{ op: 'add', id: 'x', name: 'X', type: 'do', tag: '', target: 2, ...family, icon: 'unicorn' }] }, w)), /needs icon/);
  assert.match(errs(runTool('update_goals', { changes: [{ op: 'add', id: 'x', name: 'X', type: 'do', tag: '', target: 2, ...family, category: 'unchanged' }] }, w)), /needs category/);
  assert.match(errs(runTool('update_goals', { changes: [{ op: 'edit', id: 'run', name: '', type: 'unchanged', tag: '', target: 0, ...keep, time_of_day: 'noon' }] }, w)), /time_of_day must be/);
  assert.match(errs(runTool('update_goals', { changes: [{ op: 'edit', id: 'nope', name: '', type: 'unchanged', tag: '', target: 0 }] }, w)), /No goal/);
  assert.match(errs(runTool('update_goals', { changes: [] }, w)), /at least one/);
  const lw = live(5, [{ goal_id: 'run', day: 1, status: 'done' }, { goal_id: 'run', day: 2, status: 'done' }]);
  assert.match(errs(runTool('update_goals', { changes: [{ op: 'edit', id: 'run', name: '', type: 'unchanged', tag: '', target: 1 }] }, lw)), /cannot go below 2/);
});

test('propose_schedule accepts a clean plan and reports changed days', () => {
  const w = live(4, [
    { goal_id: 'run', day: 1, status: 'done' }, { goal_id: 'run', day: 5, status: 'planned' }, { goal_id: 'run', day: 7, status: 'planned' },
    { goal_id: 'gym', day: 2, status: 'missed' }, { goal_id: 'gym', day: 6, status: 'planned' },
  ]);
  const r = runTool('propose_schedule', { occurrences: [
    { goal_id: 'run', day: 5, detail: '' }, { goal_id: 'run', day: 8, detail: '' },
    { goal_id: 'gym', day: 4, detail: '' }, { goal_id: 'gym', day: 6, detail: '' },
  ], summary: 'Run to day 8, gym on day 4' }, w);
  assert.equal(r.ok, true, errs(r));
  assert.equal(r.event.summary, 'Run to day 8, gym on day 4');
  assert.deepEqual(r.event.changed_days, [4, 7, 8]);
});

test('propose_schedule enforces days, counts, duplicates, fixed work and the past', () => {
  const sched = [{ goal_id: 'run', day: 1, status: 'done' }, { goal_id: 'gym', day: 2, status: 'missed' }];
  const bad = (occ, match) => {
    const r = runTool('propose_schedule', { occurrences: occ, summary: 'x' }, live(4, sched));
    assert.equal(r.ok, false); assert.match(errs(r), match);
  };
  const base = [{ goal_id: 'run', day: 5, detail: '' }, { goal_id: 'run', day: 7, detail: '' }, { goal_id: 'gym', day: 5, detail: '' }, { goal_id: 'gym', day: 8, detail: '' }];
  bad([...base.slice(0, 3), { goal_id: 'gym', day: 10, detail: '' }], /day 10\. Work days are 1 to 9/);
  bad([...base.slice(0, 3), { goal_id: 'gym', day: 3, detail: '' }], /day 3, which has passed/);
  bad([...base.slice(0, 3), { goal_id: 'gym', day: 5, detail: '' }], /twice on day 5/);
  bad(base.slice(0, 3), /needs 2 upcoming sessions, not 1/);
  bad([...base, { goal_id: 'run', day: 9, detail: '' }], /needs 2 upcoming sessions, not 3/);
  bad([...base, { goal_id: 'ghost', day: 6, detail: '' }], /unknown goal/);
  const r = runTool('propose_schedule', { occurrences: base, summary: ' ' }, live(4, sched));
  assert.match(errs(r), /summary must say/);
  // A done session can never be listed again on its day.
  const w = working({ phase: 'live', current_day: 1, goals: goals(), schedule: [{ goal_id: 'run', day: 1, status: 'done' }] });
  const again = runTool('propose_schedule', { occurrences: [{ goal_id: 'run', day: 1, detail: '' }, { goal_id: 'run', day: 3, detail: '' }, { goal_id: 'gym', day: 2, detail: '' }, { goal_id: 'gym', day: 4, detail: '' }], summary: 'x' }, w);
  assert.match(errs(again), /already done or missed on day 1/);
});

test('log_day marks, moves a later session forward, and refuses the future', () => {
  const w = live(4, [{ goal_id: 'run', day: 4, status: 'planned' }, { goal_id: 'gym', day: 6, status: 'planned' }, { goal_id: 'gym', day: 8, status: 'planned' }]);
  const r = runTool('log_day', { day: 4, entries: [{ goal_id: 'run', status: 'missed' }, { goal_id: 'gym', status: 'done' }] }, w);
  assert.equal(r.ok, true, errs(r));
  assert.deepEqual(r.event.entries, [{ goal_id: 'run', status: 'missed' }, { goal_id: 'gym', status: 'done', moved_from: 8 }]);
  assert.deepEqual(w.schedule.filter(o => o.goal_id === 'gym').map(o => [o.day, o.status]), [[6, 'planned'], [4, 'done']]);
  assert.match(errs(runTool('log_day', { day: 5, entries: [{ goal_id: 'run', status: 'done' }] }, w)), /1 to 4/);
  assert.match(errs(runTool('log_day', { day: 3, entries: [{ goal_id: 'ghost', status: 'done' }] }, w)), /No goal/);
  assert.match(errs(runTool('log_day', { day: 1, entries: [{ goal_id: 'run', status: 'done' }] }, planning())), /while a deka is running/);
});

test('suggest_trim lowers nothing itself and checks each goal, count and floor', () => {
  const w = planning();
  const ok = runTool('suggest_trim', { trims: [{ goal_id: 'run', requested: 3, suggested: 2 }], reason: 'time alone \u2014 every other day' }, w);
  assert.equal(ok.ok, true, errs(ok));
  assert.deepEqual(ok.event, { type: 'trim', trims: [{ goal_id: 'run', requested: 3, suggested: 2 }], reason: 'time alone, every other day' });
  assert.equal(w.goals.find(g => g.id === 'run').target, 3, 'the target is unchanged until they choose');
  assert.match(errs(runTool('suggest_trim', { trims: [], reason: '' }, w)), /at least one/);
  assert.match(errs(runTool('suggest_trim', { trims: [{ goal_id: 'ghost', requested: 1, suggested: 1 }], reason: '' }, w)), /No goal/);
  assert.match(errs(runTool('suggest_trim', { trims: [{ goal_id: 'run', requested: 5, suggested: 2 }], reason: '' }, w)), /requested must be 3/);
  assert.match(errs(runTool('suggest_trim', { trims: [{ goal_id: 'run', requested: 3, suggested: 3 }], reason: '' }, w)), /from 1 to 2/);
  assert.match(errs(runTool('suggest_trim', { trims: [{ goal_id: 'run', requested: 3, suggested: 2 }, { goal_id: 'run', requested: 3, suggested: 1 }], reason: '' }, w)), /listed twice/);
  const lw = live(5, [{ goal_id: 'run', day: 1, status: 'done' }, { goal_id: 'run', day: 2, status: 'done' }]);
  assert.match(errs(runTool('suggest_trim', { trims: [{ goal_id: 'run', requested: 3, suggested: 1 }], reason: '' }, lw)), /from 2 to 2/, 'never below what is done');
});

test('resolve_trim answers only the open trim, the way the buttons do', () => {
  const trim = { trims: [{ goal_id: 'run', requested: 3, suggested: 2 }] };
  const none = working({ phase: 'planning', goals: goals(), schedule: [] });
  assert.match(errs(runTool('resolve_trim', { choice: 'use' }, none)), /no open trim/);
  const w = working({ phase: 'planning', goals: goals(), schedule: [], open_trim: trim });
  const used = runTool('resolve_trim', { choice: 'use' }, w);
  assert.equal(used.ok, true, errs(used));
  assert.deepEqual(used.event, { type: 'trim_resolved', choice: 'use', trims: trim.trims });
  assert.equal(w.goals.find(g => g.id === 'run').target, 2, 'a proposal in the same turn is judged on the new count');
  assert.match(errs(runTool('resolve_trim', { choice: 'keep' }, w)), /no open trim/, 'answered once');
  const k = working({ phase: 'planning', goals: goals(), schedule: [], open_trim: trim });
  assert.equal(runTool('resolve_trim', { choice: 'keep' }, k).event.choice, 'keep');
  assert.equal(k.goals.find(g => g.id === 'run').target, 3);
  const moved = working({ phase: 'planning', goals: goals().map(g => g.id === 'run' ? { ...g, target: 5 } : g), schedule: [], open_trim: trim });
  assert.match(errs(runTool('resolve_trim', { choice: 'use' }, moved)), /at 5 now/);
});
