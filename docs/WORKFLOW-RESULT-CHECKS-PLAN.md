# Workflow result checks — implementation plan (D-100)

**D-101 implementation follow-up:** the owner subsequently selected implementation (“1”). Delivered behavior, exact changes, actual checks/corrections and limits are recorded in `WORKFLOW-RESULT-CHECKS.md`; current resume state is in HANDOVER. The original planning checkpoint below remains historical, not a claim that implementation is still unselected.

2026-11-15, Asia/Dubai. **PLANNING ONLY.** Owner selected option 1, workflow result checks. No application/test/schema change, installation, database/key access, outside request or new test run. D-099 remains the latest implementation: full 2,258 backend + 472 dashboard tests, typechecks/build; Manager browser 29/29. This plan does not authorize implementation or a commit.

## Goal and first-slice boundary

Add a read-only workflow run check and a small owner-visible panel. Show recorded action/task evidence separately from execution status and from unverified output. Reuse D-091/D-093/D-098 task checks, D-099 presentation conventions and D-088 approval validation. Never rerun, resolve, approve, retry or reconstruct an action from the checker.

This is a bounded existing-records slice. No migration, new dependency, durable read receipt, new Manager backlink or execution-service behavior change. No overall green verdict for the entire workflow deliverable. Exact targets/content/delivery/quality remain outside the guarantee.

## Source findings and binding rules

| Step kind | Existing record | V1 policy |
|---|---|---|
| Bot task | workflow_steps ref_kind=task/ref_id; task root/parent, assignee_bot_id, origin=user, origin_id=workflow run ID | Require the saved run graph's bot ID, UUID/root identity, null parent and exact origin/run. Missing/foreign/mismatched records contribute no evidence. Reuse the task chain checker with saved provenance and action semantics. |
| Outside write | ref_kind=approval/ref_id; approval task_id=null; D-088 atomic creation/link | Reuse one shared read-only validator for saved node, bot, connector/action, args JSON/hash and globally unique workflow approval reference. The validator does not prove rendered target/content; show that limit. |
| Manager | ref_kind=manager/ref_id; manager_runs.requested_by is only the literal workflow | **No exact workflow run/node backlink exists.** A unique forward reference plus requested_by=workflow is insufficient to establish the originating run. Mark binding unverified, show the claimed Manager ID/reason, and give it zero inherited evidence. Do not silently assume a stronger link or call its check to certify this workflow. A future durable backlink needs a separate plan/selection; no legacy backfill. |
| Outside read/no linked approval | Gate may return done without a durable per-step receipt | Completed output is not read evidence. Keep unverified; do not infer a receipt from text or a matching external.read audit message. |
| Start/end/set/condition/checkpoint | Saved graph and lifecycle/output/decision | Structural context only, zero outside-effect evidence. Checkpoint approval never certifies an outside action. |

Use **workflow_runs.graph and workflow_version**, never the current editable workflow graph. Current UI RunRow receives the current graph for its existing map; the new check must not inherit that assumption. Do not change the existing map in this slice.

Check only exact references, never summaries, output headings, similar arguments or timestamps. Deduplicate by root task ID and approval ID. A root referenced by multiple workflow boxes is ambiguous at node level (task origin identifies the run, not the node): show every box, count the root once and cap full supporting confirmation. Approval references must remain globally unique as required by D-088. Detect root tasks with origin_id=this run that are absent from direct task references (for example an overwritten retry reference); report unlinked attempt IDs/count and cap confirmation, without importing them as successful evidence or replaying them.

## Implementation and response

1. Extract the current WorkflowService.linkedApproval read-only logic into `src/workflows/approval-binding.ts`. Keep its checks and caller behavior byte-for-behavior equivalent, including invalid-link handling and cold-start uncertainty. Both workflow resolution and verification call it. Return internal structured invalid reasons; return no raw args or key material to the browser. Do not add mutations, readiness checks or approval recovery to the helper.
2. Add a workflow projection in VerificationService, backed by a new `src/verification/workflow.ts`. Capture run, saved graph, steps, exact bindings, task/provenance/action records and approval outcomes in a short SAVEPOINT snapshot. Release before FolderGate-backed file observations; compose with caller transactions. Factor reusable chain snapshot/evaluation as needed, retaining existing task/Manager contracts and staged verifier blobs.
3. For integration approvals, extract/reuse a pure recorded-action/file observation helper from the task checker. **Never fabricate a task ID or reassign task_id=null to make verifyTask accept a workflow receipt.** Preserve existing task behavior with regression tests. Executed + supported exact action type supplies one action-record evidence item; an empty outcome, unknown effect or unreadable reported file leaves supporting verification unverified. File existence/size uses the existing gated probe, never an unrestricted filesystem call. Pending/approved waits; failed action contradicts; denied/expired remains unverified/not executed unless independent evidence establishes a contradiction. Uncertain restart markers always block confirmation and never request another action.
4. Register `GET /api/workflows/runs/:id/verification` through existing verification route setup. UUID validation, existing local/paired-device read access, 404 workflow_run_not_found. A damaged stored graph/reference returns an honest partial/unknown check, not fabricated success or a recovery action.

Response: `{ verification: { runId, workflowId, workflowVersion, runStatus, checkedAt, coverageComplete, completion, outputAssessment, supporting, steps, sources, unlinkedAttempts } }`.

- `completion`: total and counts of pending/running/waiting/completed/failed/skipped, separate from verification.
- `outputAssessment`: always status=unverified with the scope/quality explanation; no scan of aggregated workflow output.
- `supporting`: existing Verification shape for recorded evidence only. Strongest relevant status wins: contradicted, waiting, unverified, verified. Structural-only completed runs use not_applicable, zero evidence. Any incomplete executable step/chain, skipped executable branch, invalid/ambiguous/unbound link, uncertain attempt, unchecked read/file, unlinked attempt, coverage limit or non-completed run prevents verified. A normal skipped branch is shown as not run, not automatically a contradiction.
- `steps`: saved node ID/type/label/status, binding state/reason and stable source IDs; no raw instructions, prompts, arguments, file contents, approval results or newly exposed error dumps.
- `sources`: distinct included task-chain/approval summaries and their scope. Manager IDs remain unbound references in steps, not included evidence. `unlinkedAttempts`: bounded IDs plus total/truncation indicator.

Bound before materializing: saved graph at most 2 MiB UTF-8, graphSchema plus validateGraph (25 nodes/60 edges, no cycles), at most 25 step rows and 375 unique task members total. Read one extra row to detect excess; count totals separately. At most 25 direct approval references. Return coverageComplete=false on malformed/extra/missing records or limits; no silently skipped confirmation. Do not traverse malformed graphs recursively. No secret/credential lookup, network/model call, audit write or persistent verdict cache.

## Visible panel and compatibility

Add a collapsed **Workflow result check** inside the expanded existing run row, using a new component and verification hook. Show **Workflow output: Not independently verified**, **Recorded step evidence**, lifecycle counts, skipped/unbound/uncertain reasons, saved version and check time. Valid task links use existing task routes; valid approval links use Approvals focus. Do not invent a Manager detail route or present an unbound Manager reference as proof.

Fetch only when the owner opens the check; poll every 10 seconds while open, stop on close/unmount. Hide cached confirmation during refresh or failure, show Check unavailable and a read-only Refresh check button. Preserve checkpoint/approval/retry/cancel controls, waiting counts, navigation and interface levels. New controls have 44 px targets; native keyboard disclosure, phone layout, reduced motion and dark mode follow D-099. No new page or menu entry.

Main touched subsystems: verification service/routes and reusable action observation; workflow's read-only binding helper/callers; WorkflowsSection plus new WorkflowResultCheck and verification hooks. New tests must be checked for existing paths before creation. Earlier staged verify.ts/verification.test.ts blobs stay unchanged; document new working changes separately. No staging/unstaging/commit.

## Tests, acceptance and handover

- Pure/synthetic DB tests: saved graph vs later edit; missing/foreign/wrong-bot/non-root references; duplicate roots and approvals; damaged args/hash/JSON; direct read without receipt; known/unknown/empty executed outcomes; pending/approved/failed/denied/expired; checkpoint not a receipt; uncertain restart; all structural; valid skipped path; incomplete/failed/cancelled child; unlinked previous attempts; unbound/foreign Manager refs; all graph/row/task limits. No final output becomes independently confirmed.
- Fault/read-only tests: consistent snapshot across later edits, snapshot release before probes, caller transaction preserved, no task/run/approval/audit writes, zero model/gate/connector/tick calls, scratch reopen/integrity, revoked folder grant and missing/changed file. Invalid references must never cause file probes.
- Run D-088 atomic-linkage and D-085 restart tests after helper extraction; preserve all owner decision/retry/uncertain-action behavior. Existing task/Manager verification tests must stay green.
- Component tests: on-demand requests, closed polling stopped, separate labels/counts, valid/invalid links, loading/error/stale refresh, manual retry, unchanged owner controls.
- New scratch-only browser script: fake connector/provider, disposable test-owned Edge, outgoing requests blocked; normal/waiting/invalid/skipped/Manager-unbound runs; keyboard/44 px targets; 360/390/768/1440 widths; dark/reduced motion and 200% text scale; zero effect/model/mutation calls from checking. Wait for responsive layout to settle before geometry assertions.
- Run relevant suites, then full npm run check and browser checks. Record actual counts, failures/corrections and limitations; no preclaimed tests or real-service evidence. Save report/screenshots, decision board, PROGRESS, capability/security/Guardian notes and Claude handover.

Rollout is source-only; no migration/backfill/live run. Rollback removes only this slice's additions and restores immediate pre-extraction behavior, keeping all D-085 to D-099 working/index changes. Prepare rollback guidance; do not perform destructive Git operations. First release remains supervised; no Tier B/real recovery or remote delivery claim.

**Next owner choice:** implement this bounded existing-records plan with fake/full/browser checks, or review the read-only approval-binding extraction first. Neither includes a commit, dependency, migration, owner-data access or real outside-service call. Manager backlink improvements are explicitly deferred.
