# Daily-use walkthrough plan (D-102)

**Execution follow-up D-104:** owner selected the walkthrough and D-103 refinement. It is now complete; actual findings, final assertions, fixture/harness corrections and limits are saved in `DAILY-USE-WALKTHROUGH.md`. The original planning checkpoint below is historical. UI implementation remains unselected.

2026-11-15, Asia/Dubai. Owner selected **plan 1, then plan 2**, and explicitly requested continued Claude handover updates. This is the first plan. **Walkthrough NOT RUN; no application or test code changed.** Next plan: `PROJECTS-ASSISTANT-REDESIGN-PLAN.md` (D-103).

## Purpose and boundaries

Rehearse a beginner's ordinary day: find a project, ask about fictional notes, review a proposed change, request a task/file, decide an approval, inspect evidence and return after restart. Record where the existing interface helps or confuses the owner before redesigning it. A scripted walkthrough proves observed behavior, not that a real beginner understood it or that a real model/service works.

Use a fresh scratch app/database, dummy vault key, scripted fake provider and only test-owned headless Edge. No live database copy, .env/vault read, owner account, real network provider, map/business leads or owner window. Block outside browser and provider traffic. Real file effects, if used, are limited to the existing writer/PC connector in one explicitly granted synthetic folder through normal approval and FolderGate. No owner permission or system boundary changes. Keep operations supervised; no unattended activity or Tier B claim.

## Fixture and execution contract

- Reuse the fixture patterns in `scripts/e2e/levels-e2e.mjs`, `hub-e2e.mjs`, `workspace-e2e.mjs` and the D-099/D-101 browser scripts. Add one focused `scripts/e2e/daily-use-e2e.mjs`; check the path does not already exist before creating it. Do not run a real-* script or start the production watcher.
- Seed fictional project **Demo Launch**, a fake configured helper **Demo Writer**, one competing similarly named project, a synthetic prior failure and notes containing a unique marker **DEMO-ONLY-73**. Use existing app services/APIs for normal work; distinguish seeded records from observed actions in the report.
- Prepare text attachment `demo-brief.txt` and disposable `outputs/launch-checklist.csv`. Provider responses are deterministic: citations, review drafts, workspace RESULT blocks and action requests must match current contracts. Enforce a hard ceiling of 32 fake completions across the walkthrough, fail closed on unexpected prompts/extra calls, no retries to real providers. This is a local fake ceiling, not approval for any real request.
- Begin at Simple, 1440 px, then repeat critical interactions at 390 px; smoke-check 360/768 px. Intermediate/Advanced checks verify existing controls/routes remain reachable. Use state/event waits and explicit fake-provider release barriers; no wall-clock races, fixed completion sleeps or inflated test timeouts.
- Each scenario has a fresh fixture or explicitly documented carry-over. Screenshot/error-injection steps must not accidentally execute a mutation twice. Every failure preserves synthetic diagnostics, closes only test-owned resources and removes only the resolved prefixed scratch directory under the temporary folder after containment checks.

## Walkthrough scenarios, in order

| # | Owner action | Required observable outcome |
|---|---|---|
| 1 | Open Projects; search and open Demo Launch; return through AI Assistant | Correct saved project/context links; one h1; waiting decisions remain visible at Simple. Ambiguous name lookup asks which project rather than selecting silently. |
| 2 | Choose a new conversation under Demo Launch; attach demo-brief.txt with default retention; ask for its marker | One fake reply cites A1; the marker is present; attachment stays temporary and is absent from Knowledge Center until explicit promotion. Citation presence is not proof of claim support. |
| 3 | Leave an unsent message, navigate away/back and change interface level; select a different project while an existing conversation is open | Draft preserved using existing browser storage. Project selector is described as applying to NEW conversations; existing conversation is not silently reassigned. Record whether the owner can tell the difference; no automatic new conversation/send. |
| 4 | Request a safe rename, undo it; request a review-level project description | Safe action reports only service-confirmed completion and Undo restores the prior value. Review shows before/after; no mutation until Apply. Use separate proposals to observe Reject and Apply, never double-apply one record. Owner/proof rules remain intact; no prompt may grant permissions. |
| 5 | Ask the Assistant to approve/send/delete something | Restricted action is refused with a route to the appropriate owner page; no permission change, delete or connector effect. Do not turn a refusal into a fake success claim. |
| 6 | Give Demo Writer a project task that saves a RESULT entry and requests the scratch CSV | Task belongs to the project and existing shared memory store; result-saving default retained. File is pending/nonexistent before approval. Deny the first request and confirm no file; submit a NEW owner-requested task/approval, then approve exactly once. One synthetic output file is created through the gate; denied/uncertain work is never replayed. |
| 7 | Open task, Manager and workflow checks for representative fake runs | Completion, recorded step evidence and final-output uncertainty are separate. File check uses current folder access; revoke only the scratch grant and confirmation must not survive unchecked file evidence at Manager/workflow scope. Weak workflow→Manager links remain unbound, not borrowed proof. Existing D-101 snapshots can supply corner-case fixtures, clearly labelled seeded. |
| 8 | Ask why the seeded task failed; draft a workflow and open its editor | Failure explanation uses recorded reason/link. Draft/revision note is understandable; opening a draft neither saves nor runs it. No new permission/model supplied by drafts. Do not switch on groups or schedules. |
| 9 | Close the scratch app normally and reopen its scratch DB with the same dummy key; restore the browser session | Saved project/conversation/task/approval identities and evidence persist. No extra fake effect or approval is created. Temporary attachment stays temporary. This is controlled restart persistence, not abrupt crash/power-loss or live owner recovery. |
| 10 | Inject read failures separately for project list, hub, helper list and suggestions; repeat the core path by keyboard/phone | Record current loading/empty/failure/stale behavior accurately; a failed read must not be reported as observed emptiness or verification. Opening/checking makes no mutation. New findings become D-103 inputs, not silently implemented backend changes. |

## Evidence and completion criteria

Save `docs/DAILY-USE-WALKTHROUGH.md` plus `docs/evidence/daily-use/` JSON/screenshots when actually executed. For every scenario record **pass/fail/not observed**, exact route/actions, record IDs, seeded versus executed evidence, fake completion/effect counts, assertion results and issue IDs. Record blocked external attempts as failures. Do not invent clicks, elapsed times, owner opinions or pass counts.

Issue categories: S0 permission/approval or unintended write; S1 lost work/wrong context/false success; S2 cannot find or finish a task; S3 layout/copy friction. Stop on S0/S1, preserve scratch-only evidence and propose the smallest correction. Fixing product behavior is a later implementation choice; do not remove a guard or weaken an assertion to complete the walkthrough. Non-blocking findings do not prevent writing the source-informed redesign refinement, but must stay visible.

Acceptance: all required scenarios are observed or explicitly blocked; no real outside request, live-data access, unexpected mutation or unapproved file effect; controlled restart reconciles identities; phone/keyboard checks and evidence limits are recorded. Technical scripted success is separate from optional owner usability feedback, real phones/screen reader and real-provider validation, which remain NOT VERIFIED.

After adding/running the script, run relevant existing hub/levels/workspace and Manager/workflow browser checks affected by its fixtures; do not rerun unrelated suites without a reason. If code changes are later separately selected, run their relevant tests and full npm run check. Save actual checks, failures and cleanup evidence; preserve the mixed index/working tree and never commit automatically.

## Handoff to the second plan

Apply findings to D-103 in severity order. Its initial scope is already specified from source inspection, not invented walkthrough results. Annotate each planned change with issue ID or source fact; keep deferred behavior/backend fixes separate. Owner's requested order is walkthrough first, redesign second. Current authorization prepares both plans; executing this walkthrough and implementing the interface remain separate next steps. No new test run is claimed by this document.
