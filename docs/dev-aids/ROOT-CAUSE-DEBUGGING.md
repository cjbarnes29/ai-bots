# Root-cause debugging checklist (development aid for Claude)

Status: documentation draft, 2026-11-15 (D-116). **Not a host skill, hook or plugin; nothing is installed or registered.** It only restates a method and binds it to this project's rules. Where it conflicts with `CLAUDE.md`, `CLAUDE.md` wins.

Provenance: the method (reproduce, compare, trace, one hypothesis at a time) is the general idea in the `systematic-debugging` skill of obra/superpowers at pinned commit `22f0b463e7a5e579904dd6211a520321035526f7` (MIT, Jesse Vincent, 2025), as summarised in `docs/SUPERPOWERS-AND-REUSABLE-SKILLS.md`. No upstream text is copied here; the wording and the project rules are local. Keep the MIT notice with any future substantial reuse.

## When to use it
A test or browser check fails, a result looks wrong, or a behavior differs from a doc. Not needed for an obvious typo.

## Steps
1. **State the symptom exactly.** Copy the failing test name and the first real error line. Say what you expected and what happened.
2. **Reproduce it on purpose.** Run the smallest thing that fails (one test file, one script). If it does not fail again, say so; do not "fix" something you cannot reproduce. Record how many runs you tried.
3. **Check the cheap causes first.** Did the failing area change? (`git diff`, `git log -3 -- <path>`). Is it an export or environment artifact (line endings, missing junction, other session active)? Does it fail alone and in the full run?
4. **Compare with a working path.** Find the nearest similar code or test that works and list the differences.
5. **Form ONE hypothesis and test it** with the smallest change or a read-only probe. Change one thing at a time.
6. **Fix the cause, not the symptom.** Add or adjust a test that fails before the fix and passes after, using fakes.
7. **Stop guessing.** After two failed fixes, stop. Write down what was ruled out and what is still unknown (progress doc), and ask the owner a next-step question instead of trying a third guess.

## Project rules that apply while debugging
- **Never weaken a check to make it pass** (assertion, timeout, guard, limit). A wait for something that loads later is fine only when the assertion stays the same.
- **No real outside request** to reproduce a bug. Use fake services, scratch databases and scratch exports.
- **Do not log or print content, secrets, environment values, screen or field text.** Use redacted metadata (ids, counts, hashes).
- **Desktop code (`src/desktop/`):** only the disposable test windows. Never touch the owner's windows.
- **Never remove a stop/kill/network guard to see what happens.** Reproduce with fake process tables or fake networks only.
- **Never run a migration or open the live database** to investigate. Use a scratch copy only if the owner approved it.
- **Load-sensitive tests** (`src/desktop/real-windows.test.ts`, known): if exactly one fails, re-run that file alone, then the full check once on a quiet machine, before treating it as a regression (D-115).
- **Export artifacts:** verify staged exports with `git -c core.autocrlf=false checkout-index`; a line-ending change fails the byte-identical `017_groups.sql` test and is not a code fault.

## What to write down
Symptom, how reproduced (runs and result), cause found or still unknown, the fix, the test that now covers it, and anything NOT verified. Put it in `docs/PROGRESS.md` and, if it changes a decision, `docs/DECISION-BOARD.md`.

## Acceptance for this aid (when piloted)
A pilot shows value only if a real debugging session ends with: a reproduced symptom, a named cause, a regression test, no weakened checks and an honest "not verified" list. A green suite alone does not prove the aid helped.
