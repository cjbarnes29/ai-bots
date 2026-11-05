# Migration proposal: group bots (017_groups), revision 2

**Status (2026-11-04): revision 2 APPROVED by the owner (board D-047) and APPLIED to `data/app.db`. Revision 1 was never applied.** `src/db/migrations/017_groups.sql` is a byte-identical copy of `docs/proposals/017_groups.sql` (SHA-256 `d45d6dca…915397`; its header comment still reads "PROPOSAL ONLY" because the procedure requires an unchanged copy). Evidence: section 11. **Group messaging is NOT enabled**: the tables exist and are empty, and no application code uses them (a test enforces this) until authorization, visibility, participation limits, loop prevention and Guardian integration are built and tested (board NV-15).
Previous status, kept for history: PROPOSAL. NOT APPLIED. NOT in `src/db/migrations/`.
Files: `docs/proposals/017_groups.sql` (the migration), `docs/proposals/017_groups_rollback.sql` (safe rollback: refuses while group data exists), `docs/proposals/017_groups_rollback_with_data.sql` (destroys group data; only after a verified backup).
Tests on throw-away databases only: `src/db/groups-proposal.test.ts` (18 passed, 2026-11-04). Revision 1 had serious gaps; the independent review that found them, and every change, are in section 10.

## 1. What it adds, and what it does not touch
New tables, indexes and triggers only. **No existing table, column, row, index, trigger or constraint is changed or removed**, and no trigger is placed on an existing table. `schema_migrations` gets one row (`017_groups.sql`).

| Table | Purpose | Key rules enforced by the database |
|---|---|---|
| `bot_groups` | a group: name, description, avatar (emoji/label, no uploads), coordinator, participation mode, default model-routing policy, `max_rounds` loop guard, memory mode, paused, archived, owner's read marker | never deleted (archive); a coordinator must be an active, non-observer member; enumerated modes; bounded rounds |
| `group_members` | membership with history: `role` (`member`, `reviewer`, `observer`), `added_at`, `removed_at` | **one active membership per bot and group** (partial unique index); unknown roles refused; no deletes, no moving rows, no reopening a removal; the coordinator cannot be removed or made an observer while coordinator |
| `group_messages` | the conversation: sender (user/bot/system), `visibility` `group` or `direct` (+ `recipient_bot_id`), `reply_to`, `kind` (message, handoff, review, challenge, clarification, escalation, task_result, summary, notice), content, `attachments` (JSON list of references, never file contents), `task_id`, model used, `redacted_at` | only **active, non-observer members** post; direct messages only to active members; replies only within the same group; **no deletes and no rewrites**: the owner can blank a message once (e.g. a pasted secret) |
| `group_messages_fts` | search (FTS5 over the message table, kept in step by triggers) | cannot drift; a blanked message leaves the index |
| `group_message_mentions` | who a message mentions (`@Bot`) | every mention is an **active member** of that group; no duplicates; kept |
| `group_memory` | notes for ONE group only | a bot-sourced note must reference the owner's approval (`approval_requests`); archived, not deleted; size limits |
| `group_events` | append-only record of bot-to-bot events: assign, transfer, review, challenge, escalate, clarify, handoff accepted/declined, loop/duplicate/permission blocks, member/coordinator/settings changes, memory added/archived, paused/resumed/stopped | no updates or deletes; message must be in the same group; named bots must belong (or have belonged) to the group; `to_bot_id` NULL for escalation to the Manager AI |

Foreign keys: `bots`, `tasks`, `approval_requests` and the new tables. The app opens every database with `PRAGMA foreign_keys = ON`. No existing code deletes bots, tasks or approval requests (checked: `grep DELETE FROM`), so these references can never block an existing operation; bots are archived, never deleted.
What the database cannot enforce (it is the service's job, to be built and tested with the group features): who may READ which messages. The schema carries what that needs (group, membership period, visibility, recipient); section 10, item 2.

## 2. Effects on existing data (and the proof)
- Every pre-existing table is fingerprinted (checksum of every row) before and after on a scratch database: identical. No object is removed.
- Existing operations after the migration behave as before (archiving a bot that is a member, creating/cancelling tasks, changing permissions, adding memory): tested.
- Groups grant nothing: no permission column exists. Group features will use the existing delegation allow-lists, approval gate, Guardian and operating-mode ceilings.
- Expected effect when applied: empty tables; no behaviour change until group code is added in later, separately tested steps.
- `src/db/upgrade.test.ts` pins the full list of migrations; it must be updated in the same change that adds the file (expected, not a defect).

## 3. Applying it (only after your approval)
1. You approve revision 2 in writing (board P-19). 2. Stop the app. 3. **Backup** (section 4). 4. Copy `docs/proposals/017_groups.sql` unchanged to `src/db/migrations/017_groups.sql` and update `upgrade.test.ts`'s expected list. 5. `npm run check`. 6. Start the app: the runner applies it in one transaction and records it; on any failure it rolls back everything and the app refuses to start with "Migration 017_groups.sql failed: ...". 7. Only then build group features, each with tests.

## 4. Backup procedure
1. Stop the app (Ctrl+C in its terminal; confirm no `node` process of the app is left).
2. `npm run backup`: a consistent single-file copy made with SQLite's `VACUUM INTO` (works even while the app runs), plus the vault key, into `data/backups/<date_time>/` (corrected 2026-11-04: earlier text said `backups/<date>/`).
3. Verify the copy: open `backups/<date>/app.db` and run `PRAGMA integrity_check` (must say `ok`); record its SHA-256.
4. Keep a second copy of that folder outside the project.
5. Local Git tag `rollback/before-groups` (local only; nothing is pushed).

## 5. Rollback and restore plan
- **Migration failed:** nothing to do; the runner rolled it back. Remove the file from `src/db/migrations/` before restarting.
- **Applied, no group data yet:** stop the app; run `017_groups_rollback.sql` in a transaction (tested: the database returns exactly to its earlier state); remove the migration file; start.
- **Applied and groups were used:** the safe rollback **refuses** (tested: it changes nothing). Decide first: either keep the data (restore nothing), or make and verify a backup, then run `017_groups_rollback_with_data.sql` in a transaction (removes only the group tables; tested: everything else unchanged), remove the migration file, start.
- **Restore from the backup (anything unexpected):** stop the app; **delete `data/app.db-wal` and `data/app.db-shm`**; copy the backup `app.db` over `data/app.db`; remove the migration file; start. **Deleting the WAL and SHM files first is mandatory**: the review proved that copying only `app.db` while a newer WAL is left behind makes SQLite report "database disk image is malformed" (test 7). With the files deleted, the restore is exact (tested).

## 6. Tests (scratch databases only; none touches `data/`)
`src/db/groups-proposal.test.ts`, 18 tests, grouped by the review's requirements: not applied anywhere real; additive with row fingerprints; columns, indexes, foreign keys and value rules; search index in step (incl. blanking); member-only visibility query; one active membership, roles, history, coordinator rules; sender, observer, removed-member, mention, reply and event rules; retention and the single permitted blanking; safe rollback refuses with data; safe rollback exact when unused; with-data rollback removes only group tables; `npm run backup` copy intact; wrong vs right restore with a stale WAL; partial failure through the runner's own transaction; double application; application on a populated database; existing operations unchanged. `applyLikeRunner` repeats exactly what `src/db/database.ts` does per migration file (the real runner is not pointed at the proposal, so the real migration folder stays untouched).
Still to do when applied: the same checks through the real runner against a COPY of the owner's `app.db`, never the original.

## 7. Preserving bots, workflows and permissions
The new tables reference `bots`, `tasks` and `approval_requests` but nothing references the new tables, and no trigger exists on any existing table. Workflows, skills, permissions, vault, audit, Guardian files: not referenced at all.

## 8. Future features this schema covers without another migration
Group and direct messages, `@mentions` (indexed per bot for "messages waiting for this bot"), replies and threads, task handoffs and results (`task_id`, kinds), reviews, challenges, clarifications, escalation to the Manager AI, ownership transfer (`transfer` events), coordinator, participation modes, loop guard, observers/reviewers, group memory with owner approval, search, attachments as references to approved files, unread markers for notifications, pause/stop records, membership history, blanking a leaked secret. **Not covered** (would need a change): more than one coordinator per group, per-bot unread markers, multi-owner access (the platform has one owner), file *contents* stored in the database (deliberately excluded).

## 9. Risks
Schema changes are hard to reverse once data exists (hence the guarded rollback and backup). CHECK lists cannot be extended in SQLite without rebuilding the table; revision 2 includes the kinds the plan needs, but a genuinely new kind later would mean a table rebuild. Triggers add a little work per insert (single-row lookups on indexed columns). FTS5 is already in use (`memory_fts`).

## 10. Independent review of revision 1 (2026-11-04) and the changes made
Method: re-read the files, the runner (`src/db/database.ts`), `016_memory.sql`, `src/backup/backup.ts`, the database tests, and every `DELETE FROM` in the code; then probed revision 1 on scratch databases (in memory and in a temporary folder). The owner's database was not opened.

| # | Requirement | Revision 1 | Revision 2 | Evidence |
|---|---|---|---|---|
| 1 | Foreign keys, constraints, indexes, integrity | **FAIL**: mentions stored as unchecked JSON (accepted non-members, non-existent bots, even non-JSON); search index maintained by hand (could drift); no length/JSON checks on notes and details | **PASS** | tests 1.x |
| 2 | Group ownership and member-only access | **FAIL** for what the schema must carry: no direct-message/visibility model; cross-group replies and event links accepted | **PASS (schema)**: visibility + recipient; same-group rules. Read enforcement remains service work (single-owner platform; the owner owns all groups) | test 2 |
| 3 | Duplicate membership and invalid roles | **FAIL**: the same bot could be an active member twice; `removed_at` before `added_at` accepted; no roles at all | **PASS** | test 3 |
| 4 | Sender membership | **FAIL**: non-members could post; coordinator could be a non-member | **PASS** (incl. observers and removed members) | test 4 |
| 5 | Deletion and retention | **FAIL**: messages, events (the handoff audit) and membership history could be deleted or rewritten; groups could be deleted | **PASS**: kept; only the owner's one-time blanking | test 5 |
| 6 | Rollback and new group data | **FAIL**: the rollback silently destroyed all group data | **PASS**: safe rollback refuses while data exists; a separate, explicit with-data script after a verified backup | test 6 |
| 7 | Backup integrity and restore | **FAIL**: the restore step did not say to delete the `-wal`/`-shm` files; restoring only `app.db` next to a newer WAL produced "database disk image is malformed" | **PASS**: procedure fixed and tested; backup via `npm run backup` (VACUUM INTO) | test 7 |
| 8 | Idempotency and partial failure | **PASS** (runner transaction; double application fails loudly) | **PASS** (re-tested with triggers and FTS inside the transaction) | test 8 |
| 9 | Compatibility (bots, workflows, permissions, Guardian) | **PASS** (nothing deletes bots/tasks; Guardian keeps its own files) | **PASS** | test 9, code search |
| 10 | Future features without another migration | **FAIL**: no direct messages, roles, observers, attachments, unread marker, approval link for bot notes; event/message kinds too narrow | **PASS** for the planned features (section 8 lists what is not covered) | section 8 |

Every change in revision 2 and why: `group_members.role` + CHECK (roles, observers); partial unique index `uq_group_members_active` (duplicate active membership); CHECK `removed_at >= added_at`; membership triggers (no delete, no move, no reopen, coordinator protection) for history; coordinator triggers on `bot_groups` (coordinator must be an active non-observer member); `trg_bot_groups_no_delete` (archive like bots); `group_messages.visibility` + `recipient_bot_id` + CHECKs + recipient trigger (direct messages, member-only); sender trigger (only active non-observer members post); reply and event same-group triggers; message no-delete and only-redact triggers + `redacted_at` (retention, while still allowing a leaked secret to be removed); `attachments` JSON array column (shared files as references); `mentions` JSON column replaced by table `group_message_mentions` with membership trigger and index (integrity and "messages for bot X"); FTS changed to an external-content index with insert/blank triggers (no drift); `group_memory` size/JSON checks, `approval_id` and CHECK for bot notes, no-delete trigger; `group_events` wider kinds, JSON-object CHECK on `detail`, same-group and membership triggers, append-only triggers; `bot_groups.model_ref` length CHECK and `last_read_message_id`; rollback split into a guarded safe script and an explicit with-data script; backup/restore procedure corrected (delete `-wal`/`-shm`, use `npm run backup`); a note that `upgrade.test.ts` must be updated when the file is added.

**Recommendation: APPROVE revision 2** (revision 1 should NOT be approved). Conditions: follow sections 3-5 exactly, and treat read access, participation limits and loop guards as application work that must be built and tested before groups are switched on.

## 11. Application record (2026-11-04)
Owner's approval: revision 2 only, with conditions: stop the app; `npm run backup` and verify it; update `upgrade.test.ts`; full test suite; existing data intact; documentation updated; **do not enable group messaging**; no destructive rollback; no commit without separate approval; stop and report on any failure.

| Step | What was done | Evidence |
|---|---|---|
| 1. Stop the app | Stopped this project's `npm run dev` / `dev:all` processes (watchers, server, Vite). Two leftover `vitest run src/desktop/...` test processes were left alone (in-memory databases only). | No listener on ports 3000/5173; re-checked immediately before applying |
| 2. Backup | `npm run backup` -> `data/backups/2026-11-04_184207/` (`app.db`, `vault.key`). Second copy outside the project: `C:\Users\carlou\Desktop\ai bot backups\2026-11-04_184207\` (hashes equal). | Backup `app.db` SHA-256 `a13a7c94b1aa47ae785a74b69abc24285261f0e02e6b36c7a9f8d2b65fb89e8d`; `PRAGMA integrity_check` = `ok`; `foreign_key_check` = 0 rows; 52 tables / 50 rows, every table's row checksum and every schema object identical to the original; last migration 016; `vault.key` identical |
| 3. Revision 2 only | `docs/proposals/017_groups.sql` copied unchanged to `src/db/migrations/017_groups.sql` | Both SHA-256 `d45d6dca7099d9de9a6ed0e958f3bffefa693963457350f48c95d6b10b915397`; test 0 pins the copy and the hash |
| 4. Tests updated | `src/db/upgrade.test.ts` and `src/agent-manager/agent-manager.test.ts` expect `017_groups.sql` (17 migrations). `src/db/groups-proposal.test.ts`: tests now start from a 016 database built like the runner (`openAt016`); the "not applied" test became "revision 2 is the applied migration"; added a real-runner test on a populated 016 database and a test that no application code uses the group tables | 21 tests in that file |
| Rehearsal | The real runner (`openDatabase`) applied 017 to a scratch COPY of the backup | 52 pre-existing tables identical; 49 new objects, all group objects; group tables empty |
| Application | `data/app.db` re-checked as identical to the backup's source, then the app's own runner (`openDatabase("data/app.db")`, one transaction) applied 017; the app was NOT started | `schema_migrations` has `017_groups.sql` (applied 2026-11-04T14:45:17Z); `integrity_check` `ok`; 0 foreign-key violations; all 52 pre-existing tables (50 rows) and all pre-existing schema objects identical; 49 objects added, all group objects; group tables 0 rows; database unchanged again after the full test runs |
| 5. Full suite | `npm run check` | Passed: 1,394 backend + 261 dashboard tests, typecheck and builds. The first run had 1 failure in `src/desktop/real-windows.test.ts` ("refuses a session once the Windows host was restarted": the disposable test window's launch returned no session under full-suite load); the file alone passed 22/22 and the full re-run passed. Unrelated to the database |

Not done, deliberately: the local Git tag `rollback/before-groups` (section 4 step 5) was not created, because nothing is committed yet; it belongs to the commit review. No group feature, route, service or page exists. Rollback, if ever needed: section 5 (no group data exists yet, so the SAFE rollback applies; or restore the verified backup, deleting `app.db-wal` and `app.db-shm` first).
