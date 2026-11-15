# Result verification assessment and delivery plan (D-090)

2026-11-15. **Planning only.** Owner requested a local map of task/workflow/Manager evidence, exact gaps and a small implementation/test plan. No application or test file changed. Existing staged P-49 verification changes are preserved. No migration, dependency, database/key access, outside request or commit.

Implementation follow-up: checkpoint A selected and implemented under **D-091**, with 14 new synthetic cases and targeted suites 42/42; exact full-check evidence/limits in `CHAIN-COMPLETENESS.md`. Original D-090 assessment/proposal remains below. RV-1/RV-3 and checkpoints B/C remain pending.

## Recommendation

Strengthen the existing task verifier before adding combined Manager/workflow badges. First deliverable: prevent a task chain with failed, cancelled or unfinished members from being labelled wholly confirmed. This is a small existing-table/service change. Next tighten action matching and establish trustworthy separation of agent text from platform notes. Only then expose Manager and workflow projections over those records. Do not create another verification store or use a model as the judge.

“Completed” describes execution state. “Recorded action” means the platform recorded a connector outcome. “Confirmed file” means the permitted file check succeeded at the time of reading. None establishes the correctness of every fact in the answer or delivery/read status at a remote recipient.

## Current evidence map (source inspected)

| Surface | Platform-owned path | What is checked today | Gap or boundary |
|---|---|---|---|
| One task | tasks.id → approval_requests.task_id | `VerificationService.verifyTask` loads status/result and that task's approval outcomes; pure `verifyTask` computes checks. Non-completed tasks return not_applicable. | Executed action itself supplies evidence even when no claim matches it. Claim matching uses connector ID, not action/recipient/artifact identity. |
| Delegated chain | tasks.root_id → each task and its approval rows | `verifyChain` calls each task check and `combine`; `record` audits status/evidence changes. Verdict is recomputed, not persisted as truth. | `combine` discards not_applicable members, including failed/cancelled/pending/running ones. A confirmed member can therefore yield an all-confirmed summary despite an incomplete member. |
| Files | Approval result text beginning `Created <path> (<bytes> bytes)` → app.ts probe | Path is restricted to PC roots and goes through FolderGate for workforce read before stat. Matching size adds evidence; missing/changed-size contradicts; unreadable is a note. | No content correctness/hash comparison. Matching byte count is not semantic validation. An unreadable file does not pass its check, but its recorded executed action can still make the overall task verified. Preserve this distinction visibly. |
| Task result text | TaskEngine.settle appends platform notes to tasks.result | Verifier splits at the first literal `--- What the platform recorded` and scans the prefix only. | Separator is also legal model output, so its location is not trusted provenance. No separately persisted authored-prefix boundary is currently consumed by the verifier. |
| Manager specialist | manager_steps.task_id → specialist root/descendants → task approvals | Manager awaits task completion and stores output; task endpoint can check the linked chain. ManagerPanel links to the task. | No Manager verification endpoint or combined verdict. Step task_id is nullable text, not an enforced FK; missing references must never be silently accepted. |
| Manager direct/self steps/final review | manager_runs.result, manager_steps.output, review calls | Model quality review returns pass/fix; fallback labels results NOT REVIEWED when review fails. | Quality review is not independent evidence. Final/direct/self text is not separately checked; Manager may complete with some failed steps if at least one finished. No tools should be added. |
| Workflow bot box | workflow_steps.ref_kind=task/ref_id → task chain | Workflow stores returned task text when task completes. Task verification remains separately available. | Run status/output is not a verification verdict; no combined run endpoint. |
| Workflow Manager box | ref_kind=manager/ref_id → Manager run/steps/task links | Workflow stores Manager result after completion. | Inherits Manager gaps; must deduplicate task/action evidence reached by more than one path. |
| Workflow write box | ref_kind=approval/ref_id → exact approval + saved graph/version | D-088 validates immutable hash/binding and resolves pending/executed/failed/denied/expired states. task_id is null by design. | Task verifier's task_id query cannot include these rows. Future projection must reuse the exact binding rules, never fuzzy-match another request or call the gate. |
| Reads / structural boxes | Gate read returns text; workflow transforms/conditions/checkpoints save state/output | Reads remain separately permission-gated. Successful gate reads audit service/action/summary/ok; they do not create approval rows. | Read audit is not a task-linked immutable receipt consumed by this verifier. Read output and a human checkpoint are not proof an outside write happened. A text-only transform or skipped branch must not manufacture evidence. |
| UI and registry | Task ResultCheck uses chain endpoint; app.ts feeds countsByBot to capability facts | Task panel polls every 10 s when enabled, shows details; capability facts reuse current chain verdicts. | Chain false positives can affect agent confirmation counts. ManagerPanel and WorkflowsSection show results/status without equivalent independent checks. UI check-fetch errors currently hide the panel when no data exists. |

Source references: `src/verification/{verify,service,routes}.ts`; `src/delegation/engine.ts` (runTask/settle); `src/app.ts` (verification probe, root completion callback, countsByBot); `src/manager/service.ts` (execute/runStep/reviewOrFallback); `src/workflows/service.ts` (linkedApproval/resolveApprovals/execute); migrations 004/006/011/014; `web/src/components/{ResultCheck,ManagerPanel,WorkflowsSection}.tsx`; `web/src/api/verificationHooks.ts`. This is source inspection, not a live-state inventory.

## Reproduced gaps, without app startup or network

Three one-off diagnostic evaluations imported only `verify.ts` using the installed local tsx runner. They supplied in-memory synthetic objects and a fake file probe. No test files were created and no app/database/provider was started.

| ID | Diagnostic input | Observed current output | Required behavior |
|---|---|---|---|
| RV-1 | Completed synthetic task says “I have sent the email to Sam.” Its only executed action is **gworkspace.drive_create_doc**, an actual existing write action that creates a document. | verified | Creating a Google document must not support a send claim. Connector identity alone is insufficient. |
| RV-2 | Combine that verified member with a failed synthetic task's not_applicable verdict. | verified | A chain containing a failed member must not be described as wholly confirmed. Running/pending/cancelled members need the same ceiling. |
| RV-3 | Synthetic reply includes the platform separator followed by a send claim; an unrelated documents.create_document action is recorded. | verified; zero unsupported-claim checks | Model-supplied separator must not hide authored claims. Platform notes must still remain excluded from claim scanning. |

These are result-label correctness issues; no approval or permission bypass was exercised. The existing P-49 review/approval-handoff wording fix is useful and must stay intact, but does not resolve these cases. Other limits are source findings, not newly reproduced failures: claim patterns are English-only, scan at most 20,000 characters/eight claims, and do not bind recipient/path/content/count. No remote receipt validation, fact checking, file-content validation or authentic real-model adversarial run was performed.

## Delivery checkpoints

Checkpoint B action-matching implementation follow-up (D-093): `EXACT-ACTION-MATCHING.md` records delivered exact operation/object matching, conservative unknowns, fake checks and preserved staged baseline. The provenance half of B and Manager/workflow C remain pending.

Checkpoint B action-semantics specification follow-up (D-092, planning only): `EXACT-ACTION-MATCHING-PLAN.md` supplies the action matrix, operation/object contract, unknown-effect ceilings, precise file manifest and fake-service tests. No B implementation from that assessment; the original sequence follows.

### A — chain completeness first (recommended next implementation)

**Files:** `src/verification/service.ts`; new `src/verification/chain-completeness.test.ts` after checking it does not already exist; `docs/CAPABILITIES.md` and checkpoint records. `verify.ts` and `verification.test.ts` staged P-49 content can remain byte-identical in this slice.

1. In verifyChain, load each member's status/identity alongside its existing verification; do not discard lifecycle information before aggregation. Reuse current task records, approval lookup and gated probe.
2. Keep `combine`'s current evidence/status ordering. Return additive chain-level lifecycle counts/details identifying non-completed task IDs and statuses. Leave the Check union and staged verifier files untouched in A; the existing plain summary carries the warning.
3. If the aggregate would be verified while any member is not completed, cap it at unverified and state exactly how many are incomplete. Preserve stronger contradicted/waiting outcomes. If all members are not_applicable, preserve not_applicable while reporting their lifecycle counts. A genuinely completed all-confirmed chain keeps its verdict; text-only completed work stays unverified.
4. Additive response fields: `completion: { total, completed, pending, running, failed, cancelled }` plus `incompleteTasks: { id, status }[]` (bounded by actual chain size/normal task limits). Update the web response type if consumers need these fields; the plain existing summary must already disclose incompleteness without requiring a UI change. Count independent evidence as before, but evidence count never overrides this ceiling.
5. Current `record` and `countsByBot` consume the corrected verdict, without a new store, grant or registry list. This slice does not repair RV-1/RV-3 or produce Manager/workflow verification; keep those limitations pinned.

Required fake/scratch cases (proposed, **not added/run**): verified root + failed child; cancelled child; pending child; running child; all completed/verified unchanged; completed text-only child remains unverified; contradicted member remains contradicted; pending approval remains waiting even with an incomplete child; all non-completed stays not_applicable with counts; unknown chain stays undefined/404; current record updates after child completion; agent counts cannot promote an incomplete chain; asking never executes/approves/creates a request and a denied folder probe remains denied. Include API summary/count assertions. Run targeted new + existing verification tests, then full check. No live-service or live-DB test.

### B — exact action semantics and authored-text provenance

**Implementation follow-up D-098:** [saved reply-origin implementation](REPLY-PROVENANCE.md) delivers the refined D-097 segmented design, atomic existing-table save and strict single-task/chain checking. New supported records no longer trust literal platform headings; legacy/invalid/mixed/incomplete records remain unverified. Combined Manager/workflow projections (C), targets/content/receipts and semantic correctness remain pending. Earlier proposals below are historical specifications, not missing current implementation.

Source-informed provenance follow-up (D-097, planning only): `REPLY-PROVENANCE-PLAN.md` refines the preliminary prefix proposal below into origin-labelled ranges, because fallback output mixes agent/teammate/tool/platform text. Exact existing-table atomic write, Unicode/truncation, strict reader/legacy policy and failure tests specified; no implementation or backfill. Resume state saved in HANDOVER at the owner's request.

Two small separately reviewable patches, before Manager/workflow confirmation is exposed:

- **Action semantics (RV-1):** attach optional, conservative result-effect facts to the existing connector ActionSpec, reported by the owning connector (for example send/save/publish/remove). `telegram.send_message` and `gmail.send_message` may back send; `gworkspace.drive_create_doc` may back save, never send. Resolve facts from exact connector + action name; no action execution, secret lookup or readiness probe. Unknown/custom/MCP actions must not confirm a claim just because their connector matches. Preserve the distinction between a recorded execution and an unsupported specific claim. No second capability registry. Recipient/artifact matching requires validated immutable arguments and an explicit further specification; effect-category matching alone must not claim exact recipient/content proof.
- **Provenance (RV-3):** stop trusting a literal marker as the boundary. Proposed existing-table approach: the engine records a versioned authored-prefix length and hash of the exact stored result in an append-only task event, atomically with task completion. Capture the boundary while building output, before truncation, and persist values for the final stored representation. The verifier checks task ID, hash, valid offsets/version and uniqueness before excluding the platform suffix. Do not duplicate plaintext or infer provenance from a model-supplied separator. Legacy/missing/mismatched provenance stays explicitly unverified where separation is required; do not retroactively certify it by guessing. Exact engine/repository transaction and truncation contracts must be finalized before implementation; no migration is proposed now.

Required tests: exact action mismatch; true matching action; unknown action; multiple targets/claims do not imply one-to-many proof; spoofed separator anywhere in reply; genuine platform notes excluded; duplicate/missing/malformed provenance; truncated text; failed partial result; transaction rollback and reopen; existing P-49 handoff cases; gated file checks unchanged. These patches will touch currently staged files: preserve their staged baseline and show the additional diff separately; never stage/unstage them automatically.

### C — Manager projection, then workflow projection

**D-101 implementation follow-up:** `WORKFLOW-RESULT-CHECKS.md` records the selected bounded existing-records workflow endpoint/panel. Task and exact approval evidence are reused; weak workflow→Manager links remain unbound with zero inherited evidence. Durable read receipts/backlinks and independent final-output/semantic/target/delivery proof remain separate. Existing task/Manager contracts, gates and staged work are preserved; actual checks are in the report.

**D-100 workflow specification follow-up (planning only):** `WORKFLOW-RESULT-CHECKS-PLAN.md` specifies the first existing-records slice, shared D-088 validator, bounded/deduplicated task/approval evidence and truthful panel. Source inspection found no exact workflow-run/node backlink on Manager runs (only requested_by=workflow); the new plan requires those references to remain unbound with zero inherited evidence. This qualifies the earlier broad traversal proposal below. No workflow projection or new tests implemented by this planning checkpoint.

**D-099 implementation follow-up:** the owner selected the first read-only Manager projection plus visible panel. Delivered run-bound/deduplicated/bounded helper checks, completion/error states and final-summary unverified ceiling; full/fake/browser evidence in `MANAGER-RESULT-CHECKS.md`. The final Manager text is deliberately not claim-scanned or certified; workflow projection and independent final-claim proof remain pending. Original broader proposal below is retained as history, not a claim these new routes are still absent.

Only after A/B, add read-only VerificationService projections using existing IDs. Suggested endpoints: `GET /api/manager/runs/:id/verification`, then `GET /api/workflows/runs/:id/verification`. These are proposals, not routes already provided.

- Manager: inspect run status, all steps, distinct linked specialist task chains, direct/self outputs and final authored text. Review pass/fix is never evidence. Missing task references, skipped/failed steps and unverified self-text stay visible. Separate final-claim verdict from supporting-step evidence; a confirmed specialist action cannot automatically certify unrelated final claims or text quality.
- Workflow: traverse saved run graph/steps, exact task/Manager refs and D-088-validated approval refs. Expose uncertainty markers/invalid bindings as unconfirmed, never a resend. Reuse/extract the existing read-only binding validator rather than duplicating weaker checks. Deduplicate by task/approval ID; cycle/size guards for malformed references. Structural/checkpoint boxes add no external evidence; skipped branches remain explicit, and gate reads remain unverified until a separately designed durable read-receipt contract exists.
- Common response should include stable source IDs and evidence scope, completion state separately from verification, and check time for file observations. No full args/secrets or file contents. Current action summaries are clipped; review sensitive fields before adding any new outward-facing content.
- UI later reuses ResultCheck presentation/hooks for Manager/workflow sections and shows “Check unavailable” on fetch failure. Never replace an unavailable check with a green completed badge. Preserve all controls, approvals, menu/level rules and folder/Guardian boundaries.

Required tests: text-only/direct Manager unverified; final claim without matching step evidence; partial failure despite completed run; review fallback; pending/denied/expired/failed approval; missing/wrong/duplicate refs; workflow bot and Manager paths deduplicated; approval task_id=null exact binding; read-only/transform/checkpoint no fabricated evidence; uncertainty blocks confirmation; scratch reopen; permissions revoked between reads; no network/model/action call from checking. These are future tests, not evidence already obtained.

## Alternatives and sequencing

| Option | Benefit | Cost / recommendation |
|---|---|---|
| A first, then B, then C | Smallest reviewable change; existing staged verifier fix can remain untouched initially; stops incomplete chains being called confirmed | Recommended. Other false-positive limits stay prominently documented until B. |
| A/B together | Addresses the three reproduced verdict issues in one checkpoint | Wider engine/connector/provenance contract, more regression work and staged-file overlap. Finalize B design before choosing this. |
| Combined Manager/workflow badges immediately | Earlier interface coverage | Defer: would spread existing false-positive behavior and lacks reliable final-claim linkage. |

Rollback is source-only for A and the proposed read projections: restore only the new delta after preserving other work, never destructive Git operations or data deletion. B's optional event metadata must be versioned and backward-readable; old code ignoring it is not permission to delete history. No live migration or key handling is needed for the next slice.

## Verification status and preserved work

Current assessment ran only the three synthetic pure-function probes above and source/Git inspection. No new test suite/full check/browser/provider run; D-089's 2,087 backend + 447 dashboard full-check pass is the last implementation checkpoint, not proof of this proposal. Documentation whitespace checks apply to this change.

Staged P-49 blobs at assessment start and finish: verify.ts `4a0b918a79e2f68ed4a629b21246c494cf197c7d`, verification.test.ts `7f003fcb877831c1601e4fd1e7486e3c738b3a96`. Both staged blobs and working-file SHA256 values matched before/after; these files were unchanged. `git diff --check` passed. Other staged files remain separate; no staging operation was performed. Guardian Tier B, live recovery, real-service semantics and real-model claim coverage remain unverified. Preview navigation state “approvals” is interest in that preview page, not new implementation or execution approval.
