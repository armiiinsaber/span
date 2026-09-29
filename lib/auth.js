// Checks the Supabase access token a request carries. Projects made before 2025 sign with a
// shared secret (HS256); newer ones sign with a key pair and publish the public keys (ES256 or
// RS256) at /auth/v1/.well-known/jwks.json. Both work: set SUPABASE_JWT_SECRET for the first,
// nothing extra for the second. The published keys are public; the request still carries the
// public API key in apikey, which is all the gateway asks for.

const crypto = require('crypto');

const KEYS_TTL = 10 * 60 * 1000;
const keyCache = new Map(); // url: { at, keys }

function decode(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return { header, claims, signed: `${parts[0]}.${parts[1]}`, sig: Buffer.from(parts[2], 'base64url') };
  } catch { return null; }
}

async function publicKeys(url, fetchImpl, apikey) {
  const hit = keyCache.get(url);
  if (hit && Date.now() - hit.at < KEYS_TTL) return hit.keys;
  const res = await fetchImpl(`${url}/auth/v1/.well-known/jwks.json`, { headers: apikey ? { apikey } : {} });
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  const { keys } = await res.json();
  keyCache.set(url, { at: Date.now(), keys });
  return keys;
}

/**
 * Returns the claims when the token is valid, otherwise null.
 * opts: { url, secret, apikey, fetch }
 */
async function verifyToken(token, { url, secret, apikey, fetch: fetchImpl = fetch } = {}) {
  const t = decode(token);
  if (!t) return null;
  const { header, claims, signed, sig } = t;
  try {
    if (header.alg === 'HS256') {
      if (!secret) return null;
      const want = crypto.createHmac('sha256', secret).update(signed).digest();
      if (want.length !== sig.length || !crypto.timingSafeEqual(want, sig)) return null;
    } else if (header.alg === 'ES256' || header.alg === 'RS256') {
      if (!url) return null;
      const jwk = (await publicKeys(url, fetchImpl, apikey)).find(k => k.kid === header.kid) || null;
      if (!jwk) return null;
      const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
      const ok = header.alg === 'ES256'
        ? crypto.verify('sha256', Buffer.from(signed), { key, dsaEncoding: 'ieee-p1363' }, sig)
        : crypto.verify('sha256', Buffer.from(signed), key, sig);
      if (!ok) return null;
    } else return null;
  } catch { return null; }
  const now = Date.now() / 1000;
  if (!claims.sub || (claims.exp && claims.exp < now)) return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes('authenticated')) return null;
  return claims;
}

module.exports = { verifyToken, decode };
