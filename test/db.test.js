// The database as Supabase would run it: setup.sql on an empty Postgres, then every policy
// through the REST stand in as two different people. Skipped when Postgres cannot start.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { startFake } = require('./fake-supabase');

let fake, a, b;
const TABLES = ['dekas', 'goals', 'sessions', 'notes', 'messages'];

test.before(async () => {
  fake = await startFake();
  a = await fake.user('ana@example.com', { first_name: 'Ana', last_name: 'Silva', username: 'ana.silva' });
  b = await fake.user('bo@example.com', { first_name: 'Bo', last_name: 'Chen', username: 'bo_chen' });
});
test.after(async () => { if (fake) await fake.stop(); });

const rest = (who, method, pathAndQuery, body, prefer) => fetch(`${fake.url}/rest/v1/${pathAndQuery}`, {
  method, headers: { apikey: fake.anonKey, Authorization: `Bearer ${who === 'service' ? fake.serviceKey : who === 'anon' ? fake.anonKey : who.access_token}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
  body: body ? JSON.stringify(body) : undefined,
});
const rows = async r => { const text = await r.text(); assert.ok(r.ok, `${r.status} ${text}`); return text ? JSON.parse(text) : null; };
const upsert = (who, table, body) => rest(who, 'POST', `${table}?on_conflict=user_id,id`, body, 'resolution=merge-duplicates,return=representation');

test('setup.sql runs from empty and runs again without complaint', async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'setup.sql'), 'utf8');
  assert.doesNotMatch(sql, /sk-ant|eyJ[A-Za-z0-9_-]{20,}|service_role_key|secret\s*=/i, 'no keys in the SQL');
  await fake.pool.query(sql);
  const tables = (await fake.pool.query("select tablename from pg_tables where schemaname = 'public' order by 1")).rows.map(r => r.tablename);
  assert.deepEqual(tables, ['dekas', 'feedback', 'goals', 'messages', 'notes', 'profiles', 'sessions', 'usage']);
  const rls = (await fake.pool.query("select tablename, rowsecurity from pg_tables where schemaname = 'public'")).rows;
  assert.ok(rls.every(r => r.rowsecurity), 'row level security on every table');
  const policies = (await fake.pool.query("select tablename, count(*) from pg_policies where schemaname = 'public' group by 1")).rows.map(r => r.tablename).sort();
  assert.deepEqual(policies, tables, 'a policy on every table');
  const bucket = (await fake.pool.query("select public, file_size_limit from storage.buckets where id = 'attachments'")).rows[0];
  assert.deepEqual(bucket, { public: false, file_size_limit: 20971520 });
});

test('signing up makes a profile from the details given, on trial for ten days', async () => {
  const p = (await fake.pool.query('select * from public.profiles where id = $1', [a.user.id])).rows[0];
  assert.deepEqual([p.first_name, p.last_name, p.username, p.email, p.plan], ['Ana', 'Silva', 'ana.silva', 'ana@example.com', 'trial']);
  const days = (new Date(p.trial_ends_at) - new Date(p.created_at)) / 86400000;
  assert.ok(days > 9.99 && days < 10.01);
  // A username taken, or malformed, is left empty rather than failing the sign up.
  await fake.pool.query("insert into auth.users (email, raw_user_meta_data) values ('cy@example.com', '{\"first_name\":\"Cy\",\"username\":\"ana.silva\"}')");
  const cy = (await fake.pool.query("select username, first_name from public.profiles where email = 'cy@example.com'")).rows[0];
  assert.deepEqual(cy, { username: null, first_name: 'Cy' });
  // Apple and Google give one name.
  await fake.pool.query("insert into auth.users (email, raw_user_meta_data) values ('di@example.com', '{\"full_name\":\"Di Okafor Jones\"}')");
  const di = (await fake.pool.query("select first_name, last_name, username from public.profiles where email = 'di@example.com'")).rows[0];
  assert.deepEqual(di, { first_name: 'Di', last_name: 'Okafor Jones', username: null });
});

test('username_taken answers anyone, and the unique index and format hold', async () => {
  assert.equal(await rows(await rest('anon', 'POST', 'rpc/username_taken', { u: 'ANA.silva' })), true);
  assert.equal(await rows(await rest('anon', 'POST', 'rpc/username_taken', { u: 'free.name' })), false);
  const dup = await rest(b, 'PATCH', `profiles?id=eq.${b.user.id}`, { username: 'ana.silva' });
  assert.equal(dup.status, 409, 'unique');
  const bad = await rest(b, 'PATCH', `profiles?id=eq.${b.user.id}`, { username: 'Bo Chen!' });
  assert.equal(bad.status, 400, 'format');
  const ok = await rest(b, 'PATCH', `profiles?id=eq.${b.user.id}`, { username: 'bo.chen', first_name: 'Bo' }, 'return=representation');
  assert.equal((await rows(ok))[0].username, 'bo.chen');
});

test('every table: a person reads and writes only their own rows', async () => {
  const stamp = new Date().toISOString();
  const sample = {
    dekas: { role: 'current', status: 'live', start_date: '2026-09-20' },
    goals: { deka_id: 'd1', goal_id: 'run', name: 'Run', target: 4 },
    sessions: { deka_id: 'd1', goal_id: 'run', day: 2, done: true },
    notes: { deka_id: 'd1', day: 2, text: 'Legs heavy.' },
    messages: { deka_id: 'd1', role: 'user', text: 'plan it', ts: 1, data: { cards: [] } },
  };
  for (const t of TABLES) {
    const mine = await rows(await upsert(a, t, [{ user_id: a.user.id, id: 'x1', updated_at: stamp, ...sample[t] }]));
    assert.equal(mine.length, 1, `${t}: a writes a row`);
    // b sees nothing of a's, even asking by id.
    assert.deepEqual(await rows(await rest(b, 'GET', `${t}?select=id&id=eq.x1`)), [], `${t}: b cannot read a's row`);
    assert.deepEqual(await rows(await rest(b, 'GET', `${t}?select=id`)), [], `${t}: b has nothing`);
    // b cannot write into a's rows, nor write a row that claims to be a's.
    assert.equal((await rest(b, 'PATCH', `${t}?id=eq.x1`, { deleted: true }, 'return=representation')).status, 200);
    assert.equal((await rows(await rest(a, 'GET', `${t}?select=deleted&id=eq.x1`)))[0].deleted, false, `${t}: b's update touched nothing`);
    assert.equal((await upsert(b, t, [{ user_id: a.user.id, id: 'x2', updated_at: stamp, ...sample[t] }])).status, 403, `${t}: b cannot insert as a`);
    assert.equal((await rest(b, 'DELETE', `${t}?id=eq.x1`, null, 'return=representation')).status, 200);
    assert.equal((await rows(await rest(a, 'GET', `${t}?select=id&id=eq.x1`))).length, 1, `${t}: b's delete removed nothing`);
    // Nobody signed in sees anything.
    assert.equal((await rest('anon', 'GET', `${t}?select=id`)).status, 403, `${t}: anon has no access`);
  }
  // Profiles: only your own.
  assert.deepEqual((await rows(await rest(b, 'GET', 'profiles?select=id'))).map(p => p.id), [b.user.id]);
  assert.equal((await rest(b, 'PATCH', `profiles?id=eq.${a.user.id}`, { first_name: 'Hacked' })).status, 204);
  assert.equal((await rows(await rest(a, 'GET', 'profiles?select=first_name')))[0].first_name, 'Ana');
});

test('a deletion travels as just the key and the flag, and updated_at moves by itself', async () => {
  const r = await rows(await upsert(a, 'goals', [{ user_id: a.user.id, id: 'gone', deleted: true }]));
  assert.equal(r[0].deleted, true);
  assert.ok(r[0].updated_at, 'stamped on insert');
  const before = (await rows(await rest(a, 'GET', 'goals?select=updated_at&id=eq.x1')))[0].updated_at;
  await new Promise(x => setTimeout(x, 20));
  await rest(a, 'PATCH', 'goals?id=eq.x1', { target: 5 });
  const after = (await rows(await rest(a, 'GET', 'goals?select=updated_at&id=eq.x1')))[0].updated_at;
  assert.ok(new Date(after) > new Date(before), 'a plain update moves updated_at');
  await rest(a, 'PATCH', 'goals?id=eq.x1', { target: 6, updated_at: '2030-01-01T00:00:00.000Z' });
  const own = (await rows(await rest(a, 'GET', 'goals?select=updated_at&id=eq.x1')))[0].updated_at;
  assert.equal(Date.parse(own), Date.parse('2030-01-01T00:00:00.000Z'), 'a row keeps the stamp it came with');
});

test('attachments: only your own folder, up and down', async () => {
  const up = (who, p, body = 'x') => fetch(`${fake.url}/storage/v1/object/attachments/${p}`, { method: 'POST', headers: { apikey: fake.anonKey, Authorization: `Bearer ${who.access_token}`, 'Content-Type': 'image/jpeg' }, body });
  const down = (who, p) => fetch(`${fake.url}/storage/v1/object/authenticated/attachments/${p}`, { headers: { apikey: fake.anonKey, Authorization: `Bearer ${who.access_token}` } });
  const first = await up(a, `${a.user.id}/one.jpg`);
  assert.equal(first.status, 200, await first.text());
  assert.equal((await up(b, `${a.user.id}/two.jpg`)).status, 403, 'b cannot write in a\'s folder');
  assert.equal((await up(b, `${b.user.id}/../${a.user.id}/three.jpg`)).status, 403, 'no path tricks');
  assert.equal((await down(a, `${a.user.id}/one.jpg`)).status, 200);
  assert.equal((await down(b, `${a.user.id}/one.jpg`)).status, 400, 'b cannot read a\'s file');
  const service = await fetch(`${fake.url}/storage/v1/object/attachments/${a.user.id}/one.jpg`, { headers: { apikey: fake.anonKey, Authorization: `Bearer ${fake.serviceKey}` } });
  assert.equal(service.status, 200, 'the server can');
  const big = await up(a, `${a.user.id}/big.pdf`, Buffer.alloc(21 * 1024 * 1024));
  assert.equal(big.status, 413, 'the bucket caps files at 20 MB');
});

test('feedback and usage: written by the server, read only by their owner', async () => {
  assert.equal((await rest(a, 'POST', 'feedback', { user_id: a.user.id, rating: 'up' })).status, 403, 'not from the app');
  await rows(await rest('service', 'POST', 'feedback', { user_id: a.user.id, message_id: 'm1', rating: 'down', reason: 'Too many runs', message: 'Here is a plan.' }, 'return=representation'));
  await rows(await rest('service', 'POST', 'usage', { user_id: a.user.id, day: '2026-09-28', model: 'claude-opus-5-5', input_tokens: 1200, output_tokens: 300, cost_usd: 0.0108 }, 'return=representation'));
  assert.equal((await rows(await rest(a, 'GET', 'usage?select=input_tokens'))).length, 1);
  assert.deepEqual(await rows(await rest(b, 'GET', 'usage?select=input_tokens')), []);
  assert.deepEqual(await rows(await rest(b, 'GET', 'feedback?select=reason')), []);
});

test('deleting the account removes every row', async () => {
  const cy = await fake.user('cy2@example.com', { username: 'cy.two' });
  await rows(await upsert(cy, 'dekas', [{ user_id: cy.user.id, id: 'd1', role: 'current' }]));
  await rows(await upsert(cy, 'messages', [{ user_id: cy.user.id, id: 'm1', deka_id: 'd1' }]));
  await rows(await rest('service', 'POST', 'usage', { user_id: cy.user.id, day: '2026-09-28' }, 'return=representation'));
  const gone = await fetch(`${fake.url}/auth/v1/admin/users/${cy.user.id}`, { method: 'DELETE', headers: { apikey: fake.anonKey, Authorization: `Bearer ${fake.serviceKey}` } });
  assert.equal(gone.status, 200);
  for (const t of ['profiles', 'dekas', 'messages', 'usage']) {
    const col = t === 'profiles' ? 'id' : 'user_id';
    assert.equal((await fake.pool.query(`select count(*) from public.${t} where ${col} = $1`, [cy.user.id])).rows[0].count, '0', `${t} emptied`);
  }
});
