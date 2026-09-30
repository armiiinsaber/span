# Deka

A planner built on 10 day cycles called dekas instead of weeks, with a chat at its heart. You talk to Deka (powered by Claude) about what the next 10 days hold, it keeps your goals and schedule in shape, and you live it one day at a time.

Days are Day 1 to Day 10. Days 1 to 9 are for living the plan. Day 10 is the review, which happens in the chat.

Live at dekaapp.com. Design follows DESIGN.md in the melomaniacstudios repo and Apple's Human Interface Guidelines, summed up with how Deka applies them in `docs/apple-hig.md`.

## How it is built

```
server.js           Express app, default export: session check, rate limits, /api/config, /api/chat, /api/feedback, /api/account
lib/auth.js         Checks the Supabase session token on every request, by shared secret or published keys
lib/db.js           The server's own Postgres line: usage, the daily limit, feedback (memory when unset)
lib/storage.js      Attachments out of the private bucket, and emptying a folder and deleting a user
lib/plans.js        Plans, their limits, and list prices
supabase/           setup.sql, to run once in the SQL Editor, made from the numbered migrations beside it
vercel.json         Function max duration and static headers
lib/chat.js         Deka's system prompt, the context each turn sends, the streamed tool loop
lib/tools.js        The tools and the checks every call must pass
lib/score.js        The plan quality check that runs on every proposed schedule
lib/icons.js        The goal icons Deka may choose, with their category and planning tags
lib/validate.js     Text cleaning shared by the tools
lib/mock.js         Dev only stand in for Claude that streams and calls tools (DEKA_MOCK=1)
public/index.html   The whole app: inline CSS and JS, served as a static file
public/sw.js        Offline shell for the installed PWA
public/brand/       Every icon and iOS splash screen, built from brand/ (see Logo)
public/fonts/       Figtree for all text and Melomaniac Serif for the wordmark, self hosted as subset WOFF2
brand/              The Deka mark: the source PNG and the traced SVGs
scripts/            trace_mark.py (PNG to SVG), brand.js (SVG to icons and splash screens), icons.js (the icon sprite),
                    real-runs.js (Deka against the real API), audit.mjs (Lighthouse on every screen)
test/               node:test suites; ui.test.js drives headless Chrome; fake-supabase.js stands in for Supabase on a real
                    Postgres started from node_modules; real-runs/ holds the latest real API transcripts
```

Everything in the app speaks one visual language: a ten day strip where every session is its goal's icon. Each goal has a Phosphor icon and a category (body, people, fun, work, mind, rest) with one soft tint. A planned session is the icon in its tint, a done one fills with chartreuse, a missed one fades, and one nobody confirmed keeps a dashed outline. The strip comes in three sizes: compact on plan cards in the chat, full on the Days tab, and mini (ten dots, filled as days pass) wherever it says where you are.

The app has three tabs, shown as icons: the Deka mark, a grid of ten dots, and a target.

- **Deka**, the chat. You add goals in plain language, one at a time or as a long list. Deka answers with a goals card: every goal as its icon, name and count in dots, grouped by category, with a meter of how full the days are (daily habits are left out, since they sit in every day either way). When it is too much, the card shows a suggested trim as faded dots and "5 → 4", the meter shows the room it makes, and Use suggestion or Keep mine answers it. Saying so in words ("sounds good", "keep my numbers") does the same. Then the card settles: "Trim applied" with only the new counts, or "Kept your numbers" with the originals. Only the newest trim can be answered; an older one that was never answered goes quiet. The reply only names the reason. Deka turns them into short goals with a type (do, see or abstain) and a target, and asks one short question only when something is unclear. When the goals look complete, when you ask, or when something changes, Deka proposes a schedule as a card: the whole plan on the compact strip, changed sessions ringed, one short line under it, and Confirm and Tweak. Tap the strip to see a day with names. Nothing changes until you tap Confirm. After a check in, a confirmed change, or when you ask how it is going, a where we are card shows the day and every goal with its progress.
- **Days**, the full strip: one row per day with big icons, today highlighted. Tap an icon to check it off, tap a day to open it in a sheet with names and notes. On desktop, drag an icon to another day.
- **Goals**, every goal as its icon, name and a progress ring. Tap one to rename it, pick another icon, change its count, move a day by tapping it and then the new day, or delete it.

**Under each reply**: Copy, thumbs up, thumbs down and Retry, as in the Claude app. Copy takes only the words, not the cards. Thumbs down asks "What went wrong?" in a small sheet. Ratings stay with the message on the device, go into the export, and are posted to `POST /api/feedback`, which writes one `[feedback]` line to the server log with the rating, the reason, the reply and a timestamp, for review in Vercel's logs. Retry is on the newest reply only. It first undoes whatever that reply changed (goals, a logged day, a trim answered, a plan confirmed from it), then sends the same message again, through the same limits as any turn. A long press on your own message offers Copy.

**Attachments.** The plus in the composer opens Photos, Camera and Files. Up to 5 photos (JPEG, PNG, HEIC, WebP) or PDFs per message, shown as thumbnails above the text field; a message can be only attachments. Photos are resized on the device to 1568 px on the long edge and sent as JPEG, so HEIC converts wherever the browser can decode it (Safari can). PDFs over 3 MB and requests over 4 MB are turned away with one sentence. Claude gets photos as image blocks and PDFs as document blocks, with that message only; later turns see a note like `[Attached a photo]`. Deka reads to do lists, calendar screenshots, syllabuses and workout plans into goals and plans through the usual cards, and answers anything unrelated with one line back to the deka. Files live in IndexedDB, not localStorage, and travel in the export and import.

**Feels like an app.** Only message text, notes and fields select. Nothing else calls out or drags on a long press, except a photo opened full screen, which can be saved. A double tap never zooms, pinch zoom still does. The shell stays put and only the content scrolls, so the page never bounces.

**New deka.** A deka can end on any day. New deka in the header menu, or Start a new deka in Profile, asks whether to end with a quick review (Deka writes about 50 words on what landed so far, done out of planned per goal and one pattern, with no tools, in the old chat) or just start over. Then it asks what comes along: the same goals at full counts, only what is left of each, or nothing. The new deka starts today as Day 1 with a fresh chat, the chosen goals on a goals card and a plan from Deka; starting empty opens with the usual first question. The old deka goes to Past dekas marked "Ended on Day 5": its strip shows only the days it ran, then one quiet Ended marker, and its stats count only those days. If the quick review fails, the new deka starts anyway and its chat says "Review skipped. You were offline." or "Review didn't load." with Try again, which writes the review into the archived deka. Undo in the toast puts everything back for 8 seconds.

Profile and Past dekas sit behind the profile icon in the header. Each deka has its own chat thread; past threads stay readable in Past dekas.

**Check in.** Profile holds a daily check in time, 8:00 pm by default. The first time the app opens after that time, Deka has already asked "How did today go?". Deka logs what you say happened (tap a result on the card to correct it). If something planned that day went unmentioned, it asks about it in one short line and waits for your answer; it never assumes a session was missed, and the check in stays open until you reply. Then it proposes how the rest of the deka fits. A session nobody confirmed shows on Days as a dashed outline, not done and not missed, and the next evening's check in asks about it first. A skipped day is asked about the next evening.

**Review.** On Day 10 Deka opens the review in the chat: what held, what slipped, one pattern. It then drafts the next deka's goals and schedule. Confirming it starts the next deka with a fresh thread.

**The mark.** The ten dots of the logo are the app's only loading indicator. While Deka thinks, and while a reply streams in, a wave runs through the dots from Day 1 to Day 10. With reduced motion, the mark stays still and gently pulses instead.

**Look and feel.** Deka follows Apple's guidelines where a web app can. Text uses a scale modeled on Apple's text styles, with Body at 17 points and nothing under 11, and on iPhone it follows the text size setting. Every control is at least 44 by 44 points. Dark mode follows the system: a warm near black under ivory text, the same tints lifted, chartreuse still for done. Glass is only for what floats over content: the tab bar, the composer, toasts and sheets. Cards are solid. Sheets have a grabber, open at medium when they are tall, drag up to large and swipe down to close. Motion uses springs and never runs with Reduce Motion, where sheets and toasts fade instead. The header is static, not fixed: fixed headers near the notch drift on iPhone.

**Accounts.** Sign up with a first name, last name, username, email and confirm email, checked as you type (the username against the database), then a 6 digit code from the email. Sign in is the email and a code, or Sign in with Apple or Google, which ask only for what the provider did not give, usually the username. No passwords. Sessions last as long as they are used. Profile shows the name, username and email, lets you edit the names and username, shows the plan quietly, and has Sign out, Export my data and Delete my account, which removes every row and file after one confirmation. Everything lives in Postgres under row level security, so an account only ever sees its own rows; this device keeps a cache, so Days and Goals draw at once and everything but Deka works offline, with changes queued and sent when the connection returns. Each record carries `updated_at` and the latest change wins. A device from before accounts uploads everything it has, past dekas and attachments included, the first time it signs in, and keeps its copy as the cache.

**Light or dark.** Right after the first sign in, each account is asked once: Light, Dark, or Match my iPhone, which follows the system setting and is what a device gets until it chooses. The choice lives at the top of Profile and applies at once, with a short crossfade (none with Reduce Motion). It is saved with the data, so export and import carry it, and mirrored in `deka.theme`, which a small script in the page head reads to set the theme before anything paints. iOS launch screens can only follow the system setting, so with a choice that differs from the system, the launch screen shows the system's theme for a moment.

**The top edge.** From iOS 26, where the system finds no flat color at the top of a web app, it blurs the status bar area, and that blur reaches down over the page. Deka puts a fixed strip in the page color at the top edge, only as tall as the status bar, for iOS to read. At the top of a page it is invisible; once content scrolls up under the status bar, a few pixels of soft edge fade in below it. It never covers the header.

**Offline.** Everything except talking to Deka works offline. Messages sent offline show as waiting and send when the connection returns.

All data lives in localStorage on the device, including the chat threads, the summaries and the check in time. Export and import it as JSON under Profile. The server stores nothing.

### How Deka works

Each message is one request to `POST /api/chat`, answered as server sent events (`text`, `goals`, `log`, `proposal`, `summary`, `error`, `done`). The server is stateless: the app sends the goals, the schedule with what is done or missed, today's date, the date and weekday of every day, the last 30 messages and a summary of older ones. While a proposal card waits for Confirm, the app also sends every session on it, so a tweak adjusts that card instead of starting over. When older messages drop out of that window, Deka writes the summary itself with `save_summary`.

Claude replies in text and calls these tools:

| Tool | What it does | Checked on the server |
|---|---|---|
| `update_goals` | Adds, edits or removes goals, each with an icon, a category and planning tags (energy, social, fun, time of day, weekend) | Unique ids, a type, targets 1 to 9, never below what is already done, an icon and every tag from their allowed lists |
| `log_day` | Marks sessions done or missed on a day | Only days that have started, known goals |
| `propose_schedule` | A full schedule for what is left, with one short summary line for the card | Days 1 to 9, counts match targets, no goal twice on a day, done and missed sessions never move, nothing on a passed day |
| `suggest_trim` | Suggests lower counts when the goals do not fit, as data: each goal, its requested count and the suggested one | Known goals, requested equal to the current target, suggested from what is done (at least 1) to one below the target, each goal once |
| `resolve_trim` | Answers the open trim when you accept it or turn it down in words, the same as the two buttons | Only offered while a trim is open; its goals must still be at the requested counts |
| `show_status` | Shows the where we are card when you ask how it is going | Nothing to check |

Deka writes its reply first and then calls its tools, so words appear while the plan is built. Once the reply is written and every call passes its checks, the turn ends without another request. A call that fails its checks goes back to Claude once with the errors. If the second try fails too, the turn ends with a plain message and a Try again link, and nothing reaches the app. The app checks a proposal again when you tap Confirm, in case the plan changed by hand since.

Every valid proposal also goes through a plan quality check (`lib/score.js`). It flags fun nights on the same or back to back days, weekend plans on a weekday while a Friday or Saturday is open, a sober night on a night out or the night before one, two hard workouts on one day when the counts do not force it, heavy days back to back, and any day far above the average load, and it keeps a fun night light. If a proposal adds flags the plan before it did not have, Claude gets the flags back for one try at a better plan, and the version with fewer flags reaches the app.

### Guardrails

Deka is for the ten days and the life around them. Goals, the schedule, check ins, reviews, motivation and news that changes the plan (sick, travelling, a busy week) are in scope, and so is a short practical question tied to a goal, which gets a line or two. Anything else gets one warm line back to the deka and no attempt at the task, or a link to the plan when there is one ("want me to block two sessions for it?"). After three off topic messages in a row, Deka adds that it is built only for planning; the app counts the streak and sends it with each message, so the server keeps nothing. Deka never shares its instructions and treats text that poses as a system note as the person's own words. A message that shows real distress gets a short caring reply that suggests someone they trust and 988 (call or text, in Canada), and no planning.

Hard limits, checked on the server before any call to Claude:

| Limit | Value |
|---|---|
| Attachments | 5 per message, photos and PDFs only, a PDF up to 3 MB, the whole request under 4 MB (Vercel's limit is 4.5 MB). |
| Message length | 2,000 characters; longer gets a note to shorten it, with no call. The app stops it in the composer too. |
| Output per call, thinking included | 8,000 tokens for a normal reply, 10,000 while planning a new deka, 12,000 for the Day 10 review, about twice the most seen in real runs. A call that hits its ceiling is logged and the turn ends with the retry message. |
| Calls per turn | 4: the first, one retry for a failed call, one try at a better plan, one for a reply that was never written. Past that, the retry message. |
| Turns per account per day | 150, counted in the `usage` table by the app's date, so it holds across devices and instances. Past that: "That is all the chat for today. Everything else works by hand until tomorrow." |
| Messages per IP | 40 in 10 minutes, as before. |
| Tools | Only Deka's own: `update_goals`, `log_day`, `propose_schedule`, `show_status`, `save_summary` when older messages need it, and `mark_off_topic`, which changes nothing and only tells the app a turn was a redirect. No web search or any other tool. |

The daily count lives in the database with the rest of usage, and the plan limits live in `lib/plans.js`.

### Data from before the rename

The app was called Span. Saved data now lives under the localStorage key `deka.v1`. On first load, data under the old key `span.v1` is copied across once and the old key is left in place. The export format did not change, so files exported as Span still import.

## Environment

Set these in the Vercel project under Settings, Environment Variables, for Production and Preview.

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Server only. Never sent to the browser. |
| `SUPABASE_URL` | yes | The project URL, like `https://abcdefgh.supabase.co`. Sent to the browser through `/api/config`. |
| `SUPABASE_PUBLISHABLE_KEY` | yes | The publishable key (`sb_publishable_...`). Sent to the browser; row level security is what protects the data. For a project on the legacy keys, set `SUPABASE_ANON_KEY` to the anon key instead. |
| `SUPABASE_SECRET_KEY` | yes | The secret key (`sb_secret_...`). Server only, never sent anywhere. Reads attachments for Claude, empties a folder and deletes a user. For legacy keys, set `SUPABASE_SERVICE_ROLE_KEY` instead. |
| `DATABASE_URL` | yes | Server only. The Postgres connection string from the project's Connect dialog, the transaction pooler on port 6543. Usage and feedback. |
| `SUPABASE_JWT_SECRET` | older projects | Server only. Only for a project that still signs sessions with the legacy JWT secret; new projects publish keys instead and need nothing here. |

**Checking the setup.** `GET /api/health`, for a signed in person, lists each required setting as pass or fail with a short reason and never a value: `ANTHROPIC_API_KEY` (present, and a free test call to the models list works), `SUPABASE_URL`, the publishable and secret keys (present and the right kind), and `DATABASE_URL` (present, no placeholder like `[YOUR-PASSWORD]`, and a test query connects). Whenever a request fails because of the setup, the server logs one line naming each failing setting, like `[setup] DATABASE_URL: still has a placeholder, like [YOUR-PASSWORD]`, and the chat shows "Deka is not set up yet." with a quiet Details link to the same list.

Both key formats work. New keys are not JWTs, so Deka sends them only in the `apikey` header, and `Authorization` carries the signed in person's session or nothing; legacy JWT keys also go in `Authorization`, as Supabase expects for them. At startup and on `/api/config`, the server refuses to send the browser a secret key or a legacy service_role key, and logs a configuration error, as it does when the public and secret variables hold the same value.
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

`npm test` includes browser tests of the mobile flows in `test/ui.test.js`. They need Chrome (or set `CHROME_PATH`) and Node 22 or newer, and skip themselves otherwise. `test/webkit.test.js` types into every field in Safari's engine with an iPhone profile (keystrokes, a pasted email, an autocorrect suggestion, IME composition); it needs `npx playwright install webkit` once and skips without it.

In the composer, a phone or tablet's return key makes a new line and only the send button sends; with a physical keyboard and a mouse, Enter sends and Shift Enter makes a new line. This is read from the `hover` and `pointer` media queries, and nothing sends while an input method is composing. The composer grows to about 8 lines, then scrolls.

Fields are drawn once and never redrawn or rewritten while someone types, so iOS suggestions, autofill and composing land whole. Live checks only update the note under a field and the button; tidying a username or an email waits for blur or submit.

`vercel dev` runs the app the way Vercel does: files in `public/` are served as static files and `server.js` runs as the function. Without the CLI, `npm run dev` serves the same thing with plain Node.

With no key, `DEKA_MOCK=1 npm run dev` runs the server against a scripted stand in for Claude. Signing in still needs a Supabase project in `.env`; the browser tests instead start a stand in for Supabase on a real Postgres (see `test/fake-supabase.js`), and that is the easiest way to see every screen without a project.

After changing `lib/icons.js`, run `node scripts/icons.js` to rebuild the icon sprite in `public/index.html`, and bump `CACHE` in `public/sw.js`.

`node scripts/audit.mjs out.json` runs Lighthouse on every screen at 375, 390 and 430 px, in Safari and as the installed app, in light and dark, against the scripted stand in. It needs Lighthouse and puppeteer-core installed somewhere; point `LIGHTHOUSE_DIR` at that `node_modules` folder.

`node --env-file=.env.local scripts/real-runs.js --runs 2 --out test/real-runs` signs in as a test account on the Supabase stand in and plays the scenarios against the real API through the real server and tool loop (planning, tweaks, check ins, the Day 10 review, a long chat that needs a summary, a check in question left unanswered, two fun nights to spread, and the guardrails: off topic requests, an injection, distress, a long paste), checks each turn, and writes the transcripts with timing and cost. It costs about $0.45 a run. Set `CLAUDE_MODEL` and `CLAUDE_EFFORT` to try other setups, and `--only 11,12` to run some of them. See `test/real-runs/README.md` for the latest results.

To try the app on your phone, open your machine's LAN address on the same Wi-Fi. Mic input needs HTTPS or localhost, so over plain LAN use the keyboard's own dictation.

## How it runs on Vercel

Vercel detects Express from `server.js`. Its default export is the app, and the whole app becomes one Vercel Function. Everything in `public/` (the page, manifest, service worker, icons, fonts) is served from Vercel's CDN; `express.static` is not used there. Any path that is not a static file, including `/api/*`, reaches the function.

`vercel.json` sets `maxDuration` to 120 seconds, room for a Claude call plus one retry after a failed validation. The `*.js` key is deliberate: Vercel names the Express function `index`, so a `server.js` key does not match it. The same file carries the security and cache headers that Express sets locally, since static files skip Express on Vercel.

### Sessions and limits

The app signs in with Supabase directly, using the public key, and keeps the session in its own storage. Every call to `/api` carries the session token, and the server checks its signature (the project's published keys, or the legacy JWT secret) before doing anything. The daily turn limit counts per account in the `usage` table, so it holds across devices and server instances. The rate limits (40 chat messages per 10 minutes per IP) live in memory and are soft: each Vercel instance counts on its own. For a hard limit, add Vercel Firewall rate limiting on `/api/chat`.

Plans: each profile is `trial`, `standard` or `pro`, and a new account starts on trial with `trial_ends_at` ten days out. Until billing exists everyone keeps full access, and the plan only shows in Profile. The limits per plan (turns a day and a month) live in `lib/plans.js`, all at today's values, so turning tiers on later is a change there.

### Setting up Supabase

Everything Deka needs from Supabase, click by click. Do these in order; the first three make the app work, the rest add Apple and Google.

**1. The project, in Canada.**
1. Go to supabase.com, sign in, and press New project.
2. Name it `deka`, set a database password (keep it; it is part of `DATABASE_URL`), and for Region choose Canada (Central), which is `ca-central-1`. Press Create new project and wait for it to finish setting up.
3. In the left bar open Project Settings (the gear), then Data API, and copy the Project URL. Open Project Settings, API Keys: copy the publishable key (`sb_publishable_...`), then create or reveal a secret key (`sb_secret_...`) and copy it. On a project that still shows only the Legacy API Keys tab, copy the anon and service_role keys there instead. Under Project Settings, JWT Keys, note whether the project signs sessions with a legacy JWT secret; with signing keys, nothing more is needed.
4. Open Connect at the top of the dashboard, choose Transaction pooler, and copy the connection string; put the database password in it. That is `DATABASE_URL`.

**2. The database, from setup.sql.**
1. In the left bar open SQL Editor and press New query.
2. Open `supabase/setup.sql` from this repository, paste all of it, and press Run.
3. To confirm: in the left bar open Table Editor. You should see `profiles`, `dekas`, `goals`, `sessions`, `notes`, `messages`, `feedback` and `usage`, each with a shield icon meaning row level security is on. Open Storage: a private bucket `attachments` exists. Open Authentication, Policies: every table lists one policy, and `storage.objects` lists "attachments: own folder". Running the file again is safe.

**3. Sign in by email code.**
1. In the left bar open Authentication, then Sign In / Providers. Email is on by default. Turn off Confirm email if you want the first code to sign people straight in (Deka verifies by code either way), and leave Secure email change on.
2. Open Authentication, Emails (Email Templates). Deka sends a 6 digit code, so the template must show `{{ .Token }}`, not the link. Set both Confirm sign up and Magic Link to the same message, in Deka's voice, for example:
   Subject: `Your Deka code`
   Body:
   ```
   <p style="font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 17px; color: #141310;">Here is your code for Deka.</p>
   <p style="font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 32px; letter-spacing: .3em; color: #141310;"><strong>{{ .Token }}</strong></p>
   <p style="font-family: -apple-system, Helvetica, Arial, sans-serif; font-size: 15px; color: #6b6a64;">It works for the next hour. If you did not ask for it, you can ignore this email.</p>
   ```
3. Under Authentication, URL Configuration, set Site URL to `https://dekaapp.com` and add `https://dekaapp.com/` and `http://localhost:3000/` to Redirect URLs.
4. Under Authentication, Sessions: leave Time-box user sessions and Inactivity timeout unset (or set the inactivity timeout to one year on a plan that allows it), so a device stays signed in as long as it is used. Under Authentication, Rate Limits, the default of a few emails an hour per address is fine; raise it if sign ups stall.
5. Supabase's built in mailer is for testing only. Under Project Settings, Authentication, SMTP Settings, turn on a custom SMTP provider (Resend, Postmark, or similar) before real people sign up, with the sender `hello@dekaapp.com` or another address on the domain.

**4. Sign in with Google.**
1. In Google Cloud Console, make or pick a project, then APIs & Services, OAuth consent screen: External, app name `Deka`, support email, and `dekaapp.com` under Authorized domains. Publish it.
2. APIs & Services, Credentials, Create credentials, OAuth client ID, type Web application, name `Deka web`. Under Authorized JavaScript origins add `https://dekaapp.com`. Under Authorized redirect URIs add the callback Supabase shows (Authentication, Sign In / Providers, Google), which is `https://<project ref>.supabase.co/auth/v1/callback`. Create, and copy the Client ID and Client secret.
3. In Supabase, Authentication, Sign In / Providers, Google: turn it on, paste the Client ID and Client secret, save.

**5. Sign in with Apple.**
1. In the Apple Developer account, Certificates, Identifiers & Profiles, Identifiers, add an App ID (`com.dekaapp.ios`, or the one the App Store app will use) with the Sign In with Apple capability.
2. Identifiers again, add a Services ID: identifier `com.dekaapp.web`, description `Deka`. Turn on Sign In with Apple, press Configure, pick the App ID as primary, and under Website URLs add the domain `dekaapp.com` and the return URL Supabase shows for Apple (`https://<project ref>.supabase.co/auth/v1/callback`). Save.
3. Keys, add a key named `Deka Sign in with Apple` with Sign In with Apple turned on, configured for the App ID. Download the `.p8` file once and note the Key ID; also note the Team ID (top right of the developer account).
4. In Supabase, Authentication, Sign In / Providers, Apple: turn it on, enter the Services ID as the Client ID, and generate the secret key with the Team ID, Key ID and the `.p8` contents (Supabase's Apple page has a generator, and the secret expires every six months, so set a reminder). Save.
5. Domain verification: Apple verifies the domain through the return URL and Services ID configuration above; no file needs hosting for the web flow. If Apple asks for a verification file for an email relay, add `apple-developer-domain-association.txt` under `public/.well-known/` and redeploy.

**6. Vercel.** In the project, Settings, Environment Variables, set for Production and Preview: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (or `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` on legacy keys), `DATABASE_URL`, and `SUPABASE_JWT_SECRET` only if the project uses the legacy secret. Remove `DEKA_PASSCODE`; the passcode gate is gone. Redeploy.

**Old devices.** A device that signed in with the passcode opens on the sign in screen. Its data is still on the device, and the first sign in uploads all of it into the account, so nothing is lost; there is nothing to do on the server side to keep old sessions.

## Deploy on Vercel

1. In Vercel, Add New, Project, import `armiiinsaber/span` from GitHub. The framework preset is Express; leave build settings empty.
2. Add the environment variables from the table above, and `CLAUDE_MODEL` if you want a different model.
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

Open dekaapp.com in Safari, Share, Add to Home Screen. It opens full screen and keeps working offline.

**Sign in and saved data.** A signed in device stays signed in as long as it is used; Supabase renews the session on every use. iOS keeps Safari and the home screen app apart, each with its own sign in and its own cache, so each asks you to sign in once; the account's data comes down either way. The home screen app is the safe place for your data: Safari can clear storage for sites you have not opened in a while, while an installed app keeps it. The app also asks the browser to keep its storage where that is supported. Export a copy now and then under Profile. Plans made offline are by hand until you are back online. An installed copy from an older address is a separate app; add Deka again from dekaapp.com.
