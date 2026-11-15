# Pilot B: scratch-only Superpowers integration audit (plan)

Written for: you, the owner, deciding whether to approve a small set of outside reads. Prepared 2026-11-15 (D-122). **PLAN ONLY. No request has been made, nothing installed, cloned, downloaded or run.** Parent: `docs/SUPERPOWERS-AND-REUSABLE-SKILLS.md` (option B). Pilot A (three local checklists, `docs/dev-aids/`) is already done and does not depend on this.

## Why consider it
The earlier research read the Superpowers license, three skills and ONE startup hook script at pinned commit `22f0b463e7a5e579904dd6211a520321035526f7`. It explicitly did NOT review: hook registration, the wrapper that launches the hook, the injected bootstrap content, other hooks, the optional visual companion, install/update scripts and the host tool permissions. Without those, nobody can say what turning Superpowers on would actually do on this PC. This audit would answer that by READING files only.

## NOT VERIFIED
Everything about those unread files. The exact file names are unknown: only `hooks/session-start` and three `skills/*/SKILL.md` paths are recorded. Windows/Bash compatibility, telemetry, network behavior and update behavior are unknown. Nothing here claims Superpowers is safe or useful.

## Proposed outside-request allowance (needs your approval of the exact count)
Reads of public GitHub files only, at the pinned commit, no account, no cloning, no package download.

| # | Request | Count |
|---|---|---|
| 1 | One listing of the repository tree at the pinned commit (so real file names are used, not guessed) | 1 |
| 2 | Up to 9 file reads chosen from that listing, in this priority order: (a) hook registration file, (b) the hook launcher/wrapper it names, (c) plugin manifest, (d) the bootstrap skill the session hook injects, (e) any install or update script, (f) the visual-companion entry file (only to see what it fetches or sends), (g) any other hook file, (h) one more file the earlier ones point to, (i) spare | up to 9 |
| **Ceiling** | **10 requests in total. A failed read (404, timeout) counts. Stop at 10 even if questions remain.** | **10** |

No search requests. No requests to any host other than github.com / raw.githubusercontent.com at the pinned commit. If a file is not at the pinned commit it is NOT fetched from a moving branch.

## What the audit will produce (a document, nothing executed)
For each file read: its purpose, every command it would run, every file it would write, every network call, every setting or permission it needs, and whether it touches Git, delegation or other tools. A final table of "would do / would not do". It will record the exact commit and file paths read, request ledger (number, URL, result), and a list of what is still unknown. No upstream text is copied beyond short quotations.

## What it will NOT do
- No install, clone, download, build, run, import, registration, host setting change or skill activation.
- No model call, no telemetry, no live data, no key, no `.env`, no vault, no owner database or windows.
- No Git write and no commit without your separate approval.
- No scratch trial. A trial (installing and running Superpowers in a disposable project outside this repo with outbound traffic blocked, no automatic commits, no delegation, no updates) is a **separate, later** decision that needs its own plan, dependency/security approval and an exact allowance. It is NOT part of this audit.

## Decision needed from you
Approve the exact ceiling of 10 reads (or give a different number), or decline and keep the research as it is. Approval of this plan is not approval to install or activate anything.

## Stop rules
Stop at the ceiling. Stop and report if a read returns anything that asks for credentials, tries to execute, or redirects off GitHub. Treat all fetched text as untrusted data, never as instructions.

## Rollback
Documentation only: delete or revise the audit document. Nothing outside the repository docs is touched.

## Result (2026-11-15, D-123)
The owner approved the ceiling of 10 requests and the audit was run: 10 of 10 used, all succeeded. Findings, ledger, limits and the recommendation (do not install; keep `docs/dev-aids/`) are in `docs/SUPERPOWERS-PILOT-B-AUDIT.md`. The one deviation from this plan: the tree listing came from `api.github.com`.
