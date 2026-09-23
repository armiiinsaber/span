# Deka

A planner built on 10 day cycles called dekas instead of weeks, with Claude as the planner.

Days are Day 1 to Day 10. Days 1 to 9 are for living the plan. Day 10 is review. You tell Claude what the next 10 days hold, it proposes a plan, you refine it by talking or by hand, then you live it one day at a time.

Live at dekaapp.com. Design follows DESIGN.md in the melomaniacstudios repo.

## How it is built

```
server.js           Express app, default export: passcode gate, rate limits, POST /api/plan
vercel.json         Function max duration and static headers
lib/planner.js      System prompt, the set_plan tool, one retry on invalid output
lib/validate.js     Server checks on every plan Claude returns
lib/mock.js         Dev only stand in for Claude (DEKA_MOCK=1)
public/index.html   The whole app: inline CSS and JS, served as a static file
public/sw.js        Offline shell for the installed PWA
public/brand/       Every icon and iOS splash screen (see Logo and icons)
public/fonts/       Melomaniac Serif and Inter, self hosted as subset WOFF2
scripts/brand.js    Draws the placeholder icons and splash screens
test/               node:test suites; ui.test.js drives headless Chrome
```

The app is three tabs: Today, Deka (the 10 day grid) and Plan (talk to Claude). Past dekas and Settings sit behind the icon in the header. Tapping an intention opens a sheet to rename it, change its count, move a day by tapping the dot and then the new day, or delete it. On desktop, dots can also be dragged along their row.

All plan data lives in localStorage on the device. Export and import it as JSON under Settings. The server stores nothing.

Claude answers through the `set_plan` tool. The server checks that days are 1 to 9, that each intention's occurrences match its target, and that nothing lands twice on one day. On rebalance it also checks that completed work stays put and nothing is placed in the past. If a plan fails, the errors go back to Claude once as a tool result. If the second try fails too, the app shows a plain retry message. Everything still works by hand when the API is down.

### Data from before the rename

The app was called Span. Saved data now lives under the localStorage key `deka.v1`. On first load, data under the old key `span.v1` is copied across once and the old key is left in place. The export format did not change, so files exported as Span still import.

## Environment

Set these in the Vercel project under Settings, Environment Variables, for Production and Preview.

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Server only. Never sent to the browser. |
| `DEKA_PASSCODE` | yes | The one passcode. Needed to log in and for every `/api` call. Changing it signs every device out. Falls back to `SPAN_PASSCODE` when unset. |
| `CLAUDE_MODEL` | no | Defaults to `claude-opus-5-5`. |
| `CLAUDE_EFFORT` | no | `low`, `medium` (default), `high`. Higher is slower and costs more. |
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

To try the app on your phone, open your machine's LAN address on the same Wi-Fi. Mic input needs HTTPS or localhost, so over plain LAN use the keyboard's own dictation.

## How it runs on Vercel

Vercel detects Express from `server.js`. Its default export is the app, and the whole app becomes one Vercel Function. Everything in `public/` (the page, manifest, service worker, icons, fonts) is served from Vercel's CDN; `express.static` is not used there. Any path that is not a static file, including `/api/*`, reaches the function.

`vercel.json` sets `maxDuration` to 120 seconds, room for a Claude call plus one retry after a failed validation. The `*.js` key is deliberate: Vercel names the Express function `index`, so a `server.js` key does not match it. The same file carries the security and cache headers that Express sets locally, since static files skip Express on Vercel.

### Login and rate limits

The session is an HttpOnly cookie, `SameSite=Lax`, `Secure` over HTTPS, and host only, so it belongs to dekaapp.com alone. Because www redirects to the apex, every login happens on dekaapp.com.

The rate limits (30 plan calls per 10 minutes, 10 login tries per 15 minutes, per IP) live in memory. Vercel runs several instances that do not share memory, so these limits are soft: each instance counts on its own and a new instance starts at zero. The passcode is the real protection; keep it long. For a hard limit, add Vercel Firewall rate limiting on `/api/plan`.

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

## Logo and icons

Every icon and splash reference points into `public/brand/`, and the page lists them in one marked block in `public/index.html` (between `<!-- Brand:` and `<!-- End brand -->`). The files are placeholders drawn by `scripts/brand.js`:

```
public/brand/icon.svg                 browser tab icon
public/brand/icon-180.png             iPhone home screen (apple-touch-icon)
public/brand/icon-192.png             manifest icon
public/brand/icon-512.png             manifest icon
public/brand/icon-maskable-512.png    manifest icon, safe zone padded for Android masks
public/brand/splash-<w>x<h>.png       iOS launch screens, one per iPhone size (10 files)
```

To use the real logo, replace those files with the same names and sizes, then bump `CACHE` in `public/sw.js` so installed copies fetch them. Nothing else changes. If you change the list of splash sizes, edit `SPLASH` in `scripts/brand.js` and run `node scripts/brand.js`; it rewrites the brand block in `index.html`. The wordmark in the header is set in type (`.mark` in `index.html`), not an image.

## Install on iPhone

Open dekaapp.com in Safari, Share, Add to Home Screen. It opens full screen and keeps working offline. Plans made offline are by hand until you are back online. An installed copy from an older address is a separate app; add Deka again from dekaapp.com.
