# Orphaned and uncertain approvals: plan

Written for: you, the owner, deciding whether to build it. Date 2026-11-15 (D-125). **PLAN ONLY. No code, test, schema or dependency change; no outside request.** Related: `docs/ATOMIC-APPROVAL-LINKAGE.md` (D-088), `docs/WORKFLOW-RESTART-SAFETY.md` (D-085), `docs/EXECUTION-ASSESSMENT.md`.

## NOT VERIFIED
Everything below is a design from reading the code. No crash, power-loss or real-service drill was run. I did not open your real database, so I do not know whether any such approval exists there today.

## The problem, in plain words
You approve an outside action (send a message, write a file). The app marks it "approved", runs the action, then records "executed" or "failed". If the app stops between "approved" and the recorded result (crash, power loss, restart, a hung connector), the approval stays **approved forever with no result**. Nobody can tell whether the message was sent. That is an **uncertain** approval.

What exists today (read from the code):
- `src/approvals/service.ts` `approve()`: `claimApproval` sets `approved`, then runs the action, then `finish` sets `executed` or `failed` (`repo.finish` only moves an `approved` row).
- Workflow steps: D-088 makes an approved-without-receipt approval fail its workflow step as uncertain at app start (`reconcileApprovalsAfterRestart`), and never resends it. That covers **new, linked workflow approvals only**.
- **Not covered:** (1) approvals that did not come from a linked workflow step (an agent's own task asking for a write), (2) older workflow approvals created before D-088 that have no link, (3) any way for you to say what actually happened.
- `approval_requests.status` has a database CHECK limited to pending, approved, executed, failed, denied, expired, so adding a new status needs a migration.

## Goals and non-goals
Goals: (a) find approvals whose outcome is uncertain, (b) show them honestly, (c) let you record what you found out, (d) never resend or guess.
Non-goals: exactly-once delivery (impossible to guarantee with an outside service), automatic retry, automatic "it failed", changing the approve/deny rules, new permissions, a migration.

## Key design choice: no migration
The audit log is append-only (database triggers refuse update and delete). Record your findings there as new events. The approval row itself is never edited. This avoids a schema change, avoids the dev-server hazard of a new `.sql` file being applied to your real database at once, and is easy to roll back.

## Part 1: detect (read-only)
An approval is **uncertain** when all hold: status `approved`, no `executed_at`, no result and no error, decided more than 2 minutes ago (the connector timeout is 30 s; 2 minutes is a margin and is a proposal), and it is **not in flight in this running process** (the gate keeps an in-memory set of ids it is executing right now). Anything pending, executed, failed, denied or expired is never listed. A restart empties the in-flight set, so a pre-restart approved row is listed.

## Part 2: say it plainly in the Approvals page
A new section "Outcome unknown (approved, but no result was recorded)" with, per item: what was asked (the existing summary and exact arguments), when you approved it, and the sentence "The app stopped or lost the result before it was recorded. It may or may not have happened. It was NOT sent again. Check the outside service (for example your Telegram chat) before doing anything." It links to the approval record. No approve/deny buttons: it is already decided. Read failures show as a failure with Retry, never as an empty list.

## Part 3: record what you found out (owner only)
Three buttons per item: **It did happen**, **It did not happen**, **I cannot tell**. Each writes one audit event `approval.reconciled` `{ id, outcome, by }` (no free text beyond a short optional note, redacted like other audit text). Needs the same owner proof as approving (a phone or a bot cannot do it), and is refused unless the approval is currently uncertain. The page then shows the item as "You recorded: it happened / did not happen / unknown". Nothing is resent, retried, approved or resumed by this. The three outcomes change what is displayed and what verification may say; they never change the approval's own status.

## Part 4: what verification and workflows do with it
- A task result check never counts an uncertain approval as confirmed. "It did happen" recorded by you may be shown as "you reported it happened", clearly labelled as your statement, still **not** platform-confirmed. "It did not happen" shows the claim as unsupported.
- A workflow step already failed as uncertain (D-088) stays failed. Recording an outcome does not resume or retry it; retrying stays a separate, deliberate action that D-085 already guards.

## Part 5: older workflow orphans (D-088 legacy)
There is no safe way to link old approvals to workflow steps (no recorded link, and guessing from times or text is exactly what earlier decisions forbid). They appear in the same list as uncertain approvals if they match Part 1; they simply have no workflow shown. No backfill, no guessing.

## Tests to write first (fake services, scratch SQLite, injected clock)
Detection: approved + old + not in flight is listed; pending, executed, failed, denied, expired are not; a row being executed in this process is not; a restart lists it; boundary at exactly 2 minutes; 500 such rows are bounded. Reconcile: owner proof required; phone and unproven refused; only an uncertain approval accepted; idempotent (second call refused or no duplicate); audit event has id and outcome and no arguments or secrets; the approval row is byte-identical after. Safety regressions: nothing is resent; `approve`, `deny`, the gate, the daily caps and workflow recovery behave as before; the full check and a staged-only export. Dashboard: the section, the plain sentence, the three buttons, Retry on a failed read, no empty-state reassurance on failure, 44 px targets, keyboard use. Browser (fake): seed an uncertain approval, record an outcome, reload, see it persisted.

## Order of work
1. Detection function and in-flight tracking in the gate, with tests. 2. `approval.reconciled` route with owner proof, with tests. 3. Dashboard section and wording, with tests and a browser check. 4. Verification wording (Part 4).

## Rollback
Stop writing `approval.reconciled` events and hide the section. The events stay in the append-only log and are harmless. No data to undo.

## Risks
- A genuinely slow action might be listed while still running if the in-flight set is wrong: the 2-minute margin and the in-flight check guard this; a test pins it.
- Your answer "it did happen" could be wrong; it is shown as your statement, never as confirmation.
- Same-user tamper protection and power-loss durability of the audit log remain NOT established (see NV-43).

## Decisions for you
Approve building Parts 1 to 4 in that order with no migration, and the 2-minute margin (or give another), or choose a different order or approach.

## Progress
- **Parts 1-4 BUILT 2026-11-15 (D-126), no migration, 2-minute margin.** Files: `src/approvals/{service,repository,routes}.ts`, `src/remote/access.ts` (owner-only route), `src/verification/{verify,service,action-observations,workflow}.ts`, `web/src/api/hooks.ts`, `web/src/pages/Approvals.tsx`; tests `src/approvals/uncertain.test.ts` (12), `src/verification/outcome-unknown.test.ts` (11), a phone-refusal case in `src/remote/remote.test.ts`, `web/src/uncertainApprovals.test.tsx` (7); browser `scripts/e2e/uncertain-approvals-e2e.mjs` 16/16. Full check 2,369 backend + 545 dashboard. Not verified: real crash/power-loss, the passphrase dialog with a Guardian, real phone in a browser, the real database.
