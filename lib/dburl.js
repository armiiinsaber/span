// The database connection string: how to connect with it, what shape it has, and why a connection
// failed. Nothing here returns or logs a value from the string: no host, user, password or port
// beyond saying whether the port is the pooler's or the direct one.

const { parse } = require('pg-connection-string');

const LOCAL = /^(localhost|127\.0\.0\.1|::1)$/;
const POOLER = /\.pooler\.supabase\.com$/i;
const DIRECT = /^db\.[a-z0-9]+\.supabase\.co$/i;
const PLACEHOLDER = /\[[^\]]*\]|<[^>]*>|YOUR[-_ ]?PASSWORD/i;
const SSL_KEYS = ['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslnegotiation', 'uselibpqcompat'];

// The pool and client settings, the same everywhere the server connects. SSL is set here and only
// here: a connection string with sslmode=require would otherwise turn into full certificate checks
// against Node's own trust store, which does not hold Supabase's root, and override this. Supabase
// encrypts every connection; the pooler's certificate is not checked against a CA, as Supabase
// suggests for clients that do not ship its root certificate. Queries use no named prepared
// statements, which transaction pooling on port 6543 cannot keep between transactions.
// The string without its SSL parameters, taken out before parsing, since the parser opens files an
// sslrootcert, sslcert or sslkey names as it reads them.
function withoutSsl(url) {
  const s = String(url), q = s.indexOf('?');
  if (q < 0) return s;
  const kept = s.slice(q + 1).split('&').filter(p => p && !/^(ssl[a-z]*|uselibpqcompat)=/i.test(p));
  return kept.length ? `${s.slice(0, q)}?${kept.join('&')}` : s.slice(0, q);
}
function dbConfig(url, extra = {}) {
  const c = parse(withoutSsl(url));
  for (const k of SSL_KEYS) delete c[k];
  const local = LOCAL.test(c.host || '');
  return { ...c, port: c.port ? Number(c.port) : undefined, ssl: local ? false : { rejectUnauthorized: false }, ...extra };
}

// The raw password as typed, before any decoding, to see whether it needs percent encoding.
function rawPassword(url) {
  const rest = String(url).replace(/^[a-z]+:\/\//i, '');
  const at = rest.lastIndexOf('@');
  if (at < 0) return '';
  const userinfo = rest.slice(0, at);
  const colon = userinfo.indexOf(':');
  return colon < 0 ? '' : userinfo.slice(colon + 1);
}

// Facts about the string, never its values.
function dbShape(url) {
  const s = String(url || '');
  const facts = { present: Boolean(s), placeholder: PLACEHOLDER.test(s), postgres: /^postgres(ql)?:\/\//i.test(s) };
  // Characters in a password that must be percent encoded: @ : / ? # [ ] and spaces, or a % that
  // does not start an escape.
  const pw = rawPassword(s);
  facts.passwordNeedsEncoding = /[@:/?#[\]\s]|%(?![0-9a-f]{2})/i.test(pw);
  let c = null;
  try { c = parse(withoutSsl(s)); } catch {}
  const host = (c && c.host) || '';
  facts.hostKind = !host ? 'missing' : POOLER.test(host) ? 'pooler' : DIRECT.test(host) ? 'direct' : LOCAL.test(host) ? 'local' : 'other';
  facts.port = c && c.port ? Number(c.port) : 5432;
  facts.portKind = facts.port === 6543 ? 'transaction pooler' : facts.port === 5432 ? (facts.hostKind === 'pooler' ? 'session pooler' : 'direct') : 'other';
  // The pooler needs the project ID after the user name, like postgres.abcdefghijklmnopqrst.
  facts.userHasProject = Boolean(c && c.user && /^[^.]+\.[a-z0-9]{15,}$/i.test(c.user));
  facts.sslmodeInString = /[?&]sslmode=/i.test(s);
  return facts;
}

// What is wrong with the string itself, before trying it. Empty when nothing is.
function shapeProblem(f) {
  if (!f.present) return 'missing';
  if (f.placeholder) return 'still has a placeholder, like [YOUR-PASSWORD]';
  if (!f.postgres) return 'not a postgres connection string';
  if (f.passwordNeedsEncoding) return 'the password has characters that must be URL encoded';
  if (f.hostKind === 'pooler' && !f.userHasProject) return 'the user name needs the project ID after a dot, like postgres.yourprojectid';
  return '';
}

// Why a connection failed, as one of a few plain categories.
function classify(err, facts = {}) {
  const code = (err && err.code) || '';
  const msg = String((err && err.message) || '');
  if (code === '28P01' || /password authentication failed/i.test(msg)) return 'password authentication failed';
  if (/tenant or user not found/i.test(msg)) return 'tenant or user not found';
  if (code === '3D000') return 'the database does not exist';
  if (/^(SELF_SIGNED_CERT|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_(VERIFY|GET)|CERT_|ERR_TLS|ERR_SSL|EPROTO)/.test(code) || /ssl|tls|certificate/i.test(msg)) return 'SSL or certificate error';
  // The direct host has only an IPv6 address, and Vercel's functions reach only IPv4.
  if (facts.hostKind === 'direct' && /^(ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|EADDRNOTAVAIL|ETIMEDOUT)$/.test(code)) return 'IPv6 only host: the direct connection cannot be reached from Vercel, use the pooler';
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH' || code === 'EADDRNOTAVAIL') return 'IPv6 only host, or no route to it';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'host not found';
  if (code === 'ECONNREFUSED') return 'connection refused';
  if (code === 'ETIMEDOUT' || /timeout|timed out/i.test(msg)) return 'timed out';
  if (code === 'ECONNRESET') return 'the connection was reset';
  return `other${code ? ` (${code})` : ''}`;
}

module.exports = { dbConfig, dbShape, shapeProblem, classify };
