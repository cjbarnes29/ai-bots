# Modernization backend assessment and patch specification

Date: 2026-11-15. Scope: local source assessment and baseline checks, selected by the owner after D-084. No application patch, migration or dependency installation in this assessment.

## NOT VERIFIED

Implementation follow-up (2026-11-15): the conservative recovery/descendant-retry portion of patch B is now implemented under D-085. See [test evidence and remaining limits](WORKFLOW-RESTART-SAFETY.md). The original assessment and proposed broader work below remain as the historical specification.

Execution follow-up (2026-11-15, D-086): patch A is implemented at task/Manager execution entry, including children and internal callers; [coverage and test evidence](EXECUTION-ASSESSMENT.md). Chat and Manager self-executed step/review text are not separate assessed tasks. Other proposed work remains pending.

The findings below are source-inspection results, not newly reproduced crash exploits. Failure-injection tests are proposed. Existing fake-provider tests do not prove live-service behavior. No new real-provider or external-service requests were made. Exact upstream UI licenses and compatibility remain unverified. Guardian Tier B and isolation remain unbuilt/unverified.

## Baseline

`npm run check` passed (exit 0): backend typecheck, 2,015 backend tests across 95 files, dashboard typecheck, 447 dashboard tests across 48 files, and dashboard production build. Backend test duration: 105.92 s; dashboard tests: 49.74 s. Existing warnings: Node DEP0190 (shell child-process arguments) and the Vite bundle-size warning (main JS 999.91 kB, 266.32 kB gzip; threshold 500 kB). No browser suite or real provider was run. This command does not invoke the separate backend build script; it is not claimed as run.

The working tree already contained staged P-49 evidence/fixes and documentation edits before this assessment. They have not been staged, unstaged, committed or overwritten by this work. No production source was modified. The normal build may regenerate ignored build outputs.

## Task entry-path matrix

Assessment is advisory/policy readiness; it does not replace action authorization. A route that lacks assessment still uses the engine and action gates shown here.

| Entry path | Source trace | Current capability assessment | Current retained safeguards / proposed gap |
|---|---|---|---|
| Direct bot task | delegation/routes.ts -> delegation/service.ts -> TaskEngine.submit | Route calls CapabilityService.assess; only unsupported explicit policy prohibitions are refused absent proceedAnyway | Engine validates bot/runnable state, pause/limits; preserve ordinary text fallback |
| Manager goal over HTTP | manager/routes.ts -> ManagerService.start | Route assesses the goal; unsupported missing/policy requirements use the existing refusal policy | Preserve route semantics and owner best-effort override without granting any permission |
| Manager specialist step | manager/service.ts -> engine.submit | No per-step assessment at submit/runTask identified | Root goal assessment does not cover every generated step; action gates still apply |
| Manual workflow run | workflows/routes.ts -> WorkflowService.run/tick | Route queries workflow readiness from registry | Readiness is not assessment of every rendered step instruction |
| Workflow bot step | workflows/service.ts -> engine.submit | No per-step assessment at engine boundary identified | Existing retry guard, task limits and outside-action gate remain |
| Workflow Manager step | workflows/service.ts -> ManagerService.start | Does not enter the Manager HTTP goal-assessment route | Internal Manager start requires explicit assessment coverage in the plan |
| Scheduled task | AutomationService.launch -> engine.submit | No assessment dependency in AutomationDeps or launch | Automation/AI/Guardian pause, daily limits and previous-run check are present |
| Triggered task | AutomationService.launch -> engine.submit | Same gap as schedule | Trigger rules, cooldown/depth and normal execution safeguards remain |
| Group mention | groups/service.ts -> engine.submit | No shared pre-execution assessment identified | Group authorization, enabled switch and participation safeguards remain |
| Decision assignment | decisions/service.ts -> engine.submit | No shared pre-execution assessment identified | Decision assignment/owner flow and runtime gates remain |
| Delegated child | TaskEngine.createChild -> runTask | Inserts a child directly; a submit-only hook would miss it | Existing target allow-list, depth/loop/budget checks remain |
| Chat answer | Existing chat service/provider path | Separate conversational path, not automatically a task-engine entry | Do not broaden the patch to chat execution or add tools to the Manager |
| Approved outside action | ActionGate.approve and execution | Does not need a second model/readiness engine | Owner proof, immutable approved content, state claim and execution-time permissions remain authoritative |

## Finding A: route-only assessment does not cover internal execution

Evidence: direct and Manager HTTP routes await assessment, whereas TaskEngine.submit is synchronous and TaskEngine.createChild inserts tasks directly. Automation, groups, decisions, Manager specialists and workflow bot steps call the engine internally. Workflow Manager steps call ManagerService.start internally.

### Proposed patch A

1. Define shared assessment policy using the existing registry and matcher; do not introduce a second feature list or let the model choose policy.
2. Add an asynchronous execution preflight before a task's first provider call. Cover root and child tasks through the common task execution path. Keep synchronous task creation APIs compatible; internally created tasks can be recorded as failed with an explicit assessment reason before any provider call. Decide and document status/event semantics in the patch.
3. Cover internal Manager starts before their planning provider call as well; a TaskEngine hook alone cannot cover that planning call.
4. Retain useful HTTP pre-acceptance checks. Distinguish acceptance vs execution audit phases so repeated assessment is not mistaken for duplicate tasks. Recheck changing capabilities at execution without unnecessary fresh probes/model calls. CapabilityService itself can use fixed local program probes and audit writes; it is not a model call.
5. Keep direct-task best-effort text behavior compatible. Do not assume a root goal's override grants unrestricted child overrides; design explicit server-owned override metadata and provenance if needed. No user/model-supplied bypass field inside generated instructions.
6. Keep permission and Guardian checks immediately before their relevant effects. Keyword matching stays a known limitation; do not describe this assessment as the security boundary.

Files likely involved: src/delegation/engine.ts, src/manager/service.ts, src/capabilities/ (shared policy), src/app.ts, route adapters as necessary. Automation service changes are optional if a shared execution hook covers it correctly; avoid converting every synchronous caller to async without need.

Acceptance tests: scheduled and event tasks with explicit policy prohibitions make zero provider calls; delegated children and internal Manager planning are covered; allowed text work still completes; changed readiness is reflected before execution; pause/cancellation/budgets and existing route refusals/overrides remain correct. Tests use fake providers and fake capability facts. Security/domain docs must be read before implementation and updated with changed guarantees.

## Finding B: workflow request-to-reference persistence gap

Evidence sequence in src/workflows/service.ts:
1. execute marks the workflow step running.
2. The integration case awaits actions.request(botId, null, action).
3. For a write, ActionGate.request inserts a new approval_requests row using a new UUID.
4. Only after the gate returns does the workflow save waiting/ref_kind=approval/ref_id.
5. recover changes a running step with no task/Manager reference back to pending. The unlinked integration request can therefore be requested again.

The separate approval repository uses an atomic pending-to-approved status claim. Preserve it: it protects two decisions on the SAME approval ID, but does not correlate two newly generated request IDs.

### Proposed patch B: small defensive change, then durable correlation

**First patch: conservative recovery.** Inspect the persisted run graph in recovery. A running integration step with no durable outcome must not be reset to pending. Mark it failed/reconciliation-required in the existing status model with a clear reason and audit record. Prevent both direct retry and retry of an upstream step from resetting that uncertain downstream integration. Merely changing recover is insufficient because retryStep resets descendants. Treat uncertain outside reads conservatively too until their execution is understood.

This first patch can potentially use existing fields and graph data without a migration; prove that in tests. It prevents automatic duplicate requests while making uncertainty explicit, but does not automatically reconnect an orphaned request or establish exactly-once remote effects.

**Second patch: durable linkage.** Specify a server-generated stable action-attempt identity and persist it before requesting an outside effect. Candidate: reuse existing workflow reference fields and approval primary key with a narrowly scoped internal gate interface. Do not expose arbitrary request IDs or reconciliation controls to the model, Manager or public request body. Existing request reuse must match bot/action/immutable args and lifecycle state; preserve expiry, quotas and all permission checks. Reject conflicting content rather than overwrite it. Use additive schema only if existing fields cannot give a clear, durable guarantee.

Pending, denied, expired, executed, failed and approved-but-outcome-unknown requests need separate recovery behavior. Never return an already-executed result as a fresh execution or retry an uncertain write. A preallocated ID is not proof of remote exactly-once effects.

Likely files: src/workflows/service.ts, src/approvals/service.ts, src/approvals/repository.ts if durable linkage requires it, src/app.ts dependency interface, existing workflow/approval tests. Read and synchronize CAPABILITIES.md, security/Guardian/handover/TASKS documentation and relevant access guidance before touching these safety-related paths.

### Required fault-test matrix

| Interruption / action | Required observation |
|---|---|
| Running integration before request is issued | Fail safely or use proven correlation; never assume a missing ref proves no effect |
| Approval inserted before workflow wait saved | No second logical request created on recovery |
| Saved waiting with valid pending approval | Keep waiting and retain exact approval ID |
| Approval denied/expired | Fail with recorded reason; no request replay |
| Owner approved and connector result not durably recorded | Mark outcome uncertain and require reconciliation; no blind resend |
| Executed result durably recorded | Reuse only matching evidence without executing again |
| Repeat owner click | Existing single-claim behavior remains |
| Retry failed upstream node with uncertain downstream integration | Refuse unsafe descendant reset |
| Checkpoint decision targets outside-action step | Existing bypass refusal remains |
| Concurrent ticks/recovery calls | No duplicate logical request or connector call in fake-service tests |

Use in-memory or scratch SQLite and a fake connector that increments an in-memory counter. Do not remove guards against a real network/process implementation. Do not reproduce a crash against the live application or database.

## Recommended integration order

1. Patch B conservative recovery and descendant-retry coverage, because it targets duplicate outside-action requests.
2. Patch A common execution assessment, including internal Manager planning and delegated children.
3. Durable correlation, then evidence links/Manager verification and scratch restore proof.
4. Exact license/dependency manifest, shared UI plus Dashboard/approvals, Assistant adapter, workflow canvas adapter.
5. Future-module contract and scratch acceptance walkthrough.

Each patch is separately reviewable and verified before the next. No dependency, migration file, restricted security change, real external request or commit is authorized by this assessment alone. Proposed order details do not supersede D-084.
