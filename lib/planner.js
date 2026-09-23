// The planning call: system prompt, set_plan tool, and one retry on invalid output.

const { validatePlan } = require('./validate');

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.CLAUDE_EFFORT || 'medium';

const SYSTEM_PROMPT = `You are the planner inside Deka, a personal planner that works in 10 day cycles called dekas instead of weeks.

How a deka works
Days are numbered 1 to 10. Days 1 to 9 are for living the plan. Day 10 is always a review day, so never schedule anything on it. Because 10 is not a multiple of 7, each deka starts on a different weekday. The person never sees weekday names in the app, but you receive the real date and weekday for every day so your placement is realistic. When you talk about days, say "day 4", not "Thursday", unless the person used the weekday first.

Intentions
Every intention has a type:
do: something the person does, like a run, the gym, reading, making music, a side project.
see: time with someone, like mom, a date, a friend.
abstain: something they hold back from on a given day, like a sober night or a no phone morning. Abstain intentions are placed on specific days and checked off like anything else.
Give each intention a short stable id in lower snake case (run, gym, mom, date_night). Keep ids unchanged across refinements so completed work stays attached. Names are short and plain, the way the person would say them ("Run", "See mom", "Sober night"). The tag is an optional one or two word hint like "evening" or "morning"; use an empty string when there is none.

Counts
"At least N" is a minimum. Schedule exactly N unless the person asks for more. An intention happens at most once per day, so a target can never exceed 9. The number of occurrences for an intention must equal its target.

Open goals
For a goal like "finish my book" with no size, ask one short follow up in the question field (for example "How many pages are left?"), and still plan everything else. Once you know the size, split it into daily or every other day portions and put the portion in each occurrence's detail, like "pages 120 to 160". Leave detail empty when there is nothing specific to say.

Placement
Use the real calendar. Put date nights and social plans on realistic evenings, usually Friday or Saturday for a date unless told otherwise. Respect anything said about specific days or weekdays.
Spread each intention evenly across days 1 to 9. Balance daily load so no day is stacked while another is empty. Avoid back to back heavy days where you can.
Pair things with care. Only put a gym session and a run on the same day if the counts force it. Never put a sober night on a date night unless the person asks for that. A night of making music and a night of project work can share a day if they must, but spread them first.

Honesty about load
Count the total. If what they ask for does not fit into 9 days without strain, say so in the note in one or two plain sentences and name what you would trim. Then return the plan with that trim applied, so the person sees your honest version. If they push back and want it all, give them what they ask for and say once that it is a lot.

Refining
When a current plan is included, the person's message is a change to it. Keep everything they did not ask to change. Keep completed occurrences exactly where they are. Manual edits in the plan state are deliberate; keep them unless the message asks otherwise.

Rebalancing
In rebalance mode, look at what was missed on days before today. Keep every completed occurrence where it is. Move missed and future occurrences onto today through day 9 so each intention still reaches its target where possible. If a target no longer fits, lower it and say so. The note is a single line saying what moved.

Review
In review mode, the plan state is the deka that just ended. Write the review field: three or four short sentences. Say what held, what slipped, and one pattern worth noticing. Be honest and kind, never gushing. Then draft the next deka's intentions and occurrences, using the next deka's day mapping, based on what the person can realistically carry. The note says in one line how the draft differs from last time.

Voice
Everything you write is short, warm, and plain. Short sentences. No filler, no exclamation marks, no emoji. Do not use em dashes, en dashes, or hyphens as punctuation; use commas or full stops. Keep the note under 40 words.

Output
Always answer by calling the set_plan tool exactly once. Do not reply with plain text. Fill every field; use an empty string for question and review when you have none.`;

const SET_PLAN_TOOL = {
  name: 'set_plan',
  description: 'Return the full plan for the deka: every intention and every occurrence, plus a short note to the person. Always call this, even when asking a question.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['intentions', 'occurrences', 'question', 'note', 'review'],
    properties: {
      intentions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name', 'type', 'tag', 'target'],
          properties: {
            id: { type: 'string', description: 'Short stable id in lower snake case.' },
            name: { type: 'string', description: 'Short plain name.' },
            type: { type: 'string', enum: ['do', 'see', 'abstain'] },
            tag: { type: 'string', description: 'Optional hint like "evening". Empty string if none.' },
            target: { type: 'integer', description: 'How many times in the deka. 1 to 9.' },
          },
        },
      },
      occurrences: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['intention_id', 'day', 'detail'],
          properties: {
            intention_id: { type: 'string' },
            day: { type: 'integer', description: 'Day number 1 to 9. Day 10 is review.' },
            detail: { type: 'string', description: 'Optional portion, like "pages 40 to 80". Empty string if none.' },
          },
        },
      },
      question: { type: 'string', description: 'One short clarifying question, or empty string.' },
      note: { type: 'string', description: 'Short note to the person about the plan.' },
      review: { type: 'string', description: 'Only in review mode: the honest read of the deka. Otherwise empty string.' },
    },
  },
};

// Turns the request body into the user turn Claude reads.
function buildUserMessage(body) {
  const lines = [];
  lines.push(`Mode: ${body.mode}`);
  lines.push(`Today: ${body.today}`);
  if (body.currentDay) lines.push(`Today is day ${body.currentDay} of the current deka.`);
  lines.push('');
  lines.push(body.mode === 'review' ? 'Next deka day mapping:' : 'Deka day mapping:');
  for (const d of body.days || []) lines.push(`Day ${d.day}: ${d.weekday} ${d.date}${d.day === 10 ? ' (review day)' : ''}`);

  if (body.plan && (body.plan.intentions || []).length) {
    lines.push('');
    lines.push(body.mode === 'review' ? 'The deka that just ended:' : 'Current plan:');
    lines.push(JSON.stringify(body.plan));
  }
  if (body.mode === 'review' && body.reflection) {
    lines.push('');
    lines.push(`Their reflection: ${body.reflection}`);
  }
  if ((body.history || []).length) {
    lines.push('');
    lines.push('Conversation so far this deka:');
    for (const h of body.history) lines.push(`${h.role === 'user' ? 'Person' : 'You'}: ${h.text}`);
  }
  if ((body.past || []).length) {
    lines.push('');
    lines.push('Recent dekas, newest first:');
    for (const p of body.past) lines.push(`${p}`);
  }
  lines.push('');
  lines.push(body.message ? `Person says: ${body.message}` : 'Person says nothing extra.');
  return lines.join('\n');
}

function findToolUse(message) {
  return (message.content || []).find(b => b.type === 'tool_use' && b.name === 'set_plan');
}

// Calls Claude, validates, and retries once with the errors fed back.
async function plan(client, body, log = () => {}) {
  const messages = [{ role: 'user', content: buildUserMessage(body) }];
  const request = () => client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT },
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [SET_PLAN_TOOL],
    tool_choice: { type: 'auto' },
    messages,
  });

  let lastErrors = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await request();
    if (res.stop_reason === 'refusal') throw new PlanError('Claude declined this one.');
    const use = findToolUse(res);
    if (!use) {
      lastErrors = ['No set_plan call.'];
      log(`attempt ${attempt + 1}: no tool call (stop_reason ${res.stop_reason})`);
      messages.push({ role: 'assistant', content: res.content });
      messages.push({ role: 'user', content: 'Please answer by calling set_plan.' });
      continue;
    }
    const result = validatePlan(use.input, body);
    if (result.ok) return result.plan;
    lastErrors = result.errors;
    log(`attempt ${attempt + 1}: invalid plan: ${result.errors.join(' | ')}`);
    messages.push({ role: 'assistant', content: res.content });
    messages.push({
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: use.id,
        is_error: true,
        content: `That plan is invalid. Fix these and call set_plan again:\n${result.errors.join('\n')}`,
      }],
    });
  }
  throw new PlanError('The plan did not come back right.', lastErrors);
}

class PlanError extends Error {
  constructor(message, details = []) { super(message); this.details = details; }
}

module.exports = { plan, buildUserMessage, SYSTEM_PROMPT, SET_PLAN_TOOL, PlanError, MODEL };
