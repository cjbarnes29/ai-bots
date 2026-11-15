# Backup and restore rehearsal (D-089)

2026-11-15. Owner selected synthetic scratch recovery only. This is evidence for the existing backup function, not a completed recovery of the owner's installation.

## Scope and implementation

Added `src/backup/restore-rehearsal.test.ts`; production backup, vault, workflow and permission code is unchanged in this checkpoint. Tests call `backupDatabase` with explicit temporary paths. **The default `npm run backup` command was not run. No live database, live vault key or .env was opened or copied.** Every key, encrypted sample and row is synthetic. Test-owned directories are validated before cleanup.

The existing function uses SQLite `VACUUM INTO` through a separate read-only source connection, then copies an adjacent `vault.key` if present. It refuses an existing timestamp folder. The test-local restore helper copies into a new directory using exclusive creation; it is not an application restore feature or permission for an agent to access files.

## Evidence

Targeted command: `npx vitest run src/backup/restore-rehearsal.test.ts src/backup/backup.test.ts` — **12/12 passed**, including nine new rehearsal cases. Initial fixture setup used a nonexistent bot `version` field; corrected to the existing `current_version`, with no schema or production change.

Full `npm run check` passed: **2,087 backend tests (99 files), 447 dashboard tests (48 files), both typechecks and dashboard production build**. Existing Node DEP0190 and large-bundle warning (999.91 kB main JS) remain. `git diff --check` passed. No separate backend build, browser suite or real-provider run was performed.

| Case | Observed result |
|---|---|
| Open source with committed WAL data | Restored database passed integrity and foreign-key checks; schema and logical-content fingerprints matched. Backup was usable without copying source WAL/SHM. Source logical content remained unchanged. |
| Open uncommitted writer transaction | Backup included the committed snapshot only; original transaction stayed open until the test explicitly rolled it back. |
| Point-in-time and independent copies | Later source rows were absent from restore. Editing the restored project changed neither the source project nor backup bytes. Current-schema opening through `openDatabase` preserved the snapshot. |
| Relationships and search | Parent/child tasks, bot versions, chat Unicode, project conversation links, saved workflow version and approval ID, full-text search, audit/event rows and read-denied/write-approval permission settings survived. The fingerprint covers all logical main tables, including project links for notes/tasks/workflows. |
| Synthetic encrypted vault | Matching synthetic key decrypted the sample; wrong synthetic key returned null and recorded unreadability without changing encrypted rows. No secret/key value was printed. |
| Keyless database without secrets | Database-only backup restored correctly; no key file was invented. This does not establish recovery of encrypted data with a missing key. |
| Waiting workflow approval | After restored scratch opening and recovery/reconciliation, the same pending approval reference remained waiting; fake action port was never called. No task/Manager/model/service ran. |
| Existing database constraints | Restored task-event append-only, immutable approval arguments and permanent workflow-version protections rejected edits and left contents unchanged. |
| Collision, missing and damaged candidates | Existing backup/restore targets were preserved; missing source copy failed; damaged database was rejected. An empty database passed SQLite integrity but failed application relationship/content checks, demonstrating that integrity alone is insufficient. |

Fingerprints compare schema and logical rows rather than file bytes because VACUUM compacts storage. FTS shadow storage is represented through its virtual table; integrity checking also covers the underlying database. Hashes are test assertions, not a tamper-resistant backup manifest. The negative-candidate checks are tests and documented acceptance criteria, not a newly shipped automatic restore validator.

## Recovery procedure for a future owner-approved drill

These are review instructions only. **No live replacement or app restart was performed or authorized by this rehearsal.**

1. Agree on the exact backup and fresh destination paths, maintenance window and rollback copy. Keep the Guardian paused and automation stopped; close all application database writers through their normal controls. Do not kill unrelated programs or resume work as part of restoration.
2. Preserve the existing installation before any replacement. For a stopped database, retain its associated WAL/SHM files as a set if present; do not replace only the main file while old writers or sidecars remain. Never discard the original to make room for a restore.
3. Identify the backup's `app.db` and its matching `vault.key` where encrypted entries exist. Keep them private and paired. SQLite integrity can pass while encrypted credentials are unusable. Do not paste, print or log a key or decrypted credential.
4. Copy the candidate into a **fresh quarantined directory**, refusing overwrites. Keep the backup itself unchanged. Inspect with a read-only database connection first; do not start the full app, which can apply migrations or run startup recovery/probes.
5. Require `PRAGMA integrity_check` = `ok`, no `PRAGMA foreign_key_check` rows, expected migration history and representative application records/relationships. Include project links, task ancestry/events, saved workflow graphs/versions, exact approval references, search and permissions. Compare against an independently recorded expected inventory; an empty valid database is not successful recovery.
6. If encrypted entries exist, separately verify the matching key through the vault's stored-value decryption path without environment fallback, logging values or contacting providers. Missing/wrong key means incomplete recovery. This real-key step requires its own owner-approved handling; this rehearsal used synthetic bytes only.
7. Review saved running/waiting work before enabling execution. Preserve approval IDs and records; do not resend uncertain outside actions to test recovery. D-085/D-088 guards are conservative, and restoring an older backup can lose newer local receipts even though an outside action already happened. Check outside history only under separately approved request counts.
8. Present the candidate results, exact live replacement steps and rollback steps for owner approval. Any live-file replacement, real-key handling or real-service check needs its own scope. After an approved replacement, keep automation held until the owner reviews recovered state; restoration never grants permission or resumes the Guardian.

## Backup coverage and limits

- The existing backup contains the SQLite database and an adjacent vault key if present. It is **not a whole-installation or PC backup**: .env, Guardian configuration/passphrase/journal, external attachments/files and generated outputs are not copied by this function. Inventory and protection of those resources remain separate work.
- Database snapshot and key copy are sequential, not one filesystem transaction. Concurrent key replacement/rotation, partial-output cleanup and disk-full/interrupted-copy behavior were not tested here. A completed folder name alone is not proof of a complete backup.
- Restoring an old database cannot reverse or establish exactly-once execution of a remote action. Do not treat a pending restored request as proof the remote service did nothing after the backup point.
- Not verified: owner's actual backup/key pair, full live application startup after restore, cross-version migration/upgrade, real provider/desktop effects, abrupt process kill/power loss, OS/storage durability, hostile backup tampering and unattended recovery. Guardian Tier B remains unbuilt; operation stays supervised.
- No dependency, migration, outside request, live database/vault copy or commit. Prior staged work remains separate.
