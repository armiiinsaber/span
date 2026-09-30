// Tests DATABASE_URL the way the server connects: the same library, pool settings and SSL. Prints
// only facts about the string and the result's category, never the string, host, user or password.
//
//   node --env-file=.env.local scripts/check-db.js

const { Pool } = require('pg');
const { dbConfig, dbShape, shapeProblem, classify } = require('../lib/dburl');

(async () => {
  const url = process.env.DATABASE_URL || '';
  const f = dbShape(url);
  const yes = b => (b ? 'yes' : 'no');
  console.log(`DATABASE_URL set: ${yes(f.present)}`);
  if (!f.present) { console.log('Result: missing. Add DATABASE_URL to the env file and save it.'); return; }
  console.log(`host: ${{ pooler: 'a Supabase pooler host', direct: 'the direct connection host (IPv6 only)', local: 'this machine', other: 'not a Supabase host', missing: 'none found' }[f.hostKind]}`);
  console.log(`port: ${f.port} (${f.portKind})`);
  console.log(`user name has the project ID after a dot: ${yes(f.userHasProject)}`);
  console.log(`leftover placeholder brackets: ${yes(f.placeholder)}`);
  console.log(`password has characters that must be URL encoded: ${yes(f.passwordNeedsEncoding)}`);
  console.log(`sslmode in the string: ${yes(f.sslmodeInString)} (the server sets SSL itself either way)`);
  const problem = shapeProblem(f);
  if (problem) { console.log(`Result: ${problem}`); return; }
  const pool = new Pool(dbConfig(url, { max: 1, connectionTimeoutMillis: 8000, query_timeout: 5000 }));
  pool.on('error', () => {});
  try {
    await pool.query('select 1');
    console.log('Result: connected');
  } catch (err) {
    console.log(`Result: ${classify(err, f)}`);
  } finally { await pool.end().catch(() => {}); }
})();
