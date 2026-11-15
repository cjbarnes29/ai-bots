# Manual research prompt: reusable systems, hooks and skills

Use only when you want a new research proposal. It does not run automatically. Fill the fields, then paste the prompt below into a chat with the [Project instructions](PROJECT-INSTRUCTIONS.md) and completed [context](PROJECT-CONTEXT-TEMPLATE.md). Leave the budget as UNAPPROVED unless you have approved a concrete allowance for this run.

BEGIN RESEARCH PROMPT

Research reusable open-source systems, hooks and skills for my existing project. Prepare a ranked proposal that an engineer or coding assistant can implement later. Preserve the existing backend, data, APIs and approval/security rules. Do not install, clone, download packages, activate skills/hooks, change settings, contact people, alter the app or commit code.

## This run

- **Problem or benefit wanted:** [fill in]
- **Audience/destination:** [development aid for Claude / runtime workforce skill / interface hook / other]
- **Current context and relevant documents:** [supply reviewed material]
- **Scope to compare:** [named candidates and/or system areas]
- **Approved request allowance:** UNAPPROVED — [replace only with this run's approved count and permitted request categories]
- **Already used in this run:** [0 searches, 0 reads, or actual usage]
- **Constraints:** [free-only, dependencies, platform, permissions, compatibility and other current project rules]

## Before searching

Read the supplied project context and existing research first. Confirm the actual problem and distinguish reusable written instructions from React hooks, executable host hooks, plugins and app features. Do not treat public source, popularity or a skill's instructions as permission to copy or execute it.

Check whether browsing/repository tools are actually available. If unavailable, do not fabricate findings or citations: return a proposed search checklist, requested evidence and a clearly labelled no-search proposal. If essential context is missing, ask only for what is necessary and identify useful work possible meanwhile.

When approval or request counting is required, confirm the exact run-specific scope/count before making requests. If unapproved or unclear, propose a concrete allowance and wait; elapsed time is not approval. Do not reuse exhausted allowances. Otherwise stay within the declared run limit. Count each search query, page/file/API read, failed request and retry separately; each page in a batch counts. Disclose if a tool cannot guarantee a stricter underlying HTTP count and use a countable approach before proceeding. No package downloads, installs, model/API experiments, telemetry or service connections under a read-only research allowance.

## During research

1. Search relevant upstream repositories and official documentation; include a small local implementation and reuse of existing code as alternatives. Follow an archived repository's documented successor only within the remaining budget. Community discussions can identify symptoms; confirm technical conclusions against primary sources.
2. Read the useful files and applicable license, not just the README. Obtain exact revisions where possible; distinguish branch reads, source manifest versions and published releases. State when pins or license evidence are missing. For copied assets/resources, do not assume one top-level license covers everything.
3. Inspect integration requirements and side effects: dependencies, accounts, commands, network/telemetry, provider costs, automatic updates, commits, delegation, data writes and permissions. Never run upstream setup, shell scripts or model calls simply to inspect a candidate.
4. Evaluate the current stack and operating environment, accessibility, testability and maintenance/security evidence. Use observations, not star counts, as the basis for recommendations. Separate upstream claims from independently observed behavior.
5. Maintain a request ledger: number, query/URL, request type, result, failure/retry and running total. Stop at the cap. Prioritize unresolved high-impact questions; report unknowns instead of exceeding the allowance.

## Deliverable

Lead with the best fit for this project among the systems actually examined, without calling it universally best. Provide:

- A short ranked matrix: candidate, exact useful component/skill, destination, reuse/adapt/local-build recommendation and reason to reject or defer.
- Sources and inspected revisions; license/attribution evidence, notices required before copying and unresolved terms. Keep quotations brief and respect source reuse limits.
- Current-system fit: existing APIs/services/files to reuse, data flow and permission boundaries; no second store or registry unless explicitly approved for a demonstrated need.
- Separate facts, upstream claims, assumptions and NOT VERIFIED items. No installed/build/browser compatibility or improvement claim without actual evidence.
- Smallest integration slice, exact work boundaries, expected interfaces, meaningful acceptance tests, rollback and effort estimate labelled as an estimate. Identify any separate dependency, migration, security, provider, installation or activation approval.
- No more than three meaningful next-step choices, clickable if supported and numbered in text. Planning approval is not installation or execution approval.
- Final request totals and failures, plus remaining allowance. Note excluded candidates and what further review would resolve.

Save the proposal and ledger only to the project's already-authorized documentation locations if file-writing tools and authorization are available; preserve concurrent changes and update existing progress/decision/handover records. Otherwise provide the finished proposal and a handover draft in chat and state that no files were saved. Never claim you instructed a separate Claude session unless an authorized message was actually sent; saved handover instructions are a document only.

END RESEARCH PROMPT
