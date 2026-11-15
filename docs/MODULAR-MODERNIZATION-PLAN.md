# Modular modernization: approved direction

Approved by the owner on 2026-11-15: "this is approved. save it to our docs".
Decision: D-084. Status: design and backend priorities approved; first conservative workflow restart/retry fix implemented under D-085 (2026-11-15). Remaining modernization phases are pending. Evidence and limits: [restart safety report](WORKFLOW-RESTART-SAFETY.md).

Follow-up D-086 (2026-11-15): shared execution assessment is implemented; [evidence and coverage limits](EXECUTION-ASSESSMENT.md). Further correlation, verification/recovery and UI phases remain pending.

Follow-up D-088 (2026-11-15): atomic binding and reconnection of new workflow approvals implemented; [evidence and limits](ATOMIC-APPROVAL-LINKAGE.md). Backup/restore proof, broader verification and UI phases remain pending; legacy orphaned approval matching is not supplied.

## NOT VERIFIED

- The preview is a design example, not the live application. All agents, projects, counts and results shown are fictional.
- Its JavaScript was exercised with a stub DOM: all 12 pages rendered, each had one h1, and the review/draft interactions worked. It has not been visually inspected in a browser; responsiveness and accessibility are not verified.
- Candidate libraries have not been installed, integrated, benchmarked or security-reviewed. Exact source files, licenses and transitive dependencies have not been audited.
- Backend priorities below are work to perform, not completed fixes. No new provider run or external-service integration was verified during this design work.
- Guardian Tier B and isolation remain unbuilt/unverified. Operation stays supervised.

## Approved direction

Improve the current app in modules. Retain Fastify, node:sqlite, zod, React, Vite, Tailwind, TanStack Query and the existing domain services. Additional frameworks must solve a demonstrated gap; a framework is not itself evidence of reliability.

Keep the Assistant first, connect projects and their work, improve visual workflows, and keep approvals visible. Strengthen the backend before the major interface upgrade. Future systems should join the existing services and permission model rather than create parallel stores or execution engines.

This approval records the design and priorities. The current instruction is to save documentation. It is not a Git commit approval or an approval to install a dependency, make outside requests, change security boundaries, deploy or enable unattended operation. Existing standing development authorization and owner-only restrictions continue to apply.

## Saved visual reference

[Interactive design snapshot](design/workforce-preview.html).

The snapshot preserves the approved conversation preview. Open it in a browser to explore Assistant, Dashboard, Projects, Workflows, Agents, Knowledge, Tasks, Approvals, Models, Integrations, Creative Studio and Settings. Settings shows the backend roadmap. Review buttons open an example dialog; the composer produces a local preview response only. There are no external resources or network API calls.

The file is an HTML fragment. Browsers can display it directly; optional conversation-host icons, design controls and saved navigation state may be absent outside the conversation. It is a reference, not a production implementation or final specification for every page. Its simplified captions do not supersede the existing seven menu headings or interface-level rules. The preview's four-step example does not establish a new executable workflow node type.

## Backend work: first priority

| Priority | Existing basis and gap | Proposed outcome | Required evidence |
|---|---|---|---|
| B1: consistent assessment | Capability assessment exists for Manager, workflow starts and direct task routes; scheduled/event-triggered task assessment remains a documented gap | Review every task entry path and apply consistent feasibility policy while retaining runtime permission checks and established best-effort text behavior | Fake-provider regression tests for scheduled, triggered, direct, delegated, Manager and workflow paths; no bypass of the action/folder gates |
| B2: safe restart and duplicate prevention | Task interruption handling and workflow retry guards exist; the workflow request-to-saved-wait handoff has a documented duplicate-request window | Design and implement a durable correlation/deduplication strategy that prevents duplicate approval requests across a restart; evaluate outside-write recovery separately | Fault injection at each handoff with fake outside services; prove requests are not duplicated and unresolved execution is not blindly replayed; do not claim exactly-once remote effects without evidence |
| B3: result evidence and diagnostics | Result verification, task events and audit records exist; Manager final text is not scanned and real claim-detection evidence remains limited | Extend applicable verification coverage and connect runs, steps, tasks, approvals and evidence through stable identifiers | Fake-provider tests for unsupported claims and approval handoffs; trace links resolve correctly; secrets excluded; real-model claims remain unverified until an approved run |
| B4: recovery proof | Backup facilities exist | Rehearse restoration and verify integrity and representative records on an isolated scratch copy | Recorded restore procedure and results; never overwrite the live database; protect vault material and follow owner restrictions for cleanup |
| B5: future modules | Capability registry, project hub, approval gate and service boundaries already exist | Define a repeatable integration contract over those services | A fake module demonstrates self-reported capabilities, owner setup, per-agent permissions, gated actions and evidence states without duplicate stores |

Keep existing quotas, bounded provider-directed waits, execution limits, approval ownership and folder checks. Restart recovery must not automatically resume restricted or uncertain outside actions. Guardian installation, firewall/account/VM work and permission changes stay in their separate approval programme.

## Interface work: phased delivery

1. Shared foundation and Dashboard: consistent components, attention queue, running work, recent results and honest setup blockers.
2. Projects: keep conversation, tasks, knowledge and outputs together using the existing hub/workspace records.
3. Assistant: improve conversation presentation, attachments, citations and before/after review proposals through existing APIs. Streaming, regeneration and retries require their own behavior review; they are not implied by adopting chat components.
4. Workflows: improve the canvas and selected-step inspector; preserve the existing WfGraph, node IDs, versions, validation and phone list editor. The backend remains the execution authority.
5. Run inspection: show recorded step states and evidence; distinguish completed, waiting, unverified and confirmed results.
6. Future systems: connect new services through existing navigation, projects, task history, capability evidence and gates. Adding a module grants no permission.

## Open-source reuse shortlist

These are candidates, not approved dependencies or verified compatible packages.

| Repository | Intended use | Current recommendation |
|---|---|---|
| [shadcn/ui](https://github.com/shadcn-ui/ui) | Selected controls, menus and panels | Evaluate first; adapt small permitted source components where appropriate |
| [shadcn-admin](https://github.com/satnaing/shadcn-admin) | Dashboard/layout reference | Adapt selected layouts; preserve existing navigation and APIs |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui) | Conversation interface | Evaluate with an adapter to existing chat, attachments and owner review |
| [xyflow / React Flow](https://github.com/xyflow/xyflow) | Visual workflow canvas | Evaluate as an editing/display library over the existing graph |
| [LangGraph.js](https://github.com/langchain-ai/langgraphjs) | Stateful orchestration reference | Defer unless backend investigation demonstrates a need |
| [Langflow](https://github.com/langflow-ai/langflow), [Dify](https://github.com/langgenius/dify), [n8n](https://github.com/n8n-io/n8n) | Interaction references or specific later integrations | Defer whole-platform adoption; review licenses separately before reuse |

Research inspected repository pages and descriptions only. The first four repositories listed MIT at the repository level. Before copying or installing anything, record the exact revision, files/package, applicable license and required notices, dependency tree, affected local files and update/rollback approach. Dify's license was not fully read. n8n identifies Sustainable Use and Enterprise licenses; do not assume unrestricted reuse. Open-source code does not make model/API use free.

Research authorization was up to 20 read-only requests: 4 searches, 8 connector-rejected README reads and 8 successful repository-page reads. That research allowance is consumed; it does not authorize further reads, downloads or service tests.

## Compatibility, verification and rollout

- Preserve all routes, one navigation list in nav.ts, seven headings, Assistant-first ordering and the browser-only interface levels. Never hide approvals or controls at Simple.
- Preserve one h1, 44 px touch targets, keyboard access, focus handling and reduced motion; check the existing viewport sizes and relevant browser suites on scratch/fake instances.
- Drafts stay unsaved until owner review. Existing source material and model output remain untrusted data.
- Run relevant tests during each change and npm run check before any commit presentation. Do not weaken existing assertions. Production code receives no claim of verification from this mockup's checks.
- Verify migrations against the existing approval rules; backup or stop the watcher before adding a migration. No live database operation is authorized by saving this document.
- Keep each phase reviewable and independently reversible. Review source/license/dependency choices before adopting them. Any commit requires its separate staged-export checks and explicit owner approval.

## Next implementation deliverable

Detailed proposed delivery sequence: [Modernization integration delivery plan](MODERNIZATION-INTEGRATION-PLAN.md) (2026-11-15; implementation not started).

Start with a concrete backend findings-and-test matrix for B1/B2, then a component/source manifest and Dashboard proposal. Keep the design preview as a reference. Use clickable choices when the owner needs to choose between concrete alternatives, with the approval scope stated on each choice.
