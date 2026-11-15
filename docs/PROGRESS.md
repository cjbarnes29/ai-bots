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

### Stage 11 facts: Guardian Tier A (emergency stop, pause, owner proof). BUILT AND TESTED, UNCOMMITTED. Tier B, the VM and isolation are NOT built or verified
- Where: `src/guardian/` (core, journal, passphrase, lease, presence, process-tree, adapters, server, main, cli), `src/guardian-link.ts` (the app's view: can only look and check a proof), hooks in `src/delegation/engine.ts`, `src/automation/service.ts`, `src/approvals/service.ts`, `src/remote/access.ts`, `src/app.ts`, `src/server.ts`; dashboard `GuardianBanner`, `OwnerProofDialog`, `lib/ownerProof.ts`. Full spec, setup, recovery, limits: `docs/GUARDIAN.md`. Findings and the prepared audit: `docs/SECURITY-AUDIT.md`. Honest status: `docs/HANDOVER.md`, `TASKS.md`.
- Behaviour: four states (RUN, PAUSED, STOPPED, LOCKED); it always starts PAUSED; closed command list (no path/program/script); pause/stop need no passphrase, resume/unlock/proof need it; 10-minute owner-proof window ends on any pause; 5 wrong tries lock for 15 minutes; hash-chained journal; 30-second signed leases; STOP ends only descendants of the Manager (found by the port it listens on, must be node.exe) and never Windows or VMware programs, the Guardian or the Manager itself.
- App: with `GUARDIAN_URL` set, no new task/schedule/workflow tick/approved action starts while not RUN, running tasks stop at the next safe point (`guardian_paused`), it fails closed if the Guardian stops answering, and owner-only changes from this PC need the proof (S-13 fix). Without `GUARDIAN_URL` nothing changes and the dashboard says "Guardian not set up".
- Tests added: 35 Guardian + 3 real-Windows (harmless programs the test starts itself) + 10 integration + 9 dashboard. Lesson: a passphrase dialog that unmounts while open must settle its promise, or every later owner action hangs (fixed and tested).
- NOT done / NOT verified: Tier B (system-level, fixed commands, protected trust anchor, session helper); real lock-screen and real 15-minute behaviour (owner's manual checks); synthetic input resets the idle timer; VM suspend/stop and firewall-rule adapters (fake runners only); the elevated firewall audit A0-A13 (script prepared, NOT RUN); dedicated Windows account; VM; application discovery/Library and access policy (designed only).
- No Windows setting, service, account, firewall rule or registry value was changed; nothing was installed; no VM was created; nothing was committed or pushed.

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

## Access module: application discovery, application policy, folder permissions (2026-11-04, UNCOMMITTED)
- Built under standing authority D-041 (board D-042): `src/access/` (paths, store, folders, apps, discovery, service, routes), the PC agent and document writer gate (`src/access/gate.ts`), the Access page (`web/src/pages/Access.tsx`, `web/src/components/access/`), audit prefix listing.
- Tests: 33 + 10 backend, 10 dashboard; `npm run check` = 1,278 backend + 250 dashboard tests, builds clean. One real read-only scan on this PC (counts in `docs/ACCESS-CONTROL.md` section 5).
- NOT verified: the Access page in a real browser, OS-level enforcement (S-19), publisher signatures (S-20, NV-12). Existing PC-agent setups need a folder approval after this change (default deny).
- Tier B plan and review-only scripts prepared, not run (D-043): `docs/TIER-B-PLAN.md`, `scripts/security/tier-b/`.
- Gotcha for future work: the test temp folder is under AppData, which the access module classes as a secrets place, so tests that grant it pass `acknowledgeSensitive: "app_data"` and an expiry (see `src/access/access-integration.test.ts`).

## Settings audit: free tiers and resources (2026-11-04, UNCOMMITTED)
- `docs/SETTINGS-AUDIT.md` (board D-044, NV-13, P-18). Provider profiles (`src/llm/profiles.ts`), application-automation switch and quota exhaustion in the existing provider cards (`web/src/components/ProviderProfilePanel.tsx`), Ollama cloud-model block (`src/llm/plugins/ollama.ts`).
- Fact for future work: the model adapter is text-only (no images, no tool calls), so no provider can read a screenshot through this app yet.

## Desktop engine and the 2026-11-04 incident (UNCOMMITTED)
- `docs/DESKTOP-ENGINE.md`: architecture, safeguards, incident root causes, test evidence, limits. Code in `src/desktop/`; disposable test program `src/desktop/testapp/`; picture policy `src/llm/image-policy.ts`.
- Tests: engine 36 + connector 8 (mocked), 22 real-Windows on disposable windows, 5 picture-policy, 1 dashboard.
- Gotchas for future work: never launch by path as proof of ownership; never call the Windows host without the engine; the real-Windows suite opens windows and may take focus; paths with backslashes inside shell heredocs get mangled, use the edit tools.
- `docs/IMPLEMENTATION-MATRIX.md`: Phase 0 audit for the Bot Studio / groups / router / workflow upgrade.

## Bot Studio increment (2026-11-04, UNCOMMITTED)
- `src/bot-studio/` (templates, portable files, draft, modes, routes), `src/routing/capabilities.ts`, `ActionGate.modeBlock`, page `web/src/pages/BotStudio.tsx`, hooks `web/src/api/studioHooks.ts`. No migration.
- Tests: 17 + 4 backend (bot-studio, capabilities), 6 dashboard, 7 migration-proposal tests on scratch databases.
- `docs/MIGRATION-PROPOSAL-GROUPS.md` + `docs/proposals/017_groups*.sql` are a PROPOSAL, deliberately outside `src/db/migrations/`.
- Gotcha: `app.modelRouter` is decorated so tests can call the router with capability requirements.

## Migration 017_groups applied (2026-11-04, UNCOMMITTED)
- Owner approved revision 2 (board D-047). `src/db/migrations/017_groups.sql` = byte-identical copy of `docs/proposals/017_groups.sql`. Applied to `data/app.db` with the app stopped, after a verified backup (`data/backups/2026-11-04_184207/`) and a rehearsal on a scratch copy. All pre-existing tables and schema objects proven identical. Evidence: `docs/MIGRATION-PROPOSAL-GROUPS.md` section 11.
- Tests: `upgrade.test.ts` and `agent-manager.test.ts` expect 17 migrations; `groups-proposal.test.ts` (21 tests) builds its "before" databases at 016 with `openAt016`, pins the copy's hash, runs the real runner on a populated 016 database, and fails if any application code uses the group tables. `npm run check`: 1,394 backend + 261 dashboard, builds clean.
- **Group messaging is NOT enabled** (NV-15): next work is the group service (authorization, read visibility, participation limits, loop prevention, Guardian), each tested, then the owner's approval to switch on. When that service is added, the "no application code uses the group tables" test is changed deliberately in the same change.
- Gotcha: `openDatabase(":memory:")` now includes the group tables; a test that needs a pre-017 database uses `openAt016` in `src/db/groups-proposal.test.ts`.
- Gotcha: the real-Windows desktop suite can fail once under full-suite load ("refuses a session once the Windows host was restarted": launch returned no session); alone it passed 22/22, and the full re-run passed.

## Basic functionality check (2026-11-04, after migration 017)
- App restarted normally (`npm run dev:all`, migrations to 017, ports 3000/5173); all 38 GET endpoints answer 200; dashboard loads.
- Real state of `data/app.db`: all 5 providers OFF, no keys (vault empty, no `.env`), 0 models; 1 bot (disabled, no model); 0 approved applications, 0 folder grants; automation paused; Guardian not configured. So NO real model call is possible yet.
- End-to-end on a SCRATCH instance (port 3101, scratch database, fake OpenAI-compatible server on 127.0.0.1; script in the session scratchpad): 22/23 passed. Proven over real HTTP: provider connect/test, 3 models discovered, ranking per task class, routing to the top model, model-level fallback (404 -> next model), clear error and bounded retries when the only provider is down, single-bot chat and task, results in Tasks / task detail / Usage / Monitor / Settings in headless Edge, no console errors.
- Findings: (1) a bot cannot be set to `active` (Phase 1 lock, `ACTIVATION_AVAILABLE = false`), yet chat and tasks run on any non-archived bot whatever its status, so "disabled" is a label only; `src/agent-manager/README.md` says otherwise. (2) The real routing setting allows only gemini/groq/openrouter, so a local Ollama would never be routed until allowed. (3) After a provider failure its status still says "connected". (4) Desktop: the disposable test program has no Open button, so the engine's `file_dialog` open (read) and replacing an existing file (edit) were never run on a real window; the bot -> `action` block -> approval -> desktop engine chain has no real-window test. (5) Two stuck `vitest run src/desktop/...` processes from an earlier session keep two cores busy (stopping them was refused by the permission system; owner to decide).

## Easy AI Integration Wizard + bot status + desktop open/edit (2026-11-04, UNCOMMITTED; board D-048, D-049, S-25)
- Dashboard: `web/src/lib/integrationGuides.ts` (provider data, official links, tutorials, key check), `web/src/lib/setupProgress.ts` (resume, step numbers only, never secrets), `web/src/components/setup/` (cards, model picker, shared bits), pages `ProviderWizard.tsx` (`/integrations/connect/:provider`), `IntegrationTutorial.tsx` (`/integrations/guide/:id`), `AiSetupAssistant.tsx` (`/integrations/ai-setup`). Cards on top of the Integrations Center. Chat tab explains a switched-off bot. Routing section lists Ollama (it could never be ticked before).
- Backend: routing `preferred` + `defaultModel` (same settings row), `POST /api/llm/models/:id/try`, provider status follows real provider-level failures and recovers (`catalog.noteCallOutcome`), central bot gate `llm.setBotGate` + `runRefusal` (agent-manager), activation needs a model, only active teammates offered. "No key" messages point to the wizard.
- Desktop: Open... button in the test program; engine recognises the Open dialog (#1148), allow-list for file-dialog `inspect()` (S-25), replace prompt recognised by text; host lists owned dialogs 3 levels deep.
- Tests: new `src/llm/setup-assistant.test.ts` (9), `web/src/setupWizard.test.tsx` (12), +3 agent-manager/chat status tests, +2 mocked engine, +3 real-window; 63 bot creations in 24 test files now switch the bot on (`switchOn` in `src/llm/test-helpers.ts`), as the owner must. `npm run check`: 1,411 backend + 274 dashboard, builds clean (one earlier full run had the known real-window launch flake under load; the next full run passed). Real-browser run on a scratch instance with a fake local Ollama: 12/12 (scratchpad `e2e/wizard.mjs`).
- NOT verified: any real provider (no key exists; NV-3), a real Ollama install, provider pages' current wording/screens, screenshots in tutorials (none: they would need visiting the sites), official logos (coloured monograms instead).
- Gotcha: `src/desktop/engine.ts` contained a NUL byte (a placeholder in a removed line); it is gone. Use the edit tools; if a line will not match, check for odd bytes.

## Integration Setup Center (2026-11-04, UNCOMMITTED; board D-050)
- Field map (vault name -> integration): GEMINI/GROQ/OPENROUTER_API_KEY -> AI provider wizards; OMNIROUTE_API_KEY -> Settings (advanced gateway); TELEGRAM_BOT_TOKEN -> Telegram; GOOGLE_CLIENT_ID/SECRET -> shared Google client (Gmail + Workspace); GMAIL_REFRESH_TOKEN / GOOGLE_WORKSPACE_REFRESH_TOKEN -> set by Google sign-in only; GITHUB_TOKEN -> GitHub; NOTION_TOKEN -> Notion; N8N_WEBHOOK_URL -> n8n; MCP_SERVER_URL (+ MCP_SERVER_TOKEN, optional) -> MCP; PUSH_VAPID_PRIVATE_KEY -> phone alerts (automatic, never pasted).
- Files: `web/src/lib/serviceGuides.ts` (content, checks, tutorials), `web/src/pages/ServiceWizard.tsx` (`/integrations/setup/:id`), `web/src/components/setup/CredentialFields.tsx` (vault only, values only in memory), `GoogleSignIn.tsx` (replaces the deleted GmailSection/GoogleWorkspaceSection), `DisconnectDialog.tsx`; `IntegrationCatalog.tsx` now groups by category and adds Connect/Configure, tutorial and Disconnect (only the service's OWN values: Gmail keeps the shared Google client). Old key list: Integrations Center > Advanced (closed by default).
- Backend: MCP `verify` (initialize + tools/list, no tool call) + test in `src/connectors/integrations.test.ts`.
- Tests: `web/src/serviceWizard.test.tsx` (19); Gmail/Workspace sign-in tests moved to the wizard step; fake API reports the real Google scope URLs. Real-browser script: scratchpad `e2e/setupcenter.mjs`.
- NOT verified: the services' real sites (links not opened), real Telegram/GitHub/Notion/Google/n8n/MCP accounts.

## Integration functional test (2026-11-04, UNCOMMITTED). Full report: `docs/INTEGRATION-FUNCTIONAL-TEST.md`
- **No credentials exist** (no `.env`, empty vault, no Ollama/OmniRoute running), so every real-service test is **BLOCKED**: Gemini/Groq/OpenRouter, Telegram, Gmail, Google Workspace, GitHub, Notion. Nothing was invented; the exact missing requirement and the later test steps are in the report.
- Ran the real app as a scratch instance (ports 3102/3103, scratch DB) against FAKE local services over real HTTP: `scripts/e2e/routing-e2e.mjs` 37/37 and `scripts/e2e/mcp-n8n-e2e.mjs` 16/16. Results: automatic routing PARTIAL (switching, context kept, answerer reported, bounded attempts, no paid model; never proven against a real provider), n8n PARTIAL (approval then exactly one webhook call), MCP PARTIAL (discovery runs no tool, `call_tool` waits for approval).
- Found and fixed: MCP `list_tools` did not show tool argument schemas; it now appends a short `(arguments: name:type*)` summary (`src/connectors/integrations.ts`, +1 test). Related suites 652 passed, typecheck clean; the full `npm run check` was NOT re-run. The running app on port 3000 still has the old code until restarted.
- Observed, not changed: a failing-auth provider is tried once per request until the breaker opens (3 failures); one 429 costs two calls to that provider (1 retry); Ollama/OmniRoute are not in the default allowed providers (owner ticks them); the Gmail connector has no draft action, only search, read and send.

- **Round 2:** still no credentials, so every real-service item stays BLOCKED/PARTIAL (no PASS). Verified the MCP schema fix (unit + scratch e2e 16/16). The running app is `tsx watch` and restarted itself with the fix (PID start time = file write time), so my round-1 note that it needed a restart was wrong and is corrected. Prepared `scripts/e2e/gemini-real.mjs` (4 real requests, needs the owner key and approval, guards tested, NOT run). Gmail draft creation documented as a missing capability, deliberately not built. Full `npm run check` passed: 1,413 backend + 293 dashboard tests, typechecks, build.

## Demo mode and usability without credentials (2026-11-05, UNCOMMITTED; board D-051). Full description: `docs/DEMO-MODE.md`
- New SIMULATED provider `demo` (`src/llm/providers/demo.ts`, `plugins/demo.ts`, registered in `plugins/index.ts`, `factory.ts`; `simulated` flag on the plugin and provider view). Every reply begins with `[SIMULATED RESPONSE - no real AI was used]`. Automatic routing skips it unless ticked by name and always ranks it last (`src/routing/router.ts`); the dashboard never counts it as a connected AI. No network, no key, no migration, no dependency.
- `src/demo/` (samples, service, routes): `GET /api/demo`, `POST /api/demo/setup` (owner-only, added to `remote/access.ts`): enables the provider and creates 4 sample agents (no permissions) and 2 sample workflows through the normal services; idempotent; never overwrites edits.
- Dashboard: "Your AI right now", routing strategy, Demo card, recent workflow runs. Settings > Model routing: provider order (preferred/backups), first choice per task, default model for new agents, availability list, never-automatically per model, fallback rules and a simulated-vs-real explanation. Integrations Center: scope chip, next step, "Which services do I need?". Workflows: failed runs name the box; simulated badges.
- Bug fixed: finished workflow runs are `completed` (backend) but the Dashboard counted `done` and the Workflows page printed the raw word; the test fake had the same wrong word.
- Tests: `src/demo/demo.test.ts` (9), `web/src/demo.test.tsx` (8), existing provider-list tests updated for the sixth provider, a dated profile for it; scratch e2e `scripts/e2e/demo-e2e.mjs` (16 checks, real app over HTTP). Headless Edge opened the dashboard, workflows and settings pages on a scratch instance.
- Honest limits: nothing here involves a real AI or a real outside service (NV-3, NV-4 unchanged). Demo calls count in usage and limits. The Demo AI cannot plan, summarise or write JSON; the Manager fails clearly with it. The workflow editor was not changed and not exercised by hand in a browser. The live database was NOT touched: the demo has not been set up on it (press Set up the demo on the Dashboard to do so).

## Routing fix: a model out of free-tier quota (2026-11-05, UNCOMMITTED)
Trigger: Gemini returned a rate-limit (free-tier quota) error for `gemini/gemini-2.5-computer-use-preview-10-2025`. Reproduced with a fake Gemini (scratch script, no network): that model ranked FIRST for general tasks, one 429 wasted two calls, the provider-wide breaker opened after about 1.5 requests, and Flash/Pro (which had quota) were never tried; routing then said "connect a provider". Free-only policy was NOT involved and is unchanged.
- **Specialised models are never chosen automatically** (`traitsOf(...).specialized` in `src/routing/rank.ts`, filter in `ModelRouter.candidates`): computer-use, robotics, guard, moderation, embeddings, rerank, tts, whisper. `computer-use` is also dropped from Gemini's text-model list (`plugins/gemini.ts`). A bot can still be given such a model by hand.
- **A rate limit rests ONE model, not the provider** (`LlmService.restModel`, in memory): first 1 min, then 5, 15 and 60 min if it keeps happening; a provider "retry after" hint is used; a used-up DAILY quota (`per day`, `limit: 0`; flag `LlmError.quota`, set in `providers/openai-compatible.ts`) rests until midnight Pacific (`msUntilPacificMidnight`). A success clears it. A resting model is refused with no request sent, and skipped by the router. A restart clears it (nothing persisted; no migration).
- **No wasted retry:** a 429 is retried once only when the provider itself asks for a wait of 5 seconds or less and it is not a quota. Rate limits no longer count toward the provider-wide circuit breaker and no longer set the provider's status to "rate limited" (other errors behave as before).
- **Router:** `rate_limited` is now a model-level failure (the provider's other models are still tried); two different models of one provider limited in the same request escalate to the whole provider. When nothing was tried because everything is resting, the error is HTTP 429 "Every eligible free model is resting ... in about N seconds" instead of "connect a provider".
- **Dashboard:** Settings > Model routing > Model availability shows "Resting after a rate limit, back in about N seconds" (`cooldowns` in `GET /api/llm/routing`).
- Tests: 8 new in `src/llm/service.test.ts`, 5 in `src/routing/routing.test.ts`, 1 in `src/llm/openai-compatible.test.ts`, 1 dashboard test; 2 old expectations updated on purpose (a bare 429 is no longer retried; `failoverKind(rate_limited)` is "model"). Mutation checks (router ignores resting models; always retry a rate limit; count a rate limit toward the breaker) were caught.
- NOT verified: Gemini's real 429 body (the daily-quota wording `per day` / `limit: 0` is a pattern guess, tested only against made-up bodies); no real provider was contacted. A model that is genuinely over its daily quota rests until midnight Pacific by that same guess.
- Not done from the proposal: a per-provider:model circuit breaker (not needed once rate limits stay out of the breaker); `require: ["text"]` passed by callers (the specialised-model filter covers the observed case).

## Recommended settings system (2026-11-05, DONE for what exists, UNCOMMITTED; board D-052, P-22)
- **Backend:** `src/recommendations/` (`engine.ts`, `core.ts` 15 recommendations, `workforce.ts` 6 more, `routes.ts`). `GET /api/recommendations`, `PUT .../mode`, `POST .../apply|restore` (apply and restore owner-only in `remote/access.ts`, audited). History and mode live in the existing `llm_settings` table (no migration).
- **Phase 6 (workforce), `workforce.ts`, wired in `app.ts` after the push service:** teamwork limits (the only applicable one: values above the approved defaults come down, a stricter value is kept, so it can never loosen a limit); advice only, never applied: agents not ready (switched off / no model), which agents can read outside services, schedules that switched themselves off or automation paused, phone alerts, memory use. Nothing can change a permission, schedule, model or notification from there. VMware is not assessed.
- **Dashboard:** Settings > Recommended Settings (`web/src/pages/settings/categories.tsx`, searchable) shows `RecommendedSettings` (mode switcher, what was checked, summary, select-and-apply, change report, history with Restore) using `RecommendationCard`. `fakeApi.ts` has a small stand-in (`rec`).
- **Tests:** backend `recommendations.test.ts` (17) + `workforce.test.ts` (8); dashboard `web/src/recommendedSettings.test.tsx` (9: loading, three modes, detail per mode, apply one, apply several, no Apply where nothing can be recommended, restore from history and card, owner-only refusal shown, load failure). `npm run check`: 1,459 backend + 311 dashboard, builds clean.
- NOT verified: any real provider or phone (NV-17); the owner's real database was not touched; not looked at by hand in a browser.

## Chat, Inbox and Group chats (owner brief 2026-11-05, phases 2-5): NOT BUILT, waiting for the owner (board P-21, NV-16)
- Inspected, nothing changed. Findings: the existing chat is per bot, one request and one answer (no streaming anywhere in `src/llm`); `chat_messages` are append-only with role user/assistant; a conversation cannot be deleted (trigger) and always starts with a user message; there is no unread, pin, mute, archive or rename; no table records why a bot wrote. The group tables (migration 017) are empty and group messaging must stay off until its service is built and the owner approves (NV-15).
- Prepared: `docs/proposals/018_inbox.sql` (additive, 4 tables, `conversations` and `chat_messages` untouched, one inbox message per real event so a retry cannot post twice, hourly per-bot cap with a held-back count). NOT applied, not in `src/db/migrations/`.
- Proposed order after approval: (1) migration + inbox service (bot-initiated messages ONLY from real events: finished or failed task, approval request, failed schedule or workflow run), rate cap, preferences, tests; (2) inbox + chat UI and the ten-item navigation; (3) group service (authorization, visibility, loop guard, Guardian), then Manager-coordinated groups; (4) streaming only if a provider path can be tested with fakes.

## Studio brief, round 1 (2026-11-05, UNCOMMITTED; board D-053, NV-18, NV-19, P-21)
- **Chat error fixed (phase 7).** "The provider refused the request (HTTP 400). (Developer instruction is not enabled for this model)": every request carried a `system` message and Gemma-family models (Gemini API / gateways) accept only user/assistant turns. `src/llm/providers/instructions.ts` + `openai-compatible.ts`: models named gemma, or any model returning that refusal (one retry, remembered in memory), get all instructions inside the first user turn in a marked priority block; word for word, order kept, history, tools and approved pictures untouched; other 400s are still errors, no retry. The single adapter serves every real provider (`factory.ts`). Tests `src/llm/instructions.test.ts` (10): role kept for normal models, Gemma folded on first request, unknown model retried once then remembered, other 400 not retried, double refusal reported, tools unchanged, content preserved. The provider/model of the owner's error is inferred from the wording, not observed. A mutation check was not run.
- **Audit and integration map** (phase 1): `docs/STUDIO-INTEGRATION-MAP.md` (what to reuse, workflow node gaps, navigation mapping).
- **Migration 018 review** (phase 8): `docs/MIGRATION-018-REVIEW.md`; `docs/proposals/018_inbox_rev2.sql` checked on a scratch in-memory database (no existing object changed, idempotency, FKs, unread/mute/archive/hide, caps, integrity). NOT applied.
- **Not built:** projects, new navigation, inbox, group chat, business work from chat, unified Workflow Studio/scheduler, new Settings/Dashboard, presets. No browser verification was done. `npm run check`: 1,469 backend + 311 dashboard, builds clean.

## Migration 018 applied (2026-11-05, UNCOMMITTED; board D-054, P-23)
- Rev 2 (7 tables) applied to `data/app.db` after backup `data/backups/2026-11-05_012948` and a scratch rehearsal. Live check: 149 old objects unchanged, row counts of all 54 old tables identical, integrity ok, FK check empty. Tests: `src/db/inbox-migration.test.ts` (7: pinned copy, empty tables, event idempotency, unread/pin/mute/hide/rename, preferences and cap, project uniqueness, group state), migration lists/counts updated in `upgrade.test.ts` and `agent-manager.test.ts`, the 017 tests now accept 018 as latest. `npm run check`: 1,476 backend + 311 dashboard.
- **Nothing uses the new tables yet.** Next: the inbox and projects service (bot messages ONLY from real events, hourly cap enforced before insert, project instructions as untrusted text), then the conversation UI and navigation.
- Gotcha: `tsx watch` does not reload on a new `.sql` file; touch a `.ts` file to restart the server so the runner applies a migration.

## Decision Chalkboard request (2026-11-05; board D-055, NV-20, P-24): designed, NOT built
- See `docs/STUDIO-INTEGRATION-MAP.md` 4b. `docs/proposals/019_decisions.sql` verified on a scratch in-memory database built from the real migrations (0 existing objects changed, 22 new, 16 checks: approval needs a chosen option, chosen option must belong to the decision, reports only from assigned bots on approved decisions, history/reports append-only, nothing deletable, a retry cannot duplicate a decision). NOT applied.

## Inbox, projects and Decisions backend (2026-11-05, UNCOMMITTED; board D-056, D-057, NV-21, NV-22, P-24, P-25)
Owner's order: (1) inbox and projects backend, (2) tests and docs, (3) review 019 against the implementation, (4) Decisions backend on the task engine, (5) frontend, conversation screens and group messaging LATER.
- **Inbox** (`src/inbox/`): `postFromEvent(bot, kind, {source kind, id})` is the only way a bot message is written. `sources.ts` looks the event up and builds the text from it (finished/failed root task of that bot; pending approval of that bot, summary only; a schedule/trigger switched off after a failed run). Wrong bot, unknown id, wrong state, impossible kind/source combination: rejected, nothing written. Same event + kind: one message (`duplicate`; a different bot reporting the same event is rejected). Hourly cap per bot (default 6): over it the message is held back and recorded (`inbox_held_back`). Owner side: list with unread (bot-first messages only), views all/unread/pinned/archived, search, pin, mute, archive, hide (history kept; a new real event unhides, archived/muted stay), rename (original title kept), mark read, notification preference default + per bot (changing it is owner-only on a phone). Hooks: task engine `onRootFinished`, approval gate `onPending`. Alerts: the decision exists (`notifier`) but is NOT connected to phone alerts.
- **Projects** (`src/projects/`): CRUD, archive, search, delete = hide (exact name), link/unlink/pin conversation, workflow, schedule, task, note; one project per item; group refused (off). Chat: `projectId` on a new conversation links it; the project's description and instructions reach the bot from the first message as context that says it grants nothing (test: instructions asking for permissions change nothing).
- **Decisions** (`src/decisions/`, `relevance.ts`, `service.ts`, `routes.ts`): see `docs/STUDIO-INTEGRATION-MAP.md` 4b/4c and `docs/MIGRATION-019-REVIEW.md`. Needs migration 019 rev 2, which is NOT approved/applied; tests use `createTestApp({ withDecisions: true })` (in-memory only, `proposedSql` hook in `buildApp`).
- **Migration 019 revision 2** (changes requested on revision 1): database-level history, owner-only columns, task start states, report uniqueness, bounded disagreement (`decision_views`, `decision_participants`). A test found a hole in my first draft (a CHECK on a NULL passes in SQLite); fixed with COALESCE.
- **Tests:** inbox 22, projects 16, decisions 28, decisions SQL 11. Mutations on the Decisions service: 6 of 6 caught. `npm run check`: 1,553 backend + 311 dashboard, builds clean. The running app (port 3000, live database) was checked read-only: /api/inbox and /api/projects answer, /api/decisions is 404 as designed.
- **Findings along the way:** relevance ordering made a test script the wrong bot first (tests now pin bots); a reply to the bot's own view dropped the whole view (now only the link is dropped); pressing Start after the work finished returned an error instead of "already" (fixed); another bot reporting an already-posted event returned "duplicate" instead of being rejected (fixed); conversations created in the same millisecond sorted unstably (tie-break added); the first message of a conversation started inside a project did not get the project context (fixed).
- **Not done / limits:** no dashboard screens; groups still off; no bot-raised decisions or mid-task progress/question reports; failed workflow runs and clarification/report/note messages have no verified producer; inbox alerts not wired to phone alerts; the inbox posts a message for EVERY finished or failed root task (including tasks the owner started and Manager sub-plans), limited only by the hourly cap; nothing tried with a real model.
- Gotcha: scripted edits to files with Windows line endings (`src/remote/access.ts`) silently miss; use the edit tool or normalise first.

## Migration 019 revision 3 (2026-11-05, UNCOMMITTED; board D-058, P-24)
- Owner's review of revision 2 (probed with scratch scripts on in-memory databases and a `VACUUM INTO` snapshot of the live database made outside the project) found: INSERT OR REPLACE bypasses delete triggers (history/reports/decisions rewritable); a decision insertable as approved with a made-up option; option removal unguarded; assignment could carry another bot's task; incomplete history; unlimited progress reports; self-alternative and views on removed options; non-atomic approve. All fixed in `docs/proposals/019_decisions.sql` (revision 3, 75 objects), `src/db/database.ts` (`recursive_triggers`) and `src/decisions/service.ts` (`inTransaction`, `assign`, participants ordered by rowid), `routes.ts` (`POST /api/decisions/:id/assignments`), `remote/access.ts` (step-up). Full write-up: `docs/MIGRATION-019-REVIEW.md`.
- Tests: proposal SQL 20 (9 regression), service 34. Proven to matter: against revision 2 SQL the six SQL regression tests fail; without the pragma the C1 test fails; without transactions the R3 test fails (its first version did not, and was rewritten).
- Also found: the review loop's participant order was undefined (a test passed by luck); fixed.
- `npm run check`: 1,568 backend + 311 dashboard. Earlier in the session one full run failed twice under load (the documented real-Windows flake and the Manager "at most two at once" test, which relies on a 30 ms timer; it passes 6/6 alone and uses nothing changed here); the next full run passed.
- NOT applied. After the owner's approval: backup, rehearsal on a scratch copy, copy unchanged to `src/db/migrations/019_decisions.sql`, tests updated, restart, live proof; then the Inbox, Projects and Decisions screens (groups stay deferred).

## Continuation: provider independence and model switching (2026-11-05, UNCOMMITTED; board D-059, NV-23, NV-24, P-26, P-27)
- Reconciled with the code and with migration 019 revision 3 (preserved: not approved, not applied, live database at 018, nothing committed). Full report: `docs/MODEL-SWITCHING.md`; design: `docs/BOT-SYSTEM-DESIGN.md`.
- **Router/contract:** `OutputContract` in `CompleteInput`; auto routing treats a contract-breaking reply as a failed attempt and tries the next model; an explicit model fails with `bad_output` and is never silently replaced. New error code `bad_output`. Used by Decisions (options, views) and Bot Studio drafts.
- **Truthful record:** `delegation/engine.ts` appends "What the platform recorded (not written by the AI)" to a task result when an outside action is waiting, refused, invalid or failed, or a teammate did not finish. Four existing exact-result assertions were updated on purpose.
- **Prompt:** `INSTRUCTION_ORDER` (platform and Guardian, owner, role, task, own procedures; documents/tool results/other bots are information; owner requests are temporary until saved) in `runtimes/prompt.ts`.
- **Real finding:** the live usage log's only real requests (2026-11-04) were 4 errors: 2 `rate_limited` on a computer-use model (fixed earlier) and 2 `bad_request` on `gemini-3.5-transcribe`, a speech model offered as a chat model. Gemini and Groq plugins and the router's specialised-model filter now exclude `transcri`/`speech`. The live model rows are unchanged until Refresh models.
- **Tests:** `src/llm/model-switching.test.ts` (18; HTTP fakes behind the real adapter, router, task engine, approval gate and Decisions service; matrix printed by the run), routing +1, decisions messages updated. Mutations: 4 of 4 caught. `scripts/e2e/routing-e2e.mjs`: 37/37. `npm run check`: 1,587 backend + 311 dashboard, builds clean.
- **NOT done:** any real provider request (6 proposed, awaiting approval P-26); playbook, `config.propose`, lessons and dashboards (NV-24); migration 019 and the Inbox/Projects/Decisions screens (still waiting for the owner's approval of 019).
- Gotcha: `src/llm/service.ts` holds a raw control byte inside a regex; edit it with a byte-preserving script (latin1), not a text round trip.

## Real-provider run P-26 (2026-11-04 22:47 UTC; board NV-23, P-28)
- 5 of the 6 approved requests were sent (the 6th named the same retired model as request 1 and was held). Groq gpt-oss-20b answered correctly (OK; exact JSON). Gemini gemini-2.5-flash is retired for new users (404). Temporary Gemma-4 bot: HTTP 200 (one internal retry after a temporary provider error), no 400; but the model ignored the folded instructions and the replies were leaked `<thought>` blocks, the second unusable. Usage: Gemini 4 calls, Groq 2, cost 0; daily counters 8/50 and 2/50. Temporary bot archived. Full table and follow-ups: `docs/MODEL-SWITCHING.md` section 8.
- No code, configuration, permission, schema or migration change was made during the run. Migration 019 and Bot System Phase A were not started. Nothing committed.

## Gemini and Groq model ecosystem (2026-11-05, UNCOMMITTED; board D-060, NV-25, P-29, P-30, P-31). Full description: `docs/MODEL-REGISTRY.md`
- **P-28 done:** `src/llm/reasoning.ts` + adapter (reasoning removed at the start of a reply; reasoning-only or cut-off = `bad_output`, fails over); retirement recognised only from the provider's own words (`LlmError.retired`), recorded with the reason, no further requests, returns only after refresh + real connectivity test + full re-verification; failure categories (`classifyFailure`) never disable a model.
- **Registry:** `src/llm/registry.ts` (document in `llm_settings`, no migration), `model-kinds.ts` (15 kinds, provider data first), `evaluation.ts` (6 tests, budget-limited, stops at provider problems), `registry-routes.ts` (`GET /api/llm/registry`, owner-only `POST /api/llm/registry/evaluate`). Adapter now returns every listed model (non-chat flagged) and, for Gemini, merges the native listing (operations, windows, thinking). Catalog/router/bot assignment use `routable`. `buildApp({ verification: "off" })` is TEST-ONLY (default enforced); createTestApp uses off.
- **Utilization:** `maxParallelChains` (teamwork limits, default 1, capped by cloud slots minus one), `spreadLoad` routing option (default off) with a Recommended Settings entry. No cap was changed (P-30).
- **Dashboard:** Settings > AI Models > Model registry (filters, reasons, tests, suitability, usage, retired replacement hint, confirm-and-run tests); bot model dropdown greys out unverified/retired models.
- **Tests:** reasoning 17, registry 38, parallel chains 6, routing +2, dashboard 8 (`web/src/modelRegistry.test.tsx`); 13 of 13 mutations of the new safeguards make the suite fail (clean baseline); `npm run check`: 1,649 backend + 319 dashboard, builds clean.
- **Bugs found by the tests:** retirement pattern missed model ids with a version dot ("2.5"); retirement "return" compared timestamps that can tie (now an explicit relisted flag); a recorded failure now blocks verification (not only core tests); recorded real evidence applied to test instances that reuse model names (now only when verification is enforced); first R3-style test did not exercise what it claimed (rewritten).
- **Live:** 6 read-only model-list requests (2 refreshes of Gemini and Groq; Gemini also its native list) found ~60 Gemini and 11 Groq models; the live catalog now excludes the speech and image models and keeps retired `gemini-2.5-flash` out. Automatic routing for your five auto bots uses ONE model (`groq/openai/gpt-oss-20b`) until more are verified. No chat request was sent.
- **Not done:** real verification beyond P-26 (P-29), cap decision (P-30), enabling parallel chains/load sharing, migration 019 and the Inbox/Projects/Decisions screens, Bot System Phase A.

## P-29 real run, P-30 and migration 019 applied (2026-11-05, UNCOMMITTED; board D-061, D-062, P-32, P-33)
- **Real run (P-29):** 23 physical requests, cost 0. Verified: Groq qwen3.8-27b (6/6) and gpt-oss-120b (5/6). Unverified: gpt-oss-20b (identity: "I am ChatGPT"), gemini-3.5-flash-lite (no action block), Gemma 4 (native system role WORKS; core tests untested), gemini-3.8-flash (HTTP 503 twice). Details and table: `docs/MODEL-REGISTRY.md` section 10.
- **Code changes from the run:** probe output budgets raised (reasoning models spent the old 64 tokens on thinking); an empty or unreadable reply is a recorded test failure, not a stop; `bad_response` classified as `bad_output`; identity results older than the settled instruction role are outdated (`effectiveTest`); the dashboard shows "outdated". Tests +5 (registry now 42).
- **P-30:** the app refuses removing a cloud provider's daily cap, so the cap is 10,000 for Gemini and Groq. The per-minute limit (10) blocked two tests; unchanged.
- **Migration 019 revision 3 applied** (D-061): backup `data/backups/2026-11-05_123019`, scratch rehearsal, unchanged SQL installed, live proof (19 migrations, integrity ok, 0 FK violations, 162 existing objects unchanged, row counts identical). The `proposedSql`/`withDecisions` test hooks were removed; `decisions-proposal.test.ts` now pins the installed file to the approved SQL.
- `npm run check`: 1,654 backend + 319 dashboard, builds clean. Nothing committed.
- **Not done:** the Inbox, Projects and Decisions screens (next, and the group messaging stays deferred), Bot System Phase A, the commit review (P-33).

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

## Inbox and Projects screens (2026-11-05, UNCOMMITTED)
- Dashboard pages `web/src/pages/Inbox.tsx` and `Projects.tsx`, hooks in `web/src/api/workHooks.ts`, routes `/inbox` and `/projects`, nav entries added. Read and organise only: no way to post as a bot; project text grants no permission.
- Tests: `web/src/inboxProjects.test.tsx` (3, stubbed fetch). Dashboard typecheck clean. Full `npm run check` NOT yet re-run after this change; not opened in a real browser.
- Decisions screen added too (`pages/Decisions.tsx`, `/decisions`): ask, save draft, choose, review round, approve/reject/reopen, assignments start/repair, reports. Tests in the same file (4 total).
- Not done: Bot System Phase A, the commit review (P-33).

## P-33 review notes (2026-11-05, UNCOMMITTED)
- **Known flaky dashboard test (not fixed, not modified):** `web/src/ai.test.tsx` > "is disabled for archived bots and bots that use the uninstalled OpenClaw runtime". With vitest's default worker count (31 files in parallel) it fails on the 4 s wait for "OpenClaw runtime, which is not installed" after `router.navigate`. It passes alone, and all 323 dashboard tests pass with `npx vitest run --maxWorkers=4`. It also fails with the Inbox/Projects/Decisions test file excluded, so those changes do not cause it. Consequence: `npm run check` can exit non-zero on this machine for a timing reason; run `cd web && npx vitest run --maxWorkers=4` to tell a flake from a real failure.

## Browser test and commit preparation (2026-11-05, UNCOMMITTED; board D-063, P-33)
- **Browser test (real Edge, real app on a scratch database, a FAKE local model server only, no internet):** 50 of 50 checks pass. Covered: sidebar navigation to all three pages; empty states; Projects create/edit/archive/unarchive/delete-by-name; Decisions ask (one call per bot, nothing saved until the owner saves), save, choose, review round with a disagreement, approve (project + task created, task finished), reject and reopen, Start for an assignment that could not start, Repair for a stuck "starting" assignment (that state was put into the SCRATCH database directly, as a crash would); Inbox list, unread badge, thread, pin, archive, views, search, empty search, notification preference; phone width 393 px; no page or console errors. Screenshots are in the session scratchpad, not in the repo.
- **Two defects found by the browser test and fixed (my own new files):** (1) Inbox and Projects scrolled sideways at phone width (the list column would not shrink: `min-w-0` added to the list and detail columns, Decisions too); (2) deleting a project fired one request for the just-deleted project (404): its detail query is now removed first.
- **Not tested in a browser:** a real model (the fake answers fixed JSON), the Guardian owner-proof dialog on these screens, a real phone, project item linking beyond the unit test, the Decisions "write your own options" path (not built).
- **Phone behaviour (D-063):** intentional; paired phones may choose, approve, reject and start decision work without the PC owner proof. No Guardian or access code changed.
- **Validation:** backend typecheck clean, 1,654 of 1,654 backend tests; dashboard typecheck clean, 323 of 323 with `--maxWorkers=4`; `ai.test.tsx` alone 43 of 43 (the known flake above is unchanged and untouched). Dashboard build clean.
- **Commit preparation: BLOCKED, nothing staged.** The requested order (P-25 backend + migrations 018/019 first, then the screens, then the rest) cannot be built from this working tree without hand-composing files that never existed:
  - HEAD (`93e188d`) is behind by many programmes. The decisions backend imports `OutputContract` from `src/llm/service.ts`, which does not exist in HEAD (model-switching work, P-27); `src/app.ts` carries ~270 changed lines in which the inbox/projects/decisions hunks are interleaved with Guardian, access, desktop, recommendations and model-registry hunks; `chat/service.ts` needs `runRefusal` and project context from other work; `delegation/engine.ts` (79 lines) mixes `onRootFinished` with parallel chains (P-31); `remote/access.ts` mixes the inbox/projects/decisions routes with the Guardian step-up.
  - A scripted trial in a scratch copy (keep only the inbox/projects/decisions hunks of `app.ts`, `access.ts`) produced code that does not even parse. A correct isolation means writing intermediate versions of those files by hand and re-testing each, which would be commits that were never run together.
  - Nothing in the repository index or tree was changed by the trial.

## Commits made and final verification (2026-11-05; board D-063, D-064)
The owner authorised routine work and the dependency-ordered commits. History on top of `93e188d`:
| Commit | What | Checked on an export of exactly the commit |
|---|---|---|
| `8733e5f` | P-14 Guardian Tier A (src/guardian, guardian-link, docs, review-only scripts) | typecheck clean, 38 tests |
| `573eaf8` | P-16 Access module (src/access, AuditLog.listPrefix, ACCESS-CONTROL.md) | typecheck clean, 33 tests |
| `d2cded6` | P-20 Migration 017_groups (groups stay OFF) | typecheck clean, whole suite 1,258 tests |
| `8960389` | P-27 model switching + P-31 registry + P-25/P-23 inbox, projects, decisions backend, migrations 018/019, wiring of Guardian proof and folder grants, desktop engine, Bot Studio, demo, recommendations | typecheck clean, 69 files / 1,654 tests |
| `d3987ec` | Dashboard: Inbox, Projects, Decisions and all pending dashboard work | typecheck clean, 323 tests (`--maxWorkers=4`), build clean |
| `cd676c2` | Demo-mode fix, Decisions access tests, e2e script refresh | full check below |
Why P-27, P-31 and P-25 are one commit: they share `app.ts`, `test-app.ts`, `remote/access.ts` and ~40 tests; a trial in a scratch export showed the llm layer alone does not compile (it needs `decisions/relevance`, `runRefusal`, the `verification` option and routing changes). Documentation-only changes follow in the docs commit.

### Found and fixed while verifying (not hidden)
- **Demo mode was broken in production:** setup returned `model_not_verified` because a simulated model can never pass real-request verification. The older demo tests ran with verification OFF, which hid it. Fixed in `src/llm/catalog.ts` (the registry does not apply to the simulated provider; routing still needs the owner's tick; answers stay marked simulated); new test with verification ENFORCED.
- `scripts/e2e/routing-e2e.mjs` predated the verification rule and failed 14 checks; it now verifies its fake models through the registry's own core tests: **40/40** (401, 429, 500, timeout, dropped connection, model-not-found all fail over; priced/unpriced/cloud-billed models never called). `demo-e2e.mjs`: **16/16**. Both use fake local servers only.
- Added tests: Decisions owner-proof rules on this PC with a configured Guardian (`guardian-integration.test.ts`), paired-phone behaviour D-063 (`remote.test.ts`).

### Final validation (after `cd676c2`)
- Backend: typecheck clean; **69 files / 1,657 tests pass**.
- Dashboard: typecheck clean; **31 files / 323 tests pass** with `--maxWorkers=4`; production build clean.
- Browser (Edge, scratch DB, fake model): 50/50 on Inbox, Projects, Decisions (see above). Routing/failover e2e 40/40, demo e2e 16/16.
- **Known flaky test (unchanged, not hidden):** `web/src/ai.test.tsx` "is disabled for archived bots and bots that use the uninstalled OpenClaw runtime" can fail under the default worker count; passes alone and with `--maxWorkers=4`. Root cause not yet fixed; do not raise its timeout blindly.

### Remaining (all need the owner or are deferred; none is claimed done)
Owner actions: Tier A manual checks (NV-8), the elevated firewall audit (NV-10/P-12), Tier B design approval and each administrator step (P-17), Ollama/vision trial and Gemini key (P-18/NV-3), Google client (NV-4), real external tests (P-5), PDPL/telecom checks (NV-5/6), image terms (NV-7), D-042 design confirmation (P-16). Not built, deferred by the board: groups service (NV-15), Tier B bundle, VM, YouTube Studio, avatars, per-bot folder grants, new workflow nodes, navigation regrouping. UI gaps in Decisions/Projects: own options, assignee choice at approval, item picker.

## Groups, workforce, collaboration and the Workforce Board (2026-11-06; board D-065, NV-15; `docs/WORKFORCE.md`)
- **Audit first:** groups tables existed (migration 017) with no service; Decisions had views, two review rounds, an append-only history that already versions option wording, frozen options after approval, assignments and reports; there was **no existing Workforce Board** (built new); no divisions concept (built as a settings document, no migration).
- **Built:** `src/groups` (OFF until the owner switches on), `src/decisions/collaboration.ts` (versions, approved version, execution record, consensus, Manager loop), `src/workforce` (organisation, board, node history, layouts); dashboard pages Groups and Workforce, Decisions extras (wording versions with diffs, own options, assignees/duties at approval, agreement panel, execution record).
- **Conflicts found and resolved:** (1) the test that pinned "no code touches the group tables" now pins "only groups/service.ts" (the service refuses everything while off); (2) CLAUDE.md and board NV-15 said "not built" - updated; (3) the simple Approve button in Decisions was replaced by the planner (same API); (4) I overwrote `web/src/collab.test.tsx` (the Phase 3 tests) by mistake and restored it from git at once, nothing lost - the new tests are in `workforceCollab.test.tsx`; (5) a re-join of a group member within the same millisecond hit the membership primary key (500) - fixed; (6) the first Manager loop stopped after one round (counted rounds twice) - fixed, test added; (7) clicking a kind filter on the board first showed only that kind - now it hides it.
- **Tests:** backend +33 (collaboration 8, groups 15, workforce 9, Guardian integration for groups and Decisions) - all with a scripted FAKE provider; dashboard +7 (+9 restored). **Browser (Edge, scratch DB, fake local servers):** `scripts/e2e/groups-e2e.mjs` 44/44: groups off by default, switch, members, responsibilities, no permission granted, a group turn where the gateway failed and the local provider answered (context kept, usage recorded, priced model never called), handoff refused then allowed by the allow-list, recommendations to Decisions, Manager loop ending in a recorded hand-over to the owner, wording versions, approval with duty, execution record, Workforce Board from real records, layout saved, phone list, no sideways scrolling, no page errors.
- **Provider verification:** SIMULATED only. No real provider request was made.
- **Not done / deferred:** group `model_ref` not applied to tasks; reassigning an assigned decision duty (database rule forbids changing assignments); bots do not start handoffs themselves; Projects item picker; the owner must switch groups on.

## Real-world task milestone (2026-11-06; board D-066, P-34; `docs/REAL-TASK.md`)
- **Audit done** (table in `docs/REAL-TASK.md`). Operational with fakes unless noted: routing and failover, Manager, groups, browser read, business discovery and audit, workspace files, Excel/PDF/Word/PowerPoint. Real evidence exists only for three Groq models (P-26/P-29). Gaps: no email draft with attachments (closed), Gmail sign-in unverified, no desktop application control beyond disposable windows, no real MCP server.
- **Built:** `documents.create_email_draft` (.eml with byte-exact attachments; never sent), `src/documents/eml.ts`, `eml.test.ts` (6), the **rehearsal** `src/workforce/real-task-rehearsal.test.ts` (Manager -> two bots -> 1 map read + 10 site checks (one down) -> 3 approvals -> real xlsx/pdf/eml -> nothing sent; SIMULATED), and the prepared real-run script `scripts/e2e/real-task.mjs` (refuses to run without the owner's approved counts).
- **Finding from the rehearsal:** the Manager plan must name specialists by bot id; a name silently becomes "Manager does the step itself" (the raw action text became the step result). A real model must copy ids correctly: a risk to watch in the real run.
- **NOT done:** the real run (needs the owner's approval of exact requests, P-34). No real provider request, map request or website request was made in this milestone. No desktop application was controlled. The email was never sent.
- Backend: typecheck clean, 74 files / 1,697 tests.

### Real run attempts (2026-11-06, owner approved P-34; D-067; `docs/REAL-TASK.md` section 0)
- Two real attempts on a scratch COPY of the saved database (the original untouched): 13 real Groq requests, 1 real map request, 0 website requests, nothing sent. **No files were produced; the success criterion is NOT met.** Failures found and fixed with tests: model-written market "uae"; empty reply to the Manager review (4,000-token budget now; a failed review keeps the finished work and is labelled NOT REVIEWED); the map client now reports why it failed; the Researcher is told to use one category. Remaining: owner approval P-35 for another map request.
- Evidence: `docs/evidence/real-task-attempt1/evidence.json`, `docs/evidence/real-task/evidence.json`.

### Third real attempt and a budget overrun (2026-11-06; D-068; `docs/REAL-TASK.md` section 0b)
- 15 real Groq requests, **2 real map requests where 1 was approved (overrun by one)**, 0 website requests, no files, nothing sent. Both map searches timed out after 40 s. Cause of the overrun: the approved counts were not actually enforced (only daily limits); fixed with a platform-enforced allowance and tests (`src/business/allowance.test.ts`, 3 tests). Milestone NOT complete; next step needs a new exact approval (P-36).

### P-36 map service diagnosis (2026-11-05; D-069; `docs/REAL-TASK.md` section 0c)
- One read-only GET to the Overpass status page, 0 provider requests: no answer within 40 s (TimeoutError, no error code); no proxy configured. Groq and Google answered from the same runtime, so the cause is that overpass-api.de does not answer this PC, not query size. Next: owner browser check and an owner-approved mirror (P-37). Milestone NOT complete.

### P-37 configurable map service (2026-11-05; D-070; `docs/REAL-TASK.md` section 0d)
- Fixed list of map services (default overpass-api.de; mirror overpass.kumi.systems, not contacted). Owner-only choice, no automatic switching, health record, one-request status check that counts against the approved allowance, timeout reasons. 12 tests with fakes; no network request made. Next: P-38 (one status request to the mirror) needs the owner's approval.

### P-38 Kumi mirror check (2026-11-05; D-071; `docs/REAL-TASK.md` section 0e)
- One read-only GET to `https://overpass.kumi.systems/api/status`: no response within 15 s (TimeoutError, no error code); 0 provider requests; no search; active map service unchanged. Both Overpass hosts are silent from this PC; likely network or security-software filtering. Mirror not suitable from here. Next: owner browser check (P-39). Milestone NOT complete.

### P-40 / P-41 model switching (2026-11-05; D-072; `docs/MODEL-SWITCHING.md` last section)
- Routing history and switch record (memory + audit log), `GET /api/llm/routing/history`, dashboard panel. Tests: routing switching 9, dashboard 3, real-browser panel check (fakes). REAL: 2 Groq requests (of 8 approved), 0 Google: real task answered by Groq after an injected local failure, context kept across the switch, recovery to the preferred model; 11/11. Not shown for real: switching between two real providers (Gemini unverified, P-42).
- Full backend runs on 2026-11-05: 1,724 tests; one run fully green, two runs each had ONE different load-dependent failure (`manager.test.ts` "daily limit on runs and at most two at once", `desktop/real-windows.test.ts` "EDITS an existing file"), both pass alone and in the next full run; not touched by P-40. Recorded as known flaky under load, alongside `web/src/ai.test.tsx`.

## Shared project workspace (2026-11-05, UNCOMMITTED; board D-073, NV-26, P-43; `docs/PROJECT-WORKSPACE.md`)
- **Built:** `src/project-workspace/` (protocol, service, routes); engine hooks `taskContext` (workspace added before the first model call) and `onTaskCompleted(task, replies)` (publications read from every reply of the task); `MemoryService` workspace methods and the exclusion of workspace entries from the general knowledge paths; `projectId` on `POST /api/bots/:id/tasks`; decision tasks linked to their project; owner-only routes for check/withdraw; dashboard `components/ProjectWorkspace.tsx` on the project detail (findings, task notes, files, contributions, updates) and a project choice on the Tasks form; `createTestApp({ dbPath })` for restart tests.
- **Reuse, no new store:** entries = memory notes (scope shared, source bot) with tags; files = approved document/PC writes of the project's tasks; earlier work = tasks; membership = project task links. No migration, no dependency.
- **Tests:** backend `src/project-workspace/workspace.test.ts` 9 (acceptance: 3 agents, a real CSV through the approval gate, read back by the third agent, restart on a database file), decisions +1 assertion set; dashboard `web/src/projectWorkspace.test.tsx` 4, `inboxProjects.test.tsx` fixture answers the new workspace route. 8 of 8 mutations caught. Full run: backend 1,732/1,733 (the failure is the documented real-Windows "launch returned no session" under load; 25/25 alone), dashboard 337/337 with `--maxWorkers=4`, typechecks and build clean.
- **Gotcha:** `.gitignore` has `workspace/` (protects the leads file), which also hides any `src/**/workspace/` folder from Git; that is why the module is `src/project-workspace/`. Check `git check-ignore -v <file>` for new folders.
- **NOT verified:** a real model using the workspace; a real browser. Not covered: Manager runs, schedules, triggers, workflows and group turns do not put tasks into a project.

### Workspace real-world testing, round 1 (2026-11-05, UNCOMMITTED; board P-44)
- **Real browser + real app + FAKE local model:** `scripts/e2e/workspace-e2e.mjs` 32/32 (three agents, folder gate on the real server path, all five tabs and owner actions, Tasks form project choice, phone width, restart persistence, no console errors). Details `docs/PROJECT-WORKSPACE.md`.
- **Found and fixed:** a re-run (after a refused file) published the same recommendation and handover again; identical live entries are now rejected ("already in the workspace"). +1 unit test (workspace tests now 10).
- **Confirmed on the real server path:** an owner-approved file is not written without a folder grant (default deny holds).
- **Real providers NOT contacted:** `scripts/e2e/real-workspace.mjs` prepared (refuses without approved counts; platform-enforced caps; scratch copy deleted). Groq -> Gemini cannot happen until one Gemini model passes verification (no Gemini model is verified; P-42 folded into P-44).

### Workspace real-provider runs P-44 (2026-11-05, owner-approved twice; evidence docs/evidence/p44-real-workspace-run1.json, -run2.json)
- Requests: run 1 Groq 6 / Google 1, run 2 Groq 7 / Google 1; caps enforced by the platform; scratch copies deleted; Groq organisation id redacted from the evidence.
- PASS with real Groq: Researcher publishes honestly labelled assumptions/findings; the Analyst's answer cites them by entry number; CSV via approval + folder grant; recommendation + handover; restart persistence; the dashboard's five tabs with the real data (screenshots `docs/evidence/real-workspace/`).
- NOT achieved: Groq -> Gemini switch (Google HTTP 503 "high demand" on the verification, twice; no Gemini model verified); the real Writer (run 2) wrote the brief from the workspace but neither published nor read the CSV; the recovery task failed on Groq's free tokens-per-minute limit (8,000; recorded in run 2).
- Script fixes during the runs (no app change): the Writer now runs on Groq when Gemini is unavailable; evidence records task errors, routing attempts and workspace events. App change from this round: duplicate-entry rule (above). Open owner decisions: P-45.

## Shared workspace reliability round (2026-11-05, UNCOMMITTED; board D-074, NV-26, P-46; details `docs/PROJECT-WORKSPACE.md` "Reliability round")
- **Root causes:** the task prompt told agents with actions "you have no tools"; reading required files and saving results were optional and never checked; the router's final error dropped the provider's wait time (and ignored resting models); Groq's "model called a tool" 400 stopped routing; earlier results were repeated (and could be stale) or, after a first fix, hidden when only a handover was saved; nothing looked at numbers.
- **Built:** truthful ground rule (`runtimes/prompt.ts` `actions` option); required-file reads for the agent through the gate (`WorkspaceDeps.readFile` in `app.ts`); required result + named handovers with one corrective request and `workspace_not_saved` (engine `taskOutcome`/`settle`, `TaskFailure.partial` keeps the text); leaner context + read-only `workspace` connector (`project-workspace/connector.ts`, `ActionContext.taskId`); number checks (`project-workspace/numbers.ts`); rate-limit waits in the engine (`rateLimitWait`, `EngineDeps.sleep`), retry hint kept by the router, "try again in Xs" read from provider text (`retryHintInText`); Groq tool-call 400 -> `bad_output`; dashboard: warnings on entries, "must save" checkbox on the Tasks form.
- **Tests:** `src/project-workspace/reliability.test.ts` (30), `context-size.test.ts` (1, measures and pins the context share), workspace tests updated to the new format, `openai-compatible.test.ts` +1, `gmail.test.ts` connector list (+workspace, deliberate), dashboard `projectWorkspace.test.tsx` +2. Mutations: 18 of 18 caught. Final: backend 1,766/1,766, dashboard 339/339 (`--maxWorkers=4`), typechecks and build clean, browser e2e `scripts/e2e/workspace-e2e.mjs` 32/32 (fake model).
- **Real Groq (Groq only, <= 12 per run, 0 Google):** runs 3-7 used 7, 10, 10, 10, 10 requests; runs 3-6 each failed on a different real defect (fixed); run 7 passed the whole chain once (17/18, the 18th is the Gemini step). Evidence `docs/evidence/p44-real-workspace-run3.json` ... `run7.json` (account ids redacted by the script).
- **Gotchas:** shell one-liners (`node -e`, heredocs) strip backslashes in this environment: a regex lost its escapes and `\b` became a backspace byte (found by a test). Write patch scripts with the Write tool, or use the Edit tool. Groq's free tier allows ~8,000 tokens per minute per model; back-to-back workspace tasks now WAIT rather than fail, so a chain can take minutes.

## Studio redesign, phase 1 (2026-11-06, UNCOMMITTED; board D-075, NV-19; plan `docs/REDESIGN-PLAN.md`)
- **Built (dashboard only, no backend, no dependency, no migration):** nine-section navigation drawn from one list (`web/src/components/shell/nav.ts`; longest-prefix match so /settings/ai-models is AI Models); secondary section tabs and breadcrumbs; open-workspace tab strip (session storage only); sidebar fold (remembered in this browser); motion system in `index.css` (tokens for the brief's durations, transform/opacity only, one easing, `prefers-reduced-motion` block); honest Creative Studio page (`pages/Creative.tsx`). Approvals badge moved to Monitoring. Every old route still works.
- **Tests:** dashboard 348/348 (was 339). Existing navigation tests changed because link names changed (shell, ai, approvals, automation, business, collab, access, monitor); `test/setup.ts` now clears sessionStorage. New tests pin the nine sections, route coverage, tabs, breadcrumbs, fold, workspace tabs, Creative honesty and the reduced-motion CSS.
- **Real browser:** `scripts/e2e/redesign-e2e.mjs` 36/36 (real app, scratch database, Edge): 21 pages at 360, 430, 768, 1024, 1440 and 1920 px with no sideways overflow, the right navigation shape per size, touch-sized targets on phones, animation 300 ms and off with reduce-motion.
- **NOT done / NOT verified:** phases 2-6 (dashboard cards, agent/model/integration workspaces, workflow animation and phone editor, split panes, shared Card/Modal/Drawer components); no real phone or tablet device; screenshots reviewed by me only.

### Phase 2: Dashboard and Monitoring (2026-11-06)
- **Built:** shared UI in `web/src/components/ui/` (`Tabs`/`TabPanel` with arrow keys, `StatCard`, `StatusDot`, `StackedBar`, `Skeleton`, `Panel`) plus CSS for value pop, bar easing, skeleton and stagger. Dashboard keeps every existing card and adds a Task execution bar (24 h, live dot while tasks run) and an Application connections box. Activity & Logs is now four tabs: Overview (unchanged), Activity log (filter by kind, problems only), Running work (tasks and workflow runs with step bars), Resources (AI calls bar, tokens, automation, providers; CPU/memory are NOT measured and the page says so).
- **Tests:** dashboard 356/356 (+8 in `phase2.test.tsx`); browser script 48/48 (adds the Dashboard boxes and the four Monitoring tabs at six sizes). No backend change.

### Phase 3: Agents, AI Models, Integrations (2026-11-06)
- **Built:** AI Models workspace at `/models` (`pages/Models.tsx`): five tabs (Providers, Models & testing, Routing & fallback, Usage, Limits & safety) built from the ORIGINAL Settings components, so no logic was copied; Settings > AI Models still shows all sections and links to the workspace; `/settings/ai-models` and `/usage` keep working and belong to the AI Models section. Agent workspace: the bot editor now uses the shared `Tabs` (arrow keys) and has a History tab (`BotHistory`: the agent's tasks from the same task list, bar of finished/failed/working). Agent list: search by name or role and status filter, cards lift and stagger in. Integrations Center: search and status filter (All / Connected / Needs setup / Problem). Chip labels use 'Disabled only' etc. so they do not collide with status badges.
- **Tests:** dashboard 363/363 (+7 in `phase3.test.tsx`); one existing check (`serviceWizard.test.tsx`, 'no credential box until a service is chosen') now ignores `type=search` inputs and still requires every other input to sit inside Advanced; browser script 54/54. No backend change.
- **Not built (stated plainly):** the agent builder is the existing Details/Permissions tabs (no new builder); 'agent communication visualisations' and 'agent knowledge' beyond the existing Memory section are not new; resizable split panes arrive with phase 4.

### Phase 4: Workflows (2026-11-06)
- **Built:** reusable `SplitPane` (`ui/SplitPane.tsx`: draggable divider with arrow keys, 25-75 %, two columns from 1024 px and stacked below, not stored anywhere), used in the workflow editor between the drawing and the box/arrow panels. Read-only `WorkflowRunMap` shown when a run is opened: boxes coloured and named by state (finished, running, waiting for you, failed, skipped, not reached), arrows that were followed turn green and animate (dash flow) only while the run is alive; an unknown status is never shown as finished; the drawing is the workflow's CURRENT version, matched to the run by box id. Phone editor: a list view (`StepList`) of the same boxes in running order with 44 px buttons and two-tap arrows, chosen automatically under 768 px (`useNarrow`) and switchable on any screen with 'Show as a list' / 'Show as a drawing'; the drawing and the list edit the same data and save as one workflow.
- **Tests:** dashboard 373/373 (+10 in `phase4.test.tsx`); browser script 69/69 (editor view per size, divider visible from 1024 px, real mouse drag and keys on the divider, touch-size list buttons, no overflow). No backend change.
- **Not built:** a drag-and-drop animation of NEW connections being drawn (arrows appear when created; the connect mode has the amber hint); live per-node progress for runs is limited to the step statuses the server records; no workflow templates (none existed; the board lists them as not built).

### Phase 5: Knowledge Center, Settings, Creative Studio (2026-11-06)
- **Built:** Knowledge Center has three tabs: Shared notes, Agent knowledge (the tabs drive the same note scope as the existing selector, so the notes page is unchanged), and Files & documents (`KnowledgeFiles`: says there is no file browser and links to Access, Projects and Creative Studio, the places that really handle files). Creative Studio has four tabs (Overview, Documents, Content drafting, Image/video/audio): numbered 'how to do it today' steps with links for what works, and for the three unconnected functions only 'Not connected' cards with no button or link. Settings: a category fades in when chosen and the category links ease.
- **Tests:** dashboard 379/379 (+6 in `phase5.test.tsx`); browser script 75/75 (Knowledge and Creative tabs plus all ten Settings categories at six sizes, touch-sized tabs, no overflow). No backend change.
- **Not built:** a file browser or document editor (the backend has no such feature and the board's folder-gate rules forbid listing PC files); a global knowledge-base/search across agents beyond the existing notes search.

### Phase 6: cross-cutting pass (2026-11-06)
- **Audit first:** on a 390 px phone across 23 pages 258 controls were under 44 px tall and there was no skip link. **Fixed at the root, not page by page:** `.btn` is 44 px on phones; fields (not checkboxes, radios, files, ranges) and `summary` toggles too; switches keep their look and get an invisible 44 px extension; the safety note's button; a 'Skip to the page content' link is the first Tab stop and `main` can take focus. After the fix the same audit found 0 (switches and inline underlined text buttons are not measured by box height, and the script says so).
- **Checks added:** every page has exactly one h1; first Tab stop is the skip link; touch rules pinned in the stylesheet tests; the motion test now reads each `@keyframes` block by its own braces (an earlier version could read past a one-line block).
- **Tests:** dashboard 384/384 (+5 in `phase6.test.tsx`); browser script `scripts/e2e/redesign-e2e.mjs` 89/89. Older browser suites re-run on the redesigned UI: workspace 32/32, groups 44/44, demo 16/16, routing 40/40 (all fake/scratch only).

### Unified workspace, phases 1-2 (2026-11-06, D-076, UNCOMMITTED)
- **Built:** `src/project-hub/` (read-only service + 3 routes; no table, no migration, no dependency); dashboard `components/hub/` (`ProjectHub` tabs: Overview, Conversations, Tasks & history, Agents, Files & knowledge, Workflows, Decisions & approvals, Settings), `api/hubHooks.ts` (one `where` map of every deep link), context links on tasks, approvals, decisions, chats and agent pages. The shared workspace moved into the hub's Files tab and the old editor into Settings (same components, no copy).
- **Existing tests changed (flow only, no assertion removed):** `projectWorkspace.test.tsx` and `inboxProjects.test.tsx` now click the hub tab that holds what they check.
- **Tests:** `npm run check` green: backend 1,770, dashboard 387. NOT done: a real-browser run, phases 3-6 (global search, chat drawer, AI navigation tool, simple/review/advanced levels, acceptance script).

### Browser check of the hub, global search, and the AI Assistant correction (2026-11-06, D-076/D-077, UNCOMMITTED)
- **Real-browser script** `scripts/e2e/hub-e2e.mjs` (scratch app, one fake local model, fictional "Bakery website" data): 113/113. Covers all eight hub tabs and their addresses, attention items, context links, deep links (chat, approval, decision, workflow run, task), empty states, read-only behaviour, keyboard tabs, global search, the AI Assistant, workflow drafting, and six screen sizes (360-1920 px: no sideways scroll, one h1, 44 px touch targets on phones).
- **Problems the browser found and fixed:** the hub sat below the whole project list (tabs clipped) -> an open project is now full width with "All projects"; ChatTab used fixed element ids so two chats on one page bound labels wrongly -> ids are per instance; `sectionFor("/")` assumed the first list entry was home -> now finds Dashboard by address.
- **Correction (D-077):** the chat drawer built in phase 3 was the wrong design. Removed. AI Assistant is a sidebar workspace (`web/src/pages/Assistant.tsx`); navigation regrouped in `nav.ts`; workflow drafting (`src/workflows/draft.ts`, `POST /api/workflows/draft`, never saved). Existing tests changed only where they named the old grouping (shell, collab, approvals, monitor, projectWorkspace, inboxProjects) and two older browser scripts (redesign, workspace).
- **Global search (phase 3):** `GET /api/search` (names/titles only; not message text, note bodies, files or secrets; archived skipped; wildcards plain), Ctrl+K dialog and a Search item in the sidebar/phone header.
- **Tests:** `npm run check` green: backend 1,777, dashboard 396. Browser: hub 113/113, redesign 89/89, workspace 32/32, groups 44/44, demo 16/16, routing 40/40.
- **NOT done / NOT verified:** AI navigation tool for the Manager (phase 4), simple/review/advanced levels (phase 5), the section-G acceptance script is partly covered by hub-e2e only; real provider use (drafts never tried with a real model); real phones; screen reader. The open-workspaces strip labels project pages "Projects (item)".

### Phase 4: Assistant lookups, Knowledge Center, attachments, controlled editing (2026-11-06, D-078, UNCOMMITTED)
- **Built** (see `docs/KNOWLEDGE-AND-ASSISTANT.md`): migration 020 (additive), `src/knowledge/` (extraction for txt/md/csv/json/xml/docx/xlsx/simple pdf, chunks + FTS5, duplicates, collections, status + reasons, reprocess, soft delete), chat attachments + retrieval with [A1]/[K1] sources, `src/assistant/` (locate, safe/review/restricted actions with log and undo, suggestions), workflow draft revise, dashboard Documents tab, chat attachments UI (drag and drop, previews, progress, retention), Assistant results/suggestions/changes panels.
- **Problems the tests and browser found and fixed:** the secret scan refused a collection's UUID; the lookup SQL ESCAPE clause; filler words ("about") treated as names; documents not found by content (now a text-index fallback); status chips and titles under 44 px on phones; image previews used `blob:` URLs which the Content Security Policy blocks (now data URLs; the policy was NOT loosened); the `ask:` prefix regex had lost its backslashes; restricted patterns too broad ("give me a summary") or too narrow ("give Atlas access"); the overview matched any sentence containing "summary".
- **Mistake caught and repaired:** I overwrote the existing `web/src/phase4.test.tsx` (10 tests from an earlier project phase) with new tests. Restored from Git; my tests live in `web/src/assistantKnowledge.test.tsx`. A per-file comparison against HEAD confirmed no test was lost anywhere.
- **Existing tests changed (facts only):** migration list/count (020 added) in `upgrade.test.ts`, `agent-manager.test.ts`, `groups-proposal.test.ts`, `decisions-proposal.test.ts`; `phase5.test.tsx` (Knowledge tabs now include Documents); the older browser scripts now click the new navigation. No assertion removed or weakened.
- **Tests:** `npm run check` green; browser: phase4 91/91, hub 113/113, redesign 89/89, workspace 32/32, groups 44/44, demo 16/16, routing 40/40.
- **NOT done / NOT verified:** Phase 5; any real model; real phones; screen reader; real-world PDFs and Office files; real-model and real-file validation (NV-31, P-47). (Correction: migration 020 IS applied to the live database, since 2026-11-06T00:27:51Z; see D-078a.)

### Phase 4 audit (2026-11-06, D-078a, UNCOMMITTED)
- Full record: `docs/PHASE4-AUDIT.md` (findings, boundaries, migration assessment, recovery, checklist) and `docs/PHASE5-PREPARATION.md` (scope, dependencies, sequence). Audit only: no Phase 5 work was started.
- **Facts found:** migration 020 was already applied to the live database by the dev watcher; live database healthy (integrity ok, tables empty, data intact); new backup `data/backups/2026-11-06_103251` verified. No test lost versus HEAD.
- **Fixed:** the Assistant's edits now respect the phone and passphrase-proof rules; the PDF/XLSX/DOCX readers are linear (hostile-file timing tests).
- **Tests after the fixes:** see the audit report; `npm run check` green.

### Real-model validation of Phase 4 (P-47, 2026-11-06)
- 12 real Groq requests (`scripts/e2e/real-phase4.mjs`, `docs/evidence/real-phase4/results.json`), details in `docs/PHASE4-AUDIT.md` section 8. One defect found and fixed (citation written as `[ K1 ]`). Workflow revise inconclusive. R6-R9 not run.

### Interface levels (D-079, 2026-11-06, UNCOMMITTED)
- Built exactly to the owner's approved recommendations (see `docs/PHASE5-PREPARATION.md` section 8). Simple lists 4 sections, Intermediate 8, Advanced all 12; browser-only; default Advanced; guides at Simple and Intermediate; nothing removed; approvals visible at every level.
- Found while building: a second "Advanced" radio group next to Recommended Settings' own switch clashed with its tests and would confuse users, so the level buttons are toggle buttons ("Simple level", ...) and the Recommended Settings switch got a one-line explanation.
- Tests: unit 9 (`interfaceLevels.test.tsx`), browser `levels-e2e.mjs` 33/33. See the final report for the full-suite numbers.
- NOT verified: the owner using it as a beginner, real phone, screen reader, whether the guide wording is right.

### Review round after P-47 and D-079 (2026-11-06, D-080, UNCOMMITTED)
- **Reviewed:** P-47 results (both rewrites judged: safe and more specific than "Find facts.", but one copied the role text and one asked the bot to verify from memory), D-079, NV-31, NV-32.
- **Changed:** guides rewritten and extended (16); Simple project page (5 tabs) and Simple Dashboard (essentials); rewrite, description and revise prompts; citation marks (`【K1】` etc.); a "what changed" note after a workflow revision; `writer-roundtrip.test.ts` (the app's own Word/Excel/PDF read back).
- **Real models:** P-48, 22 requests (Groq only). Findings in `docs/PHASE4-AUDIT.md` section 9 and NV-34.
- **Plan only:** `docs/MANAGER-LOCATE-PLAN.md`.
- **Tests now:** `npm run check` green: backend 1,865 tests (88 files), dashboard 426 tests (45 files), both builds. Browser: levels 44/44, phase4 91/91, hub 113/113, redesign 89/89, workspace 32/32, groups 44/44, demo 16/16, routing 40/40. Real-model scripts are not part of `npm run check`.
- **NOT done / NOT verified:** the Manager capability (plan only); a human beginner session; explicit mid-request fail-over with a real outage; Word and Excel files made by Microsoft programs; revise reliability; phone, screen reader.

### Modernization M1 and M2: capability registry and feasibility checker (2026-11-06, D-081, UNCOMMITTED)
- **Built:** `src/capabilities/` (registry, feasibility, service, routes); routes `GET /api/capabilities`, `POST /api/capabilities/refresh`, `POST /api/capabilities/assess`; the Manager now assesses a goal before accepting it (`proceedAnyway` overrides a refusal). Details and limits: `docs/CAPABILITIES.md`. No migration, dependency, outside request or permission change.
- **Findings from the Phase 0 audit:** the brief's HTTP 400 error was already fixed (D-053, fake-provider evidence only, NV-18); migrations 018-020 are already applied; groups, the Manager, workflows and the Assistant already exist. Remaining roadmap: M3 Assistant answer, M4 verification of results, M5 real collaboration test, M6 workflow nodes, M7 navigation headings, M8 real-provider validation, M9 desktop/VM preparation.
- **Existing test changed (flow only):** `src/skills/skills.test.ts` "make a video" now sends `proceedAnyway: true` because the Manager refuses tasks that need a feature that is not built.
- **NOT done / NOT verified:** dashboard screen; Assistant answer (M3); gating of delegation tasks and workflows; any real provider; English keywords only.

### Automatic capability discovery and updates (2026-11-06, D-082, UNCOMMITTED)
- **Built:** agents, workflows and individual models now register themselves in the capability registry (`src/capabilities/registry.ts`); `CapabilityService` has no time cache, shares overlapping builds, compares every build with a snapshot stored in the existing settings store and writes `capability.changed` / `capability.baseline` audit lines; `GET /api/capabilities/changes`; 60 s background rescan in `server.ts`; `AuditLog.recent()`. Consumers: dashboard page `/capabilities` (`web/src/pages/Capabilities.tsx`), Assistant answers (`src/capabilities/explain.ts`, reply kind `capabilities`), Manager planning lists, workflow run gate (`workflow_not_ready`, `proceedAnyway`). Details: `docs/CAPABILITIES.md`.
- **Tests:** `npm run check` green: backend 1,969 tests (92 files), dashboard 433 tests (46 files), both builds. New: discovery 30 + discovery-api 13 backend, 7 dashboard.
- **Existing test changed (timing only):** `manager.test.ts` "daily limit ... at most two at once" planning delay 30 ms to 250 ms, because the capability check now runs before a run is accepted.
- **NOT done / NOT verified:** a real-browser check of the new page; any real provider; gating of delegation tasks created directly; non-English questions; M4 (verification of results) onward.

### Commits and milestones M4 to M9 (2026-11-06, D-083)
- **Commits (owner's explicit instruction):** `18dfce7` Knowledge Center, AI Assistant, hub, levels and real-model validation (D-076 to D-080); `952f4b4` capability registry, feasibility checker and automatic discovery (D-081, D-082). Each was verified in a byte-exact export of the staged files (`git checkout-index` with autocrlf off; a first export with CRLF failed one byte-identity test, which was the export's fault, not the code's). Local tag `rollback/after-capability-discovery`. Nothing pushed.
- **Browser verification of /capabilities:** `scripts/e2e/capabilities-e2e.mjs` 46/46 (real Edge, real server on a scratch database, fake local model). The phone page is very long (about 14,000 px at 390 px wide) because every capability is a card: usable but not compact.
- **M4:** `src/verification/` (verify.ts pure, service.ts, routes.ts), Result check panel (`web/src/components/ResultCheck.tsx`), registry link, `AuditLog.recent()`. Details in `docs/CAPABILITIES.md`.
- **M6:** workflow box `integration` (graph.ts, service.ts: `resolveApprovals()`, `decide()` guard, `canRepeat`), approve/deny routes notify the engine, editor support, registry dependency on services. 11 backend tests + 2 dashboard tests.
- **M7:** `HEADINGS` and `heading` in nav.ts, captions in the sidebar and the phone's More sheet; 2 dashboard tests.
- **M5/M8:** `docs/PROVIDER-VALIDATION-PLAN.md`, `scripts/e2e/real-modernization.mjs` (syntax-checked, refuses to run without the approval variables; NOT run). No provider request was made.
- **M9:** `src/capabilities/vm-readiness.ts`, `GET /api/capabilities/vm-readiness`, card on the Capabilities page. Nothing built, installed or created.
- **Browser:** `scripts/e2e/modernization-e2e.mjs` 34/34 (result checks in all four states, approval then file then confirmed, workflow waits and continues, checkpoint bypass refused, headings at two levels and two sizes). Earlier suites re-run after the nav and editor changes: levels 44/44, hub 113/113, redesign 89/89, phase4 91/91, workspace 32/32, groups 44/44, demo 16/16, routing 40/40.
- **NOT done / NOT verified:** everything above with a real provider (P-49); claim detection beyond English wording; Manager final text is not scanned; real phones and screen readers; Guardian Tier B, the VM, the dedicated account and the firewall design remain NOT BUILT; autonomy stays supervised.
- **Final check after M4 to M9:** `npm run check` green: backend 2,012 tests (95 files), dashboard 444 tests (48 files), typecheck and both builds. No migration file was added (`src/db/migrations` still ends at 020); `data/` untouched (all browser runs used scratch databases).

### Repository audit and direct-task feasibility gate (2026-11-07)
- **Audit finding:** current code already has the capability registry, Manager assessment, workflow run gate, and independent result checks. The direct bot task route (`POST /api/bots/:id/tasks`) was the remaining identified path without a pre-task assessment. It now records an assessment for every direct task and refuses unsupported requests that match an explicit policy prohibition unless `proceedAnyway: true`; unavailable non-policy features keep their existing best-effort text fallback. Assessments are audited with the route source and a clipped instruction.
- **Checks:** targeted capability API tests passed 12/12. The first full run found 14 failures in existing task-flow tests because routine research instructions matched unavailable web capabilities and were refused; the gate was narrowed to explicit policy prohibitions to preserve these established flows. Final `npm run check` passed: backend 2,013 tests across 95 files, dashboard 447 tests across 48 files, both typechecks, and production build. Build reports the existing large-chunk warning (>500 kB).
- **Audit limits still open:** scheduled/event-triggered tasks do not yet run the feasibility assessment; Guardian Tier B, VM/isolation, real phone and screen-reader checks remain incomplete. P-49 was later approved and run once; see the entry below and `docs/PROVIDER-VALIDATION-PLAN.md`. See NV-38 and `docs/CAPABILITIES.md`.

### P-49 validation and follow-up fixes (2026-11-07)
- **Real run:** used 9/16 approved free Groq requests on a scratch database; no other provider or external service. Scratch copy deleted; live DB integrity recheck returned `ok`. Raw results: `docs/evidence/real-modernization/results.json`.
- **Results:** 17/19 assertions passed. R1 text answer remained unverified; R2 did not elicit an unsupported claim; R3 action approval/execution/file creation passed but verification falsely classified “sent for the owner’s approval” as an external send; R4 workflow and R5 Manager passed; R6 named-agent start passed but reply assertion used stale message fields. No second provider run is authorized by P-49.
- **Fixed and verified:** verifier excludes approval/review handoff language (verification tests 28/28); group e2e assertion now reads the service's `senderKind`/`senderName`; capabilities browser test expands the card's actual summary element (browser 58/58). Both e2e scripts pass `node --check`. Full `npm run check`: backend 2,015 tests across 95 files, dashboard 447 tests across 48 files, both typechecks and production build passed. Build retains the existing large-chunk warning (>500 kB).
- **NOT verified:** real-model claim detection, the corrected group reply assertion against a real model, real phones/screen readers, and all isolation/Tier B work. Autonomy remains supervised.

### Approved modular modernization direction (2026-11-15, D-084)
- **Owner approval:** "this is approved. save it to our docs" after reviewing the proposed interactive interface and backend priorities. Saved the approved plan in `docs/MODULAR-MODERNIZATION-PLAN.md` and its visual reference in `docs/design/workforce-preview.html`.
- **Direction:** improve the current app in modules; preserve its stack and services. Backend first: consistent task assessment, safe restart/approval deduplication, stronger evidence and diagnostics, scratch restore proof, then shared interface/Dashboard, projects, Assistant, workflow canvas and run inspection. Future systems join the existing capability registry, projects and approval gate.
- **Evidence:** preview JavaScript checked with a stub DOM: 12 page renders, unique h1 per page, review dialog and local draft interaction passed; no network APIs or external resources in the snapshot. No production test suite was run for this documentation-only change.
- **NOT implemented / NOT verified:** no application code or dependency changed; preview is fictional and not visually browser-verified; exact upstream licenses, package compatibility and performance remain unverified; backend priorities are not completed fixes. No new external request, database change, installation, commit or permission change. Supervised-only rules remain.
- **Next-step proposal, 2026-11-15:** `docs/MODERNIZATION-INTEGRATION-PLAN.md` specifies the baseline and entry-path matrix, backend assessment/restart/evidence work, UI and approval slice, Assistant/project adapter, workflow adapter, future-module recipe and acceptance checkpoints. It is a proposed sequence under D-084, not evidence of implementation or approval of new dependencies/external requests. No production tests run for this documentation-only addition.

### Backend assessment selected by owner (2026-11-15, D-084 follow-up)
- **Done:** local source assessment, entry-path matrix and concrete patch proposal in `docs/MODERNIZATION-BACKEND-ASSESSMENT.md`, linked from the integration plan. Existing route-level assessment is absent from several internal task/Manager paths; TaskEngine.createChild bypasses submit, so a submit-only fix is insufficient. Confirmed the request-to-workflow-reference restart gap in source and identified the downstream reset in retryStep that the defensive fix must cover.
- **Baseline:** `npm run check` passed: backend 2,015 tests (95 files), dashboard 447 tests (48 files), both typechecks and dashboard production build. Existing Node DEP0190 and large-bundle warning remain (main JS 999.91 kB). No separate backend build, browser suite or real-provider run.
- **Proposed first fix:** conservative recovery and descendant-retry protection for uncertain integration steps, then shared execution assessment (including children/internal Manager starts), durable request correlation and evidence/recovery work. Source findings are not a newly reproduced live crash; fault-injection tests are specified but not run.
- **Unchanged:** production source and live database were not modified by this assessment; no new dependency, migration, outside request or commit. Existing staged P-49 work remains separate. Guardian Tier B/isolation and all other unverified items remain open.

### Counted upstream documentation review (2026-11-15)
- **Authorized and used:** 20 read-only attempts, 4 searches + 16 reads, approved explicitly by the owner. Ledger, sources, compatibility matrix and exact proposed reuse scope: `docs/MODERNIZATION-SOURCE-REVIEW.md`.
- **Evidence:** complete top-level MIT licenses read for shadcn/ui, shadcn-admin, assistant-ui and xyflow (assistant license succeeded on a counted retry). Read three source package manifests, admin header, official Vite/chat runtime/React Flow introductory docs, React Flow Vite 8 issue metadata/body, and one Stack Overflow question/answer plus its tag index. Community advice is not treated as authoritative compatibility evidence; no code copied.
- **Recommendation refined:** use existing local components for the first Dashboard/approvals slice; do not import admin router/auth/dependency bundle. assistant-ui external-store adapter is a conditional fit for existing TanStack Query messages; dependency/offline behavior untested. React Flow source 12.12.1 declares React >=17, but issue 5734 remains open for Vite 8 and needs a production prototype before adoption. No automatic Vite downgrade or peer-force workaround.
- **NOT verified / NOT changed:** immutable source pins, npm publication/integrity, full dependency/license/security audit, installed/build/browser compatibility. No dependency downloaded/installed, application code changed, live DB operation, new implementation test or commit. This research authorization is consumed.

### Workflow outside-action restart/retry fix (2026-11-15, D-085)
- **Owner-selected implementation:** fail interrupted running integration steps conservatively from the saved run graph, preserve references, persist `integration_uncertain` when unlinked, log uncertainty and block unsafe direct/upstream retries before any reset mutation. Existing waiting approvals and safe automatic bot retries remain. Changes: `src/workflows/service.ts`, new `src/workflows/restart-safety.test.ts`; no existing tests changed. Detail: `docs/WORKFLOW-RESTART-SAFETY.md`.
- **Evidence:** original new suite had 11/13 failures before the fix. Initial broad running-state guard broke an existing automatic retry test; narrowed it to explicit descendant reset. Final targeted suites 70/70, including 16 new in-memory crash-state/retry cases. Full `npm run check` passed: backend 2,031 (96 files), dashboard 447 (48 files), both typechecks and dashboard build. Existing DEP0190 and large-bundle warnings remain; no separate backend build/browser/real-provider run.
- **Live watcher observation:** previously started assistant-owned dev watcher reloaded on the first two source edits before being stopped. Read-only checks after stopping: integrity ok, zero active tasks, 10 terminal workflow runs (6 cancelled, 3 completed, 1 failed), zero uncertain-recovery audit events. No before snapshot; no claim of all-row equality. No live crash drill or direct live DB write. Dev server remains stopped.
- **Remaining:** durable orphaned-request correlation/reconciliation and exactly-once remote effects are not provided. Assessment consistency, broader evidence/recovery and UI phases remain pending. Guardian Tier B/isolation unchanged. No migration, new dependency, external request or commit; prior staged P-49 work left separate.

### Shared task and Manager execution assessment (2026-11-15, D-086)
- **Implemented:** common registry-backed assessment at TaskEngine task execution (including children and internal schedule/trigger/group/decision/workflow/specialist callers) and Manager planning entry. Existing route refusal predicates are shared; ordinary non-policy text fallback is preserved. Explicit best-effort choices stay with the exact owner-requested root/run, grant nothing and do not flow to children/specialists/later schedules. Cancellation/Guardian task checks remain around the async wait. Manager gains no tools. Details: `docs/EXECUTION-ASSESSMENT.md`.
- **Tests:** 18 new fake-provider cases; new assessment + parallel tests 24/24; unchanged Guardian suite 12/12 outside sandbox after sandbox loopback failures. First full check failed the 40 ms overlap assumption in the existing parallel test (2 instead of 3 simultaneous calls). Replaced its timing window with a controlled fake-provider barrier and retained every original assertion, adding a three-active-calls check.
- **Final check:** `npm run check` passed outside sandbox: 2,049 backend tests (97 files), 447 dashboard tests (48 files), both typechecks and dashboard production build. Existing DEP0190 and large-chunk warning remain. No separate backend build, browser suite or real-provider test.
- **Limits:** keyword matching remains English-only/imperfect; chat and Manager self-step/review text are not separate assessed tasks. Assessment is not authorization. No dependency, migration, external request, live DB operation or commit; dev server stayed stopped. Durable approval correlation, broader evidence/recovery and UI phases remain pending; existing staged P-49 work unchanged.

### Durable approval linkage proposal (2026-11-15, D-087, PLAN ONLY)
- **Owner selected planning only.** Saved `docs/DURABLE-APPROVAL-LINKAGE-PLAN.md`: existing-table atomic approval insert + workflow waiting reference + transaction-local audits; strict synchronous internal callback; compare-and-set conflict handling; postcommit notification; startup-only handling of approved/no-receipt uncertainty; no replay of uncertain writes/reads or guessing legacy links.
- **Exact persistence:** no proposed DDL/migration; use approval_requests, workflow_steps and saved workflow_runs graph on their shared DatabaseSync connection. Alternatives and 18 required fault/persistence cases are specified, not run. Durable correlation is not implemented or verified, and cannot guarantee exactly-once remote execution.
- **Scope held:** documentation only; no application/test/migration file, database operation, dependency, outside request or commit. No new test suite run; the prior D-086 full-check results remain historical evidence, not validation of this plan.

### Atomic workflow approval linkage (2026-11-15, D-088)
- **Owner selected implementation:** gate WRITE insertion, workflow waiting/reference compare-and-set and related audit records now share one synchronous transaction on the existing connection. Notify after commit; rollback losing/failed attempts; preserve committed winner on postcommit/stale exceptions. Validate exact stored binding/JSON hash before read-only resolution. Startup-only approved/no-receipt reconciliation fails uncertain without modifying approval or resending. Existing D-085/D-086 gates/retry/assessment behavior remains. Detail: `docs/ATOMIC-APPROVAL-LINKAGE.md`.
- **Tests:** 29 new synthetic scratch-file/fake-service cases; rollback before/after insert/link/audit/commit, reconnect exact ID, notification failure, stale CAS, live vs cold approved state, denied/expired/timeout effects, bad links, Guardian/revocation, cancellation, read permissions, async callback rejection, quotas and SQLite contention. Prior restart fixture now uses a real synthetic JSON hash; no assertion weakened. Initial test connector ID type error corrected using an existing allowed ID backed only by the fake implementation.
- **Checks:** full `npm run check` passed outside sandbox: 2,078 backend tests (98 files), 447 dashboard tests (48 files), both typechecks and dashboard build. Existing DEP0190/bundle warning remains. After the full run, strengthened two test-only run=running/committed-link crash fixtures; atomic suite again 29/29. No production change after full check; `git diff --check` passed.
- **Limits/scope:** no migration/new dependency/real-service request/live DB command/commit. Server confirmed not listening before edits and stayed stopped. No real process-kill/power-loss/browser/provider drill. Legacy orphan matching, multiple workers and exactly-once remote execution remain unverified/not provided. Backup/restore proof, broader result verification and UI phases remain pending; previous staged P-49 work preserved.

### Synthetic backup/restore rehearsal (2026-11-15, D-089)
- **Full check:** `npm run check` passed: 2,087 backend tests (99 files), 447 dashboard tests (48 files), both typechecks and dashboard production build. Existing DEP0190 and 999.91 kB bundle warning remain; no separate backend build/browser/real-provider run. `git diff --check` passed; only documentation updated after full run.
- **Owner selected synthetic recovery only:** nine new scratch-database cases over the existing backup function; no production implementation change. Explicit temporary paths and generated fixture key/data only; default backup CLI not run. No live DB, live vault or .env opened/copied. Recovery procedure, case mapping and remaining limits: `docs/BACKUP-RESTORE-REHEARSAL.md`.
- **Targeted evidence:** backup suites 12/12 passed. Covers open WAL committed snapshot, exclusion of an uncommitted transaction, point-in-time independent copies, schema/logical-content matching, integrity/foreign keys, task/project/workflow/approval links, Unicode/search, permissions, immutable constraints, correct/wrong synthetic vault key, keyless empty vault and damaged/empty/collision/missing-copy rejection. Initial fixture column typo corrected to existing current_version; no schema change or weakened assertion.
- **Limits:** whole-installation/live-owner recovery, real startup, cross-version upgrade, power loss and remote-effect reconciliation NOT VERIFIED. Snapshot/key copy is sequential and no automatic restore endpoint was added. Existing backup omits external files/.env/Guardian files; actual recovery needs its own reviewed scope. Broader result/evidence diagnostics and modular UI remain pending. No dependency, migration, outside request or commit; prior staged work preserved.

### Result-verification assessment (2026-11-15, D-090, PLAN ONLY)
- **Saved:** `docs/RESULT-VERIFICATION-PLAN.md` maps task/chain approvals, gated file checks, Manager task links/self/final output, workflow task/Manager/exact approval refs, reads, UI and registry consumers. Recommended next slice: chain completeness in the existing service, then action semantics/provenance, then Manager/workflow projections. No new store or model judge.
- **Observed:** three synthetic in-memory pure-function probes reproduced verified for an email-send claim backed only by gworkspace.drive_create_doc; verified aggregate with a failed member; and verified with an unsupported claim hidden after a model-supplied platform separator. These concern result labels; no permission bypass was exercised. No app/server/database/provider was started.
- **Not implemented:** all proposed fixes, endpoints and tests remain pending. Existing staged P-49 verifier/handoff tests preserved. No application/test/migration/dependency/DB/key/external-service/commit change. No test suite or full check rerun for documentation; last implementation check remains D-089 (2,087 backend + 447 dashboard). Whitespace check run for this plan.

### Chain completeness implementation (2026-11-15, D-091)
- **Full check:** `npm run check` passed: 2,101 backend tests (100 files), 447 dashboard tests (48 files), both typechecks and dashboard production build. Existing DEP0190/999.91 kB bundle warnings remain. `git diff --check` passed; no separate backend build/browser/provider test. Only documentation changed afterward.
- **Owner selected checkpoint A:** VerificationService now retains each chain member's lifecycle, returns completion counts/incomplete task IDs/statuses and prevents an aggregate from being verified while any member failed/cancelled/is pending/running. Contradicted/waiting explanations and single-task semantics remain. Existing registry counts/audit reuse the corrected verdict; no new store, grant or execution path. Evidence: `docs/CHAIN-COMPLETENESS.md`.
- **Targeted checks:** 14 new synthetic in-memory/route-injection cases; verification suites 42/42 plus backend typecheck passed. Initial fixture failures corrected by seeding the intended approval state and using an explicit route-only database/service, retaining all production status-transition guards. Fake denied file probe remains unconfirmed; no provider/connector/listener installed in route fixture.
- **Scope/limits:** staged P-49 verify.ts/verification.test.ts blobs and working-file hashes unchanged; no staging/commit, migration, dependency, outside request, live DB/key access or server restart. Ports 3000/5173 had no listeners before edits. RV-1 exact-action matching, RV-3 trusted authored-text provenance, Manager/workflow projections and real-model/browser verification remain pending.

### Exact action matching specification (2026-11-15, D-092, PLAN ONLY)
- **Saved:** `docs/EXACT-ACTION-MATCHING-PLAN.md`: source action matrix, trusted ActionSpec operation/object declarations, exact registry lookup, conservative unknown/mismatch verdicts, file manifest and fake-service regression plan. Distinguishes email vs message, draft vs send, document vs event/task and trash move vs permanent delete/rename. Opaque/generic actions and ambiguous batch outcomes cannot confirm a specific effect.
- **Scope:** source/Git inspection and documentation only. No app/test/schema/dependency/DB/key/outside-request/commit change, no connector factory or app startup. Staged P-49 verifier blobs and working hashes preserved. No new tests run; last full implementation check remains D-091 (2,101 backend + 447 dashboard). RV-1 implementation, RV-3 provenance, target/content/remote receipt proof and Manager/workflow projections remain pending.

### Exact action/object matching (2026-11-15, D-093)
- **Full check passed:** 2,174 backend tests (102 files), 447 dashboard tests (48 files), both typechecks and dashboard build. Verification coverage: 115 cases across four files, including 73 new. Connector/process suites that failed in the restricted targeted run passed with normal local test permissions. Existing DEP0190 and 999.91 kB bundle warnings remain; no separate backend build/browser/provider run. Whitespace checks passed; only documentation updated afterward.
- **Owner selected implementation:** nineteen source-owned ActionSpec operation/object declarations, exact write-metadata resolver, normalized bounded claim matcher, task-bound receipts and conservative unknown-effect ceiling. Google Doc/draft/event/folder/trash actions cannot back incompatible sends/publication/rename/permanent erase. Known/unknown evidence remains distinct; no gate, authorization, folder or Guardian execution path changed. Evidence/staged separation: `docs/EXACT-ACTION-MATCHING.md`.
- **Checks/corrections:** intermediate verification suites 112/112; added append/resolver regressions included in full run. Corrected new fixture-only unavailable taskEngine property and wrong browser dependency name, retaining all original assertions. Larger restricted targeted run: 218 passed/35 failed (fake HTTP unreachable and two harmless test-owned stop timeouts); full rerun uses usual local execution permissions without changing guards. Exact final result in evidence report.
- **Scope:** staged P-49 verifier blob IDs unchanged. New matcher/fixture edits are separate unstaged diffs; no staging/commit, dependency, migration, real-service request, live DB/key access, browser/desktop host or production restart. RV-3 trusted authored-text provenance, target/content/receipt proof, non-English patterns and Manager/workflow combined verification remain pending.

### Backend checkpoint review (2026-11-15, D-094, REVIEW ONLY)
- **Saved:** `docs/BACKEND-CHECKPOINT.md` reviews six delivered reliability improvements (159 added backend regressions), remaining evidence/operational gaps and concrete Dashboard/Approvals scope/data/security/accessibility/fake-browser acceptance criteria. Recommends preparing a limited visual slice with local components/current APIs, while preserving truthful states and carrying RV-3/aggregate-check limits forward. This review approves no implementation or broader verification claim.
- **Evidence/scope:** local source/docs/status review and whitespace checks only; no application/test/schema/dependency/data/key/outside request/commit or new test run. Latest full implementation evidence remains D-093 (2,174 backend + 447 dashboard, typechecks/dashboard build). Historical reports retained; staged work unchanged. Trusted reply provenance, Manager/workflow projections, actual recovery and Tier B remain open.

### Dashboard/Approvals specification (2026-11-15, D-095, PLAN ONLY)
- **Saved:** `docs/DASHBOARD-APPROVALS-PLAN.md`: ordered desktop/phone layouts; exact hooks/endpoints and file manifest; query loading/error/stale distinctions; sampled workflow/time-window labels; pending/history caps and focused-ID read through existing API; exact-content/confirmation controls, narrow shared modal accessibility and fake viewport/keyboard/decision tests; source-only rollback preserving earlier work.
- **Source findings:** workflows endpoint returns latest 30 runs; approval lists default to latest 100; monitor 24-hour counters use record creation time. Current error/default-empty/allowed wording and modal viewport/focus behavior need explicit acceptance checks. Findings are inspection, not newly run browser failures.
- **Scope:** documentation only; no app/test/schema/dependency/key/data/outside request/commit or new test run. UI implementation unapproved/not built (NV-44); D-093 remains last full implementation evidence (2,174 backend + 447 dashboard). RV-3 authored provenance, Manager/workflow aggregate checks and operational limits remain open.

### Dashboard/Approvals implementation (2026-11-15, D-096)
- **Final full check passed:** 2,174 backend tests (102 files), 461 dashboard tests (50 files), both typechecks and dashboard production build. Includes 14 new component cases and the unchanged Winver suite; one earlier Winver full-run failure passed isolated and in final full run with no guard/test changes. Browser total 332/332. Existing DEP0190/large-bundle warning remains (main JS 1,005.26 kB). Syntax/whitespace checks passed; only documentation changed after final full run.
- **Delivered:** priority layout, source/window/capped-count labels, loading/error/stale states, focused-ID read through existing route, exact-content wrapping/scrolling, Executed status and shared confirmation viewport/focus handling. Existing mutations/owner-proof/Guardian/backend contracts preserved; the trap yields to another active modal. Read-only service details fold below waiting requests; controls/counts stay visible. Exact inventory/evidence: `docs/DASHBOARD-APPROVALS.md`.
- **Checks:** 14 new component regressions across two new files; original approval/chart-name assertions updated only for deliberate copy/window semantics. Dedicated browser checks 52/52 (including 200% text scale), shell 89/89, levels/beginner 44/44, project/search/Assistant hub 113/113 and modernization/approval-workflow 34/34 on synthetic data. Full final check and isolated Winver retry results are recorded in the evidence report; no guard weakened.
- **Scope/limits:** no source dependency, backend/migration/permission change, live DB/key access, real external request, owner window, production restart or commit. Source-only rollback copies saved; original staged P-49 blobs preserved. Real phone/screen reader/manual browser zoom/real Guardian-browser pairing and RV-3/aggregate/result-content limits remain unverified/open. Screenshots are synthetic, not owner's real data.

### Reliable reply-checking plan and saved handover (2026-11-15, D-097, PLAN ONLY)
- **Owner selected planning and explicitly asked to save for Claude.** `docs/REPLY-PROVENANCE-PLAN.md` and the “Resume here” block in `docs/HANDOVER.md` identify current state, exact next choice, mixed staged/unstaged work and remaining limits. Read these before continuing; no need to redo D-096 UI work.
- **Source-informed design:** fallback assembly mixes agent/teammate/tool/platform text, so use host-origin-labelled segments rather than one guessed prefix. Keep tasks.result as the displayed text; atomically bind versioned ranges/hash/IDs to it through existing task_events and task completion. Specify cancellation/persistence faults, Unicode-safe truncation, strict same-snapshot reader, one-task/chain integration and bounded coverage/legacy ceilings. No migration, new text store, dependency, key or permission proposed.
- **Not implemented:** RV-3 remains open, as do Manager/workflow projections and other operational/semantic limits. Source/docs/hash inspection and documentation checks only; no app/test/database/key/external-service/commit change or new suite run. Latest successful implementation evidence remains D-096 (2,174 backend + 461 dashboard, typechecks/dashboard build, 332 synthetic browser checks). Staged P-49 index preserved.

### Reliable saved reply origins (2026-11-15, D-098)
- **Owner selected implementation; complete and saved for Claude:** labelled result segments (normal/fallback/partial), Unicode-safe cuts, versioned bounded manifest in existing append-only task_events and atomic result/lifecycle finish. Decoder binds IDs/status/hash/ranges from one task/event SQL snapshot; single-task and chain readers reject unknown/legacy/duplicate/bad metadata without a marker fallback. Unknown/mixed/truncated/unchecked text cannot become wholly verified. Existing gate/permission/budget/publication and D-091/D-093 behavior retained. Details: `docs/REPLY-PROVENANCE.md`.
- **Verification:** 46 new cases passed. Full `npm run check`: 2,220 backend (104 files), 461 dashboard (50 files), both typechecks/dashboard build passed. Existing fake modernization browser 34/34 passed. Initial full-run failures were two exact event lists; updated only to include the new event, retaining existing assertions. Existing DEP0190/bundle warning remains (1,005.30 kB main JS). No separate backend build or real provider run; whitespace checks passed.
- **Saved state/limits:** current HANDOVER resume block replaced in-progress instructions with final results/next choice. Staged verifier blobs unchanged; approved working deltas separate. No migration/dependency/key/grant/live DB/real outside request/production restart/commit. RV-3 addressed for new valid-origin TaskEngine records; legacy/mixed/invalid/incomplete records stay unverified. Manager/workflow final projections, semantic/remote receipt proof, same-user tamper protection, power-loss and Tier B remain unverified/open.

### Manager evidence checks and panel (2026-11-15, D-099)
- **Owner selected and requested implementation.** Read-only Manager endpoint binds specialist roots to their run, reuses captured chain evidence and separates final-summary uncertainty from helper evidence. On-demand panel preserves existing controls and does not display cached confirmation during refresh/failure. Report: `docs/MANAGER-RESULT-CHECKS.md`.
- **Final evidence:** targeted backend 52/52 (38 new), dashboard 17/17 (11 new), synthetic browser 29/29 passed. Full `npm run check` passed: 2,258 backend tests (105 files), 472 dashboard tests (51 files), both typechecks/dashboard production build. Existing DEP0190/large-bundle warnings remain (main JS 1,008.08 kB). No application changes after full checks; no separate backend build or real provider run.
- **Saved state/limits:** report, decision board and Claude resume handover updated. No commit/staging/unstaging/migration/dependency/live DB/key/real-service request. Existing staged verifier hashes preserved and earlier working changes retained. Manager final-summary proof, workflow-wide projection, exact targets/content/receipts/quality and operational isolation/recovery remain open. The new Manager-only ceiling also prevents unchecked files from making helper evidence fully confirmed; existing task semantics unchanged.

### Workflow result-check plan (2026-11-15, D-100)
- Owner selected option 1, planning only. Saved `docs/WORKFLOW-RESULT-CHECKS-PLAN.md`: existing-records endpoint/panel, saved graph/step/task/approval sources, shared read-only linkage validator, deduplicated bounded evidence, uncertainty/skip/read limits, exact implementation/test/rollback contract.
- Important source limit: workflow-started Managers save only requested_by=workflow, no exact originating run/node backlink. The plan marks those links unbound with zero inherited evidence; no timestamp/forward-reference guess or migration/backfill. Final workflow output remains unverified; future backlink/read receipts separate.
- No application/test/schema/dependency/live DB/key/outside request/commit change or new test run. Latest successful implementation remains D-099 (2,258 backend + 472 dashboard/typechecks/build; Manager browser 29/29). Staged P-49 verifier hashes preserved; current handover saved for Claude. Implementation awaits owner selection.

### Workflow result checks and panel (2026-11-15, D-101)
- Owner chose implementation (“1”). Added read-only saved-graph projection, exact task/shared D-088 approval links, deduplicated bounded action evidence, unlinked attempts and truthful on-demand panel. No automatic action/retry/decision. Manager refs remain unbound and workflow output unverified. Evidence/limits: `docs/WORKFLOW-RESULT-CHECKS.md`.
- **Final full npm run check passed:** 2,322 backend tests (106 files), 484 dashboard tests (52 files), both typechecks/dashboard build; includes 64 new backend + 12 dashboard cases. Synthetic browser 42/42 passed with zero mutation/model/connector/outside-browser calls; scratch removed, phone/desktop screenshots visually reviewed. Existing DEP0190/bundle warning remains (main JS 1,012.00 kB). Only docs changed after final full checks.
- Verification recovery: initial full dashboard schedule creation timed out at five seconds and passed unchanged in isolation. Next full attempt exposed an existing Manager concurrency fixture race and two follow-on closed-test-DB rejections; replaced only its 250 ms fake completion window with an explicit barrier/finally-drain, retaining every accepted/busy/daily-limit assertion. Manager/workflow targeted 91/91 and subsequent final whole check passed. No production limit, assertion or timeout weakened; earlier failures retained in report.
- Saved report, decision board and Claude handover with remaining weak Manager links/read receipts/output/semantic/operational limits. No migration/dependency/permission/owner DB/key/real-service/commit/staging/unstaging; frozen staged verifier hashes unchanged and earlier work preserved. Next recommended planning checkpoint is supervised daily-use walkthrough before Projects/Assistant redesign; no further implementation implied.

### Ordered daily-use and Projects/Assistant plans (2026-11-15, D-102/D-103)
- Owner requested plan 1 and then plan 2, keeping Claude handover updated. Prepared `docs/DAILY-USE-WALKTHROUGH-PLAN.md` first: fresh fake/scratch app, ten realistic scenarios, source-vs-observed evidence, controlled restart, permissions/approval/attachment/context/failure checks and issue priorities. Walkthrough NOT RUN.
- Then prepared `docs/PROJECTS-ASSISTANT-REDESIGN-PLAN.md`: existing local UI components/services, Projects attention/progress and Assistant review/context hierarchy, truthful independent query states, preserved chat identity and safe/review/restricted behavior, two implementation slices with acceptance/rollback. Source inspection found possible read-error/empty confusion and new-conversation-only project filing; no usability observation is fabricated. UI NOT IMPLEMENTED; refine with actual D-102 findings before implementation.
- Updated decision board, TASKS and Claude HANDOVER with ordered resume instructions. Documentation only; no source/test/schema/dependency/owner-data/key/outside request/commit or new suite run. Latest full implementation evidence remains D-101 (2,322 backend + 484 dashboard/typechecks/build; workflow browser 42/42). Preserve mixed staged/unstaged work and all verification/operational limits.

### Daily-use walkthrough and redesign refinement (2026-11-15, D-104)
- Owner selected execution of D-102 and refinement of D-103. Added `scripts/e2e/daily-use-e2e.mjs`, fresh scratch app/injected fake provider/test-owned Edge. Final 10/10 scenarios observed, **60 passed checks and 3 automated S2 read-error findings**, plus 2 S3 visual observations. Final 17/32 fake calls; zero real/outside requests or uncaught browser errors; synthetic scratch removed. Actual report/evidence: `docs/DAILY-USE-WALKTHROUGH.md`, `docs/evidence/daily-use/`.
- Confirmed with selected fake/scratch actions: locate/ambiguity, temporary attachment/citation display, project membership/draft persistence, safe rename/Undo, independent review Apply/Reject, restricted refusals, deny then NEW file request/approve, shared entries, task/Manager/workflow evidence limits and controlled restart. File-ceiling corners use explicitly seeded receipts; no extra real execution. Earlier harness assumptions/false reused-reply checks and correct default throttling were diagnosed; final new-reply assertions plus simulated clock pacing retain default limits. Five attempt histories preserved (62 fake calls total, no real provider quota).
- Findings: DU-READ-PROJECTS blank/unreported failed list; DU-READ-HELPERS failed read looks like missing setup; DU-READ-SUGGESTIONS failed read reassures nothing needs attention. Visual DU-REVIEW-LABEL and DU-PHONE-HISTORY refine status wording/result placement. Source-informed D-103 now prioritizes those issues and preserves working ContextLinks/chat identity/drafts. UI remains NOT IMPLEMENTED and findings UNFIXED.
- Standalone syntax and targeted existing UI regression tests **19/19** passed. No full rerun for harness/docs-only work; D-101 remains last full product evidence (2,322 + 484/typechecks/build). No product/schema/dependency/owner DB/key/real-service/permission/commit/staging change. Handover/decision board/TASKS updated for Claude; real user/device/provider, cached refresh, helper-switch draft and operational limits remain explicit.

## Projects slice check (2026-11-15; board D-105, NV-45)
- Owner picked the Projects slice from clickable options. Source inspection: failed-read/Retry, empty-vs-no-match, loading, dated stale cache and the attention-first Overview already existed in `web/src/pages/Projects.tsx` and `components/hub/ProjectHub.tsx`, covered by `web/src/projects-modernization.test.tsx` (untracked, 21 cases). No product code changed.
- Fixed only a test timing problem: three "retains <level> tab rules and attention" cases now `await findByRole` for the region (assertions unchanged). Targeted 24/24, then full `npm run check`: 2,322 backend + 505 dashboard tests, typechecks, build.
- NOT done / NOT verified: a real-browser re-run of the 503 project-list case, cached-refresh failure in a browser, and the whole Assistant slice (DU-READ-HELPERS, DU-READ-SUGGESTIONS, DU-REVIEW-LABEL, DU-PHONE-HISTORY). Nothing committed.

## Assistant slice (2026-11-15; board D-106, NV-45)
- Owner picked the Assistant slice from clickable options. Changed `web/src/pages/Assistant.tsx` and `web/src/components/assistant/AssistantPanels.tsx` (presentation only; no backend, API, schema, permission or dependency change):
  - DU-READ-HELPERS: a failed agent-list read shows "Could not load your agents" + Retry and says it could not check, instead of "No agent is ready to chat yet". Locate/explain stays available.
  - DU-READ-SUGGESTIONS: a failed suggestions read shows "Could not load suggestions" + Retry; "Nothing needs attention right now." only after a successful empty read. Same for "No changes yet." in Recent changes.
  - DU-REVIEW-LABEL: an applied/rejected/undone review change shows "Review change"; "Needs your review" only while proposed. Apply/Reject/Undo unchanged.
  - DU-PHONE-HISTORY: chat now comes before earlier results when an agent is ready, with a "Results and review changes (n)" button that scrolls/focuses the results section. Side column order is Changes, Suggestions, Workflows.
  - Project selector relabelled "New conversations go in" with a one-line note that an open conversation keeps its place. Scripts `hub-e2e.mjs` and `daily-use-e2e.mjs` updated for the new label text (syntax-checked, NOT re-run).
- Tests: new `web/src/assistantReadStates.test.tsx` (9 cases); `globalSearch.test.tsx` label text updated. Full `npm run check`: 2,322 backend + 514 dashboard tests, typechecks, build.
- NOT done: browser re-run (D-102 walkthrough / hub / levels scripts) at phone and desktop widths, helper-switch draft regression, real screen reader/phone/provider. Nothing committed.
- **Browser re-run (2026-11-15, scratch app, fake model, test-owned Edge, no real service):** `hub-e2e.mjs` 113/113 (first run 112/113: the script still expected the old Files-tab heading "Files made by this project's tasks"; the app text had been reworded earlier, so the script expectation was updated). `levels-e2e.mjs` 44/44 on two runs after adding waits to two checks that read the page right after a click (earlier runs failed different single checks, a script race, not an app change; assertions unchanged). `daily-use-e2e.mjs` was NOT re-run because it overwrites `docs/evidence/daily-use/results.json` (D-104 evidence). Phone/desktop layout checks inside hub-e2e passed at 6 widths. Real phone, screen reader and real provider remain NOT VERIFIED.

## Commits and helper-switch test (2026-11-15; board D-106)
- Owner approved four local commits: 3505a6b (P-49), f412fdf (backend), c354fdf (dashboard), a39be3e (docs/evidence). Each verified from a staged-only export with core.autocrlf=false (a first export with line-ending conversion failed the byte-identical 017_groups.sql test: export artifact, not a code fault). No push, no tag.
- Added the helper-switch draft regression (unsent text and helper choice survive switching helper). Remaining: daily-use re-run, real-device/provider/usability evidence, Tier B, owner recovery.

## Daily-use re-run (2026-11-15; board D-107, NV-45)
- `scripts/e2e/daily-use-e2e.mjs` re-run on the committed code: 63 passed, 0 findings, 10/10 scenarios, 17/32 fake calls; no outside request. Project list, project hub, helper list and suggestions failures now show explicit error states. Evidence in `docs/evidence/daily-use/` (new timestamped files; results.json replaced). Synthetic only; real owner/phone/screen reader/provider NOT VERIFIED. Uncommitted.
