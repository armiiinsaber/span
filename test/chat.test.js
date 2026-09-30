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
  assert.deepEqual(client.calls[0].tools.map(t => t.name), ['update_goals', 'log_day', 'propose_schedule', 'suggest_trim', 'mark_off_topic', 'update_brief']);
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

test('review turns cannot log days; the brief, not a summary, carries what came before', async () => {
  const client = scripted([{ text: 'Ok.' }]);
  await collect(client, body({ phase: 'review', event: { kind: 'review' }, message: null, to_summarize: [{ role: 'user', text: 'old' }] }));
  assert.deepEqual(client.calls[0].tools.map(t => t.name), ['update_goals', 'propose_schedule', 'suggest_trim', 'show_status', 'mark_off_topic', 'update_brief']);
  assert.match(client.calls[0].messages.at(-1).content, /Event: review/);
  assert.doesNotMatch(client.calls[0].messages.at(-1).content, /older_messages_to_summarize/);
});

test('the context carries the brief and only the last 10 messages', () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `message ${i}` }));
  const msgs = buildMessages(body({ messages, brief: { rules: ['Day 4 free', 'Prep 3 hours a day until Oct 6'], questions: ['How many pages are left?'] } }));
  const all = msgs.map(m => (typeof m.content === 'string' ? m.content : '')).join('\n');
  assert.doesNotMatch(all, /message 19\b/);
  assert.match(all, /message 20[\s\S]*message 29/);
  const ctx = JSON.parse(msgs.at(-1).content.match(/<deka>\n(.*)\n<\/deka>/)[1]);
  assert.deepEqual(ctx.brief, { rules: ['Day 4 free', 'Prep 3 hours a day until Oct 6'], questions: ['How many pages are left?'] });
  // An app from before the brief still gets its summary read.
  const old = JSON.parse(buildMessages(body({ summary: 'They keep day 4 free.' })).at(-1).content.match(/<deka>\n(.*)\n<\/deka>/)[1]);
  assert.equal(old.brief.earlier, 'They keep day 4 free.');
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

/* A reply never offers a trim without its card */

const { TRIM_NUDGE } = require('../lib/chat');
const goal = (id, target) => ({ op: 'add', id, name: id, type: 'do', tag: '', target, icon: 'run', category: 'body', energy: 'heavy', social: 'no', fun: 'no', time_of_day: 'any', weekend: 'no' });
// 8 + 8 + 8 + 5 sessions and the two runs over 9 days: well past 3 a day.
const tooMuch = ['update_goals', { changes: [goal('gym', 8), goal('music', 8), goal('work', 8), goal('read', 5)] }];
const trim = ['suggest_trim', { trims: [{ goal_id: 'gym', requested: 8, suggested: 5 }, { goal_id: 'music', requested: 8, suggested: 4 }], reason: 'Too full' }];
const withLog = async (client, b) => { const ev = [], logs = []; await runChat(client, b, (e, d) => ev.push([e, d]), { log: m => logs.push(m) }); return { ev, logs }; };

test('goals past a comfortable load with no trim get one forced follow up, and the card joins the turn', async () => {
  const client = scripted([{ text: 'All added.', tools: [tooMuch] }, { tools: [trim] }]);
  const { ev, logs } = await withLog(client, body());
  assert.equal(client.calls.length, 2);
  assert.deepEqual(client.calls[1].tool_choice, { type: 'tool', name: 'suggest_trim' });
  assert.equal(client.calls[1].thinking, undefined, 'a forced call comes without thinking');
  assert.equal(client.calls[1].messages.at(-1).content.at(-1).text, TRIM_NUDGE.load);
  assert.deepEqual(ev.map(e => e[0]).filter(e => e !== 'text'), ['goals', 'trim']);
  assert.deepEqual(logs, ['trim correction: load']);
});

test('a reply that offers a trim with no call gets a follow up; a trim then keeps the reply', async () => {
  const client = scripted([{ text: 'Here is a lighter version.' }, { text: 'Ignored.', tools: [['suggest_trim', { trims: [{ goal_id: 'run', requested: 2, suggested: 1 }], reason: 'Room' }]] }]);
  const { ev, logs } = await withLog(client, body());
  assert.equal(client.calls[1].messages.at(-1).content.at(-1).text, TRIM_NUDGE.text);
  assert.equal(client.calls[1].tool_choice.type, 'auto');
  assert.deepEqual(ev.map(e => e[0]).filter(e => e !== 'text'), ['trim']);
  assert.equal(ev.filter(e => e[0] === 'text').map(e => e[1].delta).join(''), 'Here is a lighter version.');
  assert.deepEqual(logs, ['trim correction: text']);
});

test('with room to spare, a reply written again without the offer replaces it', async () => {
  const client = scripted([{ text: 'Two runs saved. Here is a lighter version.' }, { text: 'Two runs saved, easy ones.' }]);
  const { ev } = await withLog(client, body());
  assert.deepEqual(ev.find(e => e[0] === 'replace')[1], { text: 'Two runs saved, easy ones.' });
  assert.equal(ev.some(e => e[0] === 'trim'), false);
});

test('a follow up that neither trims nor writes loses the offer anyway', async () => {
  const client = scripted([{ text: 'Two runs saved. That is too much, so I cut it back.' }, {}]);
  const { ev } = await withLog(client, body());
  assert.deepEqual(ev.find(e => e[0] === 'replace')[1], { text: 'Two runs saved.' });
});

test('a forced trim that fails twice ends with the reply and no error', async () => {
  const bad = ['suggest_trim', { trims: [{ goal_id: 'gym', requested: 3, suggested: 2 }] }];
  const client = scripted([{ text: 'All added.', tools: [tooMuch] }, { tools: [bad] }, { tools: [bad] }]);
  const { ev } = await withLog(client, body());
  assert.equal(client.calls.length, 3);
  assert.equal(ev.some(e => e[0] === 'error' || e[0] === 'trim' || e[0] === 'replace'), false);
});

test('no follow up when a trim came, one is waiting, it was just answered, or a live turn only talks', async () => {
  const cases = [
    [[{ text: 'Too full, here is a lighter version.', tools: [tooMuch, trim] }], body()],
    [[{ text: 'That trim is still waiting, a lighter version.' }], body({ goals: [{ id: 'gym', name: 'Gym', type: 'do', tag: '', target: 8 }], open_trim: { trims: [{ goal_id: 'gym', requested: 8, suggested: 5 }] } })],
    [[{ text: 'Kept your numbers, even if it is too much.', tools: [['resolve_trim', { choice: 'keep' }]] }], body({ goals: [{ id: 'gym', name: 'Gym', type: 'do', tag: '', target: 8 }], open_trim: { trims: [{ goal_id: 'gym', requested: 8, suggested: 5 }] } })],
    [[{ text: 'Sounds like yesterday was too much. Rest tonight.' }], body({ phase: 'live', current_day: 4 })],
  ];
  for (const [replies, b] of cases) {
    const said = replies[0].text;
    const client = scripted(replies);
    const { ev, logs } = await withLog(client, b);
    assert.equal(client.calls.length, 1, said);
    assert.deepEqual(logs, []);
    assert.equal(ev.some(e => e[0] === 'replace'), false);
  }
});
