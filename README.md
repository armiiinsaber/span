# Deka

A planner built on 10 day cycles called dekas instead of weeks, with a chat at its heart. You talk to Deka (powered by Claude) about what the next 10 days hold, it keeps your goals and schedule in shape, and you live it one day at a time.

Days are Day 1 to Day 10. Days 1 to 9 are for living the plan. Day 10 is the review, which happens in the chat.

Live at dekaapp.com. Design follows DESIGN.md in the melomaniacstudios repo.

## How it is built

```
server.js           Express app, default export: passcode gate, rate limits, POST /api/chat
vercel.json         Function max duration and static headers
lib/chat.js         Deka's system prompt, the context each turn sends, the streamed tool loop
lib/tools.js        The tools and the checks every call must pass
lib/validate.js     Text cleaning shared by the tools
lib/mock.js         Dev only stand in for Claude that streams and calls tools (DEKA_MOCK=1)
public/index.html   The whole app: inline CSS and JS, served as a static file
public/sw.js        Offline shell for the installed PWA
public/brand/       Every icon and iOS splash screen, built from brand/ (see Logo)
public/fonts/       Melomaniac Serif and Inter, self hosted as subset WOFF2
brand/              The Deka mark: the source PNG and the traced SVGs
scripts/            trace_mark.py (PNG to SVG), brand.js (SVG to icons and splash screens), real-runs.js (Deka against the real API)
test/               node:test suites; ui.test.js drives headless Chrome; real-runs/ holds the latest real API transcripts
```

The app has three tabs:

- **Deka**, the chat. You add goals in plain language, one at a time or as a long list. Deka turns them into short goals with a type (do, see or abstain) and a target, and asks one short question only when something is unclear. When the goals look complete, when you ask, or when something changes, Deka proposes a schedule as a card with Confirm and Tweak. Nothing changes until you tap Confirm.
- **Days**, today's checklist at the top and the ten day tiles below. Tap a tile to open that day.
- **Goals**, every goal with its target and progress. Tap one to rename it, change its count, move a day by tapping the dot and then the new day, or delete it. On desktop, dots can also be dragged along their row.

Past dekas and Settings sit behind the icon in the header. Each deka has its own chat thread; past threads stay readable in Past dekas.

**Check in.** Settings holds a daily check in time, 8:00 pm by default. The first time the app opens after that time, Deka has already asked "How did today go?". Deka logs what you say happened (tap a result on the card to correct it). If something planned that day went unmentioned, it asks about it in one short line and waits for your answer; it never assumes a session was missed, and the check in stays open until you reply. Then it proposes how the rest of the deka fits. A session nobody confirmed shows on Days as a dashed outline, not done and not missed, and the next evening's check in asks about it first. A skipped day is asked about the next evening.

**Review.** On Day 10 Deka opens the review in the chat: what held, what slipped, one pattern. It then drafts the next deka's goals and schedule. Confirming it starts the next deka with a fresh thread.

**The mark.** The ten dots of the logo are the app's only loading indicator. While Deka thinks, and while a reply streams in, a wave runs through the dots from Day 1 to Day 10. With reduced motion, the mark stays still and gently pulses instead.

**Offline.** Everything except talking to Deka works offline. Messages sent offline show as waiting and send when the connection returns.

All data lives in localStorage on the device, including the chat threads, the summaries and the check in time. Export and import it as JSON under Settings. The server stores nothing.

### How Deka works

Each message is one request to `POST /api/chat`, answered as server sent events (`text`, `goals`, `log`, `proposal`, `summary`, `error`, `done`). The server is stateless: the app sends the goals, the schedule with what is done or missed, today's date, the date and weekday of every day, the last 30 messages and a summary of older ones. While a proposal card waits for Confirm, the app also sends every session on it, so a tweak adjusts that card instead of starting over. When older messages drop out of that window, Deka writes the summary itself with `save_summary`.

Claude replies in text and calls three tools:

| Tool | What it does | Checked on the server |
|---|---|---|
| `update_goals` | Adds, edits or removes goals | Unique ids, a type, targets 1 to 9, never below what is already done |
| `log_day` | Marks sessions done or missed on a day | Only days that have started, known goals |
| `propose_schedule` | A full schedule for what is left, with short change lines for the card | Days 1 to 9, counts match targets, no goal twice on a day, done and missed sessions never move, nothing on a passed day |

Deka writes its reply first and then calls its tools, so words appear while the plan is built. Once the reply is written and every call passes its checks, the turn ends without another request. A call that fails its checks goes back to Claude once with the errors. If the second try fails too, the turn ends with a plain message and a Try again link, and nothing reaches the app. The app checks a proposal again when you tap Confirm, in case the plan changed by hand since.

### Data from before the rename

The app was called Span. Saved data now lives under the localStorage key `deka.v1`. On first load, data under the old key `span.v1` is copied across once and the old key is left in place. The export format did not change, so files exported as Span still import.

## Environment

Set these in the Vercel project under Settings, Environment Variables, for Production and Preview.

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Server only. Never sent to the browser. |
| `DEKA_PASSCODE` | yes | The one passcode. Needed to log in and for every `/api` call. Changing it signs every device out. Falls back to `SPAN_PASSCODE` when unset. |
| `CLAUDE_MODEL` | no | Defaults to `claude-opus-5-5`. |
| `CLAUDE_EFFORT` | no | `low` (default), `medium`, `high`. In real runs low planned as well as medium, with the first word sooner and about 17% less cost; see `test/real-runs/README.md`. |
| `DEKA_MOCK` | no | Local only. `1` plans with a scripted stand in when there is no key. Ignored in production. |

## Local dev

```
npm install
npm i -g vercel           # CLI 47.0.5 or newer
vercel link               # once, to connect this folder to the Vercel project
vercel env pull .env      # optional, pulls the project's env vars
vercel dev                # http://localhost:3000
npm test
```

`npm test` includes browser tests of the mobile flows in `test/ui.test.js`. They need Chrome (or set `CHROME_PATH`) and Node 22 or newer, and skip themselves otherwise.

`vercel dev` runs the app the way Vercel does: files in `public/` are served as static files and `server.js` runs as the function. Without the CLI, `npm run dev` serves the same thing with plain Node.

With no key, `DEKA_MOCK=1 DEKA_PASSCODE=test npm run dev` runs the whole app against a scripted stand in, so you can work on the UI without spending credit.

`node --env-file=.env.local scripts/real-runs.js --runs 2 --out test/real-runs` plays nine scenarios against the real API through the real server and tool loop (planning, tweaks, check ins, the Day 10 review, a long chat that needs a summary, a check in question left unanswered), checks each turn, and writes the transcripts with timing and cost. It costs about $0.45 a run. Set `CLAUDE_MODEL` and `CLAUDE_EFFORT` to try other setups, and `--only 9` to run one scenario. See `test/real-runs/README.md` for the latest results.

To try the app on your phone, open your machine's LAN address on the same Wi-Fi. Mic input needs HTTPS or localhost, so over plain LAN use the keyboard's own dictation.

## How it runs on Vercel

Vercel detects Express from `server.js`. Its default export is the app, and the whole app becomes one Vercel Function. Everything in `public/` (the page, manifest, service worker, icons, fonts) is served from Vercel's CDN; `express.static` is not used there. Any path that is not a static file, including `/api/*`, reaches the function.

`vercel.json` sets `maxDuration` to 120 seconds, room for a Claude call plus one retry after a failed validation. The `*.js` key is deliberate: Vercel names the Express function `index`, so a `server.js` key does not match it. The same file carries the security and cache headers that Express sets locally, since static files skip Express on Vercel.

### Login and rate limits

The session is an HttpOnly cookie, `SameSite=Lax`, `Secure` over HTTPS, and host only, so it belongs to dekaapp.com alone. Because www redirects to the apex, every login happens on dekaapp.com.

The rate limits (40 chat messages per 10 minutes, 10 login tries per 15 minutes, per IP) live in memory. Vercel runs several instances that do not share memory, so these limits are soft: each instance counts on its own and a new instance starts at zero. The passcode is the real protection; keep it long. For a hard limit, add Vercel Firewall rate limiting on `/api/chat`.

## Deploy on Vercel

1. In Vercel, Add New, Project, import `armiiinsaber/span` from GitHub. The framework preset is Express; leave build settings empty.
2. Add `ANTHROPIC_API_KEY` and `DEKA_PASSCODE` under Environment Variables, and `CLAUDE_MODEL` if you want a different model.
3. Deploy. Every push to `main` deploys to production after that.

## Domains

In the project, Settings, Domains:

1. Add `dekaapp.com`. Vercel offers to add `www.dekaapp.com` too; accept, and choose to redirect `www.dekaapp.com` to `dekaapp.com` (308).
2. At the DNS host for dekaapp.com, add the records Vercel shows on each domain card:

```
Type   Name   Value
A      @      76.76.21.21
CNAME  www    <the project CNAME Vercel shows, like d1d4fc829fe7bc7c.vercel-dns-017.com>
```

The www value is unique to each project, and Vercel may show a newer A value on the card; when the card differs from the above, use the card. Remove any other A, AAAA or CNAME records on `@` and `www` first, such as a registrar's parking page. Vercel issues the certificates once DNS resolves.

## Logo

The mark is ten dots on a spiral, one per day of a deka, growing from Day 1 to Day 10. The source image is `brand/deka-mark.png`.

```
brand/deka-mark.svg         traced master: ten circles, ids day1 to day10, centred in a square viewBox
brand/deka-mark-ink.svg     near black ink on transparent, for use on ivory
brand/deka-icon.svg         app icon: ink ground, ivory dots, Day 10 in chartreuse
brand/deka-mark-small.svg   favicon version: the small dots enlarged so every dot reads at 16 and 32 px
```

`python3 scripts/trace_mark.py` measures the ten circles in the PNG (centre and radius to a fraction of a pixel) and writes the four SVGs. It needs Python 3 with numpy, scipy and pillow. `node scripts/brand.js` then builds everything in `public/brand/` from the SVGs and rewrites the one marked brand block in `public/index.html`:

```
public/brand/icon.svg                 favicon, from deka-mark-small.svg
public/brand/icon-180.png             iPhone home screen, from deka-icon.svg
public/brand/icon-192.png             manifest icon
public/brand/icon-512.png             manifest icon
public/brand/icon-maskable-512.png    manifest icon, mark inside the maskable safe zone
public/brand/splash-<w>x<h>.png       iOS launch screens: ivory, small ink mark (10 files)
```

After changing the mark, run both scripts and bump `CACHE` in `public/sw.js`. Inside the app the mark is drawn inline from the same ten circles, so the header, login, first run and every waiting state use the same shape.

iOS may keep showing the old home screen icon until the app is removed from the home screen and added again.

## Install on iPhone

Open dekaapp.com in Safari, Share, Add to Home Screen. It opens full screen and keeps working offline. Plans made offline are by hand until you are back online. An installed copy from an older address is a separate app; add Deka again from dekaapp.com.
