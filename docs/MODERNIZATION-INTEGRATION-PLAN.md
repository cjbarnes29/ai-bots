# Modernization integration delivery plan

Date: 2026-11-15. Status: proposed implementation sequence under the approved direction D-084. This document does not approve dependencies, external requests or restricted operations.

Parent plan: [approved direction and visual reference](MODULAR-MODERNIZATION-PLAN.md).

**Current checkpoint review (D-094, 2026-11-15):** [delivered backend work, open gaps and first UI-slice entry criteria](BACKEND-CHECKPOINT.md). Six reliability improvements are delivered with synthetic/fake evidence. Earlier “pending” statements below are historical phase specifications qualified by their follow-ups. Trusted reply provenance and Manager/workflow aggregate verification remain pending; no UI implementation is authorized by this review.

## NOT VERIFIED

The first conservative workflow restart/retry fix is implemented under D-085; [evidence and limits](WORKFLOW-RESTART-SAFETY.md). Other backend/UI phases remain pending. Candidate immutable source pins, dependency trees, runtime compatibility and production performance remain unverified; top-level license review is recorded separately in MODERNIZATION-SOURCE-REVIEW.md. The approved preview uses fictional data and has not been visually browser-verified. Historical test totals are not results for the new implementation. Guardian Tier B and isolation remain unbuilt/unverified; supervised operation only.

## Target and integration boundaries

Deliver the approved workspace over the existing backend: Assistant, Dashboard, Projects, Workflows, Agents, Knowledge, Tasks, Approvals and Settings remain connected to the records they already own. New systems join later without replacing the platform.

| Layer | Keep | Integration work |
|---|---|---|
| Presentation | React/Vite/Tailwind, routes, one nav.ts, interface levels | Shared components, selected source reuse and page improvements |
| Client data | TanStack Query and existing API hooks | View adapters and carefully scoped response additions only where needed; no second authoritative cache/store |
| Application services | Agent Manager, Assistant, projects/hub, chat, knowledge, workflows, Manager, task engine | Consistent assessment, durable action correlation and evidence links |
| Outside actions | Existing ActionGate, per-agent access, FolderGate and Guardian checks | Reuse these boundaries; UI libraries cannot run tools |
| Persistence | SQLite, existing repositories, audit/task/approval records | Reuse schema where sound; propose additive persistence only if required for correctness |
| Future modules | Capability registry and existing service registration | Service-reported facts, explicit setup/authorization, gated actions and recorded results |

## Phase 0: baseline and exact change specification

Initial assessment completed: [backend findings, entry-path matrix and patch specification](MODERNIZATION-BACKEND-ASSESSMENT.md). The full baseline passed; failure-injection and implementation remain proposed.

Follow-up source review: [compatibility matrix and reuse proposal](MODERNIZATION-SOURCE-REVIEW.md), 2026-11-15. Four top-level MIT files read; React/Vite fit assessed from official docs and source manifests, not runtime-tested. Recommend local components for the initial UI slice, conditional assistant-ui adapter, and a Vite 8 production test before React Flow adoption. The separately approved 20-request research round is consumed; no dependency approved or installed.

Deliverables:
- Read-only inventory of every task start path: direct, delegated, scheduled, triggered, Manager, workflow and approval continuation.
- Findings matrix with entry point, current checks, missing behavior, proposed change and regression evidence.
- Capture existing working-tree/staged changes so the new work is not mixed with the prior P-49 fixes. Do not unstage or rewrite those changes without instruction.
- Baseline relevant tests and npm run check; identify pre-existing failures separately.
- Exact source manifest for selected UI components: repository revision, file/package, license/notices, dependencies, local destination and maintenance approach. External source inspection requires a fresh approved request count; the earlier allowance is consumed.

Initial inspection points: src/app.ts, src/automation/service.ts, src/delegation/engine.ts, src/workflows/service.ts, src/capabilities/, src/verification/, existing connector/action gate and approval service.

Exit: a concrete patch plan with unchanged behavior identified, meaningful tests named, dependency choices explicit and any migration justified before adding a file. No "upgrade everything" package update.

## Phase 1: strengthen backend execution

Implementation follow-up: conservative restart/retry protection (D-085) and shared task/Manager execution assessment (D-086) are implemented and fake-tested. See `WORKFLOW-RESTART-SAFETY.md` and `EXECUTION-ASSESSMENT.md`. Durable correlation, broader evidence and restore proof remain pending; the original phase specification follows.

### 1A. Consistent capability assessment

Trace schedules and triggers through AutomationService.launch and engine.submit. Design reuse of the current CapabilityService so assessment covers all intended entry points without double assessment, unnecessary model calls or a second feature list. Preserve the current distinction between an explicit policy prohibition and a best-effort text task. Keep authorization at the moment an action executes; an earlier assessment grants nothing.

Acceptance: deterministic fake-provider tests cover the entry-path matrix, unavailable capabilities, policy refusals, existing best-effort text flows and unchanged Guardian/approval/folder enforcement. Service changes update CAPABILITIES.md and any relevant security/access documentation in the same change. Read those domain documents before editing their code.

### 1B. Crash-safe approval correlation

Delivered follow-up (D-088): [atomic approval linkage evidence](ATOMIC-APPROVAL-LINKAGE.md), with 29 synthetic scratch-file tests and full checks. No schema change; legacy orphan matching and exactly-once remote effects remain outside the guarantee.

Concrete follow-up proposal (2026-11-15, planning only): [durable approval linkage](DURABLE-APPROVAL-LINKAGE-PLAN.md). Recommends one transaction across the existing approval insert and workflow link, no DDL; specifies cold-start uncertainty and failure tests. No implementation/migration file from this proposal.

Investigate the specific workflow gap between ActionGate.request and saving the workflow step's approval reference. Specify a stable identity for one run/version/step/action attempt and an atomic persistence strategy. Reuse existing storage only if it provides the required guarantees; do not simulate durable deduplication with an in-memory flag or time window.

Distinguish three cases: duplicate approval creation, duplicate local execution and uncertain remote execution. A local correlation record cannot by itself prove exactly-once behavior at a remote service. Uncertain outside effects require explicit reconciliation instead of blind retries.

Acceptance: fault injection with fake connectors before/after request creation, wait persistence, approval decision and execution. One logical request remains linked after restart; no automatic replay of uncertain writes; denied/expired decisions and checkpoint-bypass refusal remain intact. Schema work follows the existing migration approval and watcher/backup rules.

### 1C. Evidence and recovery

**Latest workflow slice (D-101):** [workflow result checks and panel](WORKFLOW-RESULT-CHECKS.md) delivers bounded saved-graph task/approval evidence without replay or stronger output claims. Manager backlinks/read receipts remain unavailable; no migration/dependency/live-data/service call/commit. Actual full/browser results and remaining limits are in the report. Next proposed product step is planning a supervised daily-use walkthrough before the Projects/Assistant redesign, not automatic implementation of every remaining verification gap.

**Latest slice (D-099):** [Manager evidence checks and panel](MANAGER-RESULT-CHECKS.md) delivers the first read-only aggregate projection and visible helper-evidence view. Final summary remains unverified; workflow projection/final-claim proof remain pending. Full 2,258 backend + 472 dashboard/typechecks/build and fake browser 29/29 passed; no migration/dependency/live DB/service request/commit. Earlier phase specifications remain historical.

**Current implementation follow-up (D-098):** [reliable saved reply origins and validation](REPLY-PROVENANCE.md) implements the D-097 segment/atomic-save/strict-reader plan. The literal separator gap is closed for new valid TaskEngine records; legacy/invalid/mixed/incomplete origins remain unverified without backfill. Full 2,220 backend + 461 dashboard checks and modernization fake browser 34/34 passed. Manager/workflow final projections, target/content/receipt/quality proof, owner recovery and operational isolation remain pending. No commit, migration, dependency or real-service request.

Reliable reply-checking proposal (D-097, planning only): [source-informed segment/atomic-save/decoder and failure-test contract](REPLY-PROVENANCE-PLAN.md). Saved handover supports later continuation; RV-3 remains unimplemented. No UI/backend verification claim beyond D-096 is added.

Exact-action implementation (D-093): [action/object rules, tests and remaining limits](EXACT-ACTION-MATCHING.md). Source declarations and conservative unknown ceiling now replace connector-wide claim support. Chain completeness retained; trusted authored-text boundary and Manager/workflow projections remain pending.

Exact-action proposal (D-092, planning only): [action matrix and patch/test contract](EXACT-ACTION-MATCHING-PLAN.md). Source-owned exact action/object semantics, conservative unknowns and unchanged gate/chain rules are specified, not implemented. Target/content and trusted reply provenance remain separate work.

Chain-completeness follow-up (D-091): [implementation and test evidence](CHAIN-COMPLETENESS.md). The task-chain verdict now includes lifecycle counts/details and cannot be verified while a member failed/cancelled/is unfinished. Exact-action/provenance fixes and Manager/workflow evidence projections remain pending; existing staged verifier files preserved.

Evidence assessment (D-090, planning only): [result-verification map and implementation/test plan](RESULT-VERIFICATION-PLAN.md). Synthetic probes reproduced connector-only claim support, incomplete-chain omission and spoofable separator limits. Fix task evidence/completeness before projecting Manager/workflow verdicts; no fixes/endpoints implemented by this assessment.

Recovery follow-up (D-089): [synthetic backup/restore evidence and procedure](BACKUP-RESTORE-REHEARSAL.md). Nine new scratch recovery cases plus three existing backup cases passed. No live DB/key used; actual owner recovery and broader result/evidence diagnostics remain pending. D-088 delivered atomic linkage above; original specifications are retained as history.

Connect existing run, task, step, approval and evidence identifiers for inspection. Assess how Manager final results can use the existing read-only verifier without treating an agent's assertion as evidence. Preserve evidence levels and folder-gated file checks. Rehearse backup restoration into an isolated scratch location and verify integrity plus representative relationships, protecting vault material.

Exit for Phase 1: full checks pass with documented fault tests and remaining limitations; no claim of real-provider verification from simulated tests. No unattended operation.

## Phase 2: shared UI, Dashboard and approvals

Delivered first slice (D-096): [Dashboard/Approvals changes and actual verification](DASHBOARD-APPROVALS.md). Existing frontend/API/decision contracts retained; synthetic component/browser evidence and remaining device/Guardian/result limits are explicit. No library added; broader Assistant/project/canvas phases remain pending.

Concrete first-slice specification (D-095, planning only): [layout, source contract, exact files, accessibility checks and rollback](DASHBOARD-APPROVALS-PLAN.md). Uses existing local components/APIs; no UI implementation or dependency approval from this specification. Source-window/list-cap and unresolved verification limits remain explicit.

Deliver the first production slice of the approved design using existing API hooks and data. Start with shared typography, spacing, cards/statuses and reusable controls, then Dashboard attention items, recorded activity and setup blockers. Include the approvals view because the owner selected it while exploring the preview; that navigation choice is interest, not approval to change permissions or execute actions.

Candidates: selected shadcn/ui components and shadcn-admin layout patterns. Favor adapting existing components where adopting new primitives would create unnecessary risk. Exact source and dependency decisions remain open. Keep the current owner-proof and confirmation behavior; do not replace security-sensitive dialogs merely for visual consistency.

Acceptance: counts and statuses come from real existing services; pending approvals stay visible at every level; all routes, seven headings, one h1, phone controls, reduced motion and keyboard behavior remain correct. Existing Simple/Intermediate/Advanced rules continue. Test with scratch/fake data and the applicable redesign/levels/hub suites. Rollback: replace presentation components without changing domain data.

## Phase 3: Assistant and project integration

**D-104 execution/refinement follow-up:** [daily-use results](DAILY-USE-WALKTHROUGH.md) now observe 10 scenarios/60 passes and three read-error findings, plus two visual observations; [D-103](PROJECTS-ASSISTANT-REDESIGN-PLAN.md) is refined accordingly. Projects and Assistant error states take priority; working chat/context/store behavior is preserved. No product/UI implementation included, no new dependency/full product check or real-service evidence. Current handover supersedes pending-walkthrough wording in the original planning record below.

**Current ordered planning follow-up (D-102/D-103):** owner requested [daily-use walkthrough planning](DAILY-USE-WALKTHROUGH-PLAN.md) first, then [Projects/Assistant redesign planning](PROJECTS-ASSISTANT-REDESIGN-PLAN.md), with Claude handover maintained. Both plans are saved; walkthrough NOT RUN and UI NOT IMPLEMENTED. The first UI slice explicitly uses existing local components/APIs and preserves current ChatTab/service contracts; external adapter/dependency evaluation below remains deferred. Execute the owner-selected walkthrough and use actual findings to refine D-103 before implementation. No new full-check/provider evidence from planning.

Evaluate assistant-ui against the current ChatTab, AssistantPanels, attachment hooks, conversation identity and project context. Build a narrow adapter: existing server records own conversation IDs, messages, citations, attachment retention and proposal status. The library owns display interaction only. Retain the existing interface if an adapter cannot preserve these behaviors.

Show citations, before/after proposals, approval links and verified/unverified result states. Project links open the existing hub. Temporary attachments are not promoted automatically. Draft workflows are not saved automatically. Streaming, regeneration, editing and retry semantics are separate proposals, especially where another request could repeat a side effect or consume quota.

Acceptance: new/existing conversations, project context, reload, attachments, citations, proposal apply/reject/undo and failed requests work with fake providers. Restricted actions still have no Assistant execution path. Relevant knowledge/Assistant documentation stays in step. Rollback: retain a tested route/component fallback during the integration, with no second chat database or new user complexity setting.

## Phase 4: workflow canvas integration

Evaluate React Flow as the view/editor for the existing WfGraph. First build reversible adapters between stored graph and display nodes/edges. Preserve IDs, coordinates, node settings, edges, versions and server validation. Present the selected node's real settings and run status. Retain the phone list editor over the same graph.

The canvas does not execute steps, decide outside-action approvals or create new permissions. Avoid adding new node types or a second workflow engine in this phase. Paid/pro-only examples are not required.

Acceptance: representative existing graphs round-trip with all domain fields preserved; save/reopen, invalid graph errors, drafts, version selection and run inspection pass. Approval steps wait, continue only through the proper decision and refuse checkpoint bypass. Applicable workflow/modernization/redesign browser suites pass. Rollback: existing editor renders the same saved format.

## Phase 5: future-system integration contract

Document a small service integration recipe rather than building a marketplace or another framework:
1. Define validated inputs, actions and service-owned state.
2. Register the service through existing app composition; report its facts to the existing capability registry.
3. Provide explicit owner setup and per-agent access using existing mechanisms.
4. Route outside actions through the existing gate and relevant folder/application checks.
5. Link tasks and artifacts to existing project records; record outcomes and evidence.
6. Add UI navigation/guidance at the correct interface level and disclose unavailable features.
7. Test with fake services, then propose an exact-count real-service validation when needed.

Demonstrate with a test-only service. Later business or creative systems can follow the recipe. No image/video/audio provider, Google account, n8n instance or new model is connected by this work.

## Phase 6: acceptance and incremental delivery

Complete meaningful service tests, npm run check and applicable scratch/browser checks per phase. Validate six screen widths, keyboard and reduced-motion behavior. Keep real phones, assistive technology, contrast tooling and real-provider behavior marked unverified until actually checked.

Run a beginner scenario: open project -> ask Assistant using fictional notes -> review draft -> create a gated test-file request -> owner decides on scratch instance -> inspect file evidence -> reopen task/run after a controlled restart. Use fake providers and disposable scratch outputs. Verify the live database is unaffected by tests.

Before each requested commit: present git status, exact changed/staged files, test results, proposed message/co-author line and commands; verify the staged export in isolation; wait for owner approval. Do not bundle prior staged P-49 work into modernization commits.

## Proposed delivery checkpoints

| Checkpoint | Reviewable result | Decision needed |
|---|---|---|
| A | Baseline, entry-path matrix and B1/B2 patch specification | Resolve only concrete behavior/persistence choices; routine local inspection needs no new permission |
| B | Backend fixes and fake-service failure evidence | Separate approval for any restricted boundary change; dependencies if introduced |
| C | Exact source/license manifest and first Dashboard/approvals slice | Fresh counted source research; explicit dependency approval before installation |
| D | Assistant adapter and project walkthrough | Accept compatibility or retain existing chat UI |
| E | Workflow adapter and canvas walkthrough | Accept graph round-trip evidence or retain existing canvas |
| F | Future-module recipe and end-to-end acceptance report | Separate exact-count real-service validation only if requested |

## Recommended next action

Start Checkpoint A: local baseline and backend entry-path/restart analysis, then present the specific patch specification. This is concrete work independent of new libraries or external services. Follow with backend implementation under the owner's applicable development authorization; retain separate approvals for dependencies, commits, live external tests and security changes. Prefer clickable choices whenever a genuine owner decision is necessary.
