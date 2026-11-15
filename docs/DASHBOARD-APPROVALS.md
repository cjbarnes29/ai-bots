# Dashboard and Approvals slice (D-096)

2026-11-15. Owner selected implementation of `DASHBOARD-APPROVALS-PLAN.md`: current components/APIs, truthful data states, preserved decision rules, phone/dialog accessibility, fake browser tests and full checks. No dependency, migration, live DB/key access, real external-service request, commit or deployment.

## Delivered behavior

- **Dashboard:** priority attention section before setup, clearer page header/freshness, linked existing metrics and read-only work/activity panels. Workflow metrics disclose their latest-run sample. Server-wide task/action failures are no longer combined with a capped workflow sample. Creation-window labels distinguish these counts from completion throughput. “Finished” does not claim answer accuracy or remote delivery.
- **Approvals:** total waiting count is separate from loaded-card count, with capped-list disclosure. Every loaded pending request retains exact content, asked/expiry times, context links and the existing Approve…/Deny path. History says Executed, not a general success/delivery claim. Service details are a read-only fold below waiting requests; decision controls/counts/pause remain outside it.
- **Read failures:** shared QueryStatus distinguishes loading, failed initial read and failed refresh with cached data/freshness. Failed/unknown reads do not become allowed status, reassuring zeros or empty-success/all-clear messages. A failed workflow refresh suppresses its previous empty-success message.
- **Older approval links:** a valid unloaded `?focus=ID` uses the existing single-request GET, renders one card and follows the same decision handlers/invalidation. Invalid/missing/unavailable IDs get an honest message without removing other requests. No approval store or new backend route.
- **Dialog:** viewport-bounded layout with scrollable exact content and reachable footer, 44 px decision buttons at all tested widths, Tab/Shift+Tab containment and opener focus restoration. Callback rerenders do not reset focus. Keyboard handling yields to another active modal such as owner proof; existing cancel/Escape/busy/confirmation semantics remain. No authorization or permission change.

The Assistant route, navigation headings/order, levels, current providers and API mutation contracts are unchanged. No new result-verification badge or aggregate is introduced; RV-3 trusted reply provenance, Manager/workflow independent projections and exact target/content/delivery proof remain open.

## Changed-file inventory

Production frontend only:

- `web/src/pages/Dashboard.tsx`, `web/src/pages/Approvals.tsx`.
- `web/src/components/ConfirmDialog.tsx`, new `web/src/components/ui/QueryStatus.tsx`.
- `web/src/api/hooks.ts`: only a focused-request read hook under the existing approvals query-key prefix.

Tests/evidence:

- New `web/src/dashboard-approvals.test.tsx` and `web/src/confirmDialog-accessibility.test.tsx`.
- Existing `web/src/approvals.test.tsx`: one expected status word changed from Done to Executed; original mutation-count/decision assertions preserved.
- Existing tracked `web/src/phase2.test.tsx`: one accessible chart-name expectation updated to its truthful creation-window/current-running wording; numbers and assertions retained. This existing consumer was discovered during regression review, not overwritten.
- New `scripts/e2e/dashboard-approvals-e2e.mjs`, synthetic screenshots and `docs/evidence/dashboard-approvals/results.json`.

Stats/CSS, shell/nav, fakeApi, backend source, packages/lockfiles, owner-proof dialog and Guardian implementation did not need modification for this slice. Existing staged P-49 verifier blobs remain unchanged; no staging operation was performed. Source-only pre-slice copies were saved in temporary `awp-ui-before-aWsMRE`; they contain selected UI source/tests, no database, vault or .env. Rollback must restore only this slice's exact deltas, preserving earlier staged/unstaged work.

## Validation and corrections

Only fake/synthetic data was used. The new browser fixture builds the real app against a new scratch SQLite file and a source-defined fake Telegram action, with a synthetic encryption key passed in memory. Browser requests outside that app's loopback origin are blocked; no model/provider is needed. Opening/cancelling confirms zero writes/effects; one owner confirmation produces exactly one fake execution through the existing gate. Scratch database is removed after closing its app/browser; evidence contains fictional requests only.

Corrections during validation:

- Initial new browser fixture had a syntax error before app startup; corrected the fixture.
- Automatic approval review temporarily hit its usage limit and did not execute one browser retry; after the owner's continue instruction the approved review/run succeeded. No bypass or purchase.
- Initial browser sweep: 47/50, with three desktop/tablet confirmation-button height failures. Explicit 44 px minimum heights fixed all three; subsequent 50/50 passed.
- Visual review moved read-only service details below waiting requests and made screenshots skip transitional animations. No approval control was folded.
- Added owner-proof modal keyboard delegation and a regression test, retaining the existing proof flow. Existing Guardian/approval component suites passed 29/29 at that checkpoint.
- A stale-empty workflow refresh case was added; only successful reads may show the empty-success message. The final full check includes this change.
- The first full rerun after that case failed one unchanged Winver test at its final click (2,173/2,174 backend cases passed). With browser jobs closed, the isolated Winver case passed unchanged (1 passed, 24 unrelated cases skipped); the full suite was rerun afterward. No desktop guard or test was modified.

**Final `npm run check` passed:** 2,174 backend tests (102 files), **461 dashboard tests (50 files)**, both typechecks and dashboard production build. The 14 new component cases are included; the unchanged Winver suite passed in this final run. Existing Node DEP0190 and large-bundle warning remain (main JS 1,005.26 kB, gzip 267.91 kB). No separate backend build or real-provider run. Earlier full checkpoint before the stale-empty case passed 2,174 backend + 460 dashboard; that is historical evidence, not the final count. Only documentation was updated after the final full run.

| Browser regression | Passed checks |
|---|---:|
| New dashboard-approvals-e2e (synthetic DB/fake connector) | 52/52 |
| Existing redesign-e2e shell/responsive regression | 89/89 |
| Existing levels-e2e interface levels/beginner flow | 44/44 |
| Existing hub-e2e project/search/Assistant flow | 113/113 |
| Existing modernization-e2e result/approval/workflow regression | 34/34 |
| Total | **332/332** |

Dedicated desktop/phone screenshots were visually inspected; final captures disable transitional animation. Existing regression screenshots reside in their scripts' temporary screenshot directories; the dedicated slice evidence is saved in the repository. `git diff --check` and browser-script syntax check passed; new files are not ignored. Staged P-49 blob IDs remained unchanged.

## Evidence locations and limits

Dedicated real-browser screenshots/results: `docs/evidence/dashboard-approvals/`. They show a scratch installation and synthetic requests, not the owner's live workforce. The browser fixture exercises 360/390/768/1024/1440 px, long exact content, modal focus/footer/buttons, capped/focused IDs, each interface level and dark/reduced-motion layout. Additional text-scaling checks are reported with their precise scope; text scaling is not a claim of manually testing the browser's zoom controls.

Not verified: real phone/touch hardware, screen reader, manual browser 200% zoom, a real passphrase-protected Guardian/browser combination, real external delivery, live-owner data/history, every service-specific request shape or unattended operation. Component/fake Guardian tests and test-owned Edge establish only their documented scope. Existing Tier B/security limits remain unchanged. No production app restart/live database operation, outside request or commit.
