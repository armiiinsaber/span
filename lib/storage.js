// The server's side of Supabase: attachments out of the private bucket, and the two things only
// the service role may do, listing a person's folder to empty it and deleting their account.
// The secret key never leaves this process.

const { keyHeaders } = require('./keys');

const BUCKET = 'attachments';
const MAX_PDF = 20 * 1024 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;
const PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,80}$/;

function createStorage({ url, serviceKey, fetch: fetchImpl = fetch } = {}) {
  const ready = Boolean(url && serviceKey);
  // A secret key (sb_secret_) goes only in apikey; a legacy service_role JWT also goes in Authorization.
  const headers = extra => ({ ...keyHeaders(serviceKey), ...extra });
  return {
    ready,
    // refs: [{ path, kind, name }] from the app. Only paths in this user's own folder are read.
    async fetchAttachments(refs, userId) {
      if (refs == null) return { ok: true, list: [] };
      if (!Array.isArray(refs)) return { ok: false, status: 400, error: 'Those attachments cannot be sent.' };
      if (refs.length > MAX_ATTACHMENTS) return { ok: false, status: 400, error: 'Up to 5 attachments per message.' };
      const list = [];
      for (const r of refs) {
        const p = r && String(r.path || '');
        if (!PATH.test(p) || !p.startsWith(`${userId}/`)) return { ok: false, status: 400, error: 'Those attachments cannot be sent.' };
        const res = await fetchImpl(`${url}/storage/v1/object/${BUCKET}/${p}`, { headers: headers() });
        if (!res.ok) return { ok: false, status: 400, error: 'An attachment is missing. Send it again.' };
        const type = (res.headers.get('content-type') || '').split(';')[0];
        const buf = Buffer.from(await res.arrayBuffer());
        const pdf = type === 'application/pdf' || r.kind === 'pdf';
        if (pdf && buf.length > MAX_PDF) return { ok: false, status: 413, error: 'That PDF is over 20 MB.' };
        if (!pdf && buf.length > MAX_IMAGE) return { ok: false, status: 413, error: 'That photo is too large.' };
        list.push({ media_type: pdf ? 'application/pdf' : (type || 'image/jpeg'), name: r.name ? String(r.name).slice(0, 200) : '', data: buf.toString('base64') });
      }
      return { ok: true, list };
    },
    async emptyFolder(userId) {
      const listed = await fetchImpl(`${url}/storage/v1/object/list/${BUCKET}`, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefix: `${userId}/`, limit: 1000 }) });
      if (!listed.ok) throw new Error(`storage list ${listed.status}`);
      const names = (await listed.json()).map(o => `${userId}/${o.name}`).filter(n => PATH.test(n));
      if (!names.length) return 0;
      const gone = await fetchImpl(`${url}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: names }) });
      if (!gone.ok) throw new Error(`storage delete ${gone.status}`);
      return names.length;
    },
    async deleteUser(userId) {
      const res = await fetchImpl(`${url}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: headers() });
      if (!res.ok) throw new Error(`delete user ${res.status}`);
    },
  };
}

module.exports = { createStorage, BUCKET, MAX_PDF, MAX_ATTACHMENTS };
