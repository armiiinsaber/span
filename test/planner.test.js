const test = require('node:test');
const assert = require('node:assert');
const { plan, buildUserMessage, SYSTEM_PROMPT, PlanError } = require('../lib/planner');

const days = Array.from({ length: 10 }, (_, i) => ({ day: i + 1, date: `2026-09-${22 + i}`, weekday: 'X' }));
const body = { mode: 'plan', today: 'Tuesday 2026-09-22', days, plan: { intentions: [], occurrences: [] }, message: 'six runs' };

const valid = {
  intentions: [{ id: 'run', name: 'Run', type: 'do', tag: '', target: 2 }],
  occurrences: [{ intention_id: 'run', day: 2, detail: '' }, { intention_id: 'run', day: 6, detail: '' }],
  question: '', note: 'Two runs, spread out.', review: '',
};
const malformed = {
  intentions: [{ id: 'run', name: 'Run', type: 'do', tag: '', target: 2 }],
  occurrences: [{ intention_id: 'run', day: 3, detail: '' }, { intention_id: 'run', day: 3, detail: '' }],
  question: '', note: '', review: '',
};
const toolMsg = (input, id = 'tu_1') => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name: 'set_plan', input }] });

function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    messages: { create: async req => { calls.push(JSON.parse(JSON.stringify(req))); return responses.shift(); } },
  };
}

test('retries once after a malformed tool response and feeds errors back', async () => {
  const client = fakeClient([toolMsg(malformed, 'tu_bad'), toolMsg(valid, 'tu_ok')]);
  const result = await plan(client, body);
  assert.equal(result.occurrences.length, 2);
  assert.equal(client.calls.length, 2);
  const retry = client.calls[1].messages;
  const last = retry[retry.length - 1].content[0];
  assert.equal(last.type, 'tool_result');
  assert.equal(last.tool_use_id, 'tu_bad');
  assert.equal(last.is_error, true);
  assert.match(last.content, /twice on day 3/);
});

test('gives up after two invalid responses', async () => {
  const client = fakeClient([toolMsg(malformed), toolMsg(malformed)]);
  await assert.rejects(plan(client, body), PlanError);
  assert.equal(client.calls.length, 2);
});

test('recovers when the first reply is plain text', async () => {
  const client = fakeClient([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Sure.' }] }, toolMsg(valid)]);
  const result = await plan(client, body);
  assert.equal(result.intentions[0].id, 'run');
});

test('request shape: tool, model, no forced tool choice', async () => {
  const client = fakeClient([toolMsg(valid)]);
  await plan(client, body);
  const req = client.calls[0];
  assert.equal(req.model, process.env.CLAUDE_MODEL || 'claude-opus-5-5');
  assert.deepEqual(req.tool_choice, { type: 'auto' });
  assert.equal(req.tools[0].name, 'set_plan');
  assert.equal(req.tools[0].strict, true);
});

test('user message carries real weekdays, today, and history', () => {
  const m = buildUserMessage({ ...body, days: days.map(d => ({ ...d, weekday: 'Friday' })), history: [{ role: 'user', text: 'mom on the weekend' }], past: ['Span Sep 12 to Sep 21: Run 5/6.'] });
  assert.match(m, /Day 1: Friday 2026-09-22/);
  assert.match(m, /Day 10: .*review day/);
  assert.match(m, /Today: Tuesday 2026-09-22/);
  assert.match(m, /mom on the weekend/);
  assert.match(m, /Run 5\/6/);
});

test('system prompt has no dashes used as punctuation', () => {
  assert.doesNotMatch(SYSTEM_PROMPT, /[\u2014\u2013]/);
  assert.doesNotMatch(SYSTEM_PROMPT, /\s-\s/);
});
