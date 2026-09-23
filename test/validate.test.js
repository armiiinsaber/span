const test = require('node:test');
const assert = require('node:assert');
const { cleanText } = require('../lib/validate');

test('strips dashes used as punctuation', () => {
  assert.equal(cleanText('Heavy week \u2014 trim a run'), 'Heavy week, trim a run');
  assert.equal(cleanText('Rest - then run'), 'Rest, then run');
  assert.equal(cleanText('a check-in call'), 'a check-in call');
});
