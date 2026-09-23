// A chat turn with Deka: builds the conversation from what the app sends, streams
// Claude's reply, and runs each tool call through the checks in tools.js. An
// invalid call goes back to Claude once with the errors; a second failure ends the turn.

const { TOOLS, SUMMARY_TOOL, working, runTool } = require('./tools');

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.CLAUDE_EFFORT || 'medium';
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
When they tell you goals, one or many, in any words, call update_goals with clean short names ("Run", "See mom", "Sober night"). Keep ids stable. Reply in one or two short lines saying what you understood. Ask one short question only when something is genuinely unclear, like how much of a book is left. When you know the size, split it into portions and put each portion in the detail of its session.

Schedules
When the goals look complete, when they ask for a plan, or when anything changes, call propose_schedule with every upcoming session. Nothing applies until they tap Confirm on the card, so never say it is done or saved. Spread each goal evenly, balance daily load, and avoid stacking heavy days. Only put a gym session and a run on the same day if the counts force it. Never put a sober night on a date night unless they ask. Count the total: if it does not fit in the days left without strain, say so plainly in one or two sentences and propose a trimmed version, naming what you cut. If they want it all anyway, give them that and say once that it is a lot. Done and missed sessions are fixed. Nothing goes on a day that has passed. Manual changes in the plan are deliberate; keep them unless asked. If you change a target, follow with propose_schedule so the plan matches.

Check ins
Each evening the app asks "How did today go?". When the event says check in, read their answer, call log_day for each day listed (done or missed for every session planned that day, and done for anything extra they did), then call propose_schedule to fit what is left into the remaining days, even if little changes. Keep the reply to a line or two. Be kind about misses; no pep talks.

Day 10 review
When the event says review, the deka that just ended is in the context. Write the review in three or four short sentences: what held, what slipped, one pattern worth noticing. Be honest and kind, never gushing. Then draft the next deka: call update_goals to set its goals based on what they can realistically carry, and propose_schedule for its days. End with one line asking if it looks right.

Summary
When the context lists older messages to summarize, call save_summary once with a short summary that keeps what matters for planning.

Voice
Warm, brief, honest, and never lecturing. Short sentences. Most replies are one to three lines. No filler, no exclamation marks, no emoji, no headings, no markdown lists unless they ask for a list. Do not use em dashes, en dashes, or hyphens as punctuation; use commas or full stops. Plain words only.`;

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
const tidy = s => s.replace(/\s*[—–]\s*/g, ', ').replace(/ -{1,2} /g, ', ');

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
    // Hold trailing spaces until the next chunk, so a dash that starts the next chunk is cleaned with its space.
    let held = '';
    stream.on('text', delta => {
      let s = tidy(held + delta).replace(/ {2,}/g, ' ');
      held = (s.match(/\s+$/) || [''])[0];
      s = s.slice(0, s.length - held.length);
      if (s) send('text', { delta: s });
    });
    const msg = await stream.finalMessage();
    if (held) send('text', { delta: held });
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
    if (invalid) {
      if (retried) { send('error', { message: 'Deka got the plan wrong twice. Try asking again.' }); return; }
      retried = true;
    }
    messages.push({ role: 'assistant', content: msg.content });
    messages.push({ role: 'user', content: results });
  }
  log('stopped after the round limit');
}

module.exports = { runChat, buildMessages, contextBlock, SYSTEM_PROMPT, MODEL };
