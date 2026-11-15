# Handover

A plain statement of where the AI Workforce stands. **It is not finished.** The completion criteria set by the owner are listed with their real state.
Updated whenever something changes. Historical details below include older snapshots; current checkpoint: 2026-11-15.

## Resume here: D-110 option A BUILT (workflow drawing zoom/pan, uncommitted; see plan "Option A built"). Earlier D-109 scratch prototype DONE (see `docs/WORKFLOW-CANVAS-PLAN.md` "Prototype result"; repo unchanged, next needs the owner: add dependency to repo, or fall back to option A). Earlier D-108 plan ( read `docs/WORKFLOW-CANVAS-PLAN.md`; plan only, nothing installed or built). Earlier: D-106 committed; helper-switch draft test added (2026-11-15)

- **Committed locally 2026-11-15 (owner approved all four; no push):** `3505a6b` P-49 results and verifier fixes, `f412fdf` backend verification/provenance/approval linkage/execution assessment, `c354fdf` dashboard (approvals, result checks, Projects/Assistant read states), `a39be3e` docs and evidence. Each was verified from a staged-only export (autocrlf off): 2,015/2,322/2,322/2,322 backend and 447/447/514/514 dashboard, typechecks and builds. Left untracked on purpose: `.codex-remote-attachments/`, `.commit-review/`, `AGENTS.md`. Older "UNCOMMITTED" wording below is historical.
- Added the required helper-switch regression test (`web/src/assistantReadStates.test.tsx`, now 10 cases): an unsent message and the helper choice survive switching helper. Docs-and-test change after the commits is UNCOMMITTED.
- **Daily-use re-run done (D-107, uncommitted):** 63 passed, 0 findings, 10/10 scenarios on the fake-service harness.
- **Remaining:** real usability/phone/screen reader/provider, Tier B, owner recovery, Gemini/Google setup (owner). Offer clickable choices.

## D-106 context (historical): Assistant slice built (2026-11-15)

- Owner chose the Assistant slice. Built (presentation only): failed agent/suggestion/change reads now say so with Retry; neutral "Review change" label after a decision; chat before earlier results with a "Results and review changes" button; side column Changes, Suggestions, Workflows; selector "New conversations go in". Files: `web/src/pages/Assistant.tsx`, `web/src/components/assistant/AssistantPanels.tsx`, new `web/src/assistantReadStates.test.tsx` (9 cases). Full check passed: **2,322 backend + 514 dashboard**, typechecks, build. Board D-106, PROGRESS "Assistant slice".
- **Browser re-run done:** hub 113/113, levels 44/44 (script fixes: Files heading text, two waits). `daily-use-e2e.mjs` not re-run (overwrites D-104 evidence; run only if the owner accepts replacing results.json). **Next choice (clickable):** helper-switch draft regression test, daily-use re-run, or commit review. Nothing is committed; keep all staged/unstaged work. Real phone/screen reader/provider, Tier B and owner recovery stay NOT VERIFIED.

## D-105 context (historical): Projects slice checked (2026-11-15)

- Owner chose the Projects slice from clickable options. The Projects list and hub read states (failed read + Retry, empty vs no-match, loading, stale cache, attention-first Overview) were already in the working tree and covered by the untracked `web/src/projects-modernization.test.tsx`; only a test timing fix was made (`await findByRole`, assertions unchanged). Full check passed: **2,322 backend + 505 dashboard**, typechecks, build. See board D-105 and PROGRESS "Projects slice check".
- **Next choice (offer as clickable options):** Assistant slice (DU-READ-HELPERS, DU-READ-SUGGESTIONS, DU-REVIEW-LABEL, DU-PHONE-HISTORY per `docs/PROJECTS-ASSISTANT-REDESIGN-PLAN.md`), a real-browser re-run of the 503 project-list case with fake services, or the commit review. Nothing is committed; keep all staged/unstaged work. Browser re-check of the Projects slice and Tier B, owner recovery and real devices stay NOT VERIFIED.

## D-104 context (historical): walkthrough complete; D-103 refined, UI unimplemented (2026-11-15, Asia/Dubai)

- Owner selected “1” to execute the fake-service walkthrough and refine the saved redesign plan. **Done:** all 10 scenarios observed, 60 passed checks, 3 automated S2 findings plus 2 visual S3 observations. `docs/DAILY-USE-WALKTHROUGH.md` has actual results, issue IDs, seeded/real-in-scratch distinctions, harness corrections, limits and source evidence. Final authoritative JSON: `docs/evidence/daily-use/1794739317728-results.json` (also results.json). Earlier diagnostic/weak phone assertions are superseded, not acceptance evidence.
- **Next implementation choice:** Projects slice first (DU-READ-PROJECTS then Overview), then Assistant slice (DU-READ-HELPERS, DU-READ-SUGGESTIONS, status-neutral review labels and phone chat/result placement). Exact refined spec: `docs/PROJECTS-ASSISTANT-REDESIGN-PLAN.md`, D-104 refinement. Findings are UNFIXED; no UI/product change was included. Do not rerun or re-plan the finished walkthrough, or jump into unselected UI work.
- Preserve positive observations: drafts/membership/context survived observed actions; temporary attachments stayed temporary; safe/review/restricted rules, deny→NEW request→approve, weak Manager-link ceilings and controlled scratch restart behaved as recorded. Reuse existing ContextLinks/ChatTab/stores. Helper-switch/cached-refresh/screen-reader/real-device/real-provider/owner-feedback cases remain unobserved.
- **Test state:** new standalone harness syntax passed; existing projectHub/projectWorkspace/assistantKnowledge UI tests 19/19 passed. No new full product check for harness/docs-only work; latest full code checkpoint is D-101 (2,322 backend + 484 dashboard/typechecks/build; workflow browser 42/42). No production timeout/quota/assertion/guard changed. Final fake calls 17/32; defaults were respected with injected-clock pacing. All scratch DB/files removed; no real outside request/owner DB/vault/.env access.
- Owner explicitly wants Claude handover kept current. All earlier product changes and original staged P-49 verifier blobs remain preserved/uncommitted. New files are the walkthrough harness/report/evidence and refined docs. No staging/unstaging/commit/push/deploy/install/migration or real permission boundary change. Read AGENTS.md, decision board and PROGRESS first; keep Tier B, real recovery, backlinks/read receipts and independent output proof open.

## D-102/D-103 planning context (historical)

- **Owner's latest direction:** “1 and then 2 after but still update claude handover docs.” Both requested plans are saved, in order: `docs/DAILY-USE-WALKTHROUGH-PLAN.md` (D-102), then `docs/PROJECTS-ASSISTANT-REDESIGN-PLAN.md` (D-103). **Walkthrough NOT RUN; redesign NOT IMPLEMENTED.** No new application/test/schema change or test run from this planning checkpoint.
- **Next execution choice:** run the fresh scratch/fake daily-use walkthrough first and save actual findings/screenshots; then refine the already saved D-103 plan from those findings. Do not jump directly to redesign implementation, claim planned scenarios passed, or invent beginner feedback. Current request prepared plans, not execution or a commit.
- **Source findings informing the plans:** failed project/helper reads can resemble empty/missing data; project hub lists have known limits; ChatTab files only NEW conversations under a selected project. D-103 clarifies those states and prioritizes existing attention/review controls, without silently moving chats, granting access or adding stores/libraries/APIs. Shared workspace remains a view over existing memory/tasks/approvals.
- **Latest successful implementation stays D-101:** full 2,322 backend + 484 dashboard tests/typechecks/build; workflow browser 42/42. Existing test failure history/correction is in `docs/WORKFLOW-RESULT-CHECKS.md`. No need to rerun finished suites for these docs. All reliability/UI work remains uncommitted with original staged P-49 verifier blobs unchanged. Do not stage/unstage/reset or combine prior work.
- Owner explicitly wants this handover maintained for Claude. Read AGENTS.md, decision board and PROGRESS first. Preserve output/Manager backlink/read-receipt/semantic/real-device/owner-recovery/Tier B limits; no real provider/outside call, owner DB/vault/.env access, installation, permission change, commit, push or deployment implied.

## D-101 completed context (historical)

- Owner replied “1” to implement the saved workflow result-check plan. Endpoint, shared validators/observations and on-demand panel are complete. Final npm run check passed: **2,322 backend (106 files) + 484 dashboard (52 files)**, both typechecks/dashboard build; new cases 64 + 12; synthetic browser **42/42**. See `docs/WORKFLOW-RESULT-CHECKS.md` for exact changes, corrections, screenshots and limits. No application changes after final checks.
- Workflow Manager references remain unbound with zero inherited evidence; output remains unverified. Missing receipts/links, skipped/incomplete/uncertain work, unlinked attempts and processing bounds are explicit. No executor, permission, schema, dependency, owner-data or real-service change.
- All requested work and actual results are saved for Claude. Preserve every staged/unstaged change; no staging/commit/push/deploy. Frozen P-49 staged verifier hashes below remain unchanged, including despite this slice's working-only observation extraction. Live app remains stopped; no owner DB/vault/.env or real provider/outside call used. Existing warnings remain.
- Test recovery: first full run hit an unchanged dashboard schedule timeout; second hit an existing Manager 250 ms fake-provider race and follow-on closed-test-DB rejections. The Manager test now uses an explicit release barrier/finally-drain with all original assertions; targeted 91/91 and the final whole check passed. No timeout, test assertion or production limit weakened. Do not rerun finished checks without a new reason.
- Next recommended choice: plan a supervised synthetic daily-use walkthrough, then Projects/Assistant redesign. Exact Manager backlinks/read receipts/final-output proof, real phone/screen reader, owner recovery and Guardian Tier B remain separate gaps; no automatic further implementation or commit. Read AGENTS.md, decision board and PROGRESS first; do not redo D-098/D-099/D-101.

## D-100 planning context (historical)

- Owner selected workflow result-check planning (option 1). Read `docs/WORKFLOW-RESULT-CHECKS-PLAN.md` before continuing: exact existing-records scope, shared approval validator, endpoint/panel, failure tests, source-only rollback and limits. **NOT IMPLEMENTED; no application/test changes or new suite run.**
- Critical source finding: workflow-started Manager runs have requested_by=workflow but no exact workflow-run/node backlink. V1 must mark these unbound and inherit zero evidence. No timestamp/summary/forward-link guess; durable backlink work deferred. Read outputs without receipts and overall workflow deliverables stay unverified.
- Next choice: implement the saved bounded plan with synthetic/full/browser checks, or review the approval-binding extraction first. No commit, migration, dependency, live DB/key/provider access implied. Preserve index and all earlier working changes. Owner asked for docs so Claude can resume later.
- Latest implemented/tested checkpoint remains D-099 below: full 2,258 backend + 472 dashboard/typechecks/build and Manager browser 29/29. Do not redo D-098/D-099. Read AGENTS.md, decision board and PROGRESS before continuing.

## D-099 completed context (historical)

- Owner selected and requested implementation of Manager evidence checks plus the visible panel. Complete: 38 new backend/11 dashboard cases and 29/29 fake browser checks. See `docs/MANAGER-RESULT-CHECKS.md` for interface, files, corrections, limits and source-only rollback guidance.
- Final `npm run check` passed: 2,258 backend tests (105 files), 472 dashboard tests (51 files), both typechecks and dashboard build. Existing DEP0190/bundle warnings remain. No application changes afterward; no real provider or owner-data test.
- Preserve all prior staged/unstaged work. No staging/unstaging/commit, migration, dependency, real provider/DB/key access. Original staged P-49 verifier blobs remain unchanged (hashes below). Live app remains stopped. The owner explicitly requested saved docs so Claude can pick up later.
- Manager final-summary proof remains unbuilt: the new panel keeps it unverified and shows helper evidence separately. Workflow-wide checks, exact targets/content/delivery, quality/languages, owner recovery and Guardian Tier B remain pending. No new permission, execution or Guardian path.
- Next proposed choice: plan workflow-wide result checks, or leave this saved checkpoint for Claude. Wait for the owner's choice; do not automatically implement another feature or commit. Read AGENTS.md, decision board and PROGRESS before resuming; do not redo D-098 or this panel.

## D-098 completed context (historical)

- **Owner's latest selected work is complete:** reliable saved reply origins implemented from D-097. `docs/REPLY-PROVENANCE.md` contains exact files, actual behavior, corrections and limits; do not redo this or the D-096 UI slice.
- **Latest verification:** full check 2,220 backend tests (104 files), 461 dashboard tests (50 files), both typechecks/dashboard build; 46 new synthetic cases and modernization browser 34/34. Initial exact event-list failures were updated to include the new event, retaining all original assertions. Existing warnings remain; no new real-service/owner-data run.
- **Delivered:** source-labelled result segments, atomic existing-table finish/manifest/lifecycle persistence, strict same-snapshot decoder and unknown/legacy/truncation ceilings in single-task/chains. Failed storage never replays model/actions; no heading-based trust or backfill. One task-history event label is the only additional frontend change.
- **Preserve the working tree/index:** no commit/staging/unstaging/push/deploy. Existing P-49 staged verifier blobs stay `4a0b918a79e2f68ed4a629b21246c494cf197c7d` and `7f003fcb877831c1601e4fd1e7486e3c738b3a96`; working files intentionally include later approved changes. All earlier backend/UI work remains uncommitted too.
- **Remaining:** legacy/unknown origin rows remain unverified, not repaired. Manager/workflow independent final-result projections, target/content/receipt/quality/language proof, real owner recovery, power loss and Guardian Tier B remain open. No migration/dependency/key/permission changes or real outside request. Live app left stopped.
- **Next action:** wait for the owner's next clickable choice (for example plan Manager/workflow evidence projections or the Projects/Assistant slice). No commit/provider/operational work is implied. Read AGENTS.md, decision board and PROGRESS first. The owner explicitly asked for this saved handover so Claude can resume later.

## D-097 planning context (historical)

- **Owner's latest request:** plan reliable AI/platform reply separation and save docs so Claude can pick up later. Planning only; implementation has NOT been selected. Do not redo the completed UI/backend work.
- **Exact next proposal:** `docs/REPLY-PROVENANCE-PLAN.md`. Use host-origin-labelled text segments plus a bounded manifest in existing append-only task_events, atomically saved with task completion. Source inspection found mixed fallback results, so the earlier single-prefix idea is insufficient. No migration/new store/dependency/key is proposed.
- **Next action needs an owner choice:** offer clickable implementation of that plan (fake tests/full checks, no commit/outside request) or a smaller codec/transaction prototype first. Do not treat this handover as approval to change application code.
- **Latest successful implementation:** D-096, Dashboard/Approvals built; full check 2,174 backend + 461 dashboard tests, both typechecks/dashboard build, 332 synthetic browser checks. Evidence/screenshots: `docs/DASHBOARD-APPROVALS.md`. No test suite was rerun for D-097 docs.
- **Working tree:** all reliability/UI work remains uncommitted, mixed with existing staged P-49 changes. Preserve the index and all prior unstaged files. Staged verifier blobs: verify.ts `4a0b918a79e2f68ed4a629b21246c494cf197c7d`, verification.test.ts `7f003fcb877831c1601e4fd1e7486e3c738b3a96`; their working files already include later approved D-093 changes. No staging/unstaging, reset/clean, commit/push/deploy implied.
- **Keep limits open:** RV-3 is still NOT fixed; legacy results must not be guessed/backfilled. Manager/workflow final-result projections, exact target/content/receipt proof, real owner recovery and Guardian Tier B remain open. Live app left stopped; do not start against owner data or copy the live DB/vault for tests. Read AGENTS.md, decision board and PROGRESS before resuming.

## Current checkpoint (2026-11-15)
- Latest work D-104: approved fake walkthrough and D-103 refinement complete; 60 passed checks/3 automated findings/10 scenarios, 2 visual observations, 19 targeted UI tests passed. No product/UI change or new full suite. Current resume block/report supersede earlier “walkthrough NOT RUN” statements.
- Latest work D-102/D-103: both ordered plans saved and current Claude resume block updated; no execution/UI implementation or new verification. Latest code/full-check evidence remains D-101 below. Resume with an owner-selected D-102 scratch walkthrough, then refine D-103; earlier suggested alternatives are historical.
- Latest implementation D-101: bounded workflow task/approval evidence and panel complete; final full 2,322 backend + 484 dashboard/typechecks/build, new 76 cases and browser 42/42 passed. Exact report: `docs/WORKFLOW-RESULT-CHECKS.md`. Weak workflow→Manager links inherit zero evidence, output remains unverified. Earlier “workflow projection unbuilt” statements are historical; no real-provider/owner-data/operational verification claim.
- Latest implementation D-099: Manager helper-evidence projection/panel delivered; final summary stays unverified. Full 2,258 backend + 472 dashboard/typechecks/build, new 49 cases and synthetic browser 29/29 passed. See `docs/MANAGER-RESULT-CHECKS.md`. Earlier statements that all Manager projections are unbuilt are historical; final-claim and workflow-wide verification remain unbuilt.
- Latest implementation D-098: trustworthy saved reply origins complete; full check 2,220 backend + 461 dashboard, typechecks/build, new cases 46/46 and modernization browser 34/34. Detail: `docs/REPLY-PROVENANCE.md`. Earlier D-097 planning statements below are historical and superseded by the owner's implementation selection.
- D-097 planning only: reliable reply-checking source map, precise segment/atomic-save/decoder/truncation contracts, fake failure tests and resume instructions saved. Application code and staged work unchanged; no new tests or outside request. Main proposal: `docs/REPLY-PROVENANCE-PLAN.md`.
- Latest full check (D-096): 2,174 backend + 461 dashboard tests, both typechecks/dashboard build passed; 14 new UI cases and 332/332 synthetic browser checks. Earlier unchanged Winver failure passed isolated and final full; no guard weakened. Existing warnings/real-device/verification limits remain; only docs updated afterward. Detail/screenshots: `docs/DASHBOARD-APPROVALS.md`.
- D-096: Dashboard/Approvals slice implemented over current frontend/API contracts. Truthful query/window/cap states, focused reads, exact-content layout and modal keyboard/viewport behavior; no approval rule or backend change. Dedicated 52/52 and broader 280/280 browser checks with synthetic data; exact final full-check/Winver retry evidence: `docs/DASHBOARD-APPROVALS.md`. Uncommitted; original staged baseline preserved. Real device/Guardian/verification limits remain open.
- D-095 planning only: Dashboard/Approvals layout/data/file/accessibility/rollback specification saved in `docs/DASHBOARD-APPROVALS-PLAN.md`. Uses existing components/APIs, honest capped/time-window counts and errors, existing decision handlers and a narrow modal accessibility delta. No UI/backend/test change or new suite run; implementation awaits choice. NV-44 and RV-3/aggregate limits stay open; D-093 remains latest full check.
- D-094 review only: six delivered reliability checkpoints, remaining gaps and Dashboard/Approvals entry criteria saved in `docs/BACKEND-CHECKPOINT.md`. Recommend preparing a limited presentation slice using existing components/APIs; preserve status/evidence distinctions and existing decision paths. No UI or backend implementation from the review; no new tests. D-093 remains latest full-check evidence; RV-3/aggregate verification and operational limits remain open.
- Latest full check (D-093): 2,174 backend tests (102 files), 447 dashboard tests (48 files), both typechecks and dashboard production build passed; 73 new verification cases. Existing warnings remain. Prior restricted-run fake HTTP/process failures passed in the full run with ordinary test permissions; no guards weakened. Only documentation updated afterward.
- D-093: exact action/object matching and conservative unknown-effect ceiling implemented; nineteen source-owned action declarations, no execution/permission change. Original staged P-49 verifier blobs retained; new edits stay in the separate working diff. Evidence/full checks: `docs/EXACT-ACTION-MATCHING.md`. RV-3 authored provenance and exact target/content/receipt proof remain open; no live DB/key/service/commit.
- D-092 planning only: exact-action matrix, metadata/verdict contract, patch manifest and fake-service tests saved in `docs/EXACT-ACTION-MATCHING-PLAN.md`. No app/test/staged-content change or new test run. RV-1 remains unimplemented; current full-check evidence remains D-091. Matching action type will not establish exact targets/content or fix RV-3 provenance.
- Latest full check (D-091): 2,101 backend tests (100 files), 447 dashboard tests (48 files), both typechecks and dashboard production build passed. Existing warnings remain; only documentation updated afterward. No browser/provider/live-data run.
- D-091: chain completeness implemented in VerificationService with additive lifecycle counts/details and a ceiling preventing any failed/cancelled/pending/running member from yielding a wholly confirmed chain. Targeted verification 42/42 incl. 14 new cases; source typecheck passed. Evidence/full-check result: `docs/CHAIN-COMPLETENESS.md`. Staged P-49 verifier files preserved. RV-1/RV-3 and Manager/workflow projections remain open; no live database/key/service/commit.
- D-090 planning only: result/evidence map and three synthetic verdict-limit reproductions saved in `docs/RESULT-VERIFICATION-PLAN.md`. No application/test/staged-content change. Recommended next implementation is chain-completeness ceiling before action semantics/provenance and Manager/workflow projections. No new suite run; D-089 remains last full implementation check. Do not describe these fixes as built.
- Latest full check (D-089): 2,087 backend tests (99 files), 447 dashboard tests (48 files), both typechecks and dashboard production build passed. Existing DEP0190/large-bundle warnings remain. No separate backend build, browser or real-provider drill; documentation-only updates afterward.
- D-089: synthetic backup/restore rehearsal passed 12/12 targeted backup tests (nine new). Existing backup code unchanged; fresh exclusive-copy candidates preserve relationships, search, permissions, approval identity and synthetic encrypted sample. Wrong-key/damaged/empty candidate checks included. Procedure/evidence: `docs/BACKUP-RESTORE-REHEARSAL.md`. No live DB/vault opened or copied; actual owner recovery NOT RUN.
- D-088: new workflow pending approvals and waiting references now commit atomically in the existing SQLite tables; validated reconnect/cold-start uncertainty handling added. No auto-send or approval, schema/dependency change or commit. Previous conservative retry and execution assessment protections remain. Evidence/remaining limits: `docs/ATOMIC-APPROVAL-LINKAGE.md`. Development server stayed stopped; no live DB command or real-service test.
- Latest full check (D-088): 2,078 backend tests (98 files), 447 dashboard tests (48 files), both typechecks and dashboard build passed. Final atomic suite 29/29 after two crash-fixture refinements; no production changes after the full run. Existing warnings remain; no real crash/power-loss or live-service verification.
- D-086: shared task execution assessment covers internal callers and delegated children; internal Manager starts are checked before planning. Existing text fallback and explicit root/run best-effort behavior remain; overrides grant nothing and are not inherited. 18 new fake-provider cases; exact final results and limitations: `docs/EXECUTION-ASSESSMENT.md`. No migration/dependency/commit; development server stayed stopped for this phase.
- D-086 full-check snapshot: 2,049 backend tests across 97 files, 447 dashboard tests across 48 files, both typechecks and dashboard build passed. Existing DEP0190/bundle warnings remain. The concurrency test now uses deterministic fake-provider synchronization; no original assertion weakened.
- D-085: conservative workflow outside-action restart/retry protection implemented. A running integration with an uncertain result fails instead of being requested again; upstream retry cannot reset a protected descendant. Existing waiting approvals and safe automatic bot retries are preserved. Targeted suites: 70/70, including 16 new in-memory tests. Full check result: `docs/WORKFLOW-RESTART-SAFETY.md`.
- Final `npm run check` passed: 2,031 backend tests, 447 dashboard tests, both typechecks and dashboard build. Existing DEP0190 and bundle warnings remain. No separate backend build, browser suite or real-provider test was run for this fix.
- The previously running development watcher restarted twice during initial service edits before the assistant stopped it. Read-only live check afterward: integrity ok, no active tasks, 10 terminal workflow runs, zero uncertain-recovery audit records. No before snapshot exists; do not claim all live records were unchanged. Server left stopped.
- Source review and approved modular design are saved in the modernization docs. Libraries are not installed; runtime compatibility remains unverified. No commit or migration for this fix. Guardian Tier B/isolation remain unbuilt; operation remains supervised.
- Correction to the historical 2026-11-07 snapshot below: P-49 was approved and used once (9/16 Groq requests); that authorization does not permit another run. See the decision board and progress log.

## Historical checkpoint (2026-11-07)
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
