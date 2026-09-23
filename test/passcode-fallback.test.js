// Before the rename the passcode was SPAN_PASSCODE. It still works when DEKA_PASSCODE is unset.
const test = require('node:test');
const assert = require('node:assert');

delete process.env.DEKA_PASSCODE;
delete process.env.ANTHROPIC_API_KEY;
process.env.SPAN_PASSCODE = 'oldname';
const { createApp } = require('../server');

test('SPAN_PASSCODE is used when DEKA_PASSCODE is unset', async () => {
  const server = createApp({}).listen(0);
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ passcode: 'nope' })).status, 401);
  assert.equal((await post({ passcode: 'oldname' })).status, 200);
  server.close();
});
