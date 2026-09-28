// Plans and what they allow. Billing does not exist yet, so every plan gets today's generous
// values; turning tiers on later is a change here. Prices are list prices, dollars per million tokens.

const LIMITS = {
  trial: { turnsPerDay: 150, turnsPerMonth: 4500 },
  standard: { turnsPerDay: 150, turnsPerMonth: 4500 },
  pro: { turnsPerDay: 150, turnsPerMonth: 4500 },
};
const TRIAL_DAYS = 10;

const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};

const limitsFor = plan => LIMITS[plan] || LIMITS.trial;

// usage: { input, output, cacheRead, cacheWrite } in tokens.
function costOf(model, u) {
  const p = PRICES[model] || PRICES['claude-opus-5-5'];
  return ((u.input || 0) * p.input + (u.output || 0) * p.output + (u.cacheWrite || 0) * p.cacheWrite + (u.cacheRead || 0) * p.cacheRead) / 1e6;
}

module.exports = { LIMITS, TRIAL_DAYS, PRICES, limitsFor, costOf };
