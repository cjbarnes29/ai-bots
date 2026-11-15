# Atomic workflow approval linkage

Date: 2026-11-15. D-088, owner-selected implementation of the D-087 proposal. Status: implemented; focused checks and full check passed; uncommitted. No migration, new dependency, live-service call or commit.

## What is implemented

For a workflow WRITE, ActionGate creates the pending approval and WorkflowService saves its waiting/ref_kind=approval/ref_id state in one synchronous BEGIN IMMEDIATE transaction on the existing shared DatabaseSync connection. Pending/daily quota checks and approval.requested/workflow.approval_waiting audits are inside that transaction. Failed insertion, linkage, transactional audit or commit rolls back its approval/link/audits together. Existing expiration processing before the transaction remains independent; legitimate expiry records are not undone by a later failed request.

The internal linker verifies the exact connection object, saved graph/node, active run version/graph, running step, expected attempt and empty reference fields. Compare-and-set must affect one row. False, thrown or asynchronous linker results are rejected. Native rejected Promises are observed before rejection of the invalid async contract, avoiding an unhandled rejection from that programming error; asynchronous linker code is still forbidden and cannot be supplied through the HTTP/model interface.

After commit, the existing synchronous best-effort onPending notification runs. A separate read connection in tests verifies that the approval and link are already visible before notification. Notification exceptions do not undo the binding. No outbox/durable notification delivery is added; the stored Approvals record is authoritative.

The workflow preserves the committed link instead of performing a second post-return write. If a competing/stale attempt rolls back or a postcommit/pre-return path throws, a matching committed binding is retained rather than overwritten by the generic failure handler. No lost binding is reconstructed from model text, summary, similar args or timestamps.

## Read-only reconnection and cold-start handling

Resolution validates the saved run's integration node against the referenced approval: bot, connector/action, null task association, JSON/hash integrity and a single workflow reference. Invalid/missing/mismatched bindings fail visibly without requesting an action. It never rewrites approval content, executes a connector or changes an owner decision. Existing executed/failed/denied/expired resolution remains, with queued active runs included after startup recovery.

At app startup, after ordinary workflow recovery, a once-per-service reconciliation pass handles linked active waiting steps. Pending approvals remain waiting; recorded terminal outcomes resolve normally. An approved request without a terminal receipt is treated as uncertain after that cold start: its step fails, its original reference/approval status is retained and retries remain blocked. Routine ticks do NOT perform cold-start reconciliation; a live approved action may legitimately still be running.

Existing D-085 uncertain running-step protection and full-descendant retry checks remain. Terminal cancelled/failed runs are not revived by a later approval result. Legacy orphaned requests remain a manual-review case; this change does not guess/backfill links for pre-existing data. Outside READ behavior remains behind the same agent permission and is not made transactional; interrupted uncertain reads retain D-085 behavior. Ordinary bot requests without a linker retain their previous path.

## Files and persistence

- src/approvals/repository.ts: synchronous same-connection transaction helper; nested BEGIN rejection does not roll back the caller's transaction. Existing immutable/status triggers are untouched.
- src/approvals/service.ts: internal PendingApprovalLink interface and linked-write transaction; public request args/routes gain no new control. All existing authorization, mode, pause, quota and owner-approval execution checks remain.
- src/workflows/service.ts: transactional compare-and-set closure; committed-binding preservation; validated resolution; startup-only approved/no-receipt reconciliation.
- src/app.ts: narrow context forwarding and the startup reconciliation call. No tools added to Manager or Guardian.
- src/approvals/atomic-linkage.test.ts: synthetic scratch-file databases and fake services only. No real Telegram implementation is loaded even though the fake uses an existing allowed connector ID.
- src/workflows/restart-safety.test.ts: one fixture change to use a real SHA-256 of its synthetic JSON rather than placeholder hash text, so it meets the new binding validation; all original assertions retained.

No DDL, migration, new table/column, settings store or package. Tests use Buffer.alloc(32) as a synthetic in-memory vault key; they never copy a real database or vault key. Disposable scratch directories are created by the tests and cleaned only after absolute-path/prefix checks.

## Verification and failure history

Initial existing approval/integration/restart suites: 71/71. The initial broader focused command passed 142/142 runtime tests but its preceding typecheck failed because the test's connector ID was not in the existing closed list. Corrected the fixture to an existing ID backed exclusively by its fake implementation; no connector restriction changed. The following standalone typecheck passed and atomic suite passed 28/28. A further rejected-Promise linker case and promise-rejection handling were then added; final full results follow.

Full `npm run check` passed (exit 0, outside sandbox): 2,078 backend tests across 98 files, 447 dashboard tests across 48 files, both typechecks and dashboard production build. Existing Node DEP0190 and Vite >500 kB warnings remain (main JS 999.91 kB, gzip 266.32 kB). After that run, two test-only crash fixtures were strengthened to persist run=running with the committed waiting link (including approved/no-receipt); the atomic suite passed again, 29/29. No production source changed after the full run. `git diff --check` passed.

No separate backend build, browser suite, live provider/service test, real app crash, process-kill or power-loss drill was run. The development listener check found no server before editing; no live database command was issued and the development server stayed stopped. No tests were run against owner data.

### Planned matrix mapped to concrete evidence

| D-087 case | Implemented coverage |
|---|---|
| T1, T6 | Atomic waiting link visible to a separate reader, repeated ticks/reopen retain same ID and immutable request; postcommit/pre-return exception |
| T2-T5 | Before/after insert and after-link audit failure; failed CAS/stale competing attempt; rollback remains after reopen |
| T7 | Throwing notification after a committed binding; no duplicate request |
| T8 | Repeated overlapping idle/tick calls, stale attempt CAS rollback, SQLite write contention; distributed multi-worker execution is NOT supported/verified |
| T9-T11 | One owner execution and durable receipt; repeated approve refused; approved/no-receipt cold startup uncertain; held live approved call continues through routine ticks |
| T12 | Denial/expiry and fake effect followed by timeout; no repeated effect or request |
| T13 | Missing/wrong-bot/wrong-action/bad-hash links; stored JSON is also parsed by validation. No arbitrary DB tamper resistance against a same-user attacker claimed |
| T14 | Fake Guardian hold and revoked connector authorization; unchanged gate/Guardian/owner-proof regressions included in full check. No real file permission trial |
| T15 | Cancellation doesn't revive terminal run; existing D-085 direct/upstream retry and saved-graph edit tests retained |
| T16 | Permission-gated reads, unlinked bot requests, ordinary approval execution preserved |
| T17 | False/resolved/rejected-Promise/thrown linker results; async transaction work rejected; nested outer transaction preserved; wrong connection rejected |
| T18 | Transaction-local audit fault, precommit failure and SQLite contention create no half-binding or notification |

Seeded state, injected exceptions and closing/reopening scratch SQLite are persistence/reconnection tests. They are not evidence of abrupt process termination or power-loss durability. A fake timeout can leave an effect uncertain, and the tests deliberately do not infer that nothing happened.

## Remaining limits

- Local SQLite atomic binding does not provide exactly-once remote execution. A connector may complete before its receipt is saved; no automatic resend is introduced.
- Legacy orphaned approvals need owner review. This change adds no owner reconciliation UI or new permission.
- The startup pass assumes the previous executor ended. Multiple simultaneous backend processes, leases and distributed workers are outside this architecture and remain unsupported/unverified.
- No current behavior of a real external service, real phone or screen reader is established. Guardian Tier B and OS isolation remain unbuilt/unverified; operation stays supervised.
- Backup/restore proof, broader result verification and modular UI phases remain separate work. Existing staged P-49 files are not included in a commit by this task.
