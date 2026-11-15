# Hooks and skills: reuse plan for the existing workforce

Date: 2026-11-15. Owner requested recommended hooks and skills that can be reused in existing systems. **Plan only: no imports, installs, execution hooks, skill assignments or product changes.**

## NOT VERIFIED

**Superpowers comparison completed:** see [reuse catalogue](SUPERPOWERS-AND-REUSABLE-SKILLS.md) for ranked systems, inspected pinned skill/hook files, required project overrides and later pilot choices. This is research evidence only, not installation or runtime-skill activation.

**Research update, 2026-11-15:** the owner subsequently approved a new 20-request round, now completed. Read [GitHub findings and Claude instructions](HOOKS-SKILLS-GITHUB-PROPOSAL.md) and its request ledger. That report supersedes the no-new-research statement below for this round; implementation remains unapproved and unverified.

Recommendations below are integration designs based on local source inspection, not tested additions. No external skill repository, hook library, license or current release was checked. The earlier research allowance is consumed; a fresh exact-count approval is required before GitHub/documentation requests. Imported content is untrusted even when its repository is popular.

## Three different kinds of reuse

1. **Interface hooks:** reusable React functions for querying and presenting existing app data. Start from the existing TanStack Query/API hooks; no second authoritative cache or new permissions.
2. **Lifecycle hooks:** narrowly typed application events for observing task/workflow progress. Start with existing services and audit events. A skill must never install a hook, run a shell command or choose executable code.
3. **Workforce skills:** reusable written instructions assigned through the existing Skill Library. These are text, not executable plugins. Codex/Claude host skills and their command hooks are different formats and cannot be installed directly into this app.

## Existing foundations to reuse

- `src/skills/service.ts` already provides versioned skills, import/export (`awp-skill@1`), assignment, tool requirements and secret checks. Imported skills arrive disabled and unassigned. Keep this service and its existing tables as the source of truth.
- Current limits include 6,000 characters of instructions per skill, 10 skills per bot and a 4,000-character prompt budget. Review composition and truncation before adapting larger external instruction packs; do not silently raise limits.
- `web/src/api/hooks.ts` already has skill queries, mutations, import, test and assignment hooks. Reuse these rather than creating another skill store or assignment path.
- `web/src/api/assistantHooks.ts`, `hubHooks.ts`, `knowledgeHooks.ts`, `capabilityHooks.ts` and `verificationHooks.ts` provide domain-specific data adapters. Changes must preserve their query keys, invalidation and authorization semantics.
- Capability facts come from the existing registry/services. A skill's declared tool requirement is a dependency, never a permission grant or evidence that a tool works.

## Recommended interface hook work

| Priority | Hook or pattern | Existing system | Proposed benefit and acceptance condition |
|---|---|---|---|
| 1 | Consistent query presentation | Projects, Assistant, Skills, evidence panels | Reuse existing query status components and domain hooks for loading/error/retry/stale/empty states. A failed read must never imply an empty successful result. Prefer a shared presentation component unless actual hook logic is duplicated. |
| 1 | On-demand evidence queries | Task, Manager and workflow result panels | Extend existing verification hooks only after coordinating with Claude's receipts work. Closed panels do not start polling; wrong IDs or errors never show an old confirmation. |
| 2 | Skill selection/readiness adapter | Existing Skill Library and bot settings | Compose skill and capability queries to show enabled, archived, assigned and missing-tool states. Preserve existing assignment APIs; readiness grants nothing. |
| 2 | Searchable project-item selection | Existing project picker/hub hooks | Read existing entities with stable IDs; show errors and missing selections. Selecting an item does not create membership or change permissions. |
| 3 | Conversation draft/focus behavior | Existing Assistant/chat | Extract only duplicated behavior after tracing current ownership. Unsent text, helper selection and conversation/project identity survive navigation; focus never jumps on background refresh. |

These names describe proposed patterns, not existing exported functions or approved dependencies. Evaluate the smallest local extraction before adding a general hook library. Do not refactor working hooks merely for uniform naming.

## Recommended lifecycle reuse

First map the existing event producers and consumers; do not introduce a generic plugin runner. If a real gap remains, propose a fixed, typed observer inside the owning service:

| Observation | Reuse | Boundary |
|---|---|---|
| Task/workflow state changed | Existing lifecycle records and query invalidation | Observe a committed result; never mark an operation successful before persistence succeeds. |
| Approval requested/resolved | Existing ActionGate and approval audit trail | Inform the interface only; never approve, execute or retry an outside action from an observer. |
| Outside read receipt recorded | Existing append-only receipt events and verification readers | Exact task matching; receipt proves a read ran, not that its content or the answer is correct. |
| Skill changed or assigned | Existing SkillService/version records and query invalidation | Preserve review, assignment checks and existing enabled/imported behavior. No automatic assignment. |

Observers must be idempotent, bounded and have explicit failure behavior. Notification failures must not replay work. Never add a path/program/script-taking Guardian command, model-controlled callback, shell hook, startup installer or unattended scheduler. Security-boundary changes require separate owner approval and the relevant security documentation review.

## Recommended reusable skill packs

Start with short local drafts; research upstream text only where it offers a concrete benefit. The labels below are proposals, not installed capabilities.

| Priority | Skill | Existing system | Expected output and limit |
|---|---|---|---|
| 1 | Evidence-aware reporting | Ordinary agent tasks and project results | Separate requested work, attempted work, platform evidence and unknowns. Never claim confirmation from its own text; the verifier remains authoritative. |
| 1 | Project handover | Project memory/results and existing tasks | Concise decisions, completed work, unresolved questions and next steps. Include only context already allowed to that task; no second project store. |
| 1 | Requirements and acceptance criteria | Planning tasks and workflow drafting | Small milestones, dependencies, explicit acceptance checks and rollback. Plans/drafts remain proposals for owner review. |
| 2 | Repository comparison | Existing research tasks | Exact sources/revisions, license notices, fit, costs, alternatives and uncertainty. Outside reads require the bot's own permission and approved request scope. |
| 2 | Document/knowledge synthesis | Existing Knowledge Center and attachments | Source-grounded summary, citations and disagreements; temporary attachments are not promoted automatically. Documents remain untrusted data. |
| 2 | Business lead review | Existing Business Workforce | Explain match criteria, source quality and unknowns. No invented contacts, automatic discovery calls or saving/sending leads outside the existing approval rules. |
| Later | YouTube planning/editorial review | Future YouTube Studio | Draft outline, source/rights checklist and review notes only. Does not imply a built Studio, media generation or permission to publish. |

Tool requirements must use known existing tool IDs and accurately report missing dependencies. A skill cannot add models, applications, folders, credentials, read permissions, approvals or a higher operating mode. Do not put these packs into the Manager as a route to adding tools.

## Adapting external skills and hooks

For each proposed upstream item, record repository, exact revision, useful files, license/notice obligations and maintenance evidence in the [GitHub systems research plan](GITHUB-SYSTEMS-RESEARCH-PLAN.md) deliverable. Compare source reuse, a narrow adapter and a local implementation.

Review the full instructions and referenced resources for embedded commands, secrets, automatic network use, permissions, paid services and assumptions about a different host. Do not run setup commands, scripts or linked tools as part of review. Translate only useful instruction text into the existing strict import schema; tool names must map to real registered tools. Never import executable hooks or unknown metadata as app behavior.

The owner reviews the draft, then uses the existing import/save path. Imported content stays disabled and unassigned until deliberately enabled/assigned through existing controls. Keep provenance and full required license notices in a reviewed documentation record; do not squeeze notices out to fit a prompt budget. If the source cannot be licensed or safely adapted, reject it.

## Delivery sequence and checks

1. **Inventory first:** map duplicate interface logic, existing events and Skill Library behavior. Identify actual gaps; coordinate with Claude before editing overlapping files.
2. **Prepare three skill drafts:** evidence-aware reporting, project handover, requirements/acceptance criteria. Documentation drafts only; identify missing tools and budget fit without a model call.
3. **Choose one small slice:** a local interface improvement OR one reviewed skill import. Offer clickable choices with numbered equivalents; do not bundle hook infrastructure and skill activation.
4. **Verify implementation when selected:** fake services/scratch databases only. Check disabled/unassigned imports, secret/unknown-field rejection, missing tools, prompt budget, assignment isolation and unchanged permissions; test hook cache/error/polling behavior only where changed. Run relevant tests and the full check before commit review. Real-model/provider requests need separate exact-count approval.
5. **Record and roll back:** document results and unknowns in progress/decision board/handover. UI extraction reverts without changing server data; skills can be unassigned/disabled or restored through existing version controls. Existing audit events remain intact. No new migration or dependency is assumed.

No product behavior has been changed or tested by this plan. No commit, installation, live database access, outside request or activation is authorized by this documentation request.
