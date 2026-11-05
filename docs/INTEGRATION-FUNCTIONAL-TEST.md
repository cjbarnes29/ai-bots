# Integration functional test report (2026-11-04)

Scope: basic end-to-end testing of the Integration Setup Center. **No credentials of any kind exist on this PC** (no `.env`, no vault secrets, no Google client, no Ollama or OmniRoute running), so nothing could be tested against a real service. No real external request was made, no credential was read, changed or printed, the live app on port 3000 and `data/app.db` were not touched.

What WAS done: the real application (`src/server.ts`) was started as a separate scratch instance (ports 3102 / 3103, scratch database in the temp folder) and exercised over real HTTP against **fake local services** that behave like the providers. That proves our code paths work end to end; it does **not** prove the real services accept us. Re-run: `node scripts/e2e/routing-e2e.mjs` (37 checks) and `node scripts/e2e/mcp-n8n-e2e.mjs` (16 checks). They need free ports 3102/3103 and use no network beyond 127.0.0.1.

## Result table
| Integration | Authentication | Basic function | Result |
|---|---|---|---|
| AI Providers (Gemini, Groq, OpenRouter) | No key exists | Not possible | **BLOCKED** (no key; NV-3) |
| AI Providers (Ollama-style local, OmniRoute-style gateway) | Gateway key checked (401 on wrong key); local needs none | Connect, test, discover models, free-only gate, test chat via the real app, against FAKE servers | **PARTIAL** (real code, fake servers; no real Ollama/OmniRoute is running) |
| Automatic AI routing | n/a | See section "Automatic routing" | **PARTIAL** (logic and failover verified over HTTP against fakes; never against a real provider) |
| Telegram | No bot token | Not possible | **BLOCKED** (needs `TELEGRAM_BOT_TOKEN` from @BotFather). Unit tests with a fake Telegram pass (13) |
| Gmail | No Google client, no sign-in | Not possible | **BLOCKED** (needs `GOOGLE_CLIENT_ID/SECRET` and a sign-in; NV-4). Fake-Google unit tests pass (28) |
| Google Workspace | same | Not possible | **BLOCKED** (same client plus Drive/Calendar/Tasks APIs enabled) |
| GitHub | No token | Not possible | **BLOCKED** (needs `GITHUB_TOKEN`, fine-grained, read-only). Fake-GitHub unit tests pass |
| Notion | No token | Not possible | **BLOCKED** (needs `NOTION_TOKEN` and one explicitly shared test page). Fake-Notion unit tests pass |
| n8n | Webhook URL is the credential (none saved) | Local fake webhook: request waits for approval, fires exactly once after approval, answer recorded, unsafe address refused | **PARTIAL** (fake webhook only; no real n8n and no dedicated test workflow) |
| MCP | Bearer token checked (wrong token reported plainly) | Local fake MCP server: Test connection (initialize + tools/list), bot reads tool names, descriptions and (after this session's fix) argument schemas, `call_tool` waits for approval and never ran | **PARTIAL** (fake MCP only; no real, approved MCP server exists) |

"Connected" on a screen was never accepted as proof: every PARTIAL above rests on a request that was answered and checked, and every BLOCKED one rests on no request at all.

## Automatic routing: what works, what needs setup, what is missing
**Works automatically (verified over real HTTP against fake providers):**
- Detects available models: refresh asks each enabled provider for its list; only free-verified, switched-on models become candidates (preview lists exactly those). A billed Ollama cloud model is not offered at all; a priced or unpriced gateway model is blocked and cannot be switched on (409).
- Picks a model per kind of task (general / coding / research / light) and respects provider order and the owner's per-task first choice.
- Fails over on: 401 (auth), 429 (rate limit), 500, timeout, dropped connection, model-not-found. Each time the answer came from the next provider.
- Keeps the conversation: the stored history is sent again to the fallback (the second model saw the earlier "PINEAPPLE" turn).
- Reports who answered: every stored assistant message carries `providerId` and `modelId`; on total failure the error lists what was tried.
- No endless loops: at most `maxAttempts` (default 3) attempts per request, one provider-level retry at most, a failing provider cools down after 3 failures (breaker), limits stop the chain instead of hopping around them. With everything down, 2 upstream calls were made, then a clear 502.
- No silent paid use: no paid, unpriced or cloud-billed model was ever called; an explicit-model bot is never re-routed (503, zero calls to others); routing switched off gives a 409 explanation and makes zero calls.
- Provider status follows real calls (after a 401/500 it shows "unavailable" with the reason).

**Works only with manual configuration:**
- Ollama and OmniRoute are NOT in the default "allowed providers" (only Gemini/Groq/OpenRouter are): the owner must tick them in Settings > Model routing.
- A new model appears only after a refresh (automatic every 24 h by default, or "look for new models now"), and must be switched on unless "auto-enable newly discovered verified-free models" applies.
- Gateway models that list no price need the owner's confirmation.
- Bots must be switched on and set to `auto/...` (or the default model) by the owner.

**Missing / incomplete / limitations:**
- Never run against Gemini, Groq, OpenRouter, a real Ollama or a real OmniRoute. Model ranking relies on name-based rules of thumb.
- An authentication failure does not open the breaker by itself: until 3 failures accumulate, every new request first tries the broken provider once (one wasted call per message, then fallback). Observed, not changed.
- A 429 triggers one in-provider retry (default `retries: 1`) before failing over, so one rate-limited request costs two calls to that provider.
- Streaming, tool calls and images are not part of routing (text only).
- Context is preserved because history is re-sent from the database, not because a session moves between models; a very long history is trimmed to `historyMessages` (20).

**Does automatic switching genuinely work?** In our code, yes, as far as 37 HTTP-level checks against fake providers can show: it switches, keeps the context, reports the answerer, stops after bounded attempts and never selects a paid model. It is **not proven against any real provider** because none is connected.

## Bugs discovered
1. **MCP tool schemas were not visible** (feature gap against the stated goal "inspect tool descriptions and schemas"): `list_tools` returned names and descriptions only.
2. Observations (not fixed): auth failures keep being retried once per request (above); Ollama's cloud-billed models are silently dropped from the list rather than shown as blocked (safe, but the owner gets no explanation in the model list). The harness first failed only because its own burst exceeded the bot limit of 6 requests/minute, which is the limit working.

## Bugs fixed
- MCP `list_tools` now appends `(arguments: id:string*, limit:number)` for tools that declare `inputSchema.properties` (names and types cut to plain words, `*` = required, at most 12 per tool). Read-only; tools without a schema print exactly as before.

## Changes to existing files
- `src/connectors/integrations.ts`: new helper `mcpArgsSummary`, used in `list_tools`.
- `src/connectors/integrations.test.ts`: one new test (14 tests in the file now pass).
- New: `scripts/e2e/routing-e2e.mjs`, `scripts/e2e/mcp-n8n-e2e.mjs`, this file.
- `docs/PROGRESS.md`, `docs/HANDOVER.md`: results added.
- Not committed. (Correction, see "Round 2": the running app is `tsx watch` and had already restarted itself with the fix; the first version of this line said otherwise and was wrong.)

## Tests performed
- Scratch e2e routing: 37/37 (provider connect/test/refresh, free-only gate, ranking preview, auto-routing chat, failover on 401/429/500/timeout/drop/404, all-down, no-paid, explicit bot, manual switch, routing off, preferred model, status after failure).
- Scratch e2e MCP and n8n: 16/16.
- Related suites `src/routing src/llm src/connectors src/chat src/delegation`: 652 passed. `tsc --noEmit` clean. The full `npm run check` was not re-run (the change touches one backend file plus its test).
- Honest note: the first harness runs failed on my own mistakes (a model id assumption, then the per-minute limit). They are fixed in the harness, not in the app.

## What is needed to test the BLOCKED items later
| Item | Missing requirement | How to test later |
|---|---|---|
| Gemini / Groq / OpenRouter | Owner-created key in an account with no billing, pasted in the Integrations Center | Connect wizard, confirm free plan, Test connection, one tiny test chat; with two providers connected, make one fail (wrong key on a scratch copy, never the real one) and watch which provider answers on the bot's message |
| Ollama | Ollama installed (owner approval) and one small model pulled | Connect, tick Ollama in Model routing, test chat |
| Telegram | Bot token from @BotFather; the owner messages the bot once | Test connection (getMe), ask a bot to read messages, then an approved send to the owner's own chat only |
| Gmail / Google Workspace | Google Cloud OAuth client (ID + secret) and the owner's sign-in | Connect, check the scopes on the consent screen, search/read one message. **Draft creation does not exist** in the Gmail connector (only search, read, send), so "create a draft" cannot be tested without building it; sending needs approval and must not be used |
| GitHub | Fine-grained read-only token, one test repo | Test connection, search issues / read a file on that repo, confirm a write stays pending until approved and a repo outside the token's scope is refused |
| Notion | Internal integration secret and one page shared with it | Test connection, search, read the shared page, approved append to a test page |
| n8n | A dedicated test workflow and its test webhook URL (never a production one) | Save the URL, ask a bot to start it, approve once, check the run in n8n |
| MCP | An approved real MCP server over https or localhost HTTP (stdio is not supported) and its token if needed | Test connection (lists tools only), ask a bot to list tools, read descriptions and argument summaries; do NOT approve `call_tool` |

---

# Round 2 (2026-11-04, later the same day)

## Status of every integration (unchanged from round 1: still no real credential exists)
| Integration | Status | Why |
|---|---|---|
| AI Providers: Gemini | **BLOCKED** | No `GEMINI_API_KEY` saved (checked through the running app: key not configured). Test prepared, see below |
| AI Providers: Groq, OpenRouter | **BLOCKED** | No key |
| AI Providers: Ollama / OmniRoute | **PARTIAL** | Real code against fake local servers only; neither is installed/running (port 11434 and 20128 answer nothing) |
| Automatic AI routing | **PARTIAL** | 37/37 checks against fakes; never against a real provider |
| Telegram | **BLOCKED** | No bot token |
| Gmail | **BLOCKED** | No Google client or sign-in |
| Google Workspace | **BLOCKED** | Same |
| GitHub | **BLOCKED** | No token |
| Notion | **BLOCKED** | No token |
| n8n | **PARTIAL** | Fake webhook only; no dedicated test workflow exists |
| MCP | **PARTIAL** | Fake server only; no approved real server |
No item is PASS: PASS requires a test against a real service, and none was possible. Nothing is FAIL.

## 1. MCP input-schema fix: verified
- Unit test `list_tools shows each tool's declared arguments...` passes; the scratch end-to-end (`scripts/e2e/mcp-n8n-e2e.mjs`) shows a bot being told `read_note: Read a note by id (arguments: id:string*)`, and 16/16 pass, including "no tool ran" (`tools/call` never seen) and "`call_tool` waits for approval, stays unexecuted after denial".
- Still only against a fake MCP server. A real server's schemas (nested objects, `oneOf`) are summarised only by top-level property name and simple type; anything else shows as `any`.

## 2. Is the running application using the latest code? Yes (evidence, not assumption)
- Port 3000 is served by node PID 18936, started 23:22:19, child of `tsx watch src/server.ts` (started 18:55). `src/connectors/integrations.ts` was last written 23:22:19. The watcher restarted the app on the file change. No manual restart was done, so the app was never stopped by me. The new behaviour was not exercised on the live app itself (it has no MCP server saved, and I will not alter its credentials); it was exercised on the scratch copy running the same files.

## 3. Gemini: prepared, NOT run
- No key exists, and the project rules require the owner to approve the exact request and count first, so nothing was sent.
- `scripts/e2e/gemini-real.mjs` is ready (syntax-checked; both guards verified: without a key it prints BLOCKED, without `AWP_APPROVED_REAL_REQUESTS=4` it prints REFUSED, and in both cases nothing is sent). It uses a scratch app and scratch database, never your saved credentials, and exactly 4 requests to Google: Test connection, Refresh models, one tiny chat on one free-verified model, and one deliberately rejected call (invalid key) to prove the real fallback to a local fake model. It checks: authentication, real reply, provider/model recorded, usage record, fallback after a real rejection, status honesty, only free-verified models enabled.
- Free-tier safety already in the app: models are callable only after you confirm the Google project has no billing; daily cap 50; free-only gate cannot be switched off. The script additionally enables just one model.
- Not verifiable by anyone but you: that the Google project truly has no billing attached (NV-13). The script cannot check it.
- What the result would and would not prove: success proves our code talks to Google correctly and falls back after a real Google error; it does not prove limits, privacy terms or that free-tier use stays free.

## 4. Remaining integrations
Blocked on dedicated test credentials, none present. Exact needs are in the table at the end of round 1. Nothing was requested from the owner beyond what that table states, and no saved credential was read or changed.

## 5. No paid services or billing-enabled fallbacks: what is established
- Established by test (fakes): the free-only gate blocks priced/unpriced gateway models (409 on switch-on), Ollama cloud-billed models are never offered, explicit-model bots are never re-routed, routing off makes zero calls, no paid/unpriced/cloud model was ever called in 37 + 16 checks.
- Not established against real providers (no key). The real Gemini script above is the way to confirm it for Gemini.

## 6. Gmail draft creation: documented as a missing capability (decision pending, NOT implemented)
- The Gmail connector offers `search_messages`, `read_message` and `send_message` only. There is no draft action, and the OAuth scopes requested are read and send, so a draft cannot be made today. Building it would need a new scope (`gmail.compose` or similar), a new write action behind the approval gate and a re-consent; that is a feature decision for the owner, so it stays unbuilt. Until then the "draft creation" part of the Gmail test cannot be done and the Gmail result cannot be better than BLOCKED/PARTIAL.

## 7. Full check
`npm run check`: typecheck clean; backend 56 files, 1,413 tests passed; dashboard typecheck clean, 27 files, 293 tests passed; dashboard build succeeded (one existing bundle-size warning). Exit code 0. This verifies the code and fake-service behaviour, not any real integration.

## Files changed this round
New `scripts/e2e/gemini-real.mjs`; edited this report, `docs/PROGRESS.md`, `docs/HANDOVER.md`. No source change. Not committed.
