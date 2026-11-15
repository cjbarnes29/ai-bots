# Evidence before "done" (development aid for Claude)

Status: documentation draft, 2026-11-15 (D-116). **Not a host skill or hook; nothing is installed.** `CLAUDE.md` wins on any conflict.

Provenance: the idea (do not claim completion without fresh evidence) follows the `verification-before-completion` skill of obra/superpowers at pinned commit `22f0b463e7a5e579904dd6211a520321035526f7` (MIT, Jesse Vincent, 2025), summarised in `docs/SUPERPOWERS-AND-REUSABLE-SKILLS.md`. No upstream text is copied; wording and project rules are local.

## Before saying "done", "fixed" or "passing"
1. **Run the check that proves the claim, now.** Not an earlier run, not "it should pass". Read the actual output: counts, failures, exit code.
2. **Match the check to the claim.**
   - Code change: relevant tests while working, then the full `npm run check` before presenting anything for a commit.
   - UI change: component tests AND, when layout or interaction changed, the fake-service browser scripts (`hub-e2e`, `levels-e2e`, `redesign-e2e`, `modernization-e2e`, and the area's own script). Browser scripts that rewrite tracked evidence files: save copies, restore, or ask.
   - Bug fix: the test that failed before must now pass, and say so.
   - Docs only: read the result back (shell edits have lost backslashes before); run the full check only if code changed.
3. **A commit is verified on its own.** Export exactly what is staged to a scratch folder with `core.autocrlf=false`, link `node_modules`, run the full check there.
4. **Separate old evidence from new.** Say "passed today at HH:MM" or name the run; do not reuse a previous milestone's numbers.
5. **Report failures as failures.** A flake is a flake only after: alone-run, quiet re-run, and no related code touched. Say which test and how often.

## The completion report must contain
- What ran and the exact result (for example "2,346 backend + 528 dashboard, typechecks, build; browser 34/34").
- What changed (files) and what was deliberately NOT changed.
- **What was NOT verified or NOT observed** (real browser, phone, screen reader, real provider, owner feedback). Never write "verified" for fake-only or local-only evidence.
- Whether anything is uncommitted, and that no push, deploy, install or real request happened.

## Things that are never evidence
The agent saying it worked; a registered-but-unused capability; a test run before the last edit; a passing suite for code that was not changed; a screenshot of a state that was never asserted.

## Project rules that apply
No commit without the owner's explicit approval (show `git status`, changed files, results, message and exact commands, then wait). Never mutation-test a stop/kill/network guard by removing it. Update `docs/DECISION-BOARD.md`, `docs/PROGRESS.md` and `docs/HANDOVER.md` when a decision, milestone or verification changes.

## Acceptance for this aid (when piloted)
Compare against the existing process on one small task: are the claims narrower and more accurate, and did the report list every unobserved item? Record measured cost or time only if actually measured.
