const test = require('node:test');
const assert = require('node:assert');
const { runChat, buildMessages } = require('../lib/chat');

const days = Array.from({ length: 10 }, (_, i) => ({ day: i + 1, date: `2026-09-${String(23 + i).padStart(2, '0')}`, weekday: 'Wednesday' }));
const body = extra => ({ phase: 'planning', today: 'Wednesday 2026-09-23', days, goals: [{ id: 'run', name: 'Run', type: 'do', tag: '', target: 2 }], schedule: [], messages: [], message: 'plan it', ...extra });

// A scripted stand in for client.messages.stream: each call plays the next reply.
function scripted(replies) {
  const calls = [];
  return {
    calls,
    messages: {
      stream(params) {
        calls.push(JSON.parse(JSON.stringify(params)));
        const reply = replies.shift();
        let onText = () => {};
        return {
          on(e, cb) { if (e === 'text') onText = cb; return this; },
          abort() {},
          async finalMessage() {
            for (const w of (reply.text || '').split(/(?<= )/)) onText(w);
            const content = [];
            if (reply.text) content.push({ type: 'text', text: reply.text });
            for (const [i, t] of (reply.tools || []).entries()) content.push({ type: 'tool_use', id: `t${calls.length}_${i}`, name: t[0], input: t[1] });
            return { stop_reason: reply.tools ? 'tool_use' : 'end_turn', content };
          },
        };
      },
    },
  };
}
const collect = async (client, b) => { const ev = []; await runChat(client, b, (e, d) => ev.push([e, d])); return ev; };

test('streams text in order and removes dashes used as punctuation', async () => {
  const ev = await collect(scripted([{ text: 'Two runs \u2014 easy ones.' }]), body());
  assert.equal(ev.filter(e => e[0] === 'text').map(e => e[1].delta).join(''), 'Two runs, easy ones.');
});

test('a malformed proposal goes back once with errors, and only the fixed one reaches the app', async () => {
  const client = scripted([
    { text: 'Here.', tools: [['propose_schedule', { occurrences: [{ goal_id: 'run', day: 3, detail: '' }, { goal_id: 'run', day: 3, detail: '' }], changes: ['Two runs'] }]] },
    { tools: [['propose_schedule', { occurrences: [{ goal_id: 'run', day: 3, detail: '' }, { goal_id: 'run', day: 7, detail: '' }], changes: ['Runs on Days 3 and 7'] }]] },
    { text: ' Confirm when ready.' },
  ]);
  const ev = await collect(client, body());
  const proposals = ev.filter(e => e[0] === 'proposal');
  assert.equal(proposals.length, 1);
  assert.deepEqual(proposals[0][1].occurrences.map(o => o.day), [3, 7]);
  const retry = client.calls[1].messages.at(-1).content[0];
  assert.equal(retry.is_error, true);
  assert.match(retry.content, /twice on day 3/);
  assert.equal(client.calls[0].tool_choice.type, 'auto');
  assert.deepEqual(client.calls[0].tools.map(t => t.name), ['update_goals', 'log_day', 'propose_schedule']);
});

test('two invalid calls end the turn with an error and nothing applied', async () => {
  const badCall = ['propose_schedule', { occurrences: [{ goal_id: 'run', day: 10, detail: '' }], changes: ['x'] }];
  const ev = await collect(scripted([{ tools: [badCall] }, { tools: [badCall] }]), body());
  assert.equal(ev.some(e => e[0] === 'proposal'), false);
  assert.equal(ev.at(-1)[0], 'error');
});

test('goals then a proposal in one turn are judged together', async () => {
  const ev = await collect(scripted([
    { tools: [['update_goals', { changes: [{ op: 'add', id: 'gym', name: 'Gym', type: 'do', tag: '', target: 1 }] }], ['propose_schedule', { occurrences: [{ goal_id: 'run', day: 2, detail: '' }, { goal_id: 'run', day: 6, detail: '' }, { goal_id: 'gym', day: 4, detail: '' }], changes: ['Added gym on Day 4'] }]] },
    { text: 'Done.' },
  ]), body());
  assert.deepEqual(ev.filter(e => ['goals', 'proposal'].includes(e[0])).map(e => e[0]), ['goals', 'proposal']);
});

test('review turns cannot log days, and older messages ask for a summary', async () => {
  const client = scripted([{ text: 'Ok.' }]);
  await collect(client, body({ phase: 'review', event: { kind: 'review' }, message: null, to_summarize: [{ role: 'user', text: 'old' }] }));
  assert.deepEqual(client.calls[0].tools.map(t => t.name), ['update_goals', 'propose_schedule', 'save_summary']);
  assert.match(client.calls[0].messages.at(-1).content, /Event: review/);
});

test('the conversation alternates roles and ends with the context and the new message', () => {
  const msgs = buildMessages(body({ messages: [
    { role: 'assistant', text: 'How did today go?' }, { role: 'user', text: 'good' }, { role: 'user', text: 'really' },
    { role: 'assistant', text: 'Nice.' },
  ], event: { kind: 'checkin', days: [4, 5] }, message: 'ran, missed gym' }));
  assert.deepEqual(msgs.map(m => m.role), ['user', 'assistant', 'user', 'assistant', 'user']);
  assert.match(msgs.at(-1).content, /<deka>[\s\S]*"today":"Wednesday 2026-09-23"[\s\S]*check in for day 4 and day 5[\s\S]*Person: ran, missed gym/);
  assert.equal(msgs[2].content, 'good\n\nreally');
});

test('text from a second round joins the first with one space', async () => {
  const ev = await collect(scripted([
    { text: 'Here it is.', tools: [['propose_schedule', { occurrences: [{ goal_id: 'run', day: 2, detail: '' }, { goal_id: 'run', day: 5, detail: '' }], changes: ['Runs on Days 2 and 5'] }]] },
    { text: 'Confirm when it looks right.' },
  ]), body());
  assert.equal(ev.filter(e => e[0] === 'text').map(e => e[1].delta).join(''), 'Here it is. Confirm when it looks right.');
});
