# Reliable reply checking and handover (D-097)

**Implementation follow-up D-098:** the owner subsequently selected implementation. Delivered behavior, changed files, synthetic failure evidence, full checks and limitations are saved in [REPLY-PROVENANCE.md](REPLY-PROVENANCE.md); current Claude resume state is in [HANDOVER.md](HANDOVER.md). The original planning record below is historical, not the current implementation status.

2026-11-15, Asia/Dubai. **PLAN ONLY. No application/test/schema change or new test run.** Owner selected reliable separation of AI-written result text from platform notes across saving, truncation and restart, then explicitly asked to save the work so Claude can resume later. This document and the current handover/progress/decision records satisfy that save request; it is not a commit or implementation approval.

## Recommended design

Keep `tasks.result` as the one displayed result. Build it from **origin-labelled segments** in trusted engine code and save a small versioned range manifest in existing append-only `task_events`, **in the same transaction as finishing the task**. Verification checks the manifest against the exact stored result before selecting agent-written sections. Never locate a trusted boundary by searching for a heading supplied in text.

Use existing tables; no migration, dependency, secret, signature key, new permission or second text store. The visible platform heading can stay for readability, but has no authority. An agent typing that heading or JSON that resembles a manifest cannot alter the host-generated ranges.

This replaces the preliminary D-090 single-prefix suggestion with a source-informed segment contract. It closes the **separator-spoofing gap RV-3**, not factual correctness, exact targets/content/delivery, language coverage or independent Manager/workflow final-result checks. Those limits stay open.

## Source findings and why segments are necessary

| Current source | Observed behavior | Consequence |
|---|---|---|
| `TaskEngine.settle` | Appends platform context/action/workspace notes after a literal heading | The heading is display text, not proof of where the model's words end |
| `TaskEngine.execute` | Ordinary result uses cleaned first/second model text; call-budget fallback and blank final response use `assembled(...)` | Fallback contains `parsed.text`, feedback labels, teammate results, action/read outcomes and a platform budget note. Treating its entire prefix as the current agent's own answer is incorrect |
| `runTask` | Truncates assembled result to MAX_RESULT_CHARS=20,000, adds a cut notice, writes completion and lifecycle event separately | Offsets must describe the final stored representation; completion/event writes need an atomic method |
| Failure path | TaskFailure can carry a partial result, truncated separately; non-result failures are null | Failure metadata must not turn partial/failed work into completed/verified work |
| TaskRepository | Existing finish updates pending/running rows only; transaction helper is synchronous; task_events are append-only | Reuse tables and cancellation guard; add a dedicated atomic finish rather than weakening existing transitions |
| Verification | Pure checker currently trims/splits the string at the first heading; chain path calls the pure checker directly | Both one-task and chain paths must receive decoded authorship. Updating only verifyTask(service) misses chains/agent counts |

No live task/DB was inspected. These are source findings; the D-090 synthetic separator counterexample remains the recorded reproduction. Existing code is **not fixed by this plan**.

## Internal rendering contract

Add `src/delegation/result-provenance.ts` with transient `ResultSegment { origin: "agent" | "platform" | "untrusted"; text: string }`, a renderer/truncator and a strict decoder. These are internal values, never fields accepted from a user/model action, template, import, HTTP write or connector output.

- `agent`: the current task's cleaned model reply. Existing action/delegation/publication stripping and workspace behavior stay intact. The words may still be false; this tag means authorship, not evidence.
- `platform`: host-generated context/warning wrappers, separators, fixed labels/budget/cut notices and platform outcome notes. Do not derive the tag from content. Exclusion from claim scanning does not make a platform string evidence of success.
- `untrusted`: quoted teammate output or outside/tool/read data in fallback material. A child's own platform footer remains untrusted when copied into the parent. Its source task is checked independently; do not transplant its metadata into the parent's result.

Normal no-action and final-summary paths produce agent text followed by platform notes. Budget and blank-summary fallbacks preserve the current useful text/order but classify each constituent before assembly: parsed model text as agent, labels/notices as platform, returned data/teammate text as untrusted. Any fallback with untrusted raw material caps the final-answer verdict at unverified; it is not a new model-written summary. Do not spend another model call to manufacture provenance.

`settle` should return a structured internal completion payload instead of a bare string. Update every execute return path and TaskFailure's optional partial payload. The public TaskRecord/API result remains a string; rendering must not change existing messages, publication requirements, action gating or task budgets merely to simplify the type conversion.

Rendering/metadata preparation is pure. Keep workspace outcome/publication work and all model/gate/file calls outside the finish transaction, with their existing call/permission rules. Atomic result persistence does not roll back those earlier effects and must never replay them after a storage fault. Preserve the existing lifecycle `characters` meaning (pre-cut assembled length); manifest resultLength describes the stored length separately.

### Truncation and Unicode

1. Convert segment strings to well-formed Unicode before laying them out. Preserve whitespace, CRLF and visible text otherwise; no normalization/trim after offsets are computed.
2. Render using the current separators/order, recording contiguous ranges covering the entire rendered string. Coalesce adjacent equal-origin ranges; zero-length ranges are omitted.
3. Preserve the current 20,000-character cut policy and visible cut notice, but cut on a valid UTF-16 boundary (never split a surrogate pair). Apply it to the assembled result once. The generated cut notice is platform text.
4. Clip ranges to the retained prefix and include the notice's range. Set `agentTextComplete=false` if any agent text was lost. Loss of platform-only suffix does not imply lost agent text. Untrusted material remains explicitly flagged. No slicing based on a model-provided marker.
5. Hash the exact final stored string as UTF-8, and record its UTF-16 length/ranges. SQLite reopen must yield the same string/hash. Verification hashes **before** any trim and extracts each agent range independently; it never concatenates across omitted platform/untrusted sections to invent a sentence.

The existing bounded claim parser remains bounded across **all** agent ranges (shared 20,000-character/eight-claim budget, not a fresh budget per segment). If truncation or exhausted scan budget leaves agent text unchecked, cap otherwise verified at unverified. Known action/file failures still contradict; known pending approval still waits. No regex rescans unbounded suffixes.

Preserve the existing exported `findClaims(text): Claim[]` contract for callers/tests; add an internal bounded scan result with coverage information for verification rather than silently changing that export. Coverage is false whenever a budget stops before the end of the agent-written material; do not infer that unchecked suffixes contain no further claim.

## Persistence format and atomic write

Proposed task_events kind: `result_provenance`. Example shape, with synthetic placeholders:

```json
{
  "version": 1,
  "unit": "utf16",
  "taskId": "task-id",
  "rootId": "root-id",
  "status": "completed",
  "resultLength": 120,
  "resultSha256": "64-lowercase-hex-characters",
  "agentTextComplete": true,
  "ranges": [
    {"start": 0, "end": 80, "origin": "agent"},
    {"start": 80, "end": 120, "origin": "platform"}
  ]
}
```

Ranges, lengths, IDs, status and booleans are metadata only. Do not save another plaintext answer, credentials or model prompt. Manifest JSON is bounded (16 KiB, at most 64 ranges); unsupported/overflow shape means unknown provenance, never a silently truncated valid manifest. Hash is binding/integrity evidence inside this app, **not a signature or protection against a same-user DB attacker** (S-15/Tier B unchanged).

Add `TaskRepository.finishWithProvenance(...)`, returning whether it actually finished one unfinished row:

1. Validate prepared payload/manifest before opening the synchronous transaction. `BEGIN IMMEDIATE` must occur before the rollback catch so a rejected nested BEGIN cannot roll back a caller's outer transaction. No async callbacks, generic transaction refactor or await inside it.
2. CAS-update the exact task/root while its status is pending/running, preserving the current cancellation guard. If zero rows changed, commit no event and return false; never attach metadata to an existing terminal/cancelled row or guess a legacy binding.
3. Insert the one provenance event and the existing completed/failed lifecycle event on the same connection, then commit. No completion or root-finished notification before commit. A failed/no-result task needs its normal atomic failure/lifecycle record, not fabricated agent text.
4. Any insert/lifecycle/precommit fault rolls back the status/result/events together. Commit/notification fault handling must re-read a terminal state before writing again; never overwrite a committed winner or append duplicate provenance. Invoke existing root callback only after confirmed transition.

Important engine catch behavior: a completion-persistence exception must **not** fall through to the old non-atomic completion or a legacy result write. Leave an already-terminal row unchanged. If still unfinished and storage permits, allow one bounded attempt to record a fixed `result_persistence_failed` failure with null result/lifecycle event; no model text or outside action is replayed. If that also fails, surface a safe operational failure and retain normal interrupted-task recovery. Do not loop retries, resend approvals, or treat a missing event as proof an outside action did nothing.

## Reader and verdict contract

Load task result plus provenance **count and candidate metadata in one SQL statement/snapshot**. Count all matching events; do not choose “latest” when duplicates exist. Use current root/task identity to reject a foreign event/root. Do this for both the one-task query and every chain member; do not bypass it in verifyChain.

Strict decoder requires exactly one event, supported version/unit/status, exact IDs/hash/length, booleans, finite integer offsets, allowed origins and complete ordered non-overlapping coverage from 0 to stored length. Reject gaps, duplicated ranges, out-of-bounds/negative/fractional values, surrogate-splitting offsets, oversize/malformed JSON and unknown fields where they alter interpretation. Failed/cancelled tasks retain not_applicable verification; partial text is diagnostic only.

The pure `verifyTask` gets an optional fourth **internal** AuthorshipAssessment argument from this decoder. A known assessment is bound again to task ID/hash and supplies agent ranges/completeness/untrusted flags; missing argument is unknown, never an implicit “all text is agent” or old-marker fallback. This leaves HTTP TaskRecord shape unchanged. Unit fixtures may provide explicit synthetic assessments; production routes cannot accept them from a request body.

| Condition | Required behavior |
|---|---|
| Valid full agent/platform ranges, no unchecked/untrusted material | Scan all bounded agent ranges, including any fake heading typed by the model; retain exact-action/file/chain checks |
| Genuine platform notes contain “sent/created” | Do not scan those words as the agent's claims; do not award evidence for the notes themselves |
| Missing/legacy/duplicate/invalid/mismatched metadata | provenance_unchecked note and unverified ceiling; do not guess separation or backfill old rows |
| Truncated agent text, exhausted shared scan budget, mixed untrusted fallback or no authored final answer | Explicit incomplete/unchecked explanation; cannot become wholly verified from unrelated action evidence |
| Failed action/missing or changed reported file | Preserve contradicted even if provenance is unknown; these are independent recorded facts |
| Pending approval | Preserve waiting unless an independently established contradiction is stronger; unknown provenance never approves or runs it |
| Failed/cancelled/running task | Keep existing standalone not_applicable and D-091 chain lifecycle ceiling/details |

Evidence counts stay separate from coverage; an executed action/file can remain a pass while the overall result is unverified. Registry agent counts and audit consume the resulting current verdict. Existing audit deduplication stays status/evidence-based. Historic confirmed counts may drop; this means stricter coverage, not an action or record was undone.

## Proposed file manifest and implementation order

| File | Specific delta |
|---|---|
| src/delegation/result-provenance.ts (new; check existence first) | Segment render/truncate/hash, manifest shape and strict decode/binding helpers |
| src/delegation/engine.ts | Structured result/partial payloads; classify every normal/fallback path before assembly; one atomic finish; postcommit callbacks and bounded persistence failure handling |
| src/delegation/repository.ts | Dedicated guarded atomic finish + existing lifecycle/provenance insertion; current finish/cancel/recovery semantics retained for other callers |
| src/verification/service.ts | Same-statement task/manifest loading for one task and chains, duplicate/root checks and decoder assessment |
| src/verification/verify.ts | Remove marker-based trust; optional internal assessment; independent agent-span scans and uncertainty/coverage ceilings; preserve D-093 matcher and staged P-49 handoff wording |
| src/delegation/result-provenance.test.ts (new) | Codec, all completion paths, transaction/fault/cancel/reopen tests using synthetic DBs/fake providers |
| src/verification/reply-provenance.test.ts (new) | Spoofed markers, genuine notes, legacy/bad metadata, bounded multi-range coverage, verdict/registry/read-only integration |
| Existing verification/chain/action-matching tests | Explicit synthetic authorship in positive fixtures; preserve meaningful action, file, ownership, status and read-only assertions. Platform-note exclusion fixture must declare known ranges, never infer them with the same unsafe split |
| Docs/records | CAPABILITIES, result plans/evidence, SECURITY-AUDIT, GUARDIAN, HANDOVER, PROGRESS, decision board and TASKS updated with actual outcomes |

No frontend rewrite, approval/gate/FolderGate/Guardian/model permission change, new task API, database migration or new library. First implement/test the pure codec and atomic repository method, then engine paths, reader/verdict integration, fixture updates, targeted fake tests and full check. Staged P-49 verifier blobs stay in the index; any approved implementation adds a separately reviewable unstaged delta above current D-093 work. Never overwrite a tracked test or use reset/clean to isolate this slice.

## Required failure/compatibility tests (proposed, NOT run)

1. Model heading at beginning/middle/multiple times, followed by an unsupported send claim: it remains agent text and is checked. Model-supplied manifest JSON cannot confer origin.
2. Genuine platform-only suffix contains completion verbs: excluded; first/second cleaned model answers still checked. No notes/evidence are fabricated.
3. Call-budget fallback, blank-summary fallback, teammate text with its own footer, permitted read output and mixed rejected/pending action feedback: preserve output/order; mixed untrusted material remains unverified.
4. Cut before/inside/after agent/platform/untrusted ranges; astral emoji at the boundary, malformed surrogate input, CRLF/leading/trailing whitespace; hash and offsets survive file-DB close/reopen. Missing agent tail never yields full confirmation.
5. Empty agent answer, platform-only result, failed workspace publication partial, cancellation/Guardian hold and ordinary no-result failures retain existing task statuses, gates, budgets and result-publication requirements.
6. Missing/duplicate/foreign-root/wrong-task/wrong-status/bad-hash/unsupported-version/malformed/oversize manifests; negative/fractional/overlapping/gapped/out-of-range offsets and oversized range count fail closed without probe/model/action execution.
7. Transaction faults before update/after update/after manifest/after lifecycle/before commit roll back all three writes. Nested BEGIN does not roll back an existing outer transaction. Competing/cancelled/stale finish creates no event. Notification failure after commit does not erase/repeat the saved result.
8. Persistence-error catch cannot save a legacy completed string or replay an outside action; one safe failure-record attempt at most. Crash-state/reopen after committed finish resolves exact record; interrupted unfinished state uses existing recovery. No real power-loss claim.
9. One-task and chain endpoints, delegated children, agent counts, audit changes and ordinary app task execution consume the same decoder. Unknown provenance is not silently skipped by the chain path.
10. D-093 known/unknown exact action effects, all approval statuses, D-091 incomplete chains, P-49 handoff phrases and gated file checks remain meaningful. Checking creates no request, mutates no approval, and never changes a grant or executes a connector.
11. Shared scan budget is bounded across many segments; no cross-origin concatenation creates false claims, and incomplete coverage remains unverified. No adversarial regex suffix rescans.
12. Legacy completed rows remain byte-identical and unverified where provenance is missing; no automatic backfill/migration. Fake fixtures explicitly identify their authored text without relying on the marker. Existing displayed text/cut messages/API fields remain compatible except the documented Unicode-safe cut.

Run targeted codec/repository/engine/verification/delegation/workspace suites, then full `npm run check`; use existing synthetic modernization browser check if result-panel wording/behavior changes. No real model, outside service, live DB/key copy, desktop host or abrupt process-kill drill is needed. Actual power-loss and Tier B are separate evidence.

## Compatibility, rollback and resume state

This is an additive event format over existing tables. No live backfill. Older code ignores the new event but restores the old unsafe separator behavior, so **rolling back is not safe evidence of correctness**: preserve events/history, disclose the verifier downgrade and do not present old confirmation as newly trusted. Reverting only producer or consumer can also leave new completed results unverified; never add a permissive compatibility fallback to hide that.

Last successful implementation checkpoint is **D-096: 2,174 backend + 461 dashboard tests, both typechecks/dashboard build; 332/332 synthetic browser checks**. No new test/full-check/browser run for this plan. Current known limits include RV-3 (not implemented), Manager/workflow final-result projections, exact targets/content/receipts, real owner recovery and Guardian Tier B. UI improvements are built and uncommitted; live app was left stopped.

Staged verifier blobs matched before/after this plan: verify.ts `4a0b918a79e2f68ed4a629b21246c494cf197c7d`; verification.test.ts `7f003fcb877831c1601e4fd1e7486e3c738b3a96`. Engine/repository/service/verifier working-file SHA256 values also matched; no code/staging operation occurred. `git diff --check` passed. Read `AGENTS.md`, `DECISION-BOARD.md`, `PROGRESS.md` and `HANDOVER.md` before resuming. Owner approved **planning only** here; next step is a clickable implementation choice, not an assumed code change. Leaving this saved checkpoint for Claude is also a valid stopping point.
