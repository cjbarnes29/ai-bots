# Migration 019 (decisions): review of the proposal, revision 3

**Status: APPROVED and APPLIED on 2026-11-05 (board D-061); NOT COMMITTED.** The text below is the review as it was shown before approval. The SQL under review is `docs/proposals/019_decisions.sql` (revision 3). There is deliberately no `src/db/migrations/019_decisions.sql` yet. Revisions 1 and 2 are kept as `019_decisions_rev1.sql` and `019_decisions_rev2.sql`. `data/app.db` is at migration 018 and has no decision tables (checked read-only on 2026-11-05 after the changes below).

Revision 3 = revision 2 + the five required corrections (C1 to C5) and recommendations R1 to R3 from the owner's review. It has 7 tables and 75 objects (tables, indexes and triggers) and changes no existing object (tested).

## 1. Review of revision 2 (what was probed, what was found)
The owner asked for a review of the actual SQL. It was probed with a script (not part of the repository) on scratch in-memory databases and on a snapshot of the live database made with `VACUUM INTO` from a read-only connection, outside the project folder.

| # | Finding in revision 2 | Revision 3 |
|---|---|---|
| C1 | `INSERT OR REPLACE` deleted a row **without firing delete triggers**, so it rewrote a history row and a `done` report, and overwrote an approved decision with a fresh `open` one | `PRAGMA recursive_triggers = ON` in `openDatabase` (`src/db/database.ts`); with it the delete triggers fire and the replace is refused. Cannot be fixed in SQL |
| C2 | A decision could be INSERTED already `approved` with a made-up chosen option (no foreign key on `chosen_option_id`), or `open` with a choice | `trg_decisions_born_open`: a decision starts `open` with no choice and no approval fields |
| C3 | An option could be removed by anyone (no owner mark), including the chosen option; a removed option could be restored; history said `owner` regardless | Removal needs the owner mark, can never touch the chosen option, and is permanent (3 triggers) |
| C4 | An assignment could point at any task, so a bot's `done` report could carry someone else's result | `trg_decision_assignments_task_is_bots`: the task must be a root task (`parent_id IS NULL`) of that same bot |
| C5 | History gaps: no `created` row unless the service wrote one; title, owner note and project changes were not logged (even after approval); participant rows could be re-pointed or rewritten | Triggers log creation, title (before/after), note (before/after), project link and participant joining; participants can no longer be updated |
| R1 | Unlimited `progress`/`question` reports from one bot (500 accepted) | At most 20 per bot and decision (results and failures are already one per task) |
| R2 | A view could name its own option as the alternative, or be about a removed option | CHECK and trigger |
| R3 | `approve()` ran its steps one by one (crash window: approved with half the assignments, and no way to add one); `createManual` was not atomic | The approval, participants and assignments are ONE transaction; `createManual` is one transaction; new owner action `POST /api/decisions/:id/assignments` adds an assignment to an approved decision and starts that task once (step-up proof on the PC) |
| R4 | The first version of this document overstated three claims (see section 4) | Corrected |

Other things the probes confirmed to be fine: the 30-view cap works and is reachable (12 options, 5 bots; the old test never reached it, the new one does); the 5-participant and 2-round limits hold; the claim-then-start states hold; the file applies cleanly to a snapshot of the live database.

## 2. What changed from revision 2 (the complete SQL diff)
The full unified diff was shown to the owner with this review and is reproducible with `diff -u docs/proposals/019_decisions_rev2.sql docs/proposals/019_decisions.sql` (140 lines). In words: 13 new triggers (`born_open`; `history_created`, `history_title`, `history_note`, `history_project` on decisions; `no_update` and `history` on participants; three removal triggers on options; `active_options` on views; `task_is_bots` on assignments; `cap` on reports), one new CHECK on views, three new values in the history `action` list (`retitled`, `project_linked`, `participant_added`), and header comments.

## 3. What is enforced where
- **Database:** born open; allowed status moves (an approved decision never goes back); frozen options and choice after approval; owner-only columns; history written by triggers; append-only history, reports and views; uniqueness of tasks and reports; start states; view, participant and report limits; the assignment's task belongs to the bot.
- **Connection setting:** `recursive_triggers = ON` makes those delete guards also hold for `INSERT OR REPLACE`.
- **Service:** compare-and-set approval (a double click gives 200 and 409), transactions (approve, createManual, assign), draft used once, relevance and the 3-bot limit, model-output validation, which bots are asked, participants listed in the order they joined.
- **Routes / access:** choosing, approving, rejecting and starting or assigning need the owner proof on the PC when the Guardian is set up.
- **Task engine:** tasks start through `engine.submit`, so the Guardian, pause, free-only gate, delegation limits and the approval gate for every outside action apply unchanged. Approving grants no permission.

## 4. Corrections to claims made in the earlier version of this document
- "History and reports cannot be updated or deleted" was true for UPDATE and DELETE but not for `INSERT OR REPLACE` (fixed by C1).
- "Decisions cannot be deleted" was likewise not true for a replace (fixed by C1).
- "Complete automatic history" was not complete (fixed by C5).
- "Only the owner can choose or approve" is, and remains, **a label in the database, not an authentication** (section 6).

## 5. Test evidence
- `src/db/decisions-proposal.test.ts` (20 tests, 9 of them the revision 3 regression block C1 to C5, R1, R2, the 30-view cap, and "no existing object changed"); `src/decisions/decisions.test.ts` (34 tests, 6 new for R3, assigning later and the history through the service).
- **Each fix was shown to matter:** run against the revision 2 SQL (`DECISIONS_SQL=docs/proposals/019_decisions_rev2.sql`), the six SQL-level regression tests (C2, C3, C4, C5, R1, R2) FAIL. With the pragma removed from `database.ts`, the C1 test FAILS. With the transaction helper made a pass-through, the R3 all-or-nothing test FAILS. (The first version of the R3 test did not depend on the transaction at all; it was rewritten after this check.) Files were restored after each check.
- Earlier mutation checks of the service (6 of 6 caught) still apply.
- A latent flaw found while doing this: the review loop read participants without an `ORDER BY`, so the order of bots depended on random ids and one test passed only by luck. Fixed (`ORDER BY rowid`); the test passed 6 of 6 afterwards.
- `npm run check`: 1,568 backend + 311 dashboard tests, builds clean. One earlier full run in the same session had two failures: the documented real-Windows load flake, and `manager.test.ts` "has a daily limit on runs and at most two at once", which depends on a 30 ms timer and passes 6 of 6 alone; it does not use anything changed here. The next full run passed. Both are timing-sensitive tests under parallel load; the Manager one is a candidate for a longer timer, not changed here.

## 6. Remaining risks (accepted or open)
1. **The owner marker is a label.** Any writer that sets `chosen_by` / `approved_by` / `edited_by_owner` to the right value passes the database. The protection is that no route or code path lets a bot reach those acts, plus the owner proof on the PC. A hostile writer with direct access to the database file could also drop the triggers; this is the same limit as every earlier trigger-based guard (017, 018).
2. **`recursive_triggers` is per connection.** It protects the app's own connection (set in `openDatabase`). Another program opening `app.db` without it could still use `INSERT OR REPLACE`. Not a threat from the bots; relevant only for direct database editing.
3. **Enabling `recursive_triggers` affects all triggers of the app**, not only the new ones. The full test suite passes with it. No other table in the app uses `INSERT OR REPLACE` with delete triggers (the one existing use, `owner_free_models`, has no triggers; tested).
4. **Reason quality cannot be enforced.** 20 characters of "aaaa" counts as a reason. The 30-view cap favours bots that answer first.
5. **Manual decisions are not de-duplicated** (no source id); the draft path is single-use. A double-clicked review round spends two sets of model calls; the unique index still prevents duplicate views.
6. **`start()` is claim-then-start, not one transaction, on purpose** (a crash leaves a visible "stuck" claim and never a second task; `repair` handles it). Project creation after approval is separate and best-effort: a failure there never undoes the approval; the owner can link a project afterwards.
7. **Never run against a real provider;** the prompts and JSON formats are tested with scripted replies only. No dashboard screen exists yet.
8. A bot cannot raise a decision or report progress mid-task (no verified producer); the `progress`/`question` kinds and their cap are ready for it.

## 7. Compatibility and procedure
- Verified: applies cleanly to a snapshot of the live database (18 migrations): 0 existing objects changed, 75 new, all 54 older tables with identical row counts, foreign-key and integrity checks clean; a failing statement at the end rolls the whole file back; no `PRAGMA` inside the file (safe inside the runner's BEGIN/COMMIT); SQLite 3.53.4.
- If approved: stop writing; `npm run backup` and verify; rehearse on a scratch copy of that backup; copy the approved file UNCHANGED to `src/db/migrations/019_decisions.sql`; update the migration counts and lists in `upgrade.test.ts` / `agent-manager.test.ts`; add a hash-pin test (copy == proposal); extend `isNewOrLater` in `groups-proposal.test.ts` to the `decision*` objects; remove the test-only `proposedSql` / `withDecisions` hook (the tests then use the real migration); restart the server by touching a `.ts` file (the runner applies it in one transaction, a failure rolls back and the app refuses to start); prove the existing objects and row counts identical on the live database; run `npm run check`. Rollback = restore the backup (stop the app first) or leave the empty tables. The Decisions routes appear by themselves once the table exists.
