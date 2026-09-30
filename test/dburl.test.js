// The database connection string: its shape, the settings the server connects with, and the
// category a failed connection falls into, with real connections to a local Postgres where the
// failure can be made to happen here.
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const { Pool } = require('pg');
const { dbConfig, dbShape, shapeProblem, classify } = require('../lib/dburl');
const { checkSetup } = require('../lib/health');
const { startFake } = require('./fake-supabase');

let fake;
test.before(async () => { fake = await startFake(); });
test.after(async () => { if (fake) await fake.stop(); });

const REF = 'abcdefghijklmnopqrst';
const pooler = (pw = 'Plain123', port = 6543, user = `postgres.${REF}`) => `postgresql://${user}:${pw}@aws-0-ca-central-1.pooler.supabase.com:${port}/postgres`;
// Connect the way the server does and name what went wrong.
async function tryConnect(url, extra = {}) {
  const pool = new Pool(dbConfig(url, { max: 1, connectionTimeoutMillis: 3000, ...extra }));
  pool.on('error', () => {});
  try { await pool.query('select 1'); return 'connected'; }
  catch (err) { return classify(err, dbShape(url)); }
  finally { await pool.end().catch(() => {}); }
}

test('the shape of a string, without its values', () => {
  const f = dbShape(pooler());
  assert.deepEqual([f.hostKind, f.port, f.portKind, f.userHasProject, f.placeholder, f.passwordNeedsEncoding], ['pooler', 6543, 'transaction pooler', true, false, false]);
  assert.equal(dbShape(pooler('x', 5432)).portKind, 'session pooler');
  assert.equal(dbShape(`postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`).hostKind, 'direct');
  assert.equal(dbShape(pooler('x', 6543, 'postgres')).userHasProject, false);
  assert.equal(shapeProblem(dbShape(pooler('x', 6543, 'postgres'))), 'the user name needs the project ID after a dot, like postgres.yourprojectid');
  assert.equal(shapeProblem(dbShape(pooler('[YOUR-PASSWORD]'))), 'still has a placeholder, like [YOUR-PASSWORD]');
  for (const pw of ['pa@ss', 'pa#ss', 'pa/ss', 'pa?ss', 'pa ss', 'pa%zz', 'pa:ss']) assert.equal(dbShape(pooler(pw)).passwordNeedsEncoding, true, pw);
  for (const pw of ['pa%40ss', 'Plain123', 'pa-ss_s.s~s']) assert.equal(dbShape(pooler(pw)).passwordNeedsEncoding, false, pw);
  assert.equal(shapeProblem(dbShape(pooler('pa@ss'))), 'the password has characters that must be URL encoded');
  assert.equal(shapeProblem(dbShape('')), 'missing');
  assert.equal(shapeProblem(dbShape('https://example.com')), 'not a postgres connection string');
  assert.equal(shapeProblem(dbShape(pooler())), '');
  // Facts are booleans, kinds and the port number: never the host, user or password.
  const out = JSON.stringify(dbShape(pooler('S3cret!')));
  for (const v of ['S3cret', REF, 'aws-0', 'pooler.supabase.com']) assert.ok(!out.includes(v), v);
});

test('the server sets SSL itself: sslmode in the string never turns on checks Supabase would fail', () => {
  const c = dbConfig(`${pooler()}?sslmode=require`);
  assert.deepEqual(c.ssl, { rejectUnauthorized: false });
  assert.equal(c.sslmode, undefined);
  assert.equal(c.port, 6543);
  assert.equal(c.user, `postgres.${REF}`);
  assert.equal(dbConfig(`${pooler()}?sslmode=verify-full&sslrootcert=/x`).ssl.rejectUnauthorized, false);
  assert.equal(dbConfig('postgres://u:p@127.0.0.1:5432/d?sslmode=require').ssl, false, 'no SSL on this machine');
  assert.equal(dbConfig(pooler('pa%40ss')).password, 'pa@ss', 'an encoded password is decoded');
});

test('real connections, each failure in its category', async () => {
  const local = fake.databaseUrl;
  assert.equal(await tryConnect(local), 'connected');
  // With sslmode=require in the string, the server's own settings still win.
  assert.equal(await tryConnect(`${local}?sslmode=require`), 'connected');
  const raw = new Pool({ connectionString: `${local}?sslmode=require`, ssl: false, max: 1, connectionTimeoutMillis: 3000 });
  raw.on('error', () => {});
  const rawResult = await raw.query('select 1').then(() => 'connected', err => classify(err));
  await raw.end().catch(() => {});
  assert.equal(rawResult, 'SSL or certificate error', 'passed straight to pg, sslmode overrides the ssl setting');
  assert.equal(await tryConnect(local.replace(':postgres@', ':wrong@')), 'password authentication failed');
  assert.equal(await tryConnect(local.replace(/\/postgres$/, '/nope')), 'the database does not exist');
  assert.equal(await tryConnect('postgres://u:p@127.0.0.1:1/postgres'), 'connection refused');
  assert.equal(await tryConnect('postgres://u:p@deka-no-such-host.invalid:5432/postgres'), 'host not found');
  // A server that takes the connection and never answers.
  const silent = net.createServer(() => {}).listen(0);
  await new Promise(r => silent.once('listening', r));
  assert.equal(await tryConnect(`postgres://u:p@127.0.0.1:${silent.address().port}/postgres`, { connectionTimeoutMillis: 500 }), 'timed out');
  silent.close();
});

test('failures that only happen against Supabase fall into their own categories', () => {
  const direct = dbShape(`postgresql://postgres:pw@db.${REF}.supabase.co:5432/postgres`);
  for (const code of ['ENOTFOUND', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT']) {
    assert.equal(classify(Object.assign(new Error('x'), { code }), direct), 'IPv6 only host: the direct connection cannot be reached from Vercel, use the pooler', code);
  }
  assert.equal(classify(Object.assign(new Error('connect ENETUNREACH 2600:1f18::1:5432'), { code: 'ENETUNREACH' })), 'IPv6 only host, or no route to it');
  assert.equal(classify(Object.assign(new Error('Tenant or user not found'), { code: 'XX000' })), 'tenant or user not found');
  assert.equal(classify(Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' })), 'SSL or certificate error');
  assert.equal(classify(new Error('The server does not support SSL connections')), 'SSL or certificate error');
  assert.equal(classify(Object.assign(new Error('odd'), { code: '53300' })), 'other (53300)');
});

test('the health check names the category, and never a value', async () => {
  const base = { anthropicKey: 'sk-ant-x', client: { models: { list: async () => ({}) } }, url: 'https://abcd.supabase.co', publicKey: 'sb_publishable_a', secretKey: 'sb_secret_b' };
  const db = async databaseUrl => (await checkSetup({ ...base, databaseUrl })).checks.find(c => c.name === 'DATABASE_URL');
  assert.deepEqual(await db(fake.databaseUrl), { name: 'DATABASE_URL', ok: true, detail: 'connected' });
  assert.equal((await db(fake.databaseUrl.replace(':postgres@', ':wrong@'))).detail, 'password authentication failed');
  assert.equal((await db('postgres://u:p@127.0.0.1:1/postgres')).detail, 'connection refused');
  assert.equal((await db(pooler('pa@ss'))).detail, 'the password has characters that must be URL encoded');
  assert.equal((await db(pooler('x', 6543, 'postgres'))).detail, 'the user name needs the project ID after a dot, like postgres.yourprojectid');
  assert.equal((await db('postgres://u:p@deka-no-such-host.invalid:5432/postgres')).detail, 'host not found');
});
