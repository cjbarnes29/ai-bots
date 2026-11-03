# Progress record

Read this first. It is the verified checkpoint. Do not re-audit finished work; continue from "Next".
Update it at the end of every phase.

## Standing rules from the owner (do not break)
- **Zero spend.** Free-only mode is permanently locked ON. No paid models, paid fallbacks or automatic billing.
- **Phase 5 (approval system) is now built and tested**, so connectors may be added (Phases 6-8) ONLY behind the
  `ActionGate`. Bots still never get real tools: they ask in text. External *reads* are denied by default, enabled per bot.
  External *writes* always need the owner's approval.
- Internal bot-to-bot delegation is allowed (Phase 3), text only, platform-controlled.
- OmniRoute stays untouched and disconnected. Together AI is excluded. OpenClaw and Ollama are optional and
  need the owner's separate approval to install or download.
- **Never ask for, read or display API keys.** The owner pastes keys into the dashboard vault (Settings) or `.env`.
- **`data/` is the owner's REAL database** (it holds their bot "carlo"). Never modify or delete it. All tests and
  servers must use `:memory:` or a scratchpad database. A migration test on a COPY of it passed.
- The owner is a complete beginner: explain in plain language, one step at a time.
- Standing approval: proceed through the agreed roadmap without asking; stop only for things only the owner can do
  (keys, installs, approvals that change the safety rules).
- Approved limits live in `src/llm/limits.ts` (`DEFAULT_LIMITS`) and are tested in `src/llm/service.test.ts`.

## Completed and verified
| Phase | Commit | Notes |
|---|---|---|
| 0 Foundation | `67a4223` | TypeScript, Fastify, Git |
| 1 Agent Manager | `cae1fd5` backend, `60f7a7d` dashboard | SQLite, versions, permissions, React dashboard |
| 2 (2a-2d) AI models | `60b8000` | 4 provider plugins, free-only gate, limits, usage, chat. 180 backend + 60 dashboard tests, 12 real-browser checks |
| 3 Collaboration | `38fc8fd` | Allow-list (empty by default), task engine, Tasks page, Team tab, teamwork limits. 224 backend + 76 dashboard tests, 8 real-browser checks |
| 4 Automation | `e882c17` | Schedules (every N min / daily / once) and text triggers (event, task result), kill switch, run log. 299 backend + 103 dashboard tests, 13 real-browser checks |
| 5 Approvals + vault + audit | `2d2625a` | Approval gate, connector registry (empty), encrypted vault, audit log, Approvals page. 361 backend + 115 dashboard tests, 9 real-browser checks |
| 6 Telegram | `1c89e77` | Telegram connector (send = approval, read = per-bot permission, token in vault). 374 backend + 116 dashboard tests; fake Telegram only |

| 7 Gmail | (this commit) | Gmail connector + OAuth sign-in + dashboard panel. Fake Google only |
| 8 Browser | (this commit) | Public-https page reader + form submit (approval). Fake web only |
| 9 Installable app (PWA) | (this commit) | Manifest, icons, safe service worker. Phone/remote access NOT built (owner decision) |

Totals at this point: 441 backend + 124 dashboard tests, both builds, 9 + 9 real-browser checks (Phase 5 flow rerun; Phase 7-9 new) and a PWA check.

### Phase 7-9 facts (so they need not be re-read)
- Gmail (`src/connectors/gmail.ts`): actions search_messages (READ), read_message (READ), send_message (WRITE: 1-5 addresses, one-line subject, body <= 10000,
  header injection impossible, non-ASCII subject RFC 2047). Secrets in vault: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN (set by the
  sign-in, never pasted). Scopes: gmail.readonly + gmail.send ONLY. Routes: GET /api/gmail/status, POST /api/gmail/oauth/start (needs dashboard header),
  GET /api/gmail/oauth/callback (state single use, 10 min, max 5 waiting, PKCE S256; refuses if both scopes not granted). Access tokens in memory only.
  Redirect URI = http://127.0.0.1:${PORT||3000}/api/gmail/oauth/callback (owner uses a Desktop-app client). Google URLs fixed; only tests inject fakes
  (`buildApp({googleUrls})`, `createGmailConnector({urls})`). Dashboard: Settings > Gmail panel.
- Browser (`src/connectors/browser/`): netguard.ts (address rules + IP classification), fetcher.ts (pinned https, redirects re-checked, 1 MB/15 s, no
  cookies/compression), browser.ts (read_page READ, submit_form WRITE). Not a full browser: no JavaScript or logins; that would need installing a
  browser engine (needs the owner's approval).
- `buildApp` default connectors = [Telegram, Browser, Gmail]; `createTestApp` default = [].
- Mutation checks done: state single-use, PKCE verifier, private-address check, https-only check: each is caught by tests.
- PWA: web/public (manifest, icons made by `node scripts/make-icons.mjs`, sw.js). The service worker never touches /api. Registered in the built app only.
  `npm --prefix web run build` then `npm --prefix web run preview` serves it on 5173. Real Edge test: worker active, cache holds only shell + /assets.
- NOT verified against real services: Gmail (needs the owner's Google client + consent), Browser against the real internet (never fetched in tests),
  real Android phone.
- NOT built: phone/remote access (the backend only accepts this PC; the dashboard has no login, so opening it to a network would let anyone on it
  approve actions. See docs/PHONE-AND-REMOTE.md for the design that needs the owner's decision), inbound Gmail/Telegram polling into triggers.

### Phase 6 facts (so they need not be re-read)
- `src/connectors/telegram.ts`: actions `send_message` (WRITE, needs approval; chat = number or @name, text 1-4000) and `read_messages`
  (READ, needs per-bot read permission; up to 20 recent text messages via getUpdates WITHOUT offset, so nothing is consumed).
  Base URL fixed to https://api.telegram.org (only tests inject another). Token = vault secret `TELEGRAM_BOT_TOKEN`; it is part of the
  request URL, so connection errors are replaced by a generic message (never the real error). The connector has `notReady()`: until a
  well-shaped token is saved it is not offered to bots and requests are refused. Gate + dashboard show this.
- `buildApp` default connectors = [Telegram]; `createTestApp` default = [] (tests never get a real connector).
- Tested against a FAKE local Telegram server only. NOT verified against real Telegram (needs the owner token from @BotFather).
- NOT built: automatic inbound Telegram polling into triggers (would be a background outside read). Bots read on request only.
  Possible later with the owner approval.
- Owner steps to try it: create a bot with @BotFather, paste token in Settings > Keys, message the bot once from Telegram, switch on
  Telegram read on the bot Permissions tab if the bot should read replies, give a task like "tell me what the bot received / send X".

### Phase 5 facts (so they need not be re-read)
- Code: `src/approvals/` (`service.ts` = `ActionGate`, `protocol.ts` parses ```` ```action ```` blocks, `repository.ts`, `routes.ts`),
  `src/connectors/types.ts` (ConnectorDefinition/Registry), `src/vault/` (AES-256-GCM, key file `data/vault.key`, name bound as AAD),
  `src/audit/audit.ts` (append-only), migration `006_approvals_vault.sql`. Engine hook: `src/delegation/engine.ts` (`ActionPort`).
  Dashboard: `/approvals` page, `SecretsSection` in Settings, nav badge.
- Production has ZERO connectors (`buildApp({connectors})` injects fakes in tests). Chat never offers actions; only tasks do.
- Reads need per-bot read permission (else refused + audited). Writes ALWAYS become a pending approval; approve re-checks the
  sha256 of the stored args, runs exactly once (atomic `claimApproval`), 30 s timeout; deny/expire/double-approve never run.
  DB triggers lock request content, force the status flow and forbid deletes. Limits: 5 pending/bot, 20 requests/bot/day,
  50 reads/bot/day, 24 h expiry, 3 actions per task. Kill switch `/api/external/pause`. Results scrubbed of keys, clipped,
  and labelled to the bot as information, not instructions.
- Vault values are never returned by any API or put in audit/logs; vault is checked before `.env`.
- Mutation checks done: disabling the read-permission check (3 tests fail) and the args-hash check (1 fails) are caught.
- Browser harness (scratchpad `harness-p5.mts`) = real `buildApp` + fake connector + fake model; 9 checks passed incl. 375px.
- Found by tests: vault<->audit recursion (guard in `src/llm/secrets.ts`); log line overflow at 375px.
- NOT verified against real services (none exist yet): everything about Telegram/Gmail/browser.
- First start of a Phase 5 build on the owner's real DB applies migrations 002-006 and creates `data/vault.key`.
  Owner should back up `data/app.db*` AND keep `data/vault.key` with it.

### Phase 4 facts (so they need not be re-read)
- Code: `src/automation/` (`service.ts` is the core, `timing.ts` pure time maths, `scheduler.ts` the 30 s clock),
  migration `005_automation.sql` (tasks gain `origin`, `origin_id`, `origin_label`, `origin_depth`). Dashboard page `/automation`.
- Every automatic run goes through `TaskEngine.submit` (free-only gate, AI limits, pause, usage). Text only; no connectors.
- New schedules and triggers are created OFF. Min 15 min between runs, 20 runs/day total, 10/day per source, trigger cooldown
  >= 30 s, max 2 automatic hops, auto-OFF after 3 failures in a row. Ceilings in `src/automation/limits.ts`.
- Never replays missed runs (more than 5 min late = skipped and logged). Nothing runs while the app is stopped.
- Kill switch (`/api/automation/pause`) is separate from the AI pause switch; both are reported before cooldowns.
- The real server starts the clock (`app.automation.start()` in `server.ts`; `AUTOMATION_TICK_MS` only speeds up tests).
  `buildApp` never starts it; tests call `app.automation.tick()` with a fake clock.
- Events enter through `POST /api/events` (test form now; Telegram/Gmail will use this same door in Phases 6-7).
- Found and fixed by tests: `parseDays("")` meant Sunday; pause reason hidden behind cooldown; nav overflowed at 375px.

### Lessons (do not repeat)
- **Never rewrite files with PowerShell `Get-Content`/`Set-Content`** (it turns characters like the middle dot into garbage).
  Use the Edit/Write tools. A scan for `[âÂÃ]` finds this damage.
- The owner allowed all PowerShell calls for this project via `.claude/settings.local.json` (git-ignored).

### Phase 3 facts (so they need not be re-read)
- Delegation = a fenced ```` ```delegate ```` JSON block in a bot's TEXT reply, read by the platform. No tools are ever
  sent to a model. Code: `src/delegation/` (`engine.ts` is the core). Migration `004_delegation.sql`.
- Safeguards: allow-list per bot (`bot_delegation_targets`, audited), loop check (no ancestor), depth 2, 3 teammates
  per task, 5 tasks and 8 model calls per chain (ceilings 4/6/15/30), cancel, one chain at a time, restart marks
  unfinished tasks failed. All model calls go through `LlmService` (free-only gate, limits, pause, usage).
- Mutation checks done: removing the loop, depth or fan-out check is caught by tests.
- A layout bug (5 tabs overflowing at 375px) was found by the browser test and fixed (tab row scrolls).

## Pending
- **2e (needs the owner):** the owner creates a Gemini key (project with NO billing), puts it in `.env` as
  `GEMINI_API_KEY=`, says "ready". Then: check Gemini's current free terms/limits first, run ONE tiny real call,
  confirm the real reply and usage record. Groq and OpenRouter later, same way. Ollama only with approval.
- Owner should copy `data/app.db*` somewhere safe before first starting a new version.
- **Gmail (needs the owner):** create a Google Cloud project (free), enable the Gmail API, an OAuth client of type Desktop app, paste ID + secret in Settings, press Connect Gmail.
- **Phone/remote access (needs the owner's decision):** see docs/PHONE-AND-REMOTE.md.
- **OpenClaw (optional):** only with the owner's explicit approval to install.

## Roadmap
~~3 Collaboration~~, ~~4 Automation~~ and ~~5 Approvals~~ done -> ~~6 Telegram~~ done (see Phase 6 facts) -> ~~7 Gmail~~, ~~8 Browser~~, ~~9 installable app~~ done (phone/remote access waits for the owner) -> 10 OpenClaw (optional, needs the owner's approval to install).
Phase 5 is the gate for every external connector (now built and tested). Original design notes:
external READ off by default per bot (already in `bot_permissions`), external WRITE always needs the owner's approval each
time (`write_policy` is locked to `approval_required` in the database), full audit log, secrets vault replacing `.env` keys.
Phases 6-8 need the owner's own credentials (Telegram bot token, Google OAuth, browser) and cannot be verified against the
real services without them; build them behind the approval gate with fake local servers in tests, and say plainly what is
unverified. Phase 10 (OpenClaw) needs the owner's separate approval to install anything.

## How to work here
- Backend: `src/` (Fastify, `node:sqlite`, zod). Dashboard: `web/` (React, Vite, Tailwind 4, TanStack Query).
- `npm run check` = typecheck + all tests + build for both parts. Run the full check once before each commit;
  while developing run only the relevant test files (`npx vitest run <file>`).
- Tests use a scripted fake provider (`src/test-app.ts`, `src/llm/test-helpers.ts`) and a fake dashboard API
  (`web/src/test/fakeApi.ts`). Real-browser tests drive Edge via `playwright-core` against a fake local provider
  (scripts live in the session scratchpad, not in the repo).
- Windows/PowerShell. After `git commit`, add the required Co-Authored-By line.
