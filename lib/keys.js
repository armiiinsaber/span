// Supabase API keys come in two formats, and each is sent differently.
//
// New keys (Supabase docs, "Understanding API keys"): a publishable key (sb_publishable_...) for
// the browser and a secret key (sb_secret_...) for servers. They are not JWTs. They go only in the
// apikey header; the Authorization header carries a signed in user's access token or is left out.
// A new key sent as Authorization: Bearer is rejected with a 401.
//
// Legacy keys: the anon and service_role keys are JWTs. The gateway reads the role from the one in
// Authorization, so they are sent in both headers, as before.

const isNewKey = k => /^sb_(publishable|secret)_/.test(String(k || ''));
const isSecretKey = k => /^sb_secret_/.test(String(k || ''));

// The role a legacy key carries, or null when it is not a JWT.
function jwtRole(k) {
  const parts = String(k || '').split('.');
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString()).role || null; } catch { return null; }
}

// Headers for a call made with only a key, no user session.
const keyHeaders = key => (isNewKey(key) ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` });

// Which key may go to the browser, and what is wrong with the setup. Never includes a key's value.
function checkKeys({ publicKey = '', secretKey = '' } = {}) {
  const errors = [];
  let safe = publicKey;
  if (isSecretKey(publicKey)) {
    errors.push('The public Supabase key is a secret key (sb_secret_). It is never sent to the browser. Set SUPABASE_PUBLISHABLE_KEY to the publishable key (sb_publishable_).');
    safe = '';
  } else if (jwtRole(publicKey) === 'service_role') {
    errors.push('The public Supabase key is the legacy service_role key. It is never sent to the browser. Set SUPABASE_ANON_KEY to the anon key.');
    safe = '';
  }
  if (publicKey && secretKey && publicKey === secretKey) {
    errors.push('The public and secret Supabase keys hold the same value. Set SUPABASE_PUBLISHABLE_KEY to the publishable key and SUPABASE_SECRET_KEY to the secret key.');
  }
  return { publicKey: safe, errors };
}

module.exports = { isNewKey, isSecretKey, jwtRole, keyHeaders, checkKeys };
