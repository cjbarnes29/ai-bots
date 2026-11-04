# Progress record

Read this first. It is the verified checkpoint. Do not re-audit finished work; continue from "Next".
Update it at the end of every phase.

## Standing rules from the owner (do not break)
- **Zero spend.** Free-only mode is permanently locked ON. No paid models, paid fallbacks or automatic billing.
- **Phase 5 (approval system) is now built and tested**, so connectors may be added (Phases 6-8) ONLY behind the
  `ActionGate`. Bots still never get real tools: they ask in text. External *reads* are denied by default, enabled per bot.
  External *writes* always need the owner's approval.
- Internal bot-to-bot delegation is allowed (Phase 3), text only, platform-controlled.
- OmniRoute: the owner now REQUIRES it as a first-class gateway (see "OmniRoute facts"). The platform never installs, configures or modifies the owner's OmniRoute install, and tests use a pretend server only. Together AI is excluded. OpenClaw and Ollama are optional and
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

| 7 Gmail | `485a325` | Gmail connector + OAuth sign-in + dashboard panel. Fake Google only |
| 8 Browser | `485a325` | Public-https page reader + form submit (approval). Fake web only |
| 11 Android / remote access | `f3ce785` | Tailscale-only phone access with device pairing, owner-only rules, sync. Pretend Tailscale only |
| 9 Installable app (PWA) | `485a325` | Manifest, icons, safe service worker. Phone/remote access NOT built (owner decision) |

Totals after Phase 9: 441 backend + 124 dashboard tests, both builds, 9 + 9 real-browser checks (Phase 5 flow rerun; Phase 7-9 new) and a PWA check.

### Phase 11 facts: Android / remote access (owner requirement, built after OmniRoute)
- Model: the PC is the server (one DB). The phone is another client of the same API. The app still binds 127.0.0.1 only; **Tailscale Serve** (owner runs
  `tailscale serve --bg 3000`) bridges HTTPS from the tailnet. The backend now also serves the built dashboard (`web/dist`, `src/remote/dashboard.ts`, CSP, no path traversal).
- `src/remote/access.ts` (the gate): Host decides who is asking. Local names = PC (unchanged). Host in `REMOTE_HOSTS` (only *.ts.net, env, default OFF) = remote.
  Anything else = 403. Local name + proxy headers (x-forwarded-*, forwarded, tailscale-user-*) = 403 (fails closed if a proxy rewrites Host).
  Remote: API needs a paired device cookie (401 device_not_paired otherwise); change requests need the client header AND Origin == https://<host>.
- `src/remote/devices.ts` + migration `007_devices.sql`: pairing = one active code (10 chars, 5 min, single use, destroyed after 5 wrong guesses, 20 tries/min),
  device secret = 32 random bytes in an HttpOnly Secure SameSite=Strict cookie `awp_device`; DB stores sha256 only; max 10 active; 90-day idle expiry;
  DB triggers forbid delete / revive / secret change. Routes in `src/remote/routes.ts`: GET /api/session, POST /api/devices/pairing (PC only), /pair, GET /api/devices (PC only),
  DELETE /api/devices/:id (PC any; phone itself), POST /api/devices/signout.
- Phone CAN: chat, tasks, bots, schedules/triggers, approve/deny, pause. Phone CANNOT (403 owner_only): vault, providers/models/limits, bot outside-access permissions and teammate lists,
  Gmail sign-in start, pairing, switching a pause back on. Every successful remote change is audited as `remote.action` with the device name.
- Dashboard: SessionGate (unpaired phone sees only PairScreen, link `/?pair=CODE` prefills), Settings > Devices (PC: pair/revoke; phone: sign out), global 15 s refetch for cross-device sync.
- Tests: `src/remote/remote.test.ts` (42; mutation checks on auth, owner-only, proxy-header and Origin rules caught), `web/src/remote.test.tsx` (8). Real-browser run (12 checks) with a pretend
  Tailscale (HTTPS proxy adding the same headers) and a phone-sized Edge: pairing, cookie flags, sync both ways, approval from the phone, audit, owner-only refusals, 393px layout, revoke.
- NOT verified: real Tailscale Serve (exact headers/Host handling), real Android phone, installing the PWA from a real HTTPS cert (the test used a self-signed one, so the service
  worker could not register there; desktop built-app SW test passed earlier). NOT built: push notifications (needs external push services).
- Owner steps: docs/PHONE-AND-REMOTE.md.

### MASTER PLAN (owner approved Stages 1-9 on request "approve"; build in order, commit each)
Stage 1 Universal model routing (DONE, see below) -> 2 Manager AI -> 3 Tool and Skill Manager -> 4 PC agent (PowerShell, tiered permissions) -> 5 Deliverables (documents, sheets, slides, charts)
-> 6 Workflows + persistent queue -> 7 Integrations (Google Workspace, GitHub, Notion, n8n, MCP) -> 8 Memory/knowledge -> 9 Efficiency + monitoring. Principle: nothing new weakens the approval gate;
every new power is a connector behind it. Image/video/audio generation and Google API availability are "requires external verification" and must not be faked.

### Stage 1 facts: universal model routing
- Bots can have model `auto/general|coding|research|light` (validated; other `auto/...` rejected). `LlmService.complete` sends those to `ModelRouter` (`src/routing/`), everything else is a direct call as before.
  Explicit-model bots are never re-routed.
- Candidates = models that already pass the free-only policy (callable), provider allowed, not excluded, provider under its daily cap and not cooling down (breaker). Ranked by name-based rules of thumb
  (coding/large/reasoning/small) per task class; Ollama only as backup unless "prefer local". Each attempt is a normal `completeDirect` call (all limits, pause, usage records apply).
- Failover: provider-level errors (auth, quota, rate limit, network, timeout, down, circuit open) skip the whole provider; model-level (not found, unavailable, identity mismatch) skip that model;
  bot/global limits, pause, too-large, policy, bad request, content filter STOP (no hopping around limits). Max attempts 1-5 (default 3). No paid model, no account rotation.
- Settings (PC only; `/api/llm/routing`, section "Model routing" in Settings): on/off, new bots default to auto/general, auto-enable newly discovered verified-free models (never owner-confirmed gateway ones,
  never one you switched off), prefer local, allowed providers, excluded models (API), attempts, auto-refresh hours (0/6/24/168), "look for new models now", "use automatic routing for bots that have no model",
  provider health, live preview of choices. Audited (`routing.changed`, `routing.assigned`). Phones get 403 owner_only.
- Tests: `src/routing/routing.test.ts` (31) with multi-provider fakes; mutation checks (callable filter, stop-on-global-limit, provider skip, daily-cap skip, breaker skip) caught; dashboard `routing.test.tsx` (6).
  createTestApp starts with autoAssignNewBots=false (older tests expect model-less new bots).
- NOT verified against real providers (names of real free models drive the ranking heuristics).

### Stage 2 facts: the Manager AI (DONE)
- `src/manager/` (service, routes), migration 011 (manager_runs, manager_steps, manager_settings). API: GET /api/manager, PUT /api/manager/settings (PC only), POST /api/manager/runs (phone allowed),
  GET /api/manager/runs/:id, POST /api/manager/runs/:id/cancel. Dashboard: "Ask the Manager" on the Tasks page, "Manager" section in Settings.
- Flow: ONE planning call (JSON): answer directly (1 call total) or a plan of <= budget steps. Steps: Manager itself (one call) or an ALLOWED specialist bot (a normal task via TaskEngine, labelled "Manager: ...",
  so the approval gate still applies). Independent steps are started together (the engine still runs chains one at a time). ONE review call checks and combines; may redo flagged steps once (never a step that already
  asked for an outside action: no duplicate approvals). No review call if every step failed. Unreadable JSON gets one retry with the escalation model (default auto/research), never more.
- Budgets per request: model calls (default 12, ceiling 40), tokens (40k, ceiling 200k), steps (6, ceiling 10); 20 runs/day (ceiling 100), 2 at once. Exhausted -> status budget_exhausted with partial results. Specialists default to NONE.
- Restart: running runs become "interrupted" (no silent resume; Stage 6 adds queues and checkpoints). Cancel works mid-run and cancels the specialist task.
- Tests: manager.test.ts (25) with a content-aware fake model; mutation checks (specialist allow-list, no-duplicate-request rule, budget, dependency filter, duplicate ids) caught; dashboard manager.test.tsx (6).

### Stage 3 facts: Tool and Skill Manager (DONE)
- Tool registry (`src/tools/registry.ts`, GET /api/tools, POST /api/tools/refresh; Settings > Tools): an honest list with status available / needs_setup / unavailable and a reason. Checks use FIXED
  commands (node, npm, git, python, code, adb) with a 4 s timeout, plus connector readiness, AI providers and Ollama. Unbuilt things (PC agent, documents, Google Workspace, GitHub, Notion, n8n, MCP) say
  "Not built yet (Stage N)"; image/video/audio generation say "No free, verified service ... connected". The Manager plan prompt lists what exists and what does NOT, so it never plans on missing tools.
- Skill library (`src/skills/`, migration 012; Settings > Skill library): create, edit (every change a permanent version; versions/skills cannot be deleted - DB triggers), restore a version (as a NEW version),
  duplicate, archive/unarchive, export (`awp-skill@1` JSON), import (arrives OFF, unassigned), try on a sample (one limited call), enable/disable, assign to bots (max 10 per bot). Skills are TEXT only.
  Secrets (API keys, tokens, private keys) are refused in skills. Skill text is added to a bot's prompt in chat AND tasks (cap 4000 chars); a skill needing a missing tool tells the bot not to claim it used it.
- Tool access per bot (`bot_tools`): only for tools that need explicit access and are not unavailable; connectors stay with each bot's Permissions switches. Bot Permissions tab shows skills + tool access.
- Phones: read-only for skills/tools; all changes (skills, import, assignments) are owner-only (403).
- Bug found by tests and fixed: a skill PATCH with fields left out must not apply schema defaults (it would have wiped tags/tools).
- Tests: skills.test.ts (33; mutation checks on secret refusal, imported-off, enabled filter, assignable rule caught), dashboard skills.test.tsx (7).

### Stage 4 facts: PC agent / PowerShell tools (DONE; real-PC behaviour only exercised with temp folders and harmless node scripts)
- `src/connectors/pc/` (policy, paths, runner, service, connector, routes), migration 013. A connector id "pc" behind the SAME approval gate. Gate additions (apply to all connectors): `ConnectorDefinition.authorize(botId, action)`
  checked when asked, when listing offers, AND again at approval time; `ActionSpec.timeoutMs`; `ActionContext.botId`; approval now re-checks connector readiness.
- Five SEPARATE per-bot permissions (`pc_grants`): READ (list_dir, read_file, system_status; no approval), MODIFY (make_dir, write_file, delete_path = move to .awp-trash), EXECUTE (run_command, start_server),
  INSTALL (install_dependencies), ADMIN = does not exist (refused). Everything except READ always waits for the owner's approval and shows the exact command/content.
- Commands are NEVER shell strings: program + args list, program in {node, npm, git, python, adb, code}, each argument charset-restricted, per-program rules (no -e/-c/--eval/-r/--import, no npm install/exec/publish/config,
  no git push/pull/fetch/clone/reset/clean/rebase/merge/config/branch -D/checkout -f). Path-like args must be inside a workspace. Installs: named packages only, `--ignore-scripts` always, never global, pip wheels only.
- Workspaces (max 5, owner-only): not a drive root, not the user folder, not system folders, not this app's own folders. All paths resolved through real locations (links/junctions cannot escape), `..` and UNC refused,
  secrets files (.env, vault.key, *.db, keys, .npmrc...) always refused. Programs run with a clean environment (no app keys), timeout (120 s, max 300 s), output cap 16 KB, process-tree kill.
- Emergency stop (POST /api/pc/stop, phone allowed): kills everything running and blocks new work (also blocks already-approved requests); only the PC can resume. Dev servers: max 3, stop by themselves after 30 min.
- Permanent log `pc_executions` (append-only triggers) shown in Settings > PC agent; resources (CPU, memory, disk of workspaces, local AI).
- Bugs found by tests and fixed: npm package-name rule allowed a leading "-" (flag injection such as -g); delete_path "." was accepted at request time.
- Tests: policy.test.ts + pc.test.ts (193) incl. real node runs in temp folders; mutation checks (request-time authorize, approval-time re-check, link escape, env cleaning) caught; dashboard pc.test.tsx (5).
- Honest limits: `npm run <script>` runs whatever the project's package.json says (owner sees the command, not the script text); Windows .cmd launching uses the command interpreter with restricted arguments.
  NOT verified: adb, VS Code, git/python on the real PC from the app; Android builds; anything needing administrator rights (unsupported by design).

### Stage 5 facts: deliverables (DONE)
- `src/documents/` (zip, spec, office, pdf, svg, render) + connector `src/connectors/documents.ts` (id "documents"). NO new packages: the Office libraries tried (docx/exceljs/pptxgenjs/pdfkit) pulled in packages with known
  vulnerabilities (image-size, minimatch/glob via archiver), so they were NOT used; the files are written directly (npm audit stays at 0).
- Actions (all behind the approval gate; files go only into PC-agent workspace folders; uses the PC permissions MODIFY to create, READ to summarise; ".docx" etc. extension must match; no overwrite unless told):
  create_document (docx / pdf / html / md; heading, paragraph, bullets, numbered, table, chart, pagebreak), create_spreadsheet (xlsx / csv), create_presentation (pptx; chart bars drawn as shapes),
  create_chart (svg bar/line/pie), create_diagram (svg flow), summarize_data (exact stats from a .csv; no AI call).
- Safety: text is escaped for every format; no formulas ever written (xlsx text is inlineStr; csv cells starting = + - @ get an apostrophe); no macros, fields, hyperlinks, embedded objects or outside links; html page carries a
  no-scripts / no-outside-loading policy; hard limits (5000 rows, 200 blocks, 40 slides, 5 MB per file).
- VERIFIED IN REAL MICROSOFT OFFICE (COM, read-only, scratch folder): Word opened the .docx (2 tables, 2 pages, 0 fields/hyperlinks), Excel opened the .xlsx (2 sheets, number cells numbers, "=cmd|..." stayed text with no formula),
  PowerPoint opened the .pptx (4 slides). PDF is checked structurally only (xref offsets, page streams); not opened in a PDF reader here. Charts inside Word are a table of numbers (SVG file is separate).
- Tests: documents.test.ts (36) incl. a strict XML checker, package-consistency checks, PDF xref checks, gate tests.

### Stage 6 facts: workflows and persistent queue (DONE)
- Code: `src/workflows/{graph,service,routes}.ts`, migration 014 (workflows, append-only workflow_versions, workflow_runs, workflow_steps; workflows are never deleted, only archived). Dashboard: `WorkflowsSection` + `WorkflowEditor` (drag boxes with pointer events, "Arrow from/to here" buttons, live check via POST /api/workflows/validate) on the Automation page.
- Boxes: trigger (manual/event/interval>=15 min), bot_task, manager, condition, checkpoint, set, end. DAG only (loops refused), max 25 boxes/60 arrows. Templates only `{{input}}` / `{{box}}` (clipped, no code).
- Safety: new workflows are OFF; Run copies the graph so later edits never change a running run; bot tasks go through TaskEngine and the ActionGate (outside actions still need approval); a box that created an approval is never retried automatically; restart recovery never re-runs a running bot task (adopts the finished result); automation pause holds everything; event dedupe 60 s; interval triggers never replayed after downtime.
- Limits: 20 runs/day/workflow, 60 total, 5 alive, 2 concurrent, 2 parallel boxes, 30 min per run.
- Phone: can look, Run, cancel, approve/reject checkpoints; cannot create/edit/enable/archive/duplicate/retry (OWNER_ONLY_ROUTES).
- Tests: 43 backend (`src/workflows/workflows.test.ts`, with mutation checks) + 5 dashboard (`web/src/workflows.test.tsx`). Not verified in a real browser by drag yet.

### Stage 7 facts: integrations (DONE; none verified against the real services, all tested against fake servers on this PC)
- Code: `src/connectors/integrations.ts` (GitHub, Notion, n8n, MCP, Google Workspace), `integrations-access.ts` (per-bot READ switches, table `integration_access`, migration 015, routes `/api/bots/:id/integrations`, owner-only), `gmail.ts` OAuth made generic (`registerGoogleOAuthRoutes`, Gmail unchanged), vault `known()` de-duplicates shared secret names. Dashboard: `GoogleWorkspaceSection` (Settings), `BotIntegrations` (bot Permissions tab).
- Same gate as every connector: reads need the owner's per-bot switch (off by default), EVERY write waits for approval and runs once; tokens only in the vault, never in errors/results; no delete/share/invite/permission actions exist.
- GitHub (token `GITHUB_TOKEN`): search_issues, get_issue, read_file | create_issue, comment_issue. Notion (`NOTION_TOKEN`): search, read_page | create_page, append_text. n8n (`N8N_WEBHOOK_URL`): start_workflow (write). MCP (`MCP_SERVER_URL`, optional `MCP_SERVER_TOKEN`): list_tools (read) | call_tool (write, always approved). HTTP/streamable MCP only; local-program (stdio) servers are NOT supported on purpose. n8n/MCP addresses must be https or http on this PC, no name/password inside.
- Google Workspace: same Google client as Gmail, own refresh token `GOOGLE_WORKSPACE_REFRESH_TOKEN` via "Connect Google Workspace" (PKCE). Scopes: drive.readonly, drive.file, calendar.events, tasks. Reads: drive_search, drive_read (Docs/Slides as text, Sheets as CSV, text files), calendar_events, tasks_list | writes: drive_create_doc, calendar_create_event (no guests), tasks_create. NOT supported: editing existing files, Sheets cell writes, Slides editing, Forms, Gmail changes.
- Old "Not built yet (Stage 7)" tool placeholders removed; the tool list now shows the five as category integration (installed / needs setup).
- Owner must: create tokens (GitHub fine-grained PAT, Notion internal integration), paste them in the vault; for Google enable Drive/Calendar/Tasks APIs in the same Google Cloud project and press Connect Google Workspace; turn on each bot's switch.
- Tests: 12 backend (`src/connectors/integrations.test.ts`) + 4 dashboard (`web/src/integrations.test.tsx`).

### Stage 8 facts: memory and knowledge (DONE)
- Code: `src/memory/{service,connector,routes}.ts`, migration 016 (memory_notes, memory_fts (SQLite FTS5), memory_bots). Dashboard: Knowledge page (nav link), `BotMemory` on the bot Permissions tab.
- Private notes (one bot) vs shared notes (project knowledge). Only the owner creates, edits, archives or promotes shared notes ("Copy to shared knowledge" copies; the private original stays). Limits: 300 shared, 200 per bot, 4000 chars per note.
- Per bot: use own notes (default ON), use shared knowledge (default OFF). Pinned notes (capped 1500 chars) are added to the bot's prompt, labelled as reference data, not instructions.
- Bots use the "memory" connector through the gate: `recall` (read; scope notes or its OWN finished task history) and `remember` (write: needs approval, private only). Anything that looks like a key/token/password is refused on every path (create, edit, share, bot request).
- Search: FTS5 with the query reduced to plain words (no search syntax can get through). All memory routes are owner-only (a phone is refused).
- Not built: automatic summarising of tasks/workflows into notes, document chunking/embeddings (search is keyword-based). Task history search covers a bot's own completed tasks only.
- Tests: 8 backend (`src/memory/memory.test.ts`; mutation checks on the privacy filter and the secret check were caught) + 4 dashboard (`web/src/knowledge.test.tsx`).

### Stage 9 facts: application shell, Dashboard, Settings split (Phases 1-3 of docs/UI-AUDIT.md; DONE)
- Front end only: no backend, API, schema, dependency or approval-rule change. Plan, findings and deferred decisions: `docs/UI-AUDIT.md` (sections 16-17). Phases 4-9 are NOT started and wait for the owner.
- Shell: `web/src/components/shell/{AppShell,nav}.tsx` (one nav: phone bottom bar + More sheet / tablet rail / desktop sidebar), `components/{Icon,SectionTabs}.tsx`, `lib/theme.ts` (light/dark/system in localStorage; Tailwind `dark` variant is the `.dark` class on <html>).
- Routes: `/` Dashboard, `/agents` (+ `/bots/:id`, `/knowledge`), `/workflows`, `/integrations` (keys, Gmail, Google Workspace), `/automation` (Schedules), `/approvals`, `/pc` (PC agent + phones), `/monitor` + `/tasks` (Activity & Logs), `/settings/:category` (nine categories; `/usage` redirects to `/settings/ai-models`).
- Tests: `shell.test.tsx`, `dashboard.test.tsx`, `settings.test.tsx`; older tests were re-pointed to the new addresses. Real-browser layout check (Edge via playwright-core, throwaway DB, script kept in the session scratchpad): 16 pages x 7 sizes (1920x1080, 1366x768, 768x1024, 1024x768, 390x844, 360x800, 844x390) = no horizontal scroll, bottom bar/rail/sidebar sizes right, nav targets >= 44 px on touch sizes, More sheet inside the screen, dark/light/follow-device.
- Not built yet: AI Assistant page, Learning Center, integration catalog with test buttons, wizard, Workflow Studio v2.
- Phase 3.5 (housekeeping): stale location names fixed in user-facing text, comments and docs (Settings > Devices/PC agent/Manager are now PC Control Center / Settings > Agents & Permissions; provider links go to /settings/ai-models). The phone's More sheet traps focus and gives it back to the More button (tests + mutation checks for both). Phone-refusal test added for `POST /api/gmail/test-email` (mutation check: removing the guard fails it).
- Still says "bot" in page text: the bot -> agent wording change is part of Phase 5 (wizard), not done piecemeal.

### Decisions for the remaining roadmap (owner, 2026-11-04)
- Business Workforce before YouTube Studio. Start with four agents: Researcher, Lead Scout, Site Auditor, Proposal Writer. First market: UAE, with the design open to other countries.
- Leads are stored as CSV/Excel files (no database migration). YouTube: Windows speech first (Piper investigated later), manual publishing packages first, automatic upload deferred.
- Free-only until the owner approves paid services; paid-provider opt-in design stays in Phase 9; keep the model/provider layer independent. Do NOT raise provider request limits without checking real quotas and usage. Do NOT install FFmpeg, Piper or other dependencies without approval.

### Stage 10 facts: Phase 4 (Integrations Center) and the Business Workforce (7a-7f). Built and tested on FAKE data; NO real external call was made
- Phase 4: `src/connectors/catalog.ts` (GET /api/integrations, POST /api/integrations/:id/verify, owner-only), optional `verify()` on connectors (Gmail, Telegram, GitHub, Notion, Google Workspace; none for n8n/MCP = "not testable"; local ones report ready). "Verified" only after a real check; last check and last use come from the audit log (`AuditLog.latest`, `countKindSince`), no schema change. Dashboard: catalog with Test connection, details, Disconnect; `ProviderSetupGuide` (key, free-plan confirmation, test, models) on Settings > AI Models. Provider caps were NOT changed.
- Business Workforce (`src/business/`, docs/BUSINESS-WORKFORCE.md): leads in a CSV (workspace/business-workforce/leads/leads.csv, git-ignored), no migration. Website situations kept apart (none listed / confirmed none / not checked / audited / check failed). Explainable score (website 70, phone 20, address 10). Website audit with 10 fixed checks; page content never reaches an agent. Discovery from OpenStreetMap (Overpass). Staged batches (memory) + hash-bound approval for save_leads. Agents: Researcher, Lead Scout, Site Auditor, Proposal Writer (installed by an owner click, all OFF). Page: /business.
- The lock: setting `business_external_enabled` (approval_settings), OFF by default, owner-only (PUT /api/business/external), checked in the connector's authorize, the discovery client and the website fetcher. Read access reuses the agent's existing "browser" (web reading) switch because both permission tables have fixed connector lists (a new switch would need a migration).
- Real tests are WAITING for the owner's approval (exact requests listed in docs/BUSINESS-WORKFORCE.md). Unverified: that the emirate area codes work on the live map service, UAE map coverage, the service's current policy.
- Honest note: while mutation-testing, one run removed the address guard in `overpassPost` and a test then attempted a real request to a non-existent example host and a link-local address (nothing meaningful was sent). Do not mutation-test network-sending guards that way.

### Gmail "Send test email to myself"
- `POST /api/gmail/test-email {botId}` (`registerGmailTestRoute` in `gmail.ts`; owner-only, a phone is refused). Reads the signed-in address from Gmail itself (`users/me/profile`, covered by gmail.readonly), then queues an ordinary `gmail.send_message` approval to that address ONLY. Nothing is sent until the owner approves on the Approvals page. The caller cannot choose the address (strict body).
- Dashboard: Settings > Gmail panel, shown once connected (bot picker + button). Tests: 4 backend (`gmail.test.ts`), 1 dashboard (`approvals.test.tsx`). Still NOT verified against real Google.

### Inbound messages and phone alerts (approved after Phase 11)
- Inbound (`src/inbound/`, migration 009, Automation page section "Inbound messages"): a source watches Telegram (read_messages) or Gmail (unread, last day) and turns each NEW message into a text event
  (default names `telegram_message` / `gmail_message`) that the owner's triggers can use. Created OFF, PC-only to change; can be switched on only if the chosen bot has that connector's READ permission;
  reads go through the approval gate (so they count toward the bot's 50 outside reads/day; min interval 30 min); first check is a silent baseline; max 3 events per check; paused outside/automation/AI = no checks;
  3 failures or lost permission = switches itself off with a reason. Audit entries hold counts only, never message text. 17 backend + 3 dashboard tests; 4 mutation checks caught. Fake services only.
- Alerts (`src/push/`, migration 010, Settings > Alerts on this device, `web/public/sw.js` push handler): content-free Web Push, no account needed. VAPID key pair made on the PC (private half in the vault as
  PUSH_VAPID_PRIVATE_KEY). Subscriptions only for real push-service hosts (fcm.googleapis.com, Mozilla, Apple, Windows). One wake-up per newly waiting approval, max 1/min, no redirects; the phone's service worker
  asks the app how many are waiting. Revoked phones get nothing. 17 backend + 3 service-worker + 3 dashboard tests. NOT verified with a real phone / real push service.
- Real-browser regression rerun after these changes: phone flow 12/12 (now also checks /monitor and /automation at 393px) and OmniRoute 9/9 passed.
- OpenClaw (owner said "install open claw"): installed PROJECT-LOCALLY and isolated, not globally: `tools/openclaw/` (git-ignored), package `openclaw@2026.10.10`, npm `--ignore-scripts`, 360 packages, Node 24.22 OK.
  Verified: `node tools/openclaw/node_modules/openclaw/openclaw.mjs --version` -> 2026.10.10. Run it only with `USERPROFILE`/`HOME`/`OPENCLAW_STATE_DIR` pointed inside `tools/openclaw/home` so nothing is written to the user profile.
  NOT configured, NOT started, no onboarding, no daemon, no model keys, no channels. The bot runtime "openclaw" in `src/runtimes/openclaw.ts` is still the placeholder (not wired). Wiring it behind the approval gate is part of the master plan awaiting owner approval.

### Monitoring and backup facts (added after Phase 11)
- `src/monitor/monitor.ts`: GET /api/monitor/overview (read-only): bots, tasks (running / done / failed 24 h), approvals, AI calls and tokens today, automation, paired phones, the
  pause switches, a "needs your attention" list (waiting approvals, pauses, failures, schedules switched off by failures) and one mixed activity feed (tasks, approvals,
  automation problems, security events). Never contains secret values. Dashboard page `/monitor` ("Monitor" in the menu), refreshes every 5 s. Tests: 7 backend, 3 dashboard; layout checked at 393px.
- `npm run backup` (`src/backup/`): consistent copy of the database (SQLite VACUUM INTO, safe while the app runs) plus `vault.key` into `data/backups/<date_time>/`; never overwrites, never changes the original.
  3 tests. NOT run on the owner's real data folder (the owner runs it).

### OmniRoute facts (added after Phase 9, owner requirement)
- `src/llm/plugins/omniroute.ts`: provider id `omniroute`, default address http://127.0.0.1:20128/v1 (editable, must stay on this PC), key `OMNIROUTE_API_KEY`
  (vault first, then .env), kind "cloud" so it needs a key, keeps a daily cap (default 40, cannot be removed) and counts toward the overall cloud limits.
- Free rule (policy `gateway_verified_zero_price`): usable ONLY if OmniRoute lists price exactly 0 for input AND output, the id is not routing-style
  (auto, combo, fallback, router, best, any, comma/pipe lists, omniroute/...) and `owned_by` is not "combo". Unknown price = blocked. A ":free" name proves nothing.
  `checkCallable` re-checks this at call time, so a stored row cannot bypass it. Blocked models are stored (greyed out with the reason) so the owner can see why.
- Same adapter as the other providers: sends only model, messages, temperature, max_tokens, stream=false. Connection test and model discovery = existing
  Test connection / Refresh models (GET /v1/models). Refresh keeps bots and enabled choices; vanished models become unavailable and return later; a model that gains a price is blocked and switched off.
- Model identity (plugin flag `verifyReturnedModel`, gateway only): the reply's `model` must equal the requested id EXACTLY (case, spaces, prefix). Missing or different = reply discarded,
  tokens still counted, error `llm_model_mismatch`, model auto-blocked (a refresh does not re-enable it), breaker tripped. Direct providers are not subject to it (tested).
- Pricing (`verifyZeroPricing`): EVERY price-like field is checked (whole `pricing` object in any naming: prompt/completion, input/output, per token/million, request,
  image, web_search, reasoning, cache; plus top-level *cost*/*price* fields). Needs input AND output present and exactly 0; any non-zero, negative, non-numeric, null,
  "free", object, or disagreeing field blocks. Currency/unit/url style labels ignored.
- Tests: `src/llm/omniroute.test.ts` (88 tests, pretend OmniRoute server, real app + real adapter). Mutation checks on price and identity rules caught. Real-browser run (9 checks) passed.
- Owner override (approved later): a model whose ONLY problem is that no price is listed can be confirmed free by the owner on the PC (Settings > Models, explicit acknowledgement, PC-only route,
  migration `008_owner_free_models.sql`). It becomes `free_tier` + ownerVerified, stays OFF until switched on, survives refreshes while still unpriced, and is VOIDED (and audited) if OmniRoute lists a
  price, it shows a routing name, it answers as another model, or reports a cost. Never possible for priced models, routing names, combos or non-gateway providers. Tests in `omniroute.test.ts`.
- NOT verified against a real OmniRoute: its real /v1/models may not list prices. If it does not, every model shows as blocked (by design) until the owner
  decides how to authorise models (not built: "separate authorisation"). Not built: a check that the answering model equals the requested one.
- Owner steps: see docs/PROVIDERS.md.

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
- (Phone access was built later, see Phase 11.) NOT built: phone/remote access (the backend only accepts this PC; the dashboard has no login, so opening it to a network would let anyone on it
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
- **Phone access (owner does the Tailscale steps):** docs/PHONE-AND-REMOTE.md.
- **OpenClaw (optional):** only with the owner's explicit approval to install.

## Roadmap
~~3 Collaboration~~, ~~4 Automation~~ and ~~5 Approvals~~ done -> ~~6 Telegram~~ done (see Phase 6 facts) -> ~~7 Gmail~~, ~~8 Browser~~, ~~9 installable app~~ done 11 phone access done (see Phase 11 facts) -> 10 OpenClaw (optional, needs the owner's approval to install).
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
