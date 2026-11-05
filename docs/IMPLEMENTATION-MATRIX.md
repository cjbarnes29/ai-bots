# Implementation matrix: Bot Studio, group bots, model router, workflows, desktop, mobile (Phase 0 audit)

Written 2026-11-04 from the actual repository, not from plans. Method: documents read (list below), code and migrations inspected, existing tests counted. Nothing was classified COMPLETE without a test that exercises it.
Classes: **COMPLETE** implemented and tested; **PARTIAL** exists, needs work; **MISSING** not implemented; **PLANNED** documented, not implemented; **BLOCKED** needs a dependency or the owner's approval.

## 0.1 Documents read, and conflicts
Read: `CLAUDE.md`, `README.md`, `TASKS.md`, `docs/DECISION-BOARD.md`, `docs/PROGRESS.md`, `docs/HANDOVER.md`, `docs/SECURITY-AUDIT.md`, `docs/GUARDIAN.md`, `docs/ACCESS-CONTROL.md`, `docs/SETTINGS-AUDIT.md`, `docs/PROVIDERS.md`, `docs/TIER-B-PLAN.md`, `docs/PHONE-AND-REMOTE.md`, `docs/PC-AGENT.md`, `docs/BUSINESS-WORKFORCE.md`, `docs/UI-AUDIT.md`, the module READMEs under `src/`.
**Named but absent:** a separate "architecture document" does not exist (the architecture is in `README.md`, `docs/PROVIDERS.md` and the module READMEs); a "workflow documentation" and "bot documentation" file do not exist as such (`src/agent-manager/README.md`, `src/delegation/README.md`, `docs/PROGRESS.md` hold them); there is no "test documentation" file (testing is described in `docs/PROGRESS.md` "How to work here" and `docs/GUARDIAN.md` section 11).
**Conflicts found (newer decision wins):**
1. `src/agent-manager/README.md` says "Phase 1: bots are records only. Nothing can run them yet" and "setting a bot to active is refused until Phase 2". Bots do run (chat, tasks, delegation, workflows). The README is stale; code and tests are the truth.
2. The request says "do not impose a permanent six-bot limit". The existing delegation limits (depth, fan-out) are deliberate safety limits (D-005/D-041 and `docs/PROGRESS.md`), not a bot-count limit; they stay.
3. The request lets mobile "manage bots". Board S-13/D-035 say anything done by a phone is remote: owner-only changes stay PC-only with the passphrase proof. The newer security rule wins: the phone may look, chat, approve nothing owner-only, and pause/stop.
4. The request asks for a free-first router with fallback. The existing router (D-017, `docs/PROVIDERS.md`) already refuses paid models by design (free-only is locked on). Kept.
5. The request mentions Photoshop/Resolve/Premiere adapters. None is installed on this PC as far as scanned; application adapters for named programs are BLOCKED until the owner approves each program (Access > Applications) and the program exists. The generic UI Automation engine is the one execution layer.

## 0.2 / 0.3 The matrix
| # | Requested feature | Class | What exists (files, APIs, tables) | Missing | Risks | Tests needed |
|---|---|---|---|---|---|---|
| **Phase 1** | | | | | | |
| 1.1 | Create/edit bots, version history, restore, duplicate, archive | **COMPLETE** | `src/agent-manager/*`; `/api/bots*`; tables `bots`, `bot_versions`, `bot_permissions`, `permission_audit`; 17+ tests in `agent-manager.test.ts`; dashboard `BotList`, `BotEditor` | none | none | exist |
| 1.1 | Conversational (AI-assisted) bot creation | **MISSING** | the Manager AI plans tasks, but nothing turns a description into a bot configuration | a "describe the bot" draft endpoint that returns a proposed config the owner reviews and saves (never auto-saves, never grants permissions) | model output untrusted: must be validated by the existing schemas | draft validated, no permissions granted, nothing saved without owner act |
| 1.1 | Name, personality, role, instructions, model, tools, memory, delegation, limits, status | **COMPLETE** | bot content fields; `bot_tools`, `bot_skills`, `memory_bots`, `bot_delegation_targets`, per-bot limits (`/api/llm/limits`) | avatar; "boundaries" as its own field (today inside instructions) | schema change = migration (needs approval) | |
| 1.1 | Avatar | **MISSING** | none | an avatar field (emoji or colour; no uploads) | migration | |
| 1.1 | Folder / application permissions per bot | **PARTIAL** | `src/access/*` is per requester (`workforce` or `app:`); bots use the PC agent's five per-bot grants | per-bot folder grants (today one `workforce` subject for all bots) | the grant model has the subject field already, so no migration | per-bot subject tests |
| 1.2 | Operating modes (Chat Only, Research, Workflow Execution, Desktop Operator) | **MISSING** | permissions already are per connector and per PC grant; no "mode" concept | a mode as a **named preset of existing switches** (never a permission source) | a mode must never grant anything: it can only be a view/template over permissions the owner set | changing mode changes no permission |
| 1.3 | 20 editable bot templates | **PARTIAL** | `src/business/team.ts` has 4 business agent templates + installer; no general library | a template library (data, not code), "create from template" | none | each template validates against the bot schema, creates a disabled bot with all permissions OFF |
| 1.3 | Export / import bots | **MISSING** | none | JSON export (content only, no secrets, no permissions) and validated import (creates disabled bot) | imported text is untrusted | round trip; secrets stripped; import grants nothing |
| **Phase 2** | | | | | | |
| 2.1 | Groups (create, members, coordinator, memory, participation, routing policy) | **MISSING** | none. `conversations` is one bot per conversation (`bot_id NOT NULL`) | group + membership + group conversation model; **needs new tables (migration, approval required by `CLAUDE.md`)** | migration approval; participation loops | see 2.2-2.5 |
| 2.2 | Group chat, @mentions, replies, history, search | **MISSING** (single-bot chat is COMPLETE: `src/chat/*`, `chat.test.ts`) | `chat_messages` (user/assistant only) | group messages with sender, mention parsing, reply references | as above | |
| 2.3 | Participation modes and loop prevention | **PARTIAL (building blocks)** | delegation already has depth/fan-out limits, loop checks, duplicate suppression (`src/delegation/limits.ts`, `delegation.test.ts`) | group-level policy on top | duplicate/circular tests exist for delegation, not for groups | |
| 2.4 | Bot-to-bot collaboration (assign, review, challenge, escalate) | **PARTIAL** | `src/delegation/*`: allow-lists (`bot_delegation_targets`), structured task requests, `tasks`, `task_events`, `delegation_audit`, Manager AI (`src/manager`) | review/challenge message types; ownership transfer | | |
| 2.5 | Memory boundaries (private, group, project, shared) | **PARTIAL** | `src/memory/*`: private per bot and owner-approved shared notes; bot writes need approval; secrets rejected | group memory, project memory | | boundary tests for group memory |
| **Phase 3** | | | | | | |
| 3.1 | Central routing used by every bot and workflow | **COMPLETE** (for text) | `src/routing/*` + `src/llm/service.ts`: every call goes through `LlmService`; automatic model "auto:" refs; scoring by task class | capability metadata is coarse | | exist (`routing.test.ts`, `service.test.ts`) |
| 3.2 | Automatic fallback, failure classification, bounded retries, circuit breaker | **COMPLETE** | `src/routing/router.ts` (provider-level vs model-level failures, skip rest of provider, attempt record), `src/llm/resilience.ts` (backoff, circuit breaker), `llm_usage` | switch notification to the user; context hand-over is trivial because each attempt resends the same messages | | exist |
| 3.3 | Primary/secondary/local fallback, per-bot model, global policy, manual override | **COMPLETE** | per-bot model or "auto"; Settings > Model routing (`/api/llm/routing`) | per-task preferences beyond the class | | exist |
| 3.4 | Free-only, no paid fallback, usage display | **COMPLETE** | free-only gate (locked), caps, `src/llm/profiles.ts` + Settings provider cards (this session) | "last provider error" and "fallback history" are partly shown on the Monitor/Usage pages | | exist (`profiles.test.ts`) |
| 3.5 | Per-provider/per-bot/global limits, concurrency, loop prevention | **COMPLETE** | `src/llm/limits.ts`, usage repository | | | exist |
| 3.6 | Capability-aware routing (vision, audio, tools, long context, coding) | **PARTIAL** | `rank.ts` scores traits (coding/long context); this session added picture/tool **types, policy and adapter gating** (all off) | model-level capability flags for image/audio/tools and routing filters on them | no caller sends pictures | picture policy tests exist |
| 3.7 | Context preservation across a switch | **COMPLETE** for text; **n/a** for tool state | each attempt re-sends the full request; approvals are tracked outside the model | | | |
| **Phase 4** | | | | | | |
| 4.1 | Visual workflow builder | **PARTIAL** | `web/src/components/WorkflowEditor.tsx`, `src/workflows/graph.ts`: nodes trigger, bot_task, manager, condition, checkpoint, set, end | group bot, application, file, browser, parallel/merge, approval, quality, delay nodes | graph schema growth is additive | |
| 4.2 | Execution: sequential, parallel, conditions, checkpoints, resume, cancel, history | **PARTIAL (mostly complete)** | `src/workflows/service.ts`: ready-set execution with `parallelBoxes` = 2, retries, cancellation, `workflow_runs`/`workflow_steps`, recovery at start (`recover()`) | resume from a chosen checkpoint (today a restart re-runs from the interruption), configurable parallel width | | |
| 4.3 | Manager AI plans, assigns, monitors, checks quality | **PARTIAL** | `src/manager/service.ts` (`manager_runs`, `manager_steps`) | explicit quality-review step; capability/permission check before assignment | | |
| 4.4 | Reusable skills from workflows | **PARTIAL** | `src/skills/*` (skills with versions and tests: `skill_versions`) | "record a workflow as a skill", required-applications/permissions fields, test status | must not claim learning without review + passing test | |
| **Phase 5** | | | | | | |
| 5 | One controlled desktop layer for bots | **COMPLETE for the generic engine (this session)**; **BLOCKED for named-program adapters** | `src/desktop/*` (UI Automation host, OCR, process registry, redaction, engine, connector `desktop`), 57+ tests incl. 22 real-Windows tests on disposable windows | Photoshop/Resolve/Premiere/Office/VS Code adapters: none of those programs was scanned as installed (Word, Excel, PowerPoint, Photoshop, Resolve, Premiere not seen; VS Code, Chrome, Edge present) | Electron/Chromium apps expose little UI Automation; Office needs its own scripting approval | per-program real tests only on disposable data |
| 5 | Notepad-incident safeguards | **COMPLETE** (verified on real disposable windows) | process registry, window identity, redaction in host, no attach, overwrite/close guards | | residual: Tier A gives no OS isolation | exist |
| **Phase 6** | | | | | | |
| 6 | Ten workspaces in the dashboard | **PARTIAL** | existing nav: Dashboard, Agents & Teams (+Knowledge), Workflow Studio, Approvals, Business, Integrations, Schedules, PC Control Center, Access (new), Activity & Logs, Settings (AI Models, routing) | Group Chats; renaming into the requested ten workspaces | rename churn breaks tests | nav tests |
| 6 | Mobile/Android | **PARTIAL** | PWA (`manifest.webmanifest`, `sw.js`), device pairing, remote access via Tailscale, phone-safe rules, bottom bar, 375px layouts tested | group chats, attachments, voice input, deliverable review | remote must stay owner-gated | |
| **Phase 7-8** | Tests, docs | tests **ongoing**; docs **ongoing** | | | | |

## Status update 2026-11-04 (second pass: the non-migration items)
| Item | New class | Evidence |
|---|---|---|
| 1.3 Templates (20, four groups) | **COMPLETE** | `src/bot-studio/templates.ts`; creates ordinary disabled bots; 17 backend + 6 dashboard tests |
| 1.3 Export / import | **COMPLETE** (content only; unsafe files refused; nothing created on refusal) | `portable.ts`, tests incl. 11 unsafe-file cases |
| 1.2 Operating modes | **COMPLETE as ceilings** (never grants) | `modes.ts` + `ActionGate.modeBlock`; tests prove no permission changes and that a mode set after a request also stops the approval |
| 1.1 AI-assisted creation | **COMPLETE as draft-only** | `draft.ts`; owner review before saving; model output with permissions/secrets rejected |
| 3.6 Capability flags and capability-aware routing | **PARTIAL -> mostly COMPLETE for what the app can use** | `src/routing/capabilities.ts`, router `require`; picture, audio and tool capabilities are never "met" because the app cannot use them yet |
| 1.1 Avatar, per-bot folder grants | **MISSING / PARTIAL** (avatar needs a migration; folder grants per bot need a design) | not started |
| 2.x Groups | **BLOCKED: migration proposal written, awaiting approval** | `docs/MIGRATION-PROPOSAL-GROUPS.md` |
| 4.x, 6.x | unchanged (not started) | |

## Reuse, do not duplicate
Agent Manager (`src/agent-manager`), task engine and delegation (`src/delegation`), Manager AI, `LlmService` and the router, workflow engine, skills, memory, approval gate, Guardian, access module, desktop engine, PWA/remote layer. Every new feature below attaches to one of these.

## Needs the owner's approval before it can be built
- **Groups need new database tables** (a group, its members, and group messages). `CLAUDE.md`: no database migration without the owner's approval. Group chat cannot be done honestly without them. Avatars also need a column.
- Any program adapter needs the program installed and approved per program.

## Proposed build order (each step reversible, tested, no migration unless marked)
1. Bot templates + export/import + "create from template" (no migration: uses the existing create API).
2. Operating modes as presets over existing switches (no migration).
3. AI-assisted bot draft (no migration; draft only).
4. Router: per-model capability flags and a visible switch history on the existing provider cards (no migration).
5. Workflow nodes: approval/quality/parallel/merge on the existing graph (additive schema).
6. Groups (**requires migration approval**).
7. Navigation regrouping into the ten workspaces; mobile group chat.
