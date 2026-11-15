# Workflow outside-action restart safety

Date: 2026-11-15. D-085, owner-selected implementation following D-084. Status: implemented; targeted tests and full check passed; uncommitted.

## Behavior and scope

An outside-action step can create an approval request or perform an authorized read before the workflow persists the gate's returned result/reference. Previously recover() treated a running step with no saved task/Manager reference as safe to reset to pending. That could repeat the request after a restart. An upstream retry could also reset a protected descendant despite direct retry being refused.

The fix uses the run's saved graph to recognize running integration steps. Recovery marks them failed, retains any known reference, and uses ref_kind=integration_uncertain when no reference exists. It clears provisional output, records workflow.integration_uncertain and explains that the owner must inspect approval history and outside effects. It does not replay, approve, deny or execute the action.

The marker is persisted in an existing text column; no migration or dependency is needed. Retry checks the entire descendant reset set before any mutation. A protected task/Manager/approval reference, uncertain integration, active running descendant or exhausted retry allowance prevents the reset with cannot_repeat. Existing safe automatic bot retries still work, and an untouched/skipped outside-action step can still follow an upstream retry.

Normally saved waiting approvals remain linked and continue through the existing gate/result resolution. Existing pending requests, including an orphaned one, are not hidden, cancelled or decided by recovery. Owner review is necessary before approving one or starting a new run. The failure message intentionally does not recommend a fresh run as an automatic workaround.

This is conservative recovery, not durable approval correlation or exactly-once remote execution. If the crash happened before the gate call, the step still fails because the persisted state cannot prove that no effect occurred. Uncertain reads are treated conservatively too. A known reference on a still-running integration remains available for inspection, but does not make its outcome automatically confirmed.

## Tests and regression evidence

New file: src/workflows/restart-safety.test.ts. Tests use in-memory SQLite, seeded crash states and fake action counters only. They do not kill a real app or remove a network guard.

- Pending/approved/executed orphaned approval states: no new request or repeated effect; uncertain failure recorded; repeated recovery does not replay; direct retry cannot reset it.
- No approval yet, uncertain read and later-edited workflow definition: fail closed using the run snapshot.
- Saved waiting approval: remains waiting and continues from its fake executed receipt without requesting again.
- Known approval reference on a running step: reference retained, replay blocked.
- Upstream retries cannot reset waiting/completed/failed approval-linked descendants, an uncertain recovered action, a running descendant or task/Manager outside-work guards. Rejected retries leave every saved step unchanged.
- Upstream retry still allowed when its outside-action descendant never started.

Before the production fix, 11 of the original 13 new cases failed, demonstrating the missing protections. The first patch overblocked safe automatic bot retries; an existing regression caught it. The running-state check was moved to the explicit retry reset path rather than automatic canRepeat checks. No existing assertion was weakened.

Final targeted run: 70/70 tests across restart-safety (16), integration-nodes (11) and workflows (43). Full `npm run check` passed (exit 0): 2,031 backend tests across 96 files, 447 dashboard tests across 48 files, both typechecks and dashboard production build. Existing Node DEP0190 and Vite bundle warning remain (main JS 999.91 kB, gzip 266.32 kB). No separate backend build, browser suite or real provider was run. `git diff --check` passed. No existing test file was modified.

## Development watcher and live-data observation

The assistant-owned development server from the earlier dashboard-opening task was still running. It restarted after the first two service.ts edits before it was stopped. This was not a planned live crash drill and must not be reported as "the live app was untouched". No migration or direct live-database write was issued for this fix.

After stopping that server, read-only checks returned integrity_check=ok, zero active tasks, and 10 terminal workflow runs (6 cancelled, 3 completed, 1 failed); there were zero workflow.integration_uncertain audit records in the live database. Without a before snapshot this does not prove byte-for-byte or all-row equality. All regression tests used in-memory/scratch data. The development server was left stopped for the remainder of the change.

## Remaining limitations

Follow-up (D-088, 2026-11-15): atomic linkage for new workflow approvals and startup reconnection are now implemented; [evidence and limits](ATOMIC-APPROVAL-LINKAGE.md). Legacy orphans still require review. Shared execution assessment was delivered under D-086. The limitations below describe the original D-085 scope; no exactly-once remote guarantee is added by either follow-up.

- No real process-crash, browser acceptance or live-service behavior was verified by these tests.
- Atomic linkage/reconciliation of an orphaned approval is future work, not delivered here.
- Task-entry assessment consistency, Manager result verification, backup-restoration work and UI integration remain pending.
- Guardian Tier B, OS isolation and unattended operation remain unavailable/unverified.
- No commit, source-library installation, paid API or new outside research request.
