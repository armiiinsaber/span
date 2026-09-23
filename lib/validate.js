// Checks a set_plan tool input before it reaches the browser.
// Returns { ok, errors, plan } where plan is a cleaned copy.

const TYPES = new Set(['do', 'see', 'abstain']);
const WORK_DAYS = 9;

// Dashes used as punctuation become commas or plain spaces.
// Hyphens inside words (e.g. "check-in") are left alone.
function cleanText(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/\s*[\u2014\u2013]\s*/g, ', ')
    .replace(/\s+-{1,2}\s+/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function validatePlan(input, ctx = {}) {
  const errors = [];
  const mode = ctx.mode || 'plan';
  const today = Number(ctx.currentDay) || 1;

  if (!input || typeof input !== 'object') {
    return { ok: false, errors: ['Tool input is not an object.'] };
  }
  const { intentions, occurrences } = input;
  if (!Array.isArray(intentions)) errors.push('intentions must be an array.');
  if (!Array.isArray(occurrences)) errors.push('occurrences must be an array.');
  if (errors.length) return { ok: false, errors };

  const byId = new Map();
  for (const [i, it] of intentions.entries()) {
    if (!it || typeof it !== 'object') { errors.push(`intentions[${i}] is not an object.`); continue; }
    const id = typeof it.id === 'string' ? it.id.trim() : '';
    if (!id) errors.push(`intentions[${i}] has no id.`);
    else if (byId.has(id)) errors.push(`Intention id "${id}" is used twice.`);
    if (typeof it.name !== 'string' || !it.name.trim()) errors.push(`Intention "${id}" has no name.`);
    if (!TYPES.has(it.type)) errors.push(`Intention "${id}" has type "${it.type}", expected do, see or abstain.`);
    if (!Number.isInteger(it.target) || it.target < 1 || it.target > WORK_DAYS) {
      errors.push(`Intention "${id}" target must be a whole number from 1 to ${WORK_DAYS}, got ${it.target}.`);
    }
    if (id) byId.set(id, it);
  }

  const seen = new Set();
  const counts = new Map();
  for (const [i, o] of occurrences.entries()) {
    if (!o || typeof o !== 'object') { errors.push(`occurrences[${i}] is not an object.`); continue; }
    const iid = o.intention_id;
    if (!byId.has(iid)) { errors.push(`occurrences[${i}] points at unknown intention "${iid}".`); continue; }
    if (!Number.isInteger(o.day) || o.day < 1 || o.day > WORK_DAYS) {
      errors.push(`occurrences[${i}] for "${iid}" is on day ${o.day}. Work days are 1 to ${WORK_DAYS}; day 10 is review.`);
      continue;
    }
    const key = `${iid}@${o.day}`;
    if (seen.has(key)) errors.push(`"${iid}" is scheduled twice on day ${o.day}.`);
    seen.add(key);
    counts.set(iid, (counts.get(iid) || 0) + 1);
  }

  for (const [id, it] of byId) {
    const n = counts.get(id) || 0;
    if (Number.isInteger(it.target) && n !== it.target) {
      errors.push(`"${id}" has target ${it.target} but ${n} occurrences.`);
    }
  }

  // Rebalance: finished work stays put, and nothing new lands in the past.
  if (mode === 'rebalance' && ctx.plan) {
    const done = (ctx.plan.occurrences || []).filter(o => o.done);
    for (const d of done) {
      if (!seen.has(`${d.intention_id}@${d.day}`)) {
        errors.push(`Completed "${d.intention_id}" on day ${d.day} was moved or removed. Keep it where it is.`);
      }
    }
    const doneKeys = new Set(done.map(d => `${d.intention_id}@${d.day}`));
    for (const o of occurrences) {
      if (o && o.day < today && !doneKeys.has(`${o.intention_id}@${o.day}`)) {
        errors.push(`"${o.intention_id}" is placed on day ${o.day}, which has passed. Today is day ${today}.`);
      }
    }
  }

  if (errors.length) return { ok: false, errors };

  const plan = {
    intentions: intentions.map(it => ({
      id: it.id.trim(),
      name: cleanText(it.name),
      type: it.type,
      tag: cleanText(it.tag || ''),
      target: it.target,
    })),
    occurrences: occurrences.map(o => ({
      intention_id: o.intention_id,
      day: o.day,
      detail: cleanText(o.detail || ''),
    })),
    note: cleanText(input.note || ''),
    question: cleanText(input.question || ''),
    review: cleanText(input.review || ''),
  };
  return { ok: true, errors: [], plan };
}

module.exports = { validatePlan, cleanText, WORK_DAYS };
