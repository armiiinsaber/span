const test = require('node:test');
const assert = require('node:assert');
const { validatePlan, cleanText } = require('../lib/validate');

const good = () => ({
  intentions: [
    { id: 'run', name: 'Run', type: 'do', tag: '', target: 2 },
    { id: 'sober', name: 'Sober night', type: 'abstain', tag: 'evening', target: 1 },
  ],
  occurrences: [
    { intention_id: 'run', day: 1, detail: '' },
    { intention_id: 'run', day: 5, detail: '' },
    { intention_id: 'sober', day: 3, detail: '' },
  ],
  question: '', note: 'Light start.', review: '',
});

test('accepts a clean plan', () => {
  const r = validatePlan(good());
  assert.equal(r.ok, true, r.errors.join());
});

test('rejects the same intention twice on one day', () => {
  const p = good();
  p.occurrences[1].day = 1;
  const r = validatePlan(p);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /twice on day 1/);
});

test('rejects day 10 and out of range days', () => {
  for (const day of [0, 10, 11, 2.5, '3']) {
    const p = good();
    p.occurrences[0].day = day;
    assert.equal(validatePlan(p).ok, false, `day ${day}`);
  }
});

test('rejects counts that do not match targets', () => {
  const p = good();
  p.intentions[0].target = 3;
  assert.match(validatePlan(p).errors.join(), /target 3 but 2/);
});

test('rejects unknown intention, bad type, bad target, duplicate id', () => {
  const p = good();
  p.occurrences.push({ intention_id: 'ghost', day: 2, detail: '' });
  p.intentions[1].type = 'avoid';
  p.intentions.push({ id: 'run', name: 'Run again', type: 'do', tag: '', target: 12 });
  const errs = validatePlan(p).errors.join('\n');
  assert.match(errs, /unknown intention "ghost"/);
  assert.match(errs, /type "avoid"/);
  assert.match(errs, /used twice/);
  assert.match(errs, /target must be/);
});

test('rejects malformed shapes', () => {
  assert.equal(validatePlan(null).ok, false);
  assert.equal(validatePlan('plan').ok, false);
  assert.equal(validatePlan({ intentions: {}, occurrences: [] }).ok, false);
  assert.equal(validatePlan({ intentions: [null], occurrences: [7] }).ok, false);
});

test('rebalance keeps done work and avoids past days', () => {
  const ctx = {
    mode: 'rebalance', currentDay: 4,
    plan: { occurrences: [{ intention_id: 'run', day: 1, done: true }, { intention_id: 'run', day: 2, done: false }] },
  };
  const moved = good();
  moved.occurrences[0].day = 6; // moved the done run away
  assert.match(validatePlan(moved, ctx).errors.join(), /Completed "run" on day 1/);

  const past = good();
  past.occurrences[2].day = 2; // sober night in the past
  assert.match(validatePlan(past, ctx).errors.join(), /day 2, which has passed/);

  const ok = good();
  ok.occurrences[2].day = 7;
  assert.equal(validatePlan(ok, ctx).ok, true, validatePlan(ok, ctx).errors.join());
});

test('strips dashes used as punctuation', () => {
  assert.equal(cleanText('Heavy week \u2014 trim a run'), 'Heavy week, trim a run');
  assert.equal(cleanText('Rest - then run'), 'Rest, then run');
  assert.equal(cleanText('a check-in call'), 'a check-in call');
});
