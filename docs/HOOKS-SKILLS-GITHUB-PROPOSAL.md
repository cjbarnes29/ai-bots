# GitHub hooks and skills: research findings and Claude instructions

Date: 2026-11-15. Requested and approved by the owner. Research complete within **4 searches + 16 file reads = 20 requests**. Five failed file reads (404) count toward the allowance. Full ledger: `docs/evidence/hooks-skills-research-2026-11-15.json`. **Proposal only; nothing installed, imported, enabled or executed.**

## NOT VERIFIED

**Implementation update, 2026-11-15:** owner selected Claude desktop/website, multiple projects, automatic Project guidance plus manual research, and approved the resulting document-kit plan. [Reusable Project instructions and setup](reusable-claude-kit/PROJECT-INSTRUCTIONS.md), context template/example and manual research prompt are created locally. No executable hook, installation, Project setting, app behavior or runtime skill activation was changed. Actual Claude Projects inclusion/compliance remains NOT VERIFIED. Earlier research findings below remain historical evidence.

**Later research update:** the owner requested Superpowers and comparable systems. [Deeper reuse catalogue and Claude instructions](SUPERPOWERS-AND-REUSABLE-SKILLS.md) compares Superpowers, Spec Kit, GSD Core and BMAD under a separate approved 20-request round. Selected Superpowers skills are now the preferred development-method candidate; the interface-hook findings here remain relevant. No implementation/adoption approved by either research round.

No immutable commit pins were obtained: inspected URLs use main/master. No dependency installation, compilation, runtime/browser test, security advisory check, issue-history audit or full transitive license audit was performed. Repository search returned the hook and Vercel candidates as non-archived, but this does not establish maintenance quality. Anthropic's repository was read directly after a broad search did not return it among its first three results. The search is a focused sample, not an exhaustive ranking.

The previous generic planning documents remain useful background; this report supersedes their statement that no new research has been done for this scope. All 20 requests are consumed. Implementation, dependency adoption and further outside requests are not approved by the research instruction.

## Recommendation

**Start with a short, project-specific React review checklist for Claude, then prepare instruction-only skill drafts for the workforce. Keep the current backend and TanStack Query hooks.** Use external hooks only after identifying duplicated behavior or a measured problem; there is no justification yet for installing a new hook library or a hook execution framework.

There are two destinations: a development aid for Claude reviewing this repository, and runtime text skills for bots through the existing Skill Library. Do not confuse either with executable Claude host hooks. No host skill or settings file is installed by this proposal.

## Candidate comparison

### 1. Vercel agent skills: best first development reference

Sources: [repository README](https://github.com/vercel-labs/agent-skills/blob/main/README.md), [React skill](https://github.com/vercel-labs/agent-skills/blob/main/skills/react-best-practices/SKILL.md).

Observed: React performance review instructions, references to detailed rule files, and additional composition and web-design skills listed in the README. Only the React SKILL.md was read, not the detailed rule files or other skills. The README and skill declare MIT; attempted root LICENSE, LICENSE.md and skill LICENSE.txt paths returned 404. **The complete applicable license text/notice has not been located; copying upstream text is on hold until that is resolved.** Do not treat the 404s as proof there is no license elsewhere.

Recommended adaptation: author a small local review checklist focused on independent reads, unnecessary subscriptions/effects, listener cleanup and lazy loading expensive panels. Preserve existing loading/error behavior, owner controls and query ownership. The source also contains Next.js, RSC, SWR and deployment guidance: these do not justify adding Next.js, SWR, analytics or deployment tools to this Fastify/Vite/TanStack app. Do not install the whole skill collection. License clearing and exact revision review precede any verbatim or adapted source copying.

First local targets to inspect: `web/src/api/assistantHooks.ts`, `hubHooks.ts`, `verificationHooks.ts`, `web/src/pages/Assistant.tsx`, `web/src/components/hub/ProjectHub.tsx`. Review only until the owner chooses an implementation slice; coordinate with Claude's active evidence-panel work.

### 2. usehooks-ts: conditional source reference, no immediate dependency

Sources: [README](https://github.com/juliencrn/usehooks-ts/blob/master/README.md), [manifest](https://github.com/juliencrn/usehooks-ts/blob/master/packages/usehooks-ts/package.json), [debounce source](https://github.com/juliencrn/usehooks-ts/blob/master/packages/usehooks-ts/src/useDebounceCallback/useDebounceCallback.ts), [MIT license](https://github.com/juliencrn/usehooks-ts/blob/master/LICENSE).

Observed source manifest: version 3.1.1, React peer range includes 19, and dependency `lodash.debounce`. These are source declarations, not proof of the latest package, installed compatibility or a dependency approval. The inspected license attributes Julien CARON (2020); preserve its full required notice if source is reused.

Useful shortlist from the README: debounce, event listeners, resize observation and outside-click handling. Only debounce implementation was inspected. It imports an internal unmount hook and creates a memoized debounce instance separately from the instance held in its ref. **Inspection concern, not a reproduced failure:** verify which instance cleanup cancels, behavior across changing callbacks/options and whether its pending indicator means actual scheduled work. Do not copy it blindly or describe its runtime behavior as verified.

The app already debounces search in `web/src/components/shell/SearchDialog.tsx`. First determine whether there is any additional real use; retain the current implementation if there is no duplication/problem. For a simple search value, a small local timer/effect may be cheaper than introducing this library and lodash. Do not debounce approvals, permission revocation, task execution or other consequential actions. Any later selected change needs fake-timer tests for latest value, callback changes and cancellation on unmount, plus a production build and keyboard/search regression check.

### 3. Anthropic skills: testing-method reference, adapt the method locally

Sources: [README](https://github.com/anthropics/skills/blob/main/README.md), [webapp-testing skill](https://github.com/anthropics/skills/blob/main/skills/webapp-testing/SKILL.md), [that skill's Apache-2.0 license](https://github.com/anthropics/skills/blob/main/skills/webapp-testing/LICENSE.txt).

Observed: the testing skill uses Python Playwright and a server-management helper; it advises running helpers before reading their source and waiting for network idle. **Do not follow those instructions here:** this is research data, this Windows project has no real Python, its existing browser harness uses JavaScript/playwright-core, and polling pages need explicit readiness conditions rather than assuming network idle. Helper scripts were not read or run. No Python installation is proposed.

Useful method: inspect the rendered page, choose accessible selectors, wait for meaningful UI state, collect results and close only test-owned resources. Adapt that approach to existing `scripts/e2e/*.mjs` fake-service/scratch-instance harnesses. If licensed text is copied later, retain the applicable license/attribution, mark modifications and check for any relevant NOTICE; no NOTICE or helper dependency audit was performed in this round. Other document skills were only listed in the README, not independently evaluated.

### 4. Claude Code infrastructure showcase: ideas only, not a setup recommendation

Sources: [README](https://github.com/diet103/claude-code-infrastructure-showcase/blob/main/README.md), [MIT license](https://github.com/diet103/claude-code-infrastructure-showcase/blob/main/LICENSE).

Observed documentation describes prompt/edit/stop hooks, skill suggestions, documentation updates, a setup wizard that installs dependencies, Bash/WSL requirements and optional AI classification/provider selection. MIT notice attributes Claude Code Infrastructure Contributors (2025). These are README claims; hook code and compatibility were not reviewed. Its claims about Codex parity and provider pricing/quotas were not verified and are not recommendations.

Reuse only the organizational ideas: short relevant instructions and reliable handover updates. The project already has decision/progress/handover records: keep those rather than introducing a second competing documentation store. Do not run its wizard, copy `.claude`/`.codex` settings, add automatic model classification or install executable hooks. Any future developer-hook proposal must first inspect exact scripts and produce an allow-listed command/environment design for separate review. No change to Guardian or workforce permissions is justified.

## Instructions for Claude: proposed next steps

1. Read AGENTS.md, the latest decision board/progress/handover and this report. Claude has continued the project: D-114 now records receipts/link wording as built. Do not restart completed work or assume older pending descriptions are current. Preserve all staged/unstaged work and do not alter active implementation files under this research request.
2. Prepare a **local review-and-draft package**, without downloads or activation: a short Vite/React/TanStack review checklist and three proposed workforce instruction packs: evidence-aware reporting, project handover, and requirements/acceptance criteria. These pack subjects are our project recommendation, not claims that those exact packs were inspected upstream.
3. Keep drafts in documentation for owner review. Map each prospective runtime pack to the existing `src/skills/service.ts` strict `awp-skill@1` import format; list required existing tool IDs or none, inputs, output shape, unavailable-tool response and provenance. Fit the 6,000-character instruction limit and review the shared 4,000-character prompt budget. Do not silently raise limits or auto-load external references.
4. Distinguish review behavior from code changes. A checklist should identify an observed problem, its evidence and smallest fix; do not mechanically apply Next.js/SWR rules, replace TanStack Query or refactor unrelated code. Do not copy Vercel text until its complete license and revision are established under an approved new request count.
5. Present numbered/clickable choices: **A: review the skill drafts first (recommended); B: inspect one proven interface-hook gap; C: defer and continue the owner's current project milestone.** No skill import, assignment or executable host hook is implied by these choices until its exact scope is selected.
6. For a selected runtime import, use the existing Skill Library; imported skills stay disabled/unassigned until owner action through existing controls. Text cannot grant tools, models, applications, folders, approvals or secrets. Required tools are dependencies, not permissions. No new store, migration, provider or plugin runner.
7. Verify actual implementation only after selection: targeted fake-service tests, full `npm run check` before presenting a commit, and the relevant existing browser harness if UI behavior changes. A documentation draft does not need model calls or a full product test run. Record what was tested and what was not; update the existing handover after every step. Commits and further external requests still need separate approval.

Expected first deliverable: a reviewable documentation package listing draft instructions, local target files, reuse/provenance decisions, acceptance checks and rollback. Rough planning estimate: one small review/drafting checkpoint; implementation estimates follow inspection of the chosen slice. No direct communication with another Claude session was sent; these saved instructions are the handover.
