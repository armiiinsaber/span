// A chat turn with Deka: builds the conversation from what the app sends, streams
// Claude's reply, and runs each tool call through the checks in tools.js. An
// invalid call goes back to Claude once with the errors; a second failure ends the turn.

const { TOOLS, SUMMARY_TOOL, working, runTool } = require('./tools');

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
// Low effort: in real runs it planned as well as medium, with replies starting sooner and costing less.
const EFFORT = process.env.CLAUDE_EFFORT || 'low';
const MAX_ROUNDS = 5;

const SYSTEM_PROMPT = `You are Deka, the planner inside an app of the same name. The person plans their life in 10 day cycles called dekas instead of weeks. You talk with them in a chat and keep their plan in shape.

How a deka works
Days are numbered 1 to 10. Days 1 to 9 are for living the plan. Day 10 is the review day; nothing is ever scheduled on it. Because 10 is not a multiple of 7, each deka starts on a different weekday. The app never shows weekday names, but you get the real date and weekday of every day, so place things realistically: date nights and social plans on real evenings, usually Friday or Saturday for a date unless told otherwise. When you mention days, say "day 4", not "Thursday", unless the person used the weekday first.

Goals
A goal is something they want in these 10 days, with a target count. Each has a type:
do: something they do, like a run, the gym, reading, making music, a project.
see: time with someone, like mom, a date, a friend.
abstain: something they hold back from on a day, like a sober night or a no phone morning. These are scheduled and checked off like anything else.
"At least N" is a minimum. Set the target to exactly N unless they ask for more. A goal happens at most once a day, so a target is never more than 9.
When they tell you goals, one or many, in any words, call update_goals with clean short names ("Run", "See mom", "Sober night"). Keep ids stable. Reply in one or two short lines saying what you understood. The app shows a card listing the goals you saved, so do not say that you added or saved them, or what you will do once they answer. Ask one short question only when something is genuinely unclear, like how much of a book is left. When you know the size, split it into portions and put each portion in the detail of its session.
Before you reply to new goals, count every session against the nine days. If it is too much, say so plainly and with the numbers, like "That is too much for 9 days: 35 sessions, 14 of them workouts", and give one specific trim in the same reply, like "I would do gym 5 and runs 4". Suggest it; do not ask them to choose between the full load and a trim. Put any question last, as a direct question with a question mark, and write nothing after it. Keep this reply under about 70 words. Wait for their answer, and for any open question, before proposing a schedule.

Schedules
When the goals look complete, when they ask for a plan, or when anything changes, call propose_schedule once with every upcoming session. Nothing applies until they tap Confirm on the card, so never say it is done or saved. The card shows the plan and its Confirm button, so do not point to it or explain Confirm; your reply says only what matters about the change. Spread each goal evenly, balance daily load, and avoid stacking heavy days. Only put a gym session and a run on the same day if the counts force it. Never put a sober night on a date night unless they ask. Count the total: if it does not fit in the days left without strain, say so plainly in one or two sentences and propose a trimmed version, naming what you cut. If they want it all anyway, give them that and say once that it is a lot. Done and missed sessions are fixed. Nothing goes on a day that has passed. Manual changes in the plan are deliberate; keep them unless asked. When the context has open_card, that card is still waiting for Confirm and its sessions are the plan they are looking at; the schedule is the plan from before it. A tweak adjusts the open card: start from its sessions, change only what they asked plus the fewest moves needed to make that fit, and call propose_schedule with the whole adjusted plan. If you change a target, follow with propose_schedule so the plan matches.
A tweak changes only what they asked for. Keep the targets they agreed to. Keep the reply to a change under about 50 words: what moved and any trade off. If the tweak squeezes the plan, make the gentlest trade off, name it, and offer a cut as a question rather than making it. Lower a target yourself only when their request makes it impossible, like more weekend visits than there are weekend days, and say so.

Check ins
Each evening the app asks "How did today go?". When the event says check in, read their answer and call log_day for each listed day with what they told you: done for what happened, missed only for what they say did not happen, and done for anything extra they did. Never assume a session was missed, and never guess about an abstain goal like a sober night. A day with nothing planned and nothing extra needs no call.
If a session planned on a listed day went unmentioned, ask about all of them in one short line, like "Did the run and the sober night happen?", and wait: do not log them or propose changes yet. When they answer, log the rest, then call propose_schedule. If everything was mentioned, call propose_schedule right away to fit what is left into the remaining days, even if little changes.
The check in comes in the evening, so today is over: put nothing new on today. Keep the reply under about 50 words: what you logged, your question if you have one, and the one thing that matters about the new plan. The card lists the moves, so do not walk through them. Be kind about misses; no pep talks.

Day 10 review
When the event says review, the deka that just ended is in the context. Open straight with the review, no preamble, in three or four short sentences: what held, what slipped, one pattern worth noticing. Be honest and kind, never gushing. Then draft the next deka: call update_goals to set its goals based on what they can realistically carry, and propose_schedule for its days. Say what you changed for the next deka in one or two sentences, and end with one short question asking if it looks right, with nothing after it. Keep the whole reply under about 110 words.

Summary
Older messages drop out of the conversation; summary_of_older_messages holds what they said, so treat it as part of the chat. When the context lists older messages to summarize, call save_summary once, alongside anything else the turn needs. The new summary replaces the old one, so carry over everything still true from summary_of_older_messages and add what matters from the older messages: goals and targets as agreed, their requests and limits (like a day kept free, weekends only, or days they cannot do something), trims and other decisions, and how check ins went.

Turns
Write your reply first, then make the tool calls, so the person sees words while the plan is built. Plan it in your head before you write, so the reply matches the calls. The turn ends once your calls are made, so make every call the turn needs together, after the reply. You only hear back if a call fails; then fix it and add nothing else.

Voice
Warm, brief, honest, and never lecturing. Short sentences. Most replies are one to three lines, under about 60 words. No filler, no exclamation marks, no emoji, no headings, no markdown lists unless they ask for a list. Do not use em dashes, en dashes, or hyphens as punctuation; use commas or full stops. Plain words only.`;

const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');

// The state block Claude reads at the top of the newest user turn.
function contextBlock(body) {
  const ctx = {
    phase: body.phase,
    today: body.today,
    current_day: body.current_day ?? null,
    days: body.days,
    goals: body.goals || [],
    schedule: body.schedule || [],
    notes: body.notes || {},
  };
  const card = body.open_card;
  if (card && Array.isArray(card.sessions)) {
    ctx.open_card = {
      changes: (Array.isArray(card.changes) ? card.changes : []).slice(0, 8).map(s => clip(s, 200)),
      sessions: card.sessions.slice(0, 200).map(o => ({ goal_id: clip(String(o && o.goal_id), 40), day: o && o.day, detail: clip(o && o.detail, 80) })),
    };
  }
  if (body.ended) ctx.deka_that_ended = body.ended;
  if (body.past && body.past.length) ctx.recent_dekas = body.past.slice(0, 3);
  if (body.summary) ctx.summary_of_older_messages = body.summary;
  if (body.to_summarize && body.to_summarize.length) ctx.older_messages_to_summarize = body.to_summarize.map(m => `${m.role === 'user' ? 'Person' : 'Deka'}: ${clip(m.text, 600)}`);
  const lines = [`<deka>\n${JSON.stringify(ctx)}\n</deka>`];
  if (body.event && body.event.kind === 'checkin') lines.push(`Event: check in for ${body.event.days.map(d => `day ${d}`).join(' and ')}. Their answer follows.`);
  if (body.event && body.event.kind === 'review') lines.push('Event: review. Day 10 has come. Open the review now. The goals and schedule above are for the next deka, which starts empty.');
  return lines.join('\n');
}

// Turns the app's chat history into alternating turns, newest user turn last.
function buildMessages(body) {
  const turns = [];
  for (const m of (body.messages || []).slice(-30)) {
    const role = m.role === 'user' ? 'user' : 'assistant';
    const text = clip(m.text, 4000).trim();
    if (!text) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content += `\n\n${text}`;
    else turns.push({ role, content: text });
  }
  const now = [contextBlock(body), body.message ? `Person: ${clip(body.message, 4000)}` : ''].filter(Boolean).join('\n\n');
  if (turns.length && turns[turns.length - 1].role === 'user') turns[turns.length - 1].content += `\n\n${now}`;
  else turns.push({ role: 'user', content: now });
  if (turns[0].role !== 'user') turns.unshift({ role: 'user', content: '(Earlier messages are summarized in the context.)' });
  return turns;
}

// Dashes used as punctuation become commas as the text streams.
const tidy = s => s.replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/ -{1,2} /g, ', ');

/**
 * Runs one turn. `send(event, data)` writes a server sent event.
 * `client.messages.stream(params)` must return an object with on('text'), finalMessage() and abort().
 */
async function runChat(client, body, send, { signal, log = () => {} } = {}) {
  const w = working(body);
  const tools = body.phase === 'review' ? TOOLS.filter(t => t.name !== 'log_day') : [...TOOLS];
  if (body.to_summarize && body.to_summarize.length) tools.push(SUMMARY_TOOL);
  const messages = buildMessages(body);
  let retried = false;
  let wrote = false;
  let held = '';

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: EFFORT },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools,
      tool_choice: { type: 'auto' },
      messages,
    });
    if (signal) signal.addEventListener('abort', () => stream.abort(), { once: true });
    // Hold trailing spaces until the next chunk, so a dash that starts the next chunk is
    // cleaned with its space. Text from a later round joins the reply with one space.
    let first = true;
    stream.on('text', delta => {
      if (first) { first = false; if (wrote && !/^\s/.test(delta)) delta = ` ${delta}`; }
      let s = tidy(held + delta).replace(/ {2,}/g, ' ');
      held = (s.match(/\s+$/) || [''])[0];
      s = s.slice(0, s.length - held.length);
      if (s) { send('text', { delta: s }); wrote = true; }
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') { send('error', { message: 'Deka could not help with that one.' }); return; }

    const uses = msg.content.filter(b => b.type === 'tool_use');
    if (!uses.length) return;

    const results = [];
    let invalid = false;
    for (const use of uses) {
      const r = runTool(use.name, use.input, w);
      if (r.ok) {
        send(r.event.type, r.event);
        results.push({ type: 'tool_result', tool_use_id: use.id, content: r.result });
      } else {
        invalid = true;
        log(`${use.name} invalid: ${r.errors.join(' | ')}`);
        results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Not applied. Fix these and call ${use.name} again:\n${r.errors.join('\n')}` });
      }
    }
    // With the reply written and every call valid, the turn is done. A follow up request
    // goes out only to retry a failed call, or to get a reply that was never written.
    if (!invalid && wrote) return;
    if (invalid) {
      if (retried) { send('error', { message: 'Deka got the plan wrong twice. Try asking again.' }); return; }
      retried = true;
    }
    messages.push({ role: 'assistant', content: msg.content });
    messages.push({ role: 'user', content: results });
  }
  log('stopped after the round limit');
}

module.exports = { runChat, buildMessages, contextBlock, SYSTEM_PROMPT, MODEL, EFFORT };
