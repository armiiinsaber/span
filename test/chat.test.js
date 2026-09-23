const test = require('node:test');
const assert = require('node:assert');
const { runChat, buildMessages, contextBlock, CEILING, MAX_ROUNDS } = require('../lib/chat');

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
    { text: 'Here.', tools: [['propose_schedule', { occurrences: [{ goal_id: 'run', day: 3, detail: '' }, { goal_id: 'run', day: 3, detail: '' }], summary: 'Two runs' }]] },
    { tools: [['propose_schedule', { occurrences: [{ goal_id: 'run', day: 3, detail: '' }, { goal_id: 'run', day: 7, detail: '' }], summary: 'Runs on days 3 and 7' }]] },
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
  assert.deepEqual(client.calls[0].tools.map(t => t.name), ['update_goals', 'log_day', 'propose_schedule', 'suggest_trim', 'mark_off_topic']);
});

test('two invalid calls end the turn with an error and nothing applied', async () => {
  const badCall = ['propose_schedule', { occurrences: [{ goal_id: 'run', day: 10, detail: '' }], summary: 'x' }];
  const ev = await collect(scripted([{ tools: [badCall] }, { tools: [badCall] }]), body());
  assert.equal(ev.some(e => e[0] === 'proposal'), false);
  assert.equal(ev.at(-1)[0], 'error');
});

test('goals then a proposal in one turn are judged together', async () => {
  const ev = await collect(scripted([
    { tools: [['update_goals', { changes: [{ op: 'add', id: 'gym', name: 'Gym', type: 'do', tag: '', target: 1, icon: 'gym', category: 'body', energy: 'heavy', social: 'no', fun: 'no', time_of_day: 'any', weekend: 'no' }] }], ['propose_schedule', { occurrences: [{ goal_id: 'run', day: 2, detail: '' }, { goal_id: 'run', day: 6, detail: '' }, { goal_id: 'gym', day: 4, detail: '' }], summary: 'Gym on day 4' }]] },
    { text: 'Done.' },
  ]), body());
  assert.deepEqual(ev.filter(e => ['goals', 'proposal'].includes(e[0])).map(e => e[0]), ['goals', 'proposal']);
});

test('review turns cannot log days, and older messages ask for a summary', async () => {
  const client = scripted([{ text: 'Ok.' }]);
  await collect(client, body({ phase: 'review', event: { kind: 'review' }, message: null, to_summarize: [{ role: 'user', text: 'old' }] }));
  assert.deepEqual(client.calls[0].tools.map(t => t.name), ['update_goals', 'propose_schedule', 'suggest_trim', 'show_status', 'mark_off_topic', 'save_summary']);
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

const twoRuns = days => ['propose_schedule', { occurrences: days.map(day => ({ goal_id: 'run', day, detail: '' })), summary: 'Runs' }];

test('a written reply with valid calls ends the turn without a follow up request', async () => {
  const client = scripted([{ text: 'Here it is.', tools: [twoRuns([2, 5])] }, { text: 'Never sent.' }]);
  const ev = await collect(client, body());
  assert.equal(client.calls.length, 1);
  assert.equal(ev.filter(e => e[0] === 'text').map(e => e[1].delta).join(''), 'Here it is.');
  assert.equal(ev.filter(e => e[0] === 'proposal').length, 1);
});

test('calls made before any reply get a follow up request for the reply', async () => {
  const client = scripted([{ tools: [twoRuns([2, 5])] }, { text: 'Runs on days 2 and 5.' }]);
  const ev = await collect(client, body());
  assert.equal(client.calls.length, 2);
  assert.equal(ev.filter(e => e[0] === 'text').map(e => e[1].delta).join(''), 'Runs on days 2 and 5.');
});

test('once a reply is written, a retry round adds no text, so nothing repeats', async () => {
  const client = scripted([{ text: 'Here it is.', tools: [twoRuns([3, 3])] }, { text: 'Here it is again.', tools: [twoRuns([3, 7])] }]);
  const ev = await collect(client, body());
  assert.equal(client.calls.length, 2);
  assert.equal(ev.filter(e => e[0] === 'text').map(e => e[1].delta).join(''), 'Here it is.');
});

test('an open card reaches Claude with every session', () => {
  const card = { changes: ['Runs on days 2 and 6'], sessions: [{ goal_id: 'run', day: 2, detail: '' }, { goal_id: 'run', day: 6, detail: 'easy' }] };
  const ctx = JSON.parse(contextBlock(body({ open_card: card })).match(/<deka>\n(.*)\n<\/deka>/)[1]);
  assert.deepEqual(ctx.open_card, card);
  assert.equal('open_card' in JSON.parse(contextBlock(body()).match(/<deka>\n(.*)\n<\/deka>/)[1]), false);
});

// A goal set with tags, for the plan quality check.
const tagged = extra => body({ goals: [
  { id: 'date', name: 'Date night', type: 'see', tag: '', target: 1, icon: 'date', category: 'fun', energy: 'light', social: 'yes', fun: 'yes', time_of_day: 'evening', weekend: 'yes' },
  { id: 'boys', name: 'Boys night', type: 'see', tag: '', target: 1, icon: 'drinks', category: 'fun', energy: 'light', social: 'yes', fun: 'yes', time_of_day: 'evening', weekend: 'yes' },
], days: ['Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((weekday, i) => ({ day: i + 1, date: '', weekday })), ...extra });
const nights = (a, b) => ['propose_schedule', { occurrences: [{ goal_id: 'date', day: a, detail: '' }, { goal_id: 'boys', day: b, detail: '' }], summary: 'Two nights out' }];

test('a flagged plan gets one try to improve, and the better one reaches the app', async () => {
  const client = scripted([{ text: 'Here.', tools: [nights(3, 4)] }, { tools: [nights(3, 6)] }, { text: 'Never sent.' }]);
  const ev = await collect(client, tagged());
  const cards = ev.filter(e => e[0] === 'proposal');
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0][1].occurrences.map(o => o.day), [3, 6]);
  assert.deepEqual(cards[0][1].score, { first: 1, final: 0, retried: true });
  assert.equal(client.calls.length, 2);
  const feedback = client.calls[1].messages.at(-1).content[0];
  assert.match(feedback.content, /Valid, but it can be better[\s\S]*back to back/);
});

test('when the try is worse or invalid, the first plan is shown anyway', async () => {
  const worse = await collect(scripted([{ text: 'Here.', tools: [nights(3, 4)] }, { tools: [nights(4, 4)] }]), tagged());
  assert.deepEqual(worse.filter(e => e[0] === 'proposal').map(e => e[1].occurrences.map(o => o.day)), [[3, 4]]);
  const broken = await collect(scripted([{ text: 'Here.', tools: [nights(3, 4)] }, { tools: [nights(3, 12)] }]), tagged());
  assert.deepEqual(broken.filter(e => e[0] === 'proposal').map(e => e[1].occurrences.map(o => o.day)), [[3, 4]]);
  assert.equal(broken.some(e => e[0] === 'error'), false);
});

test('a tweak is only asked to fix what it made worse', async () => {
  const card = { changes: ['Two nights'], sessions: [{ goal_id: 'date', day: 3, detail: '' }, { goal_id: 'boys', day: 4, detail: '' }] };
  const client = scripted([{ text: 'Moved.', tools: [nights(3, 4)] }]);
  const ev = await collect(client, tagged({ open_card: card }));
  assert.equal(client.calls.length, 1, 'the flag was already on the card, so no retry');
  assert.equal(ev.filter(e => e[0] === 'proposal').length, 1);
});

test('output ceilings by kind of turn, and a turn that hits one stops with the retry message', async () => {
  const seen = [];
  const cut = { messages: { stream(params) {
    seen.push(params.max_tokens);
    return { on() { return this; }, abort() {}, async finalMessage() { return { stop_reason: 'max_tokens', content: [] }; } };
  } } };
  const logs = [];
  const ev = [];
  await runChat(cut, body(), (e, d) => ev.push([e, d]), { log: m => logs.push(m) });
  await runChat(cut, body({ phase: 'live', current_day: 3 }), () => {}, { log: () => {} });
  await runChat(cut, body({ phase: 'review', event: { kind: 'review' }, message: null }), () => {}, { log: () => {} });
  assert.deepEqual(seen, [CEILING.plan, CEILING.normal, CEILING.review]);
  assert.equal(ev.at(-1)[0], 'error');
  assert.match(logs.join(' '), /hit the plan ceiling/);
});

test('a turn that keeps needing more calls stops at the round limit with the retry message', async () => {
  // Every call makes a valid call but never writes a reply, so each one asks for another.
  const client = scripted(Array.from({ length: 8 }, () => ({ tools: [twoRuns([2, 5])] })));
  const ev = await collect(client, body());
  assert.equal(client.calls.length, MAX_ROUNDS);
  assert.equal(ev.at(-1)[0], 'error');
});

test('the off topic streak from the app reaches Claude, and the marker changes nothing', async () => {
  const ctx = JSON.parse(contextBlock(body({ off_topic_streak: 2 })).match(/<deka>\n(.*)\n<\/deka>/)[1]);
  assert.equal(ctx.off_topic_streak, 2);
  const ev = await collect(scripted([{ text: 'Back to your ten days?', tools: [['mark_off_topic', {}]] }]), body());
  assert.deepEqual(ev.filter(e => e[0] !== 'text' && e[0] !== 'done').map(e => e[0]), ['off_topic']);
});
