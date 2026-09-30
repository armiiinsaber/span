// Which server settings are in place and working. Each check says pass or fail and why in a few
// plain words, never a value: no key, no URL, no password, no raw error text (a database error can
// carry the host and user). Used by GET /api/health and by the one line logged when a request fails
// because of the setup.

const { Client } = require('pg');
const { isNewKey, isSecretKey, jwtRole } = require('./keys');

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

async function checkDatabase(url) {
  if (!url) return { ok: false, detail: 'missing' };
  if (PLACEHOLDER.test(url)) return { ok: false, detail: 'still has a placeholder, like [YOUR-PASSWORD]' };
  let u;
  try { u = new URL(url); } catch { return { ok: false, detail: 'not a connection string' }; }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return { ok: false, detail: 'not a postgres connection string' };
  const local = /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
  const c = new Client({ connectionString: url, connectionTimeoutMillis: 5000, query_timeout: 5000, ssl: local ? false : { rejectUnauthorized: false } });
  c.on('error', () => {});
  try {
    await c.connect();
    await c.query('select 1');
    return { ok: true, detail: 'connected' };
  } catch (err) {
    const code = err && err.code;
    return { ok: false, detail: code === '28P01' ? 'the password was refused' : code === '3D000' ? 'the database does not exist' : 'could not connect' };
  } finally { c.end().catch(() => {}); }
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
