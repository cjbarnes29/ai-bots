# Owner backup drill checklist (real installation)

Written for: you, the owner, to run by hand. Date 2026-11-16. **Nothing here was run by the assistant.** It turns the synthetic rehearsal (`docs/BACKUP-RESTORE-REHEARSAL.md`, D-089) into steps you can do on your real data. Until you run it and share the output, a recovery of your real installation is **NOT VERIFIED**.

## Before you start
- Stop the dev server (`npm run dev:all`) so no file changes while you copy.
- Do not paste any key, token or the contents of `.env` into a chat. Share only the pass/fail lines asked for below.

## Steps
1. **Make a backup.** Run `npm run backup`. Write down the folder it prints. Expect: a new backup file and no error.
2. **Check the key pair.** Confirm you still have the vault key that matches this backup (the encrypted entries are unreadable without it). Keep a copy of the key somewhere separate from the backup (for example another drive). Do not store them together.
3. **Restore into a scratch copy, never over the live database.** Copy the backup file to a new empty folder. Point a second app instance at that copy only (a different data path and port). Do not replace your live files.
4. **Look at it.** Open the scratch instance. Check: your bots, projects, memory notes and approvals history are there; the Approvals "Outcome unknown" section loads; the Guardian and all automation are still held (a restore never resumes anything).
5. **Delete the scratch copy** (it holds the vault key material) and re-check that your live database is unchanged.

## What to report back (pass/fail only)
- Backup created: yes / no
- Matching key kept separately: yes / no
- Scratch instance started and showed your data: yes / no
- Automation still held after the restore: yes / no
- Scratch copy deleted: yes / no

## Still NOT verified after this drill
Cross-version upgrade, abrupt power loss during a write, hostile tampering of a backup, unattended recovery. Operation stays supervised until Guardian Tier B is verified.
