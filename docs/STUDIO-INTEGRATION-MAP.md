# AI Workforce Studio: audit and integration map (2026-11-05)

Status: **audit only. Nothing of the redesign (projects, inbox, group chat, unified Workflow Studio, new Settings/Dashboard) is built.** This file says what exists, what can be reused, and what is missing, so the build can be planned honestly. Sources: the code in `src/` and `web/src/`, `docs/PROGRESS.md`, `docs/HANDOVER.md`, `docs/DECISION-BOARD.md`.

## 1. What exists and how the Studio would reuse it
| Studio need | Existing piece | Reuse | Gap |
|---|---|---|---|
| Normal chat with Manager AI or a bot | `src/chat` (per-bot conversations, `ChatService.sendMessage`), `src/manager` | Yes, as the engine of every conversation | Chat is request/answer, no streaming, no stop, no regenerate, no rename/hide, always starts with the user, always bound to ONE bot (`conversations.bot_id NOT NULL`) |
| Model choice and automatic routing | `src/routing`, `src/llm` (resting models, specialised-model filter) | Yes, unchanged | Model selector per conversation is not exposed in the chat API |
| Specialist bots, hidden from the main navigation | `src/agent-manager`, Bot Studio | Yes. The pages stay reachable (Settings > Workforce) | Nothing removed from the backend |
| Delegating work from chat | `src/delegation` (task engine, depth/call limits), `src/manager` plans | Yes | Chat does not yet show task progress inline |
| Group chats | Migration 017 tables (empty) | Tables only | **No group service** (authorization, visibility, loop guard, Guardian) and **groups are NOT enabled** (NV-15) |
| Bot-initiated messages | Nothing writes to a chat first; `src/monitor`, approvals and task events exist | Events exist to listen to | Needs migration 018 (event-tied meta, unread, caps) |
| Projects | Nothing | n/a | Needs migration 018 rev 2 (`projects`, `project_items`) |
| Knowledge / memory | `src/memory` (bot, shared, history), Knowledge page | Yes, linked to a project via `project_items` | Project instructions must be added to the prompt by the chat service, as untrusted text that never grants anything |
| Workflow Studio | `src/workflows` (graph of nodes, saved queue, runs, checkpoints), `web/.../WorkflowEditor.tsx` | Yes: ONE engine | See section 2 |
| Scheduler | `src/automation` (schedules, triggers, pause switch, failure rule, limits) | Yes | Today a separate page and separate model; the workflow `trigger` node has only manual / event / interval |
| Approvals | `src/approvals`, approval gate on every outside write | Yes, unchanged | Approval requests do not appear in a conversation |
| Business Workforce | `src/business` (map lookup, website audit, scoring, CSV/Excel export, proposal prompt, installable team + workflow with 3 checkpoints) | Yes | Built and tested on FAKE data only. Outside requests are OFF; **no real map or website request has ever been made** (P-5, NV-3). Not reachable from chat |
| Spreadsheets / documents | `src/documents` (xlsx, docx, pdf, pptx writers), `connectors/documents.ts`, folder gate + approval | Yes | Works through an approved action; verified only on files the tests open |
| Web reading | `connectors/browser` (one GET, public addresses only) | Yes | Per-bot switch, read-only, no crawling or logins |
| Settings | `web/.../settings/categories.tsx` (10 categories incl. Recommended Settings) | Partly | Redesign to the brief's 10 categories, cards, presets, "what happens when on/off" text |
| Guardian, folder and app permissions | `src/guardian`, `src/access` | Unchanged | Every new file/PC/outside action must go through them |

## 2. Workflow Studio gap list (brief vs `src/workflows/graph.ts`)
Existing node types: `trigger` (manual, event, interval of 15 minutes or more), `bot_task`, `manager`, `condition`, `checkpoint` (approval), `set`, `end`.
- **Present:** manual start, repeating interval, bot/manager steps, condition and branch (true/false edges), approval checkpoint, stop (`end`), retries (0 to 2), run history, pause switch (automation).
- **Missing in the workflow graph:** scheduled date and time, delay, wait-for-event, repeat (loop), group-conversation node, send-to-inbox, save-to-project, browse website, extract data, create spreadsheet/document, task-completion / file-arrival / approval-event triggers (the automation module has event and task-result triggers, but they are a separate system), retry of a failed run from the editor, drag-and-drop palette beyond the existing editor.
- **Rule for the build:** extend `graph.ts` and the existing runner; do NOT add a second engine. Every new node must call existing services (browser connector, documents connector, approval gate) so Guardian, folder permission and approval apply. A retry must re-enter through the same limits and approvals. Nodes for capabilities that are not verified (research, browsing, spreadsheet, proposal) must show "not available / not verified" instead of pretending.

## 3. Navigation (target) and what moves
Target sidebar: Inbox, Projects, Workflow Studio (with schedules), Business Workforce, Activity, Settings. Today's pages map as: Dashboard -> Inbox/Projects home; Agents & Teams, Bot Studio -> Settings > Workforce and the conversation/project configuration; Approvals -> inside conversations and Activity (page kept); Schedules -> inside Workflow Studio; Integrations Center, PC Control Center, Access -> Settings; Knowledge -> project. No route is deleted until its replacement works; backend untouched.

## 4. Database
- Needed: migration 018 (`docs/proposals/018_inbox_rev2.sql`: 7 tables, 13 objects incl. indexes). **Not applied. Waiting for the owner's explicit approval (board P-21).**
- Verified on a scratch in-memory database (not the real one): see `docs/MIGRATION-018-REVIEW.md`.
- Everything else in this map needs no migration.

## 4b. Relevant answers with options, and the Decision Chalkboard (owner request 2026-11-05)
Request: when the owner asks something, the bots whose responsibilities and assignments fit answer with OPTIONS to choose from; the question and options can be put on a chalkboard of decisions where the owner can read, edit and approve them as a project, and the assigned bots report back.
(Name: the in-app feature is called **Decisions** / "Decision Chalkboard" to avoid confusion with the developer file `docs/DECISION-BOARD.md`.)
- **Who answers (relevance).** Deterministic first: each active bot's `role` and `responsibilities` (already stored in `bots`) and its open assignments (`tasks`, `decision_assignments`) are matched to the question; an explicit @mention always wins; Manager AI picks when nothing matches clearly. At most 3 bots answer one inquiry, each at most once, no bot-to-bot replies; all calls go through the existing chat/task engine, routing, free-only limits and Guardian. A bot with nothing relevant stays silent (no filler messages).
- **Options.** A bot answers with 2 to 5 options (title, details, pros, cons). Model output is a DRAFT: it is only saved to the chalkboard when the owner presses "Put on the chalkboard"; code never saves it by itself (as for Bot Studio drafts, D-046).
- **Chalkboard.** The owner can edit option text, add or remove options, add a note, choose one, then **Approve as project**. Approving creates or links a project (`projects`), records the assignments (`decision_assignments`: which bot does what, editable) and starts the tasks through the normal task engine. Approval grants NO permission, folder, program or secret; any outside action those tasks need still waits for the usual approval.
- **Report back.** Assigned bots post `decision_reports` (progress, done, blocked, question) tied to their real task (one per task and kind); the report also reaches the inbox through `inbox_message_meta`. Nothing is simulated.
- **History.** Every edit, choice and approval is kept (`decision_revisions`, append-only); decisions are archived, never deleted.
- **Needs migration 019** (`docs/proposals/019_decisions.sql`, 5 tables, 22 objects incl. triggers). Verified on a scratch database only (16 checks); NOT applied; waiting for the owner (board P-24). Not built: service, chat integration, chalkboard page.

## 4c. What is built so far (2026-11-05, backend only, UNCOMMITTED)
| Piece | Where | State |
|---|---|---|
| Inbox service | `src/inbox/` (service, sources, routes) on migration 018 | Built and tested (22 tests). Bots appear only for REAL events: a finished or failed root task, an approval request, a schedule or trigger that switched itself off. The message text is built from the event, never from the caller; there is no route to post a message; one message per event and kind; an hourly cap per bot (default 6, 1 to 60) holds the rest back and records them; unread (bot-first messages only), pin, mute, archive, hide ("delete" keeps every message), rename, search, per-bot notification preference. The alert decision (`notifier`) is NOT wired to phone alerts yet. Not supported on purpose, no verified producer: clarification / report / note messages, failed workflow runs |
| Projects service | `src/projects/` on migration 018 | Built and tested (16 tests). Create, rename, archive, search, "delete" = hide with the exact name; link conversations, workflows, schedules, tasks, notes (never copies; one project per item); group chats refused while groups are off. Project instructions are added to a conversation's context from its first message, labelled as context that grants nothing |
| Chat hooks | `src/chat/`, `src/runtimes/` | `projectId` on the chat request; `projectContext` on the runtime input |
| Event hooks | `src/app.ts`, `approvals/service.ts` (`onPending`) | The task engine's `onRootFinished` now feeds automation, decisions and the inbox; the approval gate tells the inbox when a request starts waiting |
| Decisions service | `src/decisions/` | Built and tested (34 tests; migration 019 is revision 3, awaiting approval) against the PROPOSED migration 019 on in-memory databases only. In the real app the routes exist only if the `decisions` table exists, so today they do not (GET /api/decisions is 404 on the live app). See `docs/MIGRATION-019-REVIEW.md` |

Decisions in short: the owner asks (`POST /api/decisions/inquire`); at most 3 bots whose role, responsibilities or current tasks match (or who are @mentioned) each make one model call and return 2 to 4 options as a DRAFT; the owner puts a draft on the chalkboard (once) or writes options by hand; edits, choice, rejection and approval are the owner's; `review` runs a bounded, reasoned round of views (stances) that never decide; `approve` (compare-and-set) creates or links a project, assigns the bots and starts each task ONCE through `engine.submit`; finished tasks write one `done` or `blocked` report each; the whole history is written by the database.

Open points for the next phases: dashboard screens for all of this, group conversations (NV-15), a verified way for a bot to raise a decision or ask a question mid-task, wiring the alert decision to phone alerts, real-provider checks of the prompts.

## 4d. Models and bots (2026-11-05)
Provider independence, output contracts, the platform-written task record and the instruction order are built and tested on fakes (`docs/MODEL-SWITCHING.md`). The persistent-coworker design (playbook, proposals, dashboards) is in `docs/BOT-SYSTEM-DESIGN.md`; not built.

## 5. Browser verification
None performed for any redesign item (none exists yet). The chat-error fix (section below in PROGRESS) is verified by unit tests against a fake provider only.
