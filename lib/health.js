// Which server settings are in place and working. Each check says pass or fail and why in a few
// plain words, never a value: no key, no URL, no password, no raw error text (a database error can
// carry the host and user). Used by GET /api/health and by the one line logged when a request fails
// because of the setup.

const { Pool } = require('pg');
const { isNewKey, isSecretKey, jwtRole } = require('./keys');
const { dbConfig, dbShape, shapeProblem, classify } = require('./dburl');

const TTL = 60 * 1000;
// A value copied from a template and never filled in, like [YOUR-PASSWORD] or <password>.
const PLACEHOLDER = /\[[^\]]*\]|<[^>]*>|YOUR[-_ ]?PASSWORD/i;

// Only the status of a failed call, never its message.
const statusOf = err => (err && (err.status || err.statusCode)) || null;

async function checkAnthropic(key, client) {
  if (!key) return { ok: false, detail: 'missing' };
  if (!client) return { ok: false, detail: 'not loaded' };
  if (!client.models || typeof client.models.list !== 'function') return { ok: true, detail: 'present, not tested' };
  try {
    await client.models.list({ limit: 1 }, { timeout: 8000, maxRetries: 0 });
    return { ok: true, detail: 'a test call worked' };
  } catch (err) {
    const s = statusOf(err);
    return { ok: false, detail: s === 401 ? 'rejected, the key is not valid' : s ? `the test call failed (${s})` : 'the test call could not reach the API' };
  }
}

function checkUrl(url) {
  if (!url) return { ok: false, detail: 'missing' };
  if (PLACEHOLDER.test(url)) return { ok: false, detail: 'still has a placeholder' };
  let u;
  try { u = new URL(url); } catch { return { ok: false, detail: 'not a URL' }; }
  const local = /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return { ok: false, detail: 'not an https URL' };
  return { ok: true, detail: 'present' };
}

function checkPublic(key) {
  if (!key) return { ok: false, detail: 'missing' };
  if (isSecretKey(key)) return { ok: false, detail: 'is a secret key, not the publishable key' };
  if (isNewKey(key)) return { ok: true, detail: 'a publishable key' };
  const role = jwtRole(key);
  if (role === 'anon') return { ok: true, detail: 'a legacy anon key' };
  if (role === 'service_role') return { ok: false, detail: 'is the service_role key, not the anon key' };
  return { ok: false, detail: 'not a Supabase key' };
}

function checkSecret(key, publicKey) {
  if (!key) return { ok: false, detail: 'missing' };
  if (publicKey && key === publicKey) return { ok: false, detail: 'the same value as the public key' };
  if (isSecretKey(key)) return { ok: true, detail: 'a secret key' };
  if (isNewKey(key)) return { ok: false, detail: 'is a publishable key, not the secret key' };
  const role = jwtRole(key);
  if (role === 'service_role') return { ok: true, detail: 'a legacy service_role key' };
  if (role === 'anon') return { ok: false, detail: 'is the anon key, not the service_role key' };
  return { ok: false, detail: 'not a Supabase key' };
}

// The database: the string's shape first, then a real connection made exactly as the server makes
// one, with the same pool settings and SSL, and the failure named by its category.
async function checkDatabase(url) {
  const facts = dbShape(url);
  const problem = shapeProblem(facts);
  if (problem) return { ok: false, detail: problem };
  let pool;
  try { pool = new Pool(dbConfig(url, { max: 1, connectionTimeoutMillis: 8000, query_timeout: 5000 })); }
  catch { return { ok: false, detail: 'not a connection string' }; }
  pool.on('error', () => {});
  try {
    await pool.query('select 1');
    return { ok: true, detail: facts.hostKind === 'pooler' ? `connected through the ${facts.portKind}` : 'connected' };
  } catch (err) {
    return { ok: false, detail: classify(err, facts) };
  } finally { pool.end().catch(() => {}); }
}

/**
 * settings: { anthropicKey, client, url, publicKey, secretKey, databaseUrl, names }
 * names: the variable each value came from, like { publicKey: 'SUPABASE_ANON_KEY' }.
 * Returns { ok, checks: [{ name, ok, detail }] }.
 */
async function checkSetup(settings) {
  const n = { anthropicKey: 'ANTHROPIC_API_KEY', url: 'SUPABASE_URL', publicKey: 'SUPABASE_PUBLISHABLE_KEY', secretKey: 'SUPABASE_SECRET_KEY', databaseUrl: 'DATABASE_URL', ...(settings.names || {}) };
  const [anthropic, database] = await Promise.all([checkAnthropic(settings.anthropicKey, settings.client), checkDatabase(settings.databaseUrl)]);
  const checks = [
    { name: n.anthropicKey, ...anthropic },
    { name: n.url, ...checkUrl(settings.url) },
    { name: n.publicKey, ...checkPublic(settings.publicKey) },
    { name: n.secretKey, ...checkSecret(settings.secretKey, settings.publicKey) },
    { name: n.databaseUrl, ...database },
  ];
  return { ok: checks.every(c => c.ok), checks };
}

// The same, remembered for a minute, so a burst of failing requests runs it once.
function createHealth(settings) {
  let last = null, at = 0, running = null;
  return async function health({ fresh = false } = {}) {
    if (!fresh && last && Date.now() - at < TTL) return last;
    if (!running) running = checkSetup(settings).then(r => { last = r; at = Date.now(); return r; }).finally(() => { running = null; });
    return running;
  };
}

// One line for the log, naming each failing setting and why.
const failingLine = r => `[setup] ${r.checks.filter(c => !c.ok).map(c => `${c.name}: ${c.detail}`).join('; ') || 'every setting passes'}`;

module.exports = { checkSetup, createHealth, failingLine, PLACEHOLDER };
