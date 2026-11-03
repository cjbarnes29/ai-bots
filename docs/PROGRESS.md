# Progress record

Read this first. It is the verified checkpoint. Do not re-audit finished work; continue from "Next".
Update it at the end of every phase.

## Standing rules from the owner (do not break)
- **Zero spend.** Free-only mode is permanently locked ON. No paid models, paid fallbacks or automatic billing.
- **No external tools before Phase 5 is built AND tested.** Bots produce text only, only when asked. No Gmail,
  Telegram or browser code until then. External *reads* are denied by default, enabled per bot. External *writes*
  always need the owner's approval.
- Internal bot-to-bot delegation is allowed (Phase 3), text only, platform-controlled.
- OmniRoute stays untouched and disconnected. Together AI is excluded. OpenClaw and Ollama are optional and
  need the owner's separate approval to install or download.
- **Never ask for, read or display API keys.** Keys go in the owner's `.env` (names in `.env.example`).
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

## Roadmap
~~3 Collaboration~~ done -> **4 Automation (schedules/triggers, text only) is next** -> 5 Approvals + secrets vault +
audit -> 6 Telegram -> 7 Gmail -> 8 Browser -> 9 Android/remote access -> 10 OpenClaw (optional).
Phase 4 must respect: scheduled runs create tasks through `TaskEngine.submit` (so all limits, pause and free-only apply),
a global kill switch, small default frequency limits (free tiers!), and nothing running when the app is stopped.

## How to work here
- Backend: `src/` (Fastify, `node:sqlite`, zod). Dashboard: `web/` (React, Vite, Tailwind 4, TanStack Query).
- `npm run check` = typecheck + all tests + build for both parts. Run the full check once before each commit;
  while developing run only the relevant test files (`npx vitest run <file>`).
- Tests use a scripted fake provider (`src/test-app.ts`, `src/llm/test-helpers.ts`) and a fake dashboard API
  (`web/src/test/fakeApi.ts`). Real-browser tests drive Edge via `playwright-core` against a fake local provider
  (scripts live in the session scratchpad, not in the repo).
- Windows/PowerShell. After `git commit`, add the required Co-Authored-By line.
