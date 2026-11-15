# Reliable saved reply origins (D-098)

2026-11-15, Asia/Dubai. Owner selected implementation of `REPLY-PROVENANCE-PLAN.md`, with synthetic failure tests/full checks and saved handover. **Implemented, tested and uncommitted.** No migration, dependency, live database/key access, real external-service request, new permission or deployment.

## What changed

TaskEngine now builds displayed results from source-labelled agent/platform/untrusted segments. A model heading or JSON resembling a manifest stays part of its agent text. Normal first/final replies, blank-summary and budget fallback paths all use this representation. Feedback raw material is conservatively untrusted; it cannot certify a final answer. Existing displayed order, publication logic, gates and budgets remain.

`tasks.result` stays the one displayed string. A bounded versioned manifest (IDs, status, SHA256, UTF-16 length/ranges and completeness flag, no duplicate plaintext) is saved in existing append-only task_events. A guarded BEGIN IMMEDIATE transaction saves the result/status, result_provenance event and completed/failed lifecycle event together. Cancellation/terminal/root guards remain; rejected nested BEGIN does not roll back a caller's transaction. Root callbacks occur only after a confirmed transition/commit.

Truncation keeps the existing 20,000-character policy/cut notice, replaces malformed surrogates before layout and avoids splitting an astral pair. The cut notice is platform text; lost agent text is marked incomplete. Failed partial results retain their diagnostic text and failed status. No-result failures have no invented agent material.

The verifier loads task plus provenance count/candidate in one SQL snapshot for both individual tasks and chains. Exactly one supported, bounded record must match task/root/status/hash/length and contiguous well-formed ranges. Duplicates, wrong identity, malformed/oversize/unsupported records or legacy missing metadata are unknown. No literal-heading fallback or backfill exists.

Only agent ranges are scanned, independently across omitted sections. The shared 20,000-character/eight-claim budget does not reset per range. Incomplete coverage, mixed untrusted material or no authored final answer caps otherwise verified to unverified. Exact-action/file checks retain independent evidence: failures can still contradict, pending approvals still wait, and D-091 lifecycle ceilings remain. No result text can grant permission or create an origin record.

The new event has a plain Task history label, “Result record saved,” without a new verification promise or layout. No approval, retry, folder, Guardian or model authorization path changed.

## Storage failure behavior

- Insert/lifecycle/precommit faults roll back status, result and manifest together.
- A committed terminal result is never replaced by a losing/uncertain retry.
- Engine persistence errors never fall back to an unbound legacy completion or call the model/connector again. An unfinished task gets at most one atomic null-result `result_persistence_failed` attempt.
- If that failure record is also unavailable, one fixed diagnostic containing only task ID is emitted and normal interrupted-task recovery remains necessary. No partial success is invented.
- Commit succeeded but caller received an error: the saved terminal state is preserved. Postcommit observer/automation delivery is not given an exactly-once guarantee or durable notification outbox; no callback replay is added.

## Changed files

| File | Delta |
|---|---|
| src/delegation/result-provenance.ts | New well-formed renderer, safe truncation, bounded manifest and strict decoder |
| src/delegation/repository.ts | New atomic guarded finish; prior finish/cancel/recovery contracts retained |
| src/delegation/engine.ts | Structured ordinary/fallback/partial results, atomic completion and bounded safe storage-failure handling |
| src/verification/service.ts | Same-snapshot task/event-count lookup in one-task/chain paths |
| src/verification/verify.ts | Optional internal bound authorship assessment; no marker trust, independent/shared-budget scans and uncertainty ceiling; D-093 rules retained |
| src/delegation/result-provenance.test.ts | New renderer/decoder/atomic/reopen tests |
| src/verification/reply-provenance.test.ts | New spoofing/coverage/fake-app/storage-fault tests |
| src/verification/test-provenance.ts | Test-only explicit synthetic origins, never a production fallback |
| Existing verification, action-matching and chain-completeness tests | Explicit known synthetic origins for positive fixtures; genuine platform note fixture declares its own sections rather than inferring from a marker |
| src/delegation/delegation.test.ts | Two exact event lists add the new event before completion; all existing usage/result/request assertions retained |
| web/src/pages/Tasks.tsx | One human-readable label for the new record event; no UI rewrite |

Original staged P-49 verifier blobs remain unchanged: verify.ts `4a0b918a79e2f68ed4a629b21246c494cf197c7d`, verification.test.ts `7f003fcb877831c1601e4fd1e7486e3c738b3a96`. Approved D-093/D-098 changes remain separate unstaged working diffs above them. No staging/unstaging/commit performed; all earlier reliability/UI work preserved.

## Evidence

**46 new cases** across the two new test files passed. Coverage includes spoofed/repeated headings, genuine notes, mixed fallback, Unicode/CRLF, safe cuts, incomplete/shared-budget scans, legacy/foreign/bad manifests, strict shapes/ranges, missing/duplicate count, range limits, rollback after update/insert/lifecycle/precommit, terminal/cancel/root/nested-transaction guards, committed-before-error preservation and scratch close/reopen with integrity check.

Fake app checks cover normal, spoofed, blank-final and call-budget results. Two scratch-file trigger faults verify the engine failure path: exactly one fake model call, no approval created, no legacy completed result, and one safe diagnostic if failure storage also fails. Triggers are added only to synthetic DBs; no production/network/kill guard is removed or mutated.

Initial targeted suites/typecheck passed (159 cases before the two storage-fault additions); the final new-file targeted run passed 46/46. First full check failed only two old exact event-sequence expectations (2,218 passed/2 failed); those expectations now explicitly include the added origin event, retaining all original assertions.

**Final `npm run check` passed:** **2,220 backend tests (104 files), 461 dashboard tests (50 files), both typechecks and dashboard production build.** Existing Node DEP0190 and large-bundle warning remain (main JS 1,005.30 kB). No separate backend build or real-provider run.

**Existing real-browser modernization regression: 34/34 passed**, using its scratch database, fake local model and test-owned Edge. It observes text-only/unbacked claims, pending→executed file evidence, gated workflow approvals and navigation/phone layouts. No real outside action/provider or owner database/window was used. Whitespace/new-file-ignore checks passed. Only documentation updated after final code verification.

## Limits and resume guidance

RV-3 heading spoofing is addressed for new TaskEngine results with valid saved metadata. Legacy/ambiguous records are unverified; they are not repaired or retroactively certified. Hash/range metadata is not a signature or protection against a same-user database attacker (Tier B remains required).

Still not established: truth/quality of an answer, every linguistic phrasing/language, exact recipient/artifact/content/count, real delivery/read receipts, historical implementation identity, independent Manager/workflow final-result projections, real power-loss durability, distributed workers or exactly-once remote effects/notifications. Task-origin checking does not make model quality review independent evidence. No live recovery or real Guardian/device test is added.

Read HANDOVER's current resume block, decision board and PROGRESS before continuing. This checkpoint's requested implementation is complete; next feature/commit/provider/operational work requires the applicable owner selection/approval. Do not rerun finished suites or rewrite the UI just because earlier historical plan sections still say pending. Saved source and documentation remain uncommitted, with the live app left stopped.
