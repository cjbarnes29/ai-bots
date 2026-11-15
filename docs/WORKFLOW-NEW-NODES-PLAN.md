# New workflow boxes: plan

Written for: you, the owner, deciding whether any new workflow box is worth building. Date 2026-11-16. **PLAN ONLY. No code, test, schema or dependency change; no outside request.** Related: `docs/WORKFLOW-CANVAS-PLAN.md`, `docs/WORKFLOW-RESULT-CHECKS.md`, `docs/WORKFLOW-RESTART-SAFETY.md`.

## NOT VERIFIED
This is a design from reading `src/workflows/graph.ts`. Nothing was built or run.

## What exists (8 boxes, `src/workflows/graph.ts`)
trigger (manual / event / interval, 15 min or more), bot_task, manager, integration (goes through the approval gate), condition (6 text tests), checkpoint (owner decision), set (text value), end.

## Rules any new box must keep
1. It grants no permission, folder, program, secret or approval (CLAUDE.md 5b/5c/5e).
2. An outside write only through the existing `integration` box and `ActionGate`. No new box may send, publish, delete or save anything outside.
3. Nothing runs unattended beyond what exists. No box may wait for time to pass in a way that continues while you are away (Guardian Tier B is not built).
4. A saved graph with the old 8 boxes loads and runs exactly as before (strict schema: adding a type is additive; old graphs stay valid). No migration: the graph is stored as JSON.
5. A run's result check (D-100 family) must not treat a new box as outside-effect evidence.

## Candidates, with a recommendation

| Box | What it does | Risk | Recommend |
|---|---|---|---|
| **Check result** | Reads the platform's own verification of an earlier step (confirmed / unverified / waiting / contradicted) and lets a condition branch on it. Read-only, no model. | Low. Reuses `src/verification/`. Must never present "completed" as "confirmed". | **Yes, first** |
| **Note to owner** | Writes a dashboard-only note (no email, no phone, no Telegram) shown on the run and the Approvals/Dashboard attention list. | Low. Text is untrusted data; length-limited and redacted like audit text. | **Yes, second** |
| **Join** | Waits until all incoming branches finished, then continues. | Medium. Touches the run engine's ordering and restart recovery (D-085). | Later, only with restart-safety tests |
| **Pause for time** | Waits N minutes. | Conflicts with rule 3 (runs while you are away). | **No** until Tier B is verified |
| **Repeat / loop** | Re-runs a branch. | Runaway cost and loops; interacts with retries and daily caps. | **No** |
| **Web request / script / code** | Arbitrary network or code. | Breaks the free-only, gate-only and untrusted-data rules. | **No, never as a box** (use `integration` with a registered connector) |

## Proposed order
1. **Check result** box: schema addition, validation (must point at an earlier step), engine step that calls the verification service read-only, condition support on its status, canvas palette entry, plain-language guide text at Intermediate. Tests: old graphs unchanged; each of the four verdicts; a missing or later step is refused at validation; the box makes zero model, connector or write calls; restart recovery re-evaluates it harmlessly (it is read-only); the result check does not count it as evidence.
2. **Note to owner** box: same pattern; tests for length, redaction, no outside call, shown on the run page.
3. Reassess **Join** after both.

## Tests common to both
Fake services and scratch SQLite only. Existing workflow suites, `workflowIntegration`, `workflow-verification` and restart-safety stay green. Browser check (fake): add the box on the canvas and list view, save, reopen, run, see the result. Full check and a staged-only export before any commit.

## Rollback
Remove the type from the schema and palette. A graph that already contains the new box would then fail validation, so ship behind a short note on the board and keep a backup (`npm run backup`) before the first real use. No data migration either way.

## Decisions for you
Approve building **Check result** then **Note to owner** (or choose another order or none).
