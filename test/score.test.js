const test = require('node:test');
const assert = require('node:assert');
const { scorePlan } = require('../lib/score');

// A deka starting on a Wednesday: day 3 is a Friday, day 4 a Saturday, day 9 a Thursday.
const WD = ['Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const days = WD.map((weekday, i) => ({ day: i + 1, weekday }));
const g = (id, tags) => ({ id, name: id, type: 'do', category: 'body', energy: 'light', social: 'no', fun: 'no', time_of_day: 'any', weekend: 'no', ...tags });
const date = g('date', { category: 'fun', social: 'yes', fun: 'yes', time_of_day: 'evening', weekend: 'yes' });
const boys = g('boys', { category: 'fun', social: 'yes', fun: 'yes', time_of_day: 'evening', weekend: 'yes' });
const sober = g('sober', { type: 'abstain', category: 'rest', time_of_day: 'evening' });
const gym = g('gym', { energy: 'heavy' });
const run = g('run', { energy: 'heavy' });
const work = g('work', { category: 'work', energy: 'heavy', time_of_day: 'evening' });
const walk = g('walk');
const at = pairs => pairs.map(([goal_id, day]) => ({ goal_id, day }));
// Something light on every day, so no day looks like a free day.
const filler = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => ['walk', d]);
const keys = (goals, sessions) => scorePlan({ goals: [walk, ...goals], sessions: at([...filler, ...sessions]), days }).map(f => f.key);

test('fun nights on back to back days are flagged; a day apart is fine', () => {
  assert.ok(keys([date, boys], [['date', 3], ['boys', 4]]).includes('fun-next-3'));
  assert.ok(keys([date, boys], [['date', 3], ['boys', 3]]).includes('fun-same-3'));
  assert.deepEqual(keys([date, boys], [['date', 3], ['boys', 6]]).filter(k => k.startsWith('fun')), []);
});

test('a weekend plan on a weekday is flagged while a Friday or Saturday is open', () => {
  assert.ok(keys([date], [['date', 6]]).includes('weekend-date-6'));
  assert.deepEqual(keys([date], [['date', 4]]).filter(k => k.startsWith('weekend')), []);
  assert.deepEqual(keys([date], [['date', 5]]).filter(k => k.startsWith('weekend')), [], 'Sunday is weekend too');
  // Friday day 3 holds the date night, and Saturday is next to it, so the boys night may go midweek.
  assert.deepEqual(keys([date, boys], [['date', 3], ['boys', 7]]).filter(k => k.startsWith('weekend')), []);
});

test('sober nights stay off nights out and off the night before one', () => {
  assert.ok(keys([date, sober], [['date', 3], ['sober', 3]]).includes('sober-on-3'));
  assert.ok(keys([date, sober], [['date', 3], ['sober', 2]]).includes('sober-before-2'));
  assert.deepEqual(keys([date, sober], [['date', 3], ['sober', 6]]).filter(k => k.startsWith('sober')), []);
});

test('heavy days: doubled workouts only when forced, not back to back, no day far above the rest', () => {
  assert.ok(keys([gym, run], [['gym', 2], ['run', 2]]).includes('heavy-body'));
  const forced = [];
  for (let d = 1; d <= 9; d++) forced.push(['gym', d], ['run', d]);
  assert.equal(keys([gym, run], forced).includes('heavy-body'), false, 'nine of each must double up');
  assert.ok(keys([gym, work], [['gym', 2], ['work', 2], ['gym', 3], ['work', 3]]).includes('heavy-next-2'));
  const piled = [['gym', 5], ['run', 5], ['work', 5], ['date', 5], ['sober', 5]];
  assert.ok(keys([gym, run, work, date, sober], piled).includes('load-5'));
});

test('a fun night keeps its evening free and its workouts single', () => {
  assert.ok(keys([date, work], [['date', 3], ['work', 3]]).includes('light-evening-3'));
  assert.ok(keys([date, gym, run], [['date', 3], ['gym', 3], ['run', 3]]).includes('light-heavy-3'));
});

test('days with nothing on them are treated as free, and done sessions only count as context', () => {
  const s = scorePlan({ goals: [date], sessions: [{ goal_id: 'date', day: 6 }], days }).map(f => f.key);
  assert.equal(s.includes('weekend-date-6'), false, 'an empty Friday is not pushed on');
  const done = scorePlan({ goals: [walk, date, boys], sessions: at(filler).concat([{ goal_id: 'date', day: 3, locked: true }, { goal_id: 'boys', day: 4, locked: true }]), days, from: 5 });
  assert.deepEqual(done, []);
});
