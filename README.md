# Span

A planner built on 10 day spans instead of weeks, with Claude as the planner.

Days are Day 1 to Day 10. Days 1 to 9 are for living the plan. Day 10 is review. You tell Claude what the next 10 days hold, it proposes a plan, you refine it by talking or by hand, then you live it one day at a time.

Live at span.melomaniacstudios.com. Design follows DESIGN.md in the melomaniacstudios repo.

## How it is built

```
server.js           Express: static app, passcode gate, rate limits, POST /api/plan
lib/planner.js      System prompt, the set_plan tool, one retry on invalid output
lib/validate.js     Server checks on every plan Claude returns
lib/mock.js         Dev only stand in for Claude (SPAN_MOCK=1)
public/index.html   The whole app: inline CSS and JS
public/sw.js        Offline shell for the installed PWA
test/               node:test suites
```

All plan data lives in localStorage on the device. Export and import it as JSON under Settings. The server stores nothing.

Claude answers through the `set_plan` tool. The server checks that days are 1 to 9, that each intention's occurrences match its target, and that nothing lands twice on one day. On rebalance it also checks that completed work stays put and nothing is placed in the past. If a plan fails, the errors go back to Claude once as a tool result. If the second try fails too, the app shows a plain retry message. Everything still works by hand when the API is down.

## Environment

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Server only. Never sent to the browser. |
| `SPAN_PASSCODE` | yes | The one passcode. Needed to log in and for every `/api` call. Changing it signs every device out. |
| `CLAUDE_MODEL` | no | Defaults to `claude-opus-5-5`. |
| `CLAUDE_EFFORT` | no | `low`, `medium` (default), `high`. Higher is slower and costs more. |
| `PORT` | no | Render sets this. |
| `SPAN_MOCK` | no | `1` plans with a local stand in when there is no key. Ignored in production. |

## Local dev

```
npm install
cp .env.example .env      # fill in ANTHROPIC_API_KEY and SPAN_PASSCODE
npm run dev               # http://localhost:3000
npm test
```

With no key, `SPAN_MOCK=1 SPAN_PASSCODE=test npm run dev` runs the whole app against a scripted stand in, so you can work on the UI without spending credit.

To try the app on your phone, open your machine's LAN address on the same Wi-Fi. Mic input needs HTTPS or localhost, so over plain LAN use the keyboard's own dictation.

Limits: 30 plan calls per 10 minutes and 10 login tries per 15 minutes, per IP.

## Deploy on Render

1. Push this repo to GitHub as `melomaniac/span`.
2. In Render, New, Blueprint, pick the repo. It reads `render.yaml`.
3. Set `ANTHROPIC_API_KEY` and `SPAN_PASSCODE` when asked. They are marked `sync: false`, so they never live in git.
4. The service claims `span.melomaniacstudios.com`. Render shows the target host, usually `span.onrender.com`.

## Point the domain

At the DNS host for melomaniacstudios.com, add:

```
Type   Name   Value
CNAME  span   span.onrender.com
```

Use the exact host Render shows under Settings, Custom Domains. Once DNS resolves, Render verifies the domain and issues the certificate. Nothing changes for the main site, which stays on GitHub Pages.

## Install on iPhone

Open span.melomaniacstudios.com in Safari, Share, Add to Home Screen. It opens full screen and keeps working offline. Plans made offline are by hand until you are back online.
