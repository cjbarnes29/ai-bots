# Manager/workflow backlinks and read receipts: plan

Date: 2026-11-15. Status: **PLAN ONLY. No code, test, schema or dependency change.** Decision board D-111. Context: `WORKFLOW-RESULT-CHECKS.md`, `MANAGER-RESULT-CHECKS.md`, `BACKEND-CHECKPOINT.md`.

## NOT VERIFIED
- Everything below is a design from reading the source. Nothing was built or run. Real-service, crash and power-loss behavior is not covered.
- Exactly how often legacy Manager/workflow rows exist in the owner's real database was NOT inspected (the live database is never opened).

## The two gaps (read from the code, 2026-11-15)
1. **Backlink gap.** A workflow's Manager box starts a Manager run with `requested_by = "workflow"` (`src/workflows/service.ts` line ~530) and only AFTERWARDS records the forward link (`workflow_steps.ref_kind = 'manager'`, `ref_id = <manager run id>`). The Manager run itself stores no workflow run id or box id (`manager_runs` has only `requested_by`). So a Manager run cannot prove which workflow run/box started it, and there is a window between "run started" and "forward link written" where a crash leaves a Manager run with no link at all. Today these references are treated as "unbound" and inherit zero evidence (correct, conservative).
2. **Read-receipt gap.** An agent's outside READ goes through the gate (`src/approvals/service.ts` ~189) and writes an `external.read` audit event with action, summary and ok/failed, but WITHOUT the task id, even though the task id is available at that point (`ctx.taskId`). So "this task really read that thing" cannot be proven; completed reads stay "unverified".

## Key finding: no migration is needed
`audit_events` is append-only (database triggers refuse update and delete, migration 006) and its `detail` is free JSON. Both fixes can add NEW fields to audit events written from now on. That avoids a schema change, avoids the dev-server hazard of a new `.sql` file being applied to the owner's real database at once, and gives the same append-only protection. A new column on `manager_runs` (migration 021) is the alternative and needs backup/stop first; it is NOT recommended unless audit-based lookup proves too slow.

## Part 1: exact backlink (workflow run + box to Manager run)
Design:
1. When a workflow starts a Manager run, record an audit event `manager.origin` written in the SAME transaction/step as the Manager run insert, containing `{ managerRunId, originKind: "workflow", workflowRunId, nodeId }`. `ManagerService.start` gains an optional `origin` argument (only the workflow service passes it; the owner/Assistant path does not).
2. Order change: write the origin before the model/plan work begins, so the unbound window disappears for new runs.
3. Verification treats a Manager reference as **bound** only when BOTH directions agree: the workflow step's forward link names the Manager run AND exactly one `manager.origin` event names that workflow run + box + Manager run. Any disagreement, missing event, duplicate or mismatch stays **unbound with zero inherited evidence**.
4. Legacy runs (before this change) have no origin event and stay unbound. No backfill, no timestamp guessing.
Not claimed: that the Manager's final answer is correct, that its steps did what the box intended, or that a bound link proves outside effects. It only proves "this Manager run was started by that box".

## Part 2: durable read receipt
Design:
1. Extend the `external.read` audit event with `taskId`, `connector`, `actionName`, `argsHash` (sha256 of the validated args JSON, never the args themselves if they could hold secrets), `resultChars`, `resultHash` (sha256 of the text the gate returned, after secret redaction) and `ok`. No result text is stored.
2. Verification consumes a receipt only on an EXACT task id match with `ok: true`, and states it as "a read of <connector.action> ran for this task; content was not judged". Missing taskId (all old events) stays unverified.
3. Keep the daily read cap and denial paths unchanged. Denied reads write no receipt.
Not claimed: that the agent used what it read, or that the read data was correct or complete.

## Part 3: show it (small UI change after the backend)
In the existing Manager and workflow result-check panels, add the words "linked (both directions agree)" versus "not linked", and "read receipt recorded" versus "no receipt". Existing zero-evidence ceilings stay for anything not bound. No new page, no new store.

## Tests to write first (fake services only)
- Origin: new workflow-started Manager run has one matching event; forward and backward links agree; missing, duplicate, wrong-box and wrong-run events stay unbound; owner-started runs never get an origin; crash between start and forward link now leaves a discoverable origin (the run is attributable) but is still unbound until both agree.
- Receipt: successful read writes taskId/hash fields; failed and denied reads do not claim success; no secret or result text appears in the event; args containing a fake secret are hashed only; two reads on two tasks never cross; legacy events without taskId stay unverified.
- Regression: all existing verification, Manager, workflow, approval and gate tests; the gate, daily read cap and approval flow unchanged; full `npm run check`; staged-only export verification.

## Order of work and rollback
1. Part 2 (receipt) first: one file in the gate plus the verification reader; smallest and independent.
2. Part 1 (origin) second: Manager `start` option, workflow call site, verification binding rule.
3. Part 3 (UI wording) last.
Rollback: stop writing the new fields; old events remain valid and unread fields are ignored; verification falls back to today's conservative unbound/unverified behavior. No data to undo.

## Risks
- A new audit field must never carry secrets or content: hash only; a test with a fake secret must pass before any use.
- Verification must not treat an unreliable or duplicated event as proof; the "exactly one event and both directions agree" rule is the guard.
- Audit is append-only but same-user tamper and power-loss durability remain NOT established (see NV-43).

## Decision needed (owner)
Approve building Part 2, then Part 1, then Part 3 as separate steps (no migration, no dependency, fake tests only), or choose a different order.

## Progress
- **Part 2 BUILT 2026-11-15 (D-112):** `src/approvals/service.ts` (receipt fields on `external.read`), `src/audit/audit.ts` (`readReceipts`), 6 cases in `src/approvals/approvals.test.ts`. Full check 2,328 backend + 520 dashboard. Verification does not yet consume or display receipts (that is Part 3). Parts 1 and 3 not built.
- **Part 1 BUILT 2026-11-15 (D-113):** `manager.origin` event written in the same transaction as the Manager run; `originLink` agreed/none/conflict in the workflow check; binding stays `unbound` and no evidence is inherited. Files: `src/manager/service.ts`, `src/workflows/service.ts`, `src/verification/workflow.ts`, `web/src/api/verificationHooks.ts` (type), tests in `workflow-verification.test.ts`, `manager.test.ts`, `workflows.test.ts`. Full check 2,341 backend + 520 dashboard. Part 3 (wording in panels, consuming receipts) not built.
