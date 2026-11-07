# Handover

A plain statement of where the AI Workforce stands. **It is not finished.** The completion criteria set by the owner are listed with their real state.
Updated whenever something changes. Historical details below include older snapshots; current checkpoint: 2026-11-07.

## Current checkpoint (2026-11-07)
- The latest implementation commit is `f5cb7e5` (M4-M9 modernization). The direct bot task route now includes a capability assessment and blocks explicitly policy-prohibited unsupported requests unless the caller asks for a best-effort attempt; see NV-38 and the 2026-11-07 entry in `docs/PROGRESS.md`.
- Current full check: backend 2,013 tests, dashboard 447 tests, both typechecks and production build pass. The dashboard build still warns that its minified JavaScript chunk is larger than 500 kB.
- Real-provider P-49 remains unapproved and unrun. No real provider requests were made for this audit/change. Guardian Tier B, dedicated account, VM/isolation and elevated firewall audit remain not built or not run; unattended operation remains unavailable.
- This file's sections 1-8 contain historical owner guidance and older snapshots. For current implementation detail, use `docs/PROGRESS.md`, `docs/CAPABILITIES.md` and `docs/REPOSITORY-AUDIT-2026-11-07.md`.

## 1. Completion criteria (the owner's list) and their real state
| Criterion | State | Evidence / what is missing |
|---|---|---|
| Core functionality works | **Yes, for what exists** (tested on fake services) | 1,278 backend and 250 dashboard tests. Real Gmail, Telegram, GitHub, Notion, Google, Gemini, map and website access are NOT verified (board NV-1 to NV-4). |
| Security controls implemented and tested | **Partly** | Guardian Tier A, owner proof, pause/stop, fail-closed, application discovery and permission levels, folder permissions (`docs/ACCESS-CONTROL.md`): built and tested. Not built: Tier B, OS-level enforcement of folder permissions, file-transfer queues, a desktop-control connector. |
| Guardian Tier B verified | **NO. Not built.** | `docs/GUARDIAN.md` section 9 lists what must exist. |
| Isolation requirements verified | **NO.** | No VM, no dedicated account, no firewall rules, no in-guest test. The elevated audit is prepared, not run. |
| Critical tests pass | **Yes for what exists** | `npm run check`. |
| Documentation complete | **For the built parts yes; for unbuilt parts it is design only** | `docs/GUARDIAN.md`, `docs/SECURITY-AUDIT.md`, board, this file. |
| Installation and recovery procedures documented | **For Tier A yes. Tier B: not yet (nothing to install).** | `docs/GUARDIAN.md` sections 8 and 10. |
| Remaining risks and administrator-dependent steps identified | **Yes** (sections 5 and 6 below) | |

**So: do not treat the system as ready for unattended or autonomous operation. It is safe for supervised development and testing with the Guardian running and you present.**

## 2. What exists
- **App** (Fastify + SQLite + zod in `src/`; React dashboard in `web/`): bots, Manager AI, delegation, workflows, schedules, approval gate, vault, integrations, PC agent (fixed program list, no shell), memory, Business Workforce (fake data only). See `README.md` and `docs/PROGRESS.md`.
- **Guardian (Tier A)** in `src/guardian/`: separate stop/pause program with its own port and files. See `docs/GUARDIAN.md`.
- **Desktop engine** in `src/desktop/` and Access > Desktop control: operates only programs it starts, from the approved list, through UI Automation and local OCR; every plan needs your approval; see `docs/DESKTOP-ENGINE.md`. **Incident 2026-11-04** (Notepad tab overwritten by a probe) is documented in `docs/SECURITY-AUDIT.md` 1c; recovery is yours. **Uncommitted.**
- **Integrations Center** (page **Integrations Center**): pick one service, press **Connect**, follow the steps. AI providers have their own wizard (key, free-plan check, test, models), other services a six-step wizard with the right sign-in (token, address, or Google sign-in). Keys go to the encrypted vault and are never shown again. The full list of every saved key is still there, under **Advanced** at the bottom.
- **Bot Studio** (page **Bot Studio**, `src/bot-studio/`): templates, content-only bot export/import, AI-drafted bots (you review before saving), operating modes that only limit a bot. New bots start switched off with every permission off. **Group chats are not built and not switched on**: their database tables now exist (migration 017 revision 2, approved and applied 2026-11-04, D-047; they are empty), but the group service (who may read what, participation limits, loop prevention, Guardian) is not built yet (NV-15).
- **Owner proof**: dashboard dialog and `x-awp-proof` check, backed by the Guardian.
- **Access module** in `src/access/` and the **Access** page: read-only application discovery, application levels (Unknown, Approved, Trusted, Protected), independent folder permissions (default deny; read, create, edit, rename, delete), audit record. The PC agent and document writer obey it. Specification, enforcement map and limits: `docs/ACCESS-CONTROL.md`. **Uncommitted** (board P-16).
- **Prepared, not run:** `scripts/security/firewall-audit.ps1` and the review-only Tier B scripts in `scripts/security/tier-b/` (plan: `docs/TIER-B-PLAN.md`).

## 3. Setup from scratch (Windows)
1. Install Node 24 and Git (already on this PC). In the project folder: `npm run install:all`.
2. (Optional, `.env`) create `.env` for keys; never put keys anywhere else or in Git.
3. Guardian: `npm run guardian:passphrase`, then `npm run guardian` in its own terminal, then add `GUARDIAN_URL=http://127.0.0.1:3100` to `.env`. Details and all settings: `docs/GUARDIAN.md` section 8.
4. App: `npm run dev:all`; open http://127.0.0.1:5173; resume at http://127.0.0.1:3100.
5. Test: `npm run check` (typecheck, all tests, builds). Guardian tests alone: `npx vitest run src/guardian src/guardian-integration.test.ts`.
Dependencies: only the three runtime packages already used (`fastify`, `@fastify/cors`, `zod`). The Guardian adds **no** package. No migration, no new account, no service, no firewall change.

## 4. Security boundaries (what protects what)
- **Approval gate:** reads need a per-agent switch; every write needs your approval and runs once. Unchanged.
- **Guardian:** while not RUN nothing new starts; owner-only changes need the passphrase proof. Separate process, closed command list, fails closed.
- **Secrets:** vault or `.env` only; never printed or logged; never in Git (`data/` and `workspace/` are ignored).
- **Folder and application permissions:** enforced by the app for the PC agent and document writer, denied while the Guardian holds, changed only with your passphrase proof. **Not enforced by Windows**: a program the AI runs, or any same-account script, can reach what your Windows account can (S-19).
- **Not a boundary yet:** anything that depends on Tier B, a dedicated account, or a VM.

## 5. Remaining manual steps (only the owner can do these)
0. After you update: the PC agent's workspace folders now also need a folder approval under **Access > Folders** (default deny). Open Access, approve the folder you want the PC agent to use, then try it. Report what you see (board NV-11).
1. Set the Guardian passphrase and put `GUARDIAN_URL` in `.env` (section 3).
2. Run the three manual Guardian checks (lock, 15-minute idle, STOP during a task): `docs/GUARDIAN.md` section 11. Report the results.
3. Run the elevated read-only audit and share the output: `docs/SECURITY-AUDIT.md` section 1.
4. Review and decide on each later change the assistant proposes (firewall, services, account, VM). Each needs your explicit approval and, for administrator steps, your own UAC approval each time.
5. Approve (or not) a commit of the current work: it is **uncommitted**.
6. Provide the Gemini key and Google client when you want real tests (NV-3, NV-4); approve the exact real external test requests (P-5).

### 5b. Integration test status (2026-11-04; report: `docs/INTEGRATION-FUNCTIONAL-TEST.md`)
- No real integration has been verified: this PC holds no credentials. Gemini/Groq/OpenRouter, Telegram, Gmail, Google Workspace, GitHub and Notion are **BLOCKED**; automatic routing, n8n and MCP are **PARTIAL** (real code over HTTP against fake local services only).
- To unblock, per service: see the table "What is needed to test the BLOCKED items later" in the report (key/token/client, a dedicated test workflow for n8n, an approved MCP server). Re-runnable checks: `node scripts/e2e/routing-e2e.mjs`, `node scripts/e2e/mcp-n8n-e2e.mjs` (scratch instances, no network, no real data).
- The app on port 3000 runs under `tsx watch` and restarted itself at 23:22:19 on 2026-11-04 (same second as the MCP fix was saved), so it already runs the fix; no manual restart is needed. Real Gemini test is prepared but NOT run: `scripts/e2e/gemini-real.mjs` (needs a key from a no-billing project and your approval of exactly 4 requests; steps at the top of the file). Gmail draft creation is a MISSING capability awaiting a feature decision (not implemented, by instruction). Tick Ollama/OmniRoute in Settings > Model routing if you want them used by automatic routing.

### 5c. Try the application without any account (2026-11-05, `docs/DEMO-MODE.md`)
- Open the Dashboard and press **Set up the demo** (not yet pressed on your real database). It adds a simulated AI (every answer starts with "[SIMULATED RESPONSE - no real AI was used]"), four sample agents and two sample workflows you can run, edit and delete. It makes no outside request and costs nothing. It is not a real AI; connecting a real provider is still the only way to get real answers, and nothing about any real service has been tested.
- Automatic routing will not use the simulated AI unless you tick it by name in Settings > AI Models > Model routing.
- New screens: "Your AI right now" and routing strategy on the Dashboard; provider order, first choice per task, default model and availability in Model routing; next steps and "Which services do I need?" in the Integrations Center.

### 5d. Gemini rate limits (2026-11-05, details in docs/PROGRESS.md)
- A model that hits its free-tier limit now rests on its own (1 minute, growing to 1 hour, or until midnight Pacific for a used-up daily quota) and its sibling models keep answering. Models built for another job (computer-use, guard, embeddings...) are never chosen automatically. Settings > AI Models > Model routing shows which model is resting. Free-only rules are unchanged. Not verified against the real Gemini; the daily-quota wording is a guess.
- **Recommended Settings** (Settings > Recommended Settings): finished and tested with fake services, uncommitted. Press Apply only on what you want; every change can be restored. Not yet tried against a real provider.

### 5f. Capability registry and feasibility checker (2026-11-06)
- The platform can now list what it can really do, with six separate evidence levels (installed, configured, authenticated, operational, tested, verified), and the Manager checks a task before accepting it. Open `/api/capabilities` to read it (no screen yet). `docs/CAPABILITIES.md`. Tested with fake services only; everything stays supervised-only. Uncommitted.

### 5g. Automatic capability discovery (2026-11-06)
- Open **Apps & Integrations > Capabilities** (Advanced level) or ask the Assistant "what can you do?". The list builds itself from the real services: new agents, workflows, AI models, connections and tools appear, removed ones disappear, and every change is written to the audit log. A new agent says "set up, not proven" until it completes a task. Workflow runs are refused (with reasons) when an agent they use cannot run; you can still send them with `proceedAnyway`. Tested with fakes only; not yet checked in a real browser or with a real provider. Uncommitted.

### 5h. Result checks, outside-action workflow boxes, menu headings and VM readiness (2026-11-06)
- **Task page > Result check** now says whether a result is confirmed by the platform (an approved action ran, the file really exists), not checked (a text answer), waiting for your approval, or contradicted (the reply claims something the record does not support). "Completed" alone never means confirmed.
- **Workflow editor > Add Outside action:** a box that does something outside through the same approval gate. A write waits for you on the Approvals page and the workflow continues right after you decide. The checkpoint buttons cannot approve it.
- **Menu:** the same 12 entries under seven headings (Global Assistant, Inbox, Projects, Workflow Studio, Business Workforce, Activity, Settings).
- **Capabilities page > Desktop and VM readiness:** a read-only checklist; the VM is NOT built and nothing was installed or changed.
- **Waiting for you:** the real-provider test needs your approval of exactly 16 free Groq requests (`docs/PROVIDER-VALIDATION-PLAN.md`, board P-49). Until then none of this has been seen with a real model.
- Two commits were made at your instruction (`18dfce7`, `952f4b4`); the work in this section is **uncommitted**.

### 5e0. Chat error "Developer instruction is not enabled" (fixed in code, 2026-11-05)
- Models that do not accept a system message (the Gemma family) now get the bot's instructions inside the first message instead. Tested against a fake provider only; try the same bot again and tell me if the error is gone.

### 5e. Studio redesign, Inbox, Projects and Group chats (not built)
- Plan and review: `docs/STUDIO-INTEGRATION-MAP.md`, `docs/MIGRATION-018-REVIEW.md`. **Migration 018 (revision 2) is applied** (2026-11-05, backup `data/backups/2026-11-05_012948`); the tables are empty and nothing uses them yet. Next is the inbox and projects service, then the conversation screens.

### 5e5. After the real model tests and migration 019 (2026-11-05)
- Your automatic bots now use two Groq models that passed the tests: qwen3.8-27b and gpt-oss-120b. No Gemini model is verified yet (gemini-3.8-flash answered "high demand" twice). Gemma 4 works with a real system message. Details: `docs/MODEL-REGISTRY.md` section 10. Decisions waiting for you are on the board as P-32.
- Migration 019 is applied; the Decisions service is live in the app (no screen yet). Backup: `data/backups/2026-11-05_123019`. Nothing is committed.

### 5e4. Gemini and Groq models: what changed (2026-11-05)
- Settings > AI Models now has a **Model registry**: every model the two providers list, what kind it is, and whether bots may use it. Only **verified** models are used automatically or can be given to a bot. Today that is ONE model (Groq `gpt-oss-20b`), so your five automatic bots use it. More models become usable when they pass real tests, which needs your approval of the exact requests (`docs/MODEL-REGISTRY.md` section 8, P-29). Press **Refresh models** whenever you like; it is a free list request.
- Speech, image, music, realtime and similar models are listed but can never be chosen as chat models. `gemini-2.5-flash` is retired for your account (use `gemini-3.8-flash` after it is verified).
- Replies that are only a model's internal reasoning now fail and the next model is tried.
- Optional, off by default: Settings > Teamwork limits > separate jobs at the same time; Model routing > share work between providers. The app's cap of 50 requests per provider per day is unchanged (decision P-30).

### 5e3. Real run of six provider requests (done 2026-11-05)
- Groq works (correct answers). Gemini's `gemini-2.5-flash` is retired by Google (still in your list). A Gemma 4 bot answered without the earlier 400 error, but ignored its instructions and showed its internal reasoning; one reply was unusable. Three follow-ups wait for your decision (board P-28). Do not give a bot `gemma-4-*` or `gemini-2.5-flash` for now. Nothing else was changed; a temporary test bot was created and archived.

### 5e2. Model switching and provider independence (2026-11-05)
- Bots keep their identity, instructions, memory, permissions and history in the application database whatever model answers. Proven only with fake providers (`docs/MODEL-SWITCHING.md`); a real check needs your approval of 6 exact requests (P-26). Your live app shows Gemini and Groq connected.
- Likely cause of the "Developer instruction is not enabled" error you saw: a speech model (`gemini-3.5-transcribe`) was listed as a chat model. It is now excluded from automatic routing and from new model lists. Press **Refresh models** (Settings > AI Models) so it disappears from your list, and do not give a bot that model by hand.
- Task results now end with a platform-written record when an outside action is waiting or was refused, so a model cannot make a pending request look done.
- Next for bots (not built): the playbook and the guided creation screens (`docs/BOT-SYSTEM-DESIGN.md`).

### 5e1. Backend for the inbox, projects and decisions (built 2026-11-05, nothing to see yet)
- Inbox and projects work in the running app but there is no screen for them yet (the API answers: /api/inbox, /api/projects). Decisions (the chalkboard) exist only as tested code: they switch on by themselves once you approve migration 019 revision 2 (`docs/MIGRATION-019-REVIEW.md`). You asked for changes to revision 1 and then reviewed revision 2; **revision 3 (with all your corrections) is ready for your approval**. The only change that already ran is in the app's code: the database connection now sets `recursive_triggers` (no data changed).
- Nothing is committed (board P-23, P-25).

### 5e-old. Chat, Inbox and Group chats (earlier note)
- You asked for a ChatGPT-style chat, a messaging-style Inbox where bots write to you, and Manager-coordinated group chats. None of it exists yet. It needs a new database migration (`docs/proposals/018_inbox.sql`, not applied) which only you can approve, and a decision on building the group service (NV-15, P-21). See the end of `docs/PROGRESS.md`.

## 6. Administrator-dependent and approval-dependent work (not done)
Tier B install (service or system task); firewall rules and any change to Public any-port rules; NetBIOS/file-sharing unbinding on VMware adapters; the dedicated Windows account; VMware VM and network creation; Windows evaluation image (licence terms unchecked, NV-7).
For each, the assistant prepares a reviewed script or instructions; it does not run them. Prepared so far: `scripts/security/tier-b/01-create-ai-account.ps1`, `02-firewall-rules.ps1`, `03-install-guardian.ps1`, `99-rollback.ps1` (dry run by default, parse-checked only). The Tier B Guardian build itself does not exist yet.

## 7. Known limitations and unresolved risks
See `docs/GUARDIAN.md` section 12 (L-1 to L-9) and `docs/SECURITY-AUDIT.md` sections 3 and 4 (S-13 to S-18). The biggest: Tier A does not stop a hostile script of your own Windows user; the idle timer counts synthetic input; nothing about the VM, firewall or isolation is verified; unattended operation is not allowed.

## 8. Recovery
`docs/GUARDIAN.md` section 10. Safety copies of the project exist as Git tags `rollback/before-*` (local only; nothing is pushed; there is no remote).
