# Small implementation plan: template (development aid for Claude)

Status: documentation draft, 2026-11-15 (D-116). **Not a CLI, extension or host skill; nothing is installed.** Use it for a selected change big enough to need a written plan (more than a few files, or any security, data, approval or provider effect). `CLAUDE.md` wins on any conflict.

Provenance: the structure borrows the idea of a short plan with concrete files, checks and rollback from obra/superpowers `writing-plans` (pinned commit `22f0b463e7a5e579904dd6211a520321035526f7`, MIT, Jesse Vincent, 2025) and github/spec-kit's plan template (MIT, GitHub, Inc.), as summarised in `docs/SUPERPOWERS-AND-REUSABLE-SKILLS.md`. No upstream text is copied; project rules replace their commit and delegation defaults.

Keep one authoritative record: put the plan in its own `docs/<NAME>-PLAN.md`, add a decision-board entry (next free D-number) and link it from `docs/HANDOVER.md`. Do not create a second process or a conflicting "constitution".

---
## Copy from here

# <Title> plan
Date, status line (**PLAN ONLY** until the owner chooses to build), decision-board id.

## NOT VERIFIED
List every claim that is a design or a reading of the code, not a result.

## Problem and outcome
One short paragraph each: what is wrong or missing, and what "done" looks like for the owner.

## Exclusions
What this change will NOT do (new dependencies, schema changes, new permissions, UI redesign, real requests).

## What exists today (read from the code)
Files, functions and tables involved, with paths (`src/...`, `web/src/...`) and what each does. Quote line ranges only if they will not rot.

## Approach and alternatives
The recommended approach and the realistic alternatives, each with cost and risk. Say which needs the owner's approval (dependency, migration, security boundary).

## Steps (each ends with evidence)
Numbered, small, ordered. For each: files touched, the test to write first, the check to run. Migrations: take `npm run backup` or stop the dev server first; never apply by hand to the real database.

## Safety and permissions
Which of these are touched: approval gate, folder gate, Guardian, vault, interface levels, assistant action levels. State "none" explicitly when true. Nothing may grant a permission, folder, program, secret or approval.

## Tests and checks
Unit/integration with fakes, dashboard component tests, browser scripts, full `npm run check`, staged-only export for each commit. Real-provider runs need the owner's exact approved count.

## Rollback
How to return to the previous behavior and what data (if any) is left behind. No destructive git operation without approval.

## Risks
Short list: lossy mapping, secrets in logs, load-sensitive tests, anything an agent could misuse.

## Owner decisions needed
Clickable options, one question at a time: what to do next.

## Progress (fill as built)
Dated lines with real results and "not verified" items; update the decision board, progress and handover in the same change.

---
## End of template

## Acceptance for this aid (when piloted)
Use it for one real small plan. It helps if the plan was readable by the owner in one sitting, listed concrete files and checks, named what is not verified, and did not need to be restarted. Otherwise set it aside; documentation drafts are revisable.
