// Dev only (DEKA_MOCK=1): a stand in for Claude so the UI can be worked on without a key.
// It reads counts like "six runs" from the message and spreads them. It is not a planner.

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, once: 1, twice: 2 };
const KINDS = [
  [/date/, 'date_night', 'Date night', 'see', 'evening'],
  [/mom|mum|mother/, 'mom', 'See mom', 'see', ''],
  [/run/, 'run', 'Run', 'do', ''],
  [/gym/, 'gym', 'Gym', 'do', ''],
  [/music/, 'music', 'Make music', 'do', 'night'],
  [/rentletter/, 'rentletter', 'Rentletter', 'do', 'night'],
  [/sober|no drinking/, 'sober', 'Sober night', 'abstain', ''],
  [/book/, 'book', 'Read', 'do', ''],
];

function spread(n, from = 1, offset = 0) {
  const days = [];
  for (let d = from; d <= 9; d++) days.push(d);
  if (n >= days.length) return days;
  return Array.from({ length: n }, (_, i) => days[(Math.floor((i + .5) * days.length / n) + offset) % days.length]);
}

function planFrom(message) {
  const text = message.toLowerCase();
  const intentions = [], occurrences = [];
  for (const part of text.split(/,| and /)) {
    const kind = KINDS.find(k => k[0].test(part));
    if (!kind || intentions.some(i => i.id === kind[1])) continue;
    const m = part.match(/\b(\d|one|two|three|four|five|six|seven|eight|nine|once|twice)\b/);
    const n = kind[1] === 'book' ? 5 : m ? (WORDS[m[1]] || Number(m[1])) : 1;
    intentions.push({ id: kind[1], name: kind[2], type: kind[3], tag: kind[4], target: n });
    const used = new Set();
    for (const d of spread(n, 1, intentions.length)) {
      let day = d;
      while (used.has(day)) day = day % 9 + 1;
      used.add(day);
      occurrences.push({ intention_id: kind[1], day, detail: kind[1] === 'book' ? `${(occurrences.length % 5 + 1) * 20} pages` : '' });
    }
  }
  return { intentions, occurrences };
}

async function create(req) {
  const body = req.messages[0].content;
  const mode = /Mode: (\w+)/.exec(body)[1];
  const said = (/Person says: (.*)$/m.exec(body) || [])[1] || '';
  const planLine = body.split('\n').find(l => l.startsWith('{"intentions"'));
  const current = planLine ? JSON.parse(planLine) : null;
  let out;
  if (mode === 'plan') {
    out = { ...planFrom(said), note: 'This is a lot for nine days. I would trim gym to six. Mock plan, not Claude.', question: /book/i.test(said) ? 'How many pages are left?' : '', review: '' };
  } else {
    const today = Number((/Today is day (\d+)/.exec(body) || [])[1] || 1);
    const intentions = current.intentions.map(({ id, name, type, tag, target }) => ({ id, name, type, tag, target }));
    const occurrences = [];
    for (const it of intentions) {
      const occ = current.occurrences.filter(o => o.intention_id === it.id);
      const kept = mode === 'rebalance' ? occ.filter(o => o.done || o.day >= today) : occ;
      const taken = new Set(kept.map(o => o.day));
      let need = it.target - kept.length;
      for (let d = today; d <= 9 && need > 0; d++) if (!taken.has(d)) { taken.add(d); kept.push({ intention_id: it.id, day: d, detail: '' }); need--; }
      it.target = kept.length;
      occurrences.push(...kept.map(({ intention_id, day, detail }) => ({ intention_id, day, detail: detail || '' })));
    }
    out = {
      intentions, occurrences, question: '',
      note: mode === 'rebalance' ? 'Moved missed runs to later days.' : mode === 'review' ? 'Same shape as last time. Mock draft.' : 'Updated. Mock plan, not Claude.',
      review: mode === 'review' ? 'Runs held. Nights slipped late in the deka. Mock read, not Claude.' : '',
    };
  }
  await new Promise(r => setTimeout(r, 900));
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'mock', name: 'set_plan', input: out }] };
}

module.exports = { messages: { create } };
