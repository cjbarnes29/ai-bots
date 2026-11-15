# GitHub systems research and reuse plan

Date: 2026-11-15. Owner requested saving the earlier GitHub research direction for the next developer, including Claude. **Documentation only; no new research performed.**

## NOT VERIFIED

**Additional completed scope:** [Superpowers and comparable reusable skill systems](SUPERPOWERS-AND-REUSABLE-SKILLS.md), separately approved 4-search/16-read round, now consumed. Covers development-method reuse and Claude handover; adoption remains unapproved and untested.

**Research update, 2026-11-15:** a separately owner-approved hooks/skills round used 4 searches and 16 file reads. [Findings and concrete Claude instructions](HOOKS-SKILLS-GITHUB-PROPOSAL.md) record recommendations, failed license paths and compatibility limits. This supersedes the no-new-research statement below for that scope only; no adoption approved and the new allowance is consumed.

No new repository, release, license, maintenance or security claim was checked. The previous research allowance is consumed: obtain approval of the exact request count before another round. This request does not authorize searches, downloads, clones, installation or service access. Public source alone is not permission to copy.

## Owner's direction

Improve the current AI Workforce in modules. Preserve its backend, data, APIs and approval rules; add systems later through reviewed boundaries. Compare selected source reuse, an isolated adapter and a small local implementation. A replacement app or backend rewrite is not the default.

## Relevant systems to research

Companion scope: [hooks and skills reuse plan](HOOKS-AND-SKILLS-REUSE-PLAN.md). Include reusable interface patterns, narrowly typed lifecycle observations and instruction-only skills; assess external host formats before considering adaptation.

| Priority | Area | Useful components or patterns | Preserve |
|---|---|---|---|
| 1 | Project item picker | Accessible searchable selection replacing raw IDs; loading, errors and stale states | Existing project store, permissions and routes |
| 2 | Assistant/chat | Attachments, citations, keyboard use and long histories | Existing persistence, safe/review/restricted actions; owner saves drafts |
| 3 | Workflow editor | Accessible node editing, keyboard alternatives, touch controls and large drawings | Existing graph, validation, execution and approval gate |
| 4 | Evidence and operations | Approval history, read receipts, task evidence and recovery diagnostics | Confirmation from platform records, never model assertions |
| 5 | Future modules | Knowledge search, document handling, connector adapters, Business Workforce and later YouTube Studio | FolderGate, capability registry, free-only policy and gated outside writes |

This is a research backlog, not a second capability registry or authorization to implement these modules. Coordinate with Claude's active backlinks/receipts work before proposing changes to the same panels.

## Existing research to build on

- [Source review](MODERNIZATION-SOURCE-REVIEW.md): shadcn/ui, shadcn-admin, assistant-ui and React Flow. Its historical compatibility and license evidence has limits; refresh only under a new approved research allowance.
- [Integration plan](MODERNIZATION-INTEGRATION-PLAN.md): modular integration and preservation of existing functionality.
- [Canvas plan](WORKFLOW-CANVAS-PLAN.md): React Flow was tested in scratch only; the owner selected improvements to the current editor. No repo adoption is implied.
- Read the newest [handover](HANDOVER.md), [decision board](DECISION-BOARD.md) and [progress](PROGRESS.md) before work. Historical pending states may be superseded.

## Required research deliverable

Produce a ranked shortlist and comparison matrix using official documentation, GitHub source, licenses and relevant issues. Stack Overflow discussions may identify symptoms or workarounds; verify conclusions against upstream sources and local tests.

For each candidate record:

1. Repository/documentation links, inspected date and immutable source revision; distinguish source versions from published releases.
2. Exact useful files/components and local integration points; include a local implementation alternative and reasons to reject a candidate.
3. Licenses for copied files, assets and dependencies, required notices and restrictions. Do not assume a top-level license covers everything.
4. Maintenance/security evidence and unknowns; popularity alone is not a recommendation.
5. Fit with the current installed stack, Windows, accessibility and 44 px touch targets; specify build, fake-service and browser checks.
6. Dependencies, accounts/cloud requirements, costs, possible network behavior, data/migration implications and separate approvals required.
7. Smallest integration slice, effort estimate, acceptance criteria and rollback. Reuse existing working code where a new system offers little benefit.

Recommend at most three concrete options: **reuse selected source**, **integrate through an adapter**, or **build a small local component**. Give clickable choices with numbered equivalents. Planning approval does not authorize installation or outside requests.

## Handover

Save findings and exact request usage; update the decision board, progress and handover when decisions or verification change. Preserve existing work and coordinate with Claude rather than starting parallel implementation. No commit, deployment or real database change is authorized here.
