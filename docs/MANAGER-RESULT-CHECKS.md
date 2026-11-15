# Manager evidence checks (D-099)

2026-11-15, Asia/Dubai. Owner selected the proposed Manager checks and visible panel, then explicitly requested implementation. **Implemented, full-check passed and saved locally; UNCOMMITTED.** No migration, dependency, live database/vault access or real outside-service request.

## Behavior and interface

`GET /api/manager/runs/:id/verification` returns `{ verification }`, validates a UUID and uses existing access rules (missing run: 404 `run_not_found`). The response separates `finalSummary` (always unverified) from `supporting` (existing Verification shape), with `runId`, `runStatus`, `checkedAt`, step lifecycle counts, `coverageComplete`, step bindings/reasons and distinct task-chain results.

The Manager's direct answer, self-written steps, model review/pass and fallback final are not independent platform evidence. Final text is not scanned using task provenance assumptions, and a successful specialist action never certifies unrelated final claims or answer quality. There is deliberately no overall green Manager verdict.

The projection checks root identity, null parent, recorded specialist, user origin and exact Manager-run origin ID before including a task chain. Missing/foreign/malformed links are excluded with a reason, not repaired. Repeated valid references remain visible; their chain is checked/counts once. Read at most 10 steps and 150 task members across distinct chains; excessive records produce explicit incomplete coverage, never silently confirmed omissions.

A short SAVEPOINT snapshot captures run/step/reference/task/provenance/action facts. Existing single-task/chain rules are reused; file observations happen after that snapshot through the existing FolderGate-backed probe. SAVEPOINT composes with an existing caller transaction. No model, connector, approval, execution, audit mutation or persisted verdict is added by checking.

Contradictions and pending approvals retain their existing precedence. Failed/skipped/unfinished steps, non-completed runs, incomplete task chains, missing valid task evidence, Manager self-steps or unchecked reported files prevent full helper confirmation. Existing task verdict semantics remain unchanged; the new Manager aggregate adds its own conservative ceiling for unchecked files. A premature send claim can still contradict a pending action rather than merely show waiting.

## Panel

Each saved Manager result has a collapsed “Manager result check” disclosure. Opening it fetches the check and refreshes every 10 seconds while open; closed historical runs make no automatic check requests. Final-summary and helper-evidence labels are separate, with counts, step reasons, valid task links, observation time and expandable details. Loading/refetch hides prior confirmation, failed refresh says “Check unavailable,” and read-only manual refresh can recover. Existing start/cancel/approval controls and navigation are unchanged.

Phone layouts, native keyboard disclosure, 44 px new interactive targets, dark/reduced-motion rendering and 200% text scale have synthetic browser evidence. Real phone, screen reader and real Guardian/browser pairing are NOT VERIFIED.

## Files and evidence

- New `src/verification/manager.ts`: snapshot, bindings, bounded projection and response type.
- `src/verification/service.ts`: reuse chain loading/evaluation separately so captured facts can be checked after the snapshot; new `verifyManager` entry point. Earlier D-091/D-093/D-098 work preserved.
- `src/verification/routes.ts`: new read-only route, registered through existing verification setup; no Manager execution service or app wiring changes needed.
- New `web/src/components/ManagerResultCheck.tsx`, existing ManagerPanel and verification hooks: panel, response type and on-demand query.
- New `src/verification/manager-verification.test.ts` (38 cases), `web/src/manager-verification.test.tsx` (11 cases), `scripts/e2e/manager-verification-e2e.mjs` and synthetic screenshots/results in `docs/evidence/manager-verification/`.

Targeted backend checks passed 52/52 (38 new plus 14 existing chain cases); dashboard checks passed 17/17 (11 new plus 6 existing Manager cases). Typechecks and dashboard production build passed. **New browser check passed 29/29**: scratch DB, fake connector/provider, test-owned headless Edge, zero model/connector calls, mutations or outside browser requests. Scratch DB removed by the script.

During development, fixture expectations were corrected to retain the existing “false send before execution” contradiction rule. A revoked-folder test exposed the need for the new Manager-only unchecked-file ceiling; implemented and tested. The browserless DOM harness lacks native keyboard activation of summary and a named toggle helper: polling uses a real toggle event and keyboard activation is verified in actual Edge instead. Initial restricted-runner Edge launch failed; the normal approved test runner succeeded. Immediate desktop-to-phone assertions raced the shell media-query update on two runs; each viewport now waits for the same no-overflow condition with a five-second timeout. The final script passed 29/29 against the final built dashboard. No product check was removed.

**Final `npm run check` passed:** 2,258 backend tests in 105 files, 472 dashboard tests in 51 files, both typechecks and dashboard production build. Existing DEP0190 and large-bundle warnings remain (main JS 1,008.08 kB, gzip 268.54 kB); no separate backend build or real provider run. No application code changed after these checks.

## Preservation, rollback and limits

All work remains unstaged/uncommitted, alongside earlier approved reliability/UI changes. Original staged P-49 verifier blobs are unchanged: verify.ts `4a0b918a79e2f68ed4a629b21246c494cf197c7d`; verification.test.ts `7f003fcb877831c1601e4fd1e7486e3c738b3a96`. Do not reset/clean/stage/unstage or roll back entire shared files: those contain earlier approved deltas. Source-only rollback would remove only D-099 additions and restore the immediately preceding chain-load/evaluation structure, preserving provenance/action/lifecycle work; no data/schema rollback is needed. Rollback has not been performed.

Not supplied: proof of final Manager claims/text origins, exact recipients/artifact/content/count, quality/truth/language coverage, workflow-wide result projection, real delivery/receipts, live owner recovery, distributed workers, power-loss durability or Guardian Tier B. A checked task link is application-record evidence, not protection against a same-user database attacker. No fake evidence promotes a capability to real verified operation.

Claude/later sessions should read the current HANDOVER block, decision board and PROGRESS. Do not redo completed backend/UI work. Next proposed slice is planning workflow-wide checks, with exact approval linkage and uncertainty handling preserved; no such implementation or commit is included here.
