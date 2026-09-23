# Real runs

Deka against the real Claude API (claude-opus-5-5), through the real server and tool loop, on 2026-09-23. Made with `node --env-file=.env.local scripts/real-runs.js --runs 2 --out test/real-runs`. The deka starts on Wednesday 2026-09-23, so day 3 is a Friday and days 4 and 5 are the only weekend.

| Scenario | Run 1 | Run 2 |
|---|---|---|
| 1 full dump | pass | pass |
| 2 book and trim | pass | pass |
| 3 tweaks | pass | pass |
| 4 add coffee | pass | pass |
| 5 check in day 2 | pass | pass |
| 6 skipped check in | pass | pass |
| 7 day 10 review | pass | pass |

Each turn, per run: seconds to the first word, total seconds, and cost at list price.

| Scenario | Turn | Run 1 | Run 2 |
|---|---|---|---|
| 1 full dump | In the next 10 days I want at least one ... | 5.4 s / 9.5 s / $0.042 | 7.0 s / 11.0 s / $0.046 |
| 2 book and trim | About 120 pages left. Your trim sounds g... | 13.1 s / 21.7 s / $0.069 | 11.7 s / 20.8 s / $0.068 |
| 3 tweaks | keep day 4 free | 13.1 s / 23.8 s / $0.066 | 10.9 s / 18.7 s / $0.060 |
| 3 tweaks | mom on weekends only | 18.6 s / 26.3 s / $0.084 | 19.9 s / 28.0 s / $0.083 |
| 4 add coffee | also add 2 coffee catch ups with friends... | 5.9 s / 13.5 s / $0.058 | 4.1 s / 11.2 s / $0.054 |
| 5 check in day 2 | did the gym and rentletter, skipped the ... | 13.8 s / 21.3 s / $0.083 | 9.6 s / 16.9 s / $0.069 |
| 6 skipped check in | sorry, forgot to check in yesterday. yes... | 7.2 s / 14.4 s / $0.063 | 7.3 s / 14.5 s / $0.062 |
| 7 day 10 review | (Day 10: the app opens the review) | 16.9 s / 26.6 s / $0.096 | 16.1 s / 25.7 s / $0.107 |

Total: $0.56 for run 1, $0.55 for run 2.
