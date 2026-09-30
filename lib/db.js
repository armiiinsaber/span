// The server's own line to Postgres, with the service role's reach: usage, feedback and plans.
// Row level security does not apply here, so every query names the user it is about.
// With no DATABASE_URL, the same shape works from memory, for local dev without an account.

const { Pool, types } = require('pg');
const { limitsFor } = require('./plans');
const { dbConfig } = require('./dburl');

types.setTypeParser(1082, v => v);
types.setTypeParser(20, v => Number(v));
types.setTypeParser(1700, v => Number(v));

function createDb(databaseUrl) {
  if (!databaseUrl) return memoryDb();
  // A few connections per function instance, closed soon when idle, since each Vercel instance
  // keeps its own pool; the pooler on port 6543 shares the database's connections between them.
  const pool = new Pool(dbConfig(databaseUrl, { max: 4, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000 }));
  // An idle connection the database drops (a restart, a pooler timeout) is reported here. Without a
  // listener Node treats it as a crash; the pool replaces the connection on the next query anyway.
  pool.on('error', () => console.error('[db] an idle connection was closed by the database'));
  return {
    kind: 'postgres',
    async plan(userId) {
      const r = await pool.query('select plan, trial_ends_at from public.profiles where id = $1', [userId]);
      return r.rows[0] ? r.rows[0].plan : 'trial';
    },
    // Turns already used today and this month, by the app's own dates.
    async turns(userId, day) {
      const r = await pool.query("select count(*) filter (where day = $2::date) as today, count(*) filter (where to_char(day, 'YYYY-MM') = $3) as month from public.usage where user_id = $1", [userId, day, day.slice(0, 7)]);
      return { today: Number(r.rows[0].today), month: Number(r.rows[0].month) };
    },
    async recordUsage(u) {
      await pool.query('insert into public.usage (user_id, day, kind, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [u.userId, u.day, u.kind || 'chat', u.model || '', u.input || 0, u.output || 0, u.cacheRead || 0, u.cacheWrite || 0, u.cost || 0]);
    },
    async addFeedback(f) {
      await pool.query('insert into public.feedback (user_id, message_id, rating, reason, message) values ($1, $2, $3, $4, $5)', [f.userId, f.messageId || '', f.rating, f.reason || '', f.message || '']);
    },
    async end() { await pool.end(); },
  };
}

function memoryDb() {
  const usage = [];
  const feedback = [];
  return {
    kind: 'memory', usage, feedback,
    async plan() { return 'trial'; },
    async turns(userId, day) {
      return { today: usage.filter(u => u.userId === userId && u.day === day).length, month: usage.filter(u => u.userId === userId && u.day.slice(0, 7) === day.slice(0, 7)).length };
    },
    async recordUsage(u) { usage.push(u); if (usage.length > 5000) usage.splice(0, 1000); },
    async addFeedback(f) { feedback.push(f); },
    async end() {},
  };
}

// Whether this user may take one more turn today, by their plan.
async function allowTurn(db, userId, day) {
  const [plan, used] = await Promise.all([db.plan(userId), db.turns(userId, day)]);
  const lim = limitsFor(plan);
  if (used.today >= lim.turnsPerDay) return { ok: false, why: 'day' };
  if (used.month >= lim.turnsPerMonth) return { ok: false, why: 'month' };
  return { ok: true, plan };
}

module.exports = { createDb, allowTurn };
