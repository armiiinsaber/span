// Joins the migrations into supabase/setup.sql, the one file to paste into the SQL Editor.
//
//   node scripts/setup-sql.js
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'supabase', 'migrations');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
const out = ['-- Deka database setup. Made from supabase/migrations by scripts/setup-sql.js.',
  '-- Run it once in the Supabase SQL Editor on a fresh project. Running it again is safe.', '',
  ...files.map(f => `-- ${f}\n\n${fs.readFileSync(path.join(dir, f), 'utf8').trim()}\n`)];
fs.writeFileSync(path.join(__dirname, '..', 'supabase', 'setup.sql'), out.join('\n'));
console.log(`${files.length} migrations into supabase/setup.sql`);
