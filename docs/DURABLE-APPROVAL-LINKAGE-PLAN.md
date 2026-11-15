# Durable workflow approval linkage: implementation proposal

Date: 2026-11-15. Status: PLAN ONLY. Owner selected: "Prepare durable approval linkage ... Planning only; no migration file or application changes yet." Related decisions: D-084, D-085, D-086; planning record D-087.

## NOT BUILT / NOT VERIFIED

Implementation follow-up (D-088, 2026-11-15): the owner subsequently selected implementation. The existing-table atomic linkage and recovery behavior are now implemented and fake-tested; [actual evidence and remaining limits](ATOMIC-APPROVAL-LINKAGE.md). This proposal and its original planning-only authorization remain below as history. Real crash/power-loss behavior, distributed workers and exactly-once remote effects remain unverified/not provided.

No application code, migration, database or dependency is changed by this proposal. The transaction/link protocol, recovery behavior and tests below have not been implemented or run. This is not a claim of exactly-once remote execution, live crash verification, or OS isolation. D-085 conservative failure remains the implemented protection. Existing Guardian/owner-proof/action/folder gates and supervised-only rules remain authoritative.

## Recommendation

Use one short synchronous SQLite transaction to create a pending approval AND save the workflow's waiting/reference state. Reuse approval_requests, workflow_steps, the immutable graph snapshot in workflow_runs, and existing audit_events. These services currently share the DatabaseSync connection created in app.ts, which makes a single-connection transaction feasible.

This closes the new-approval-to-workflow-link persistence window without adding another approval store, preallocated request state, or a migration. It does not automatically identify legacy orphaned requests and does not make an external connector's execution transactional with SQLite.

### Alternatives considered

| Design | Persistence change | Assessment |
|---|---|---|
| Atomic approval insert + workflow link (recommended) | Existing rows/columns, one transaction; no DDL | Smallest fit for the shared SQLite connection; requires a carefully limited internal linkage callback and conflict handling |
| Reserve an approval UUID in the step before requesting | Existing fields could hold a reserved identity, but adds reservation/reuse/reconciliation semantics | More crash states and content-matching obligations; unnecessary for current single-database composition |
| Add workflow_action_attempts with unique run/step/attempt and approval FK | New table/index/immutability rules plus migration and lifecycle code | Worth reconsidering only for multiple durable action attempts, multiple execution processes, or separated stores; not needed merely to close this window |

The source review has not justified adding a queue library, new database or orchestration framework.

## Invariants to preserve

1. Only ActionGate creates approval requests after its existing validations. Every outside write still requires an owner decision; reads still require the agent's own permission.
2. For a new workflow WRITE, a committed approval must have its committed workflow reference. Any failure to attach rolls back the new approval and its transaction-local audit records.
3. One integration step attempt may not replace an existing reference or make another request after it has asked. D-085 direct and full-descendant retry guards remain.
4. A linked approval identifies the exact saved request; never find a request by similar summary, timestamp, arguments or model text.
5. Workflow continuation reads existing approval state only. It cannot call approve(), claimApproval(), spec.execute(), or request() to reconnect.
6. A committed owner approval is not proof of connector completion. Approved-but-no-terminal-receipt after a cold process restart remains uncertain and must not be executed again.
7. An executed receipt is a workflow step result, not independent proof that every claimed file/send succeeded. Existing result verification retains that responsibility and folder gate.
8. Uncertainty is visible; no automatic new run, denial, expiration extension, retry allowance reset or permission change hides it.

## Proposed internal API changes

Exact implementation names may change in review, but responsibilities and types are part of this proposal:

- ApprovalRepository.transaction<T>(work: () => T): T: synchronous transaction on its existing DatabaseSync connection. Reject a returned Promise/thenable; rollback and rethrow on error. Use one documented transaction owner; do not silently nest BEGIN statements. If legitimate nested callers are identified, design/test SAVEPOINT ownership before implementation rather than guessing.
- An optional internal-only context on ActionGate.request for workflow callers, containing linkPending: (approvalId: string) => boolean. It is not part of connector/action args or any HTTP/model-facing schema. It may do only the workflow compare-and-set and transaction-local workflow audit on the SAME connection. It must return true synchronously; false, throw or thenable rolls back the insert. TypeScript's void callback assignability is not sufficient to prohibit async callbacks, hence the boolean type and runtime check.
- WorkflowDeps.actions.request and the adapter in app.ts forward this context for integration steps only. Ordinary task requests keep their existing three-argument behavior. Do not add tools to Manager or any path-taking command to Guardian.
- The WorkflowService closure captures runId, nodeId, saved workflowVersion and expected attempt from platform state. It does not accept them from model output as authority. A static implementation review must confirm every mutation uses the existing shared connection.

No public route body gains correlationId, approvalId, callback, proceedAutomatically, or other new control. Existing owner proof, gate limits and argument validation remain unchanged.

## Exact persistence changes (existing schema)

**DDL: none.** No .sql file is created under src/db/migrations or docs/proposals by this plan. Do not edit historical migrations 006 or 014. No new setting or table holds a second approval record.

Retain the ordinary step-attempt start record (status=running, incremented attempts). After the gate validates connector, bot, pause/Guardian state, readiness, parsed args, authorization, operating mode, argument size and WRITE kind:

1. Begin the synchronous write transaction (proposed BEGIN IMMEDIATE, with existing busy/error handling preserved).
2. Recheck pending/daily request quotas inside this transaction before inserting. Multiple callers must not bypass limits during serialization. Existing expiration behavior must remain correct; no expiry is extended for reconnection.
3. Insert approval_requests using a gate-generated UUID, immutable normalized args_json/args_hash, unchanged expiry and pending status. The existing primary key and content/status triggers stay untouched.
4. Compare-and-set the corresponding workflow_steps row to waiting/ref_kind=approval/ref_id=new UUID and its standard waiting message. Require exactly one affected row. Use the expected running attempt and active run snapshot; zero affected rows is a linkage conflict, not permission to create another binding.
5. Append approval.requested and workflow.approval_waiting inside the same transaction, using IDs and existing sanitized summaries. Rollback removes these uncommitted records too; committed append-only history remains immutable.
6. Commit, then invoke the existing best-effort inbox/onPending notification. Never notify before commit. Notification failure must not alter the committed request/link or cause another request. No notification-outbox system is added here; the Approvals page's stored record stays authoritative.
7. Return pending_approval with the committed ID. The caller verifies/preserves the already-saved link; it does not create a second post-return linking window.

Illustrative compare-and-set, to be implemented and tested rather than executed from this document:

```sql
UPDATE workflow_steps
SET status = 'waiting', ref_kind = 'approval', ref_id = :approvalId,
    output = :waitingMessage
WHERE run_id = :runId AND node_id = :nodeId
  AND status = 'running' AND attempts = :expectedAttempt
  AND ref_kind IS NULL AND ref_id IS NULL
  AND EXISTS (
    SELECT 1 FROM workflow_runs r
    WHERE r.id = :runId AND r.status = 'running'
      AND r.workflow_version = :savedWorkflowVersion
  );
```

The caller must also resolve nodeId from that run's saved graph, confirm it is the expected integration node and that bot/connector/action match the validated gate request. Use trusted saved output/template scope for argument generation. The atomic callback is only a linker; it must not update the immutable approval payload, choose authorization, perform connector IO or resolve the owner decision.

If existing data legitimately supplies a non-null ref, do not clear it to make this compare-and-set succeed. Read the binding and reconcile it through the read-only lifecycle rules below. A CAS failure after a competing request committed must roll back the losing insert and must NOT let the generic execute catch overwrite the winning waiting step as failed. Handle this internal conflict explicitly: retain a matching committed binding, or fail closed if its identity cannot be validated. No automatic request reissue.

The callback design must be rejected if implementation cannot prove the approval insert, link and transactional audits use the same connection and transaction. At that point return a concrete alternative design rather than split the commit or claim atomicity.

## Recovery and reconnection rules

Recovery uses workflow_runs.graph (the run snapshot), not the current edited workflow. A failed/cancelled terminal run is not revived because an old approval later changes. Existing retry protection applies to direct and upstream requests.

| Persisted state after restart | Workflow outcome | Forbidden behavior |
|---|---|---|
| Crash before new transaction/commit, step running and no link | D-085 uncertain failure remains; there is no committed approval from the rolled-back transaction | Assume absence of a reference proves no effect or automatically request again |
| Transaction committed: waiting step linked to pending approval | Reattach by that exact ref_id, show waiting; no request/model/connector call | Create a replacement approval or silently approve |
| Linked denied/expired approval | Fail with its recorded decision; preserve request | Extend expiry, reopen it or request again |
| Linked failed approval | Fail using recorded error; effects may be uncertain, so no replay | Treat failed as evidence that nothing happened remotely |
| Linked executed approval | Continue from its recorded result, once; keep verification status separate | Call connector or invent a receipt from an agent claim |
| Linked approved without durable terminal outcome at COLD startup | Preserve approval state/ref; mark the workflow step uncertain/failed and block retries; explain manual reconciliation | Reset approved to pending, call approve again, mark executed/failed from inference, or automatically resend |
| Linked approved during normal live execution | Keep waiting while the existing owner-approved call is running | Label all live approved rows as crashed or execute them from a tick |
| Missing request, mismatched bot/action, invalid hash or incompatible saved binding | Fail closed and record linkage problem without changing approval content | Guess a nearby request or force an association |
| Legacy orphan created before the atomic-link implementation | Keep D-085/manual review; no automatic matching | Backfill links by timestamps, summaries or argument similarity |
| Interrupted READ without approval | Retain D-085 conservative failure | Invent an approval or auto-repeat a read whose outcome is unknown |

**Cold-start distinction:** resolveApprovals() currently leaves approved rows waiting, which is appropriate while execution is in progress. Add a dedicated startup-only reconciliation pass for linked active runs; it must never run inside the routine tick/resolve loop. App startup must know the previous executor has ended. Multiple concurrently running backend processes are not supported/verified by this proposal; do not infer that a row is abandoned merely from another process starting. This work does not introduce a lease or distributed worker system.

Existing normal resolution already reads executed/failed/denied/expired requests. Extend its binding validation before trusting the receipt: expected node, bot, connector/action and integrity of stored args hash. Validation does not grant file access or execute anything. If current connector validation/transforms are needed to compare a historical payload, design that narrowly; do not recompute or rewrite approved content using a changed schema.

## File-by-file implementation scope

| File/module | Proposed change |
|---|---|
| src/approvals/repository.ts | Synchronous transaction helper; existing insert/claim/finish and immutable schema retained |
| src/approvals/service.ts | Internal linker context; transaction encloses quotas, insert, link and audits; notify after commit; no outside IO inside transaction |
| src/workflows/service.ts | Attempt-bound compare-and-set closure; preserve committed link on return/conflict; binding validation and startup-only reconciliation; preserve D-085 descendant retry guard |
| src/app.ts | Narrow action-port forwarding and one startup reconciliation call after services exist; no new external capability |
| src/workflows/restart-safety.test.ts | Preserve all conservative recovery cases and add new atomic-link/cold-start cases |
| New test file, after git ls-files check | Transaction/fault/reopen tests using synthetic scratch SQLite and fake connectors |
| Existing approval/workflow/Guardian tests | Extend only where needed; preserve assertions and normal owner/permission behavior |
| CAPABILITIES/GUARDIAN/SECURITY-AUDIT/HANDOVER/TASKS/PROGRESS/board | Exact guarantees, limits, outcome states and test evidence kept in step |

Read the current domain/security/access instructions before implementation. FolderGate checks must remain inside the relevant file connector; no plan-level association permits probing a file directly.

## Required failure-test matrix

Tests below are specified, NOT RUN. Use synthetic data and fake connectors only. In-memory tests cover service behavior; scratch FILE databases closed/reopened across fresh service instances test persistence. Never use the owner's DB/vault, real outside service, or stop the real running app. No guard-removal mutation against real network pieces.

| Test | Fault / setup | Required assertions |
|---|---|---|
| T1 | Normal workflow write | Exactly one pending approval and one matching waiting step; zero connector executions |
| T2 | Throw before approval insert | No approval/link/audit notification; D-085 safe failure |
| T3 | Throw after insert before link | Reopened scratch DB contains neither approval nor link; no inbox notification |
| T4 | CAS affects zero rows | Losing approval/audits rolled back; existing binding and step state unchanged |
| T5 | Throw after link before commit | Neither side survives close/reopen; no postcommit notification |
| T6 | Close/reopen after commit before request returns | Same approval ID and waiting step restored; request/connector counters unchanged |
| T7 | Notification throws after commit | One committed binding remains; no duplicate request; waiting count visible |
| T8 | Overlapping attempts/ticks; competing transaction if supported | Only one committed binding; loser does not fail/reset winner; quotas not bypassed |
| T9 | Owner approval then executed receipt | Gate executes once, workflow uses its exact receipt after reopen; second approval refused |
| T10 | Cold restart with approved/no terminal receipt | Step visibly uncertain and retry-blocked; no connector invocation; approval not reclassified by guess |
| T11 | Live approved call deliberately held by fake barrier | Routine ticks keep waiting; they do not trigger startup reconciliation |
| T12 | Denied/expired/failed states, including timeout after fake effect | Recorded outcomes shown; no new request or repeated fake effect |
| T13 | Malformed/missing/mismatched link or payload hash | Fail closed; immutable content not overwritten; no request/execute |
| T14 | Guardian pause, owner-proof failure, revoked permissions/mode | Existing checks still refuse their effects; linkage cannot approve or grant access |
| T15 | Upstream/direct retry, workflow edit and cancellation | D-085 guard survives; saved run snapshot governs; terminal run not revived |
| T16 | READ flow and normal bot action requests without linker | Existing behavior preserved; uncertain reads stay conservative; per-agent permission required |
| T17 | Transaction callback returns Promise/false/throws | Reject/rollback; no async work accepted as a committed attachment |
| T18 | Failure during audit insertion or SQLite busy/commit failure | No half-binding; no notification or automatic request replay; clear safe error |

An exception inside a transaction and a clean close/reopen do not prove abrupt power-loss behavior. A disposable test-owned child-process kill drill could be proposed separately after the basic tests pass; it would use only a synthetic scratch database and a harmless test helper. It is not run or authorized by the current planning choice.

Test implementation must include both halves: no duplicate requests AND correct reconnection to the original request. Keep checks of unchanged request content, expiry, owner decision and no-reset descendant state. Do not merely assert that the workflow displays an ID.

## Acceptance, rollout and rollback

1. Implement only after the owner selects an implementation choice. Keep this plan in docs; do not add SQL as a way to reserve the work.
2. Re-read current worktree/staged state. Preserve the prior P-49 work and D-085/D-086 changes; no reset/unstage/commit.
3. Confirm the development server is stopped before source edits; the prior watcher incident must not repeat. No migration is expected; if that changes, stop and prepare the exact additive schema proposal before any migration file can trigger the watcher.
4. Run focused fake-service/fault/reopen tests, existing approval/workflow/Guardian suites and full npm run check. Browser testing, if added, uses a scratch/fake app. Real-provider or real-service checks need a new exact-count approval.
5. Report committed-binding guarantees separately from uncertain external effects. Record warning/failure history honestly and keep supervised-only limitations.
6. Do not ask to commit until a concrete isolated staged-export check and exact commit review are prepared; no commit is included in this plan.

Rollback needs no schema reversal. However, old pre-D-085 code would reintroduce unsafe replay and must not be the rollback target. Retain D-085 as the minimum safe behavior. Runs newly marked uncertain/failed are not reset to pending on rollback; known waiting approval links remain ordinary existing-format references. A rollback must not automatically resume a stranded approved action.

## Owner choices for the next step

- Implement the recommended atomic-link design using existing tables, with the failure-test matrix and full checks; no migration/new dependency/real-service call/commit.
- Keep D-085/D-086 and rehearse synthetic backup/restore first.
- Request a revised proposal if separate action-attempt history or multiple worker processes are an actual requirement; do not silently expand this plan to those architectures.
