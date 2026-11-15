# Project context: template and AI Workforce example

Prepared 2026-11-15. Choose ONE section below as your context document. Replace placeholders with reviewed facts; leave unknowns explicit. The reusable instructions are in [PROJECT-INSTRUCTIONS.md](PROJECT-INSTRUCTIONS.md).

This document describes the project and records existing authorization; filling a field never grants a new permission. A local path does not make its content available in Claude desktop/website. Supply sanitized current excerpts or approved reference documents and verify Claude can see them.

## Portable template — complete for each project

- **Project name and purpose:** [name; who uses it; intended outcome]
- **Context reviewed on:** [date and reviewer]
- **Current selected task:** [specific deliverable, or no task selected]
- **Success criteria:** [observable acceptance conditions]
- **Technology and structure:** [existing stack; important areas; operating environment]
- **Authoritative project rules:** [document names and supplied versions; include their relevant content]
- **Decisions and progress:** [current decision/progress records; newest relevant entries]
- **Latest handover:** [current scope, concurrent work, next decision; supplied excerpt]
- **Access actually available in this chat:** [documents/tools visible; repository, command execution and browsing availability each explicit]
- **Permitted actions for this task:** [owner's already-authorized scope; local-only if applicable]
- **Separate approval requirements:** [installs, dependencies, requests, costs, data, security, communications, Git and deployment rules]
- **External research budget:** [unapproved, or exact approved searches/reads and usage; never infer one from an old run]
- **Checks to use if execution is authorized:** [relevant commands/procedures; synthetic versus live restrictions]
- **Observed verification:** [actual results, date, scope and evidence; not a wish list]
- **Assumptions:** [unconfirmed but stated planning defaults]
- **NOT VERIFIED:** [missing evidence, unfinished integrations, limitations]
- **Existing records to update:** [decision, progress and handover destinations; no second store]
- **Rollback limits:** [permitted reversible changes; operations requiring separate approval]
- **Communication preference:** [plain language; numbered/clickable choices; update frequency]

If the current task, rules or access are missing, Claude should ask for the missing information or offer a plan based on explicit assumptions. It must not guess authorization or report unavailable checks as run.

## AI Workforce example — dated documentation snapshot

**Project:** personal AI workforce with AI helpers, a Manager, workflows, gated integrations, Business Workforce and a later YouTube Studio. Improve the existing system in modules; preserve the backend and approval mechanisms.

**Snapshot reviewed:** 2026-11-15. Refresh from current records before acting; this example is not a live status feed or a replacement for those records.

**Technology:** Fastify, node:sqlite and zod in `src/`; React, Vite, Tailwind and TanStack Query in `web/`; Windows. No real Python or FFmpeg is established by this context.

**Authority:** AGENTS.md/CLAUDE.md, then the current `docs/DECISION-BOARD.md`, `docs/PROGRESS.md` and `docs/HANDOVER.md`. Read the relevant subsystem documentation before changes. Historical headings may lag newer entries. Do not silently overwrite approved decisions.

**Current selected task:** this reusable document kit was authorized. No new product implementation, hook/plugin activation or research run is selected by this example. Claude has been handling application development separately; coordinate before editing overlapping files.

**Documented checkpoint:** D-114 records read receipts and Manager-origin wording as built and locally committed; its recorded full check was 2,346 backend and 528 dashboard tests plus typechecks/builds. D-115 reports investigating a real-Windows test flake, with six quiet backend runs passing but the cause unproven. These are historical documentation claims, not checks run by the current chat. Re-read the latest handover before using them.

**Access:** this document gives no repository, desktop, execution or account access. In desktop/website chats, assume only supplied material is available until tools/access are demonstrated. Do not request secrets or upload a live database/vault.

**Restrictions:** no commit without explicit approval and the project's exact commit-review procedure. No push, deployment, publishing, paid services, secret exposure or unauthorized destructive operations. No new dependency without approval. Preserve all concurrent/staged/unstaged work. Never manually migrate the real database. Read the current additive-schema and dev-server migration rules before any future schema plan.

**External calls:** both 20-request research rounds documented for hooks/skills and Superpowers are consumed. A new run requires approval of its exact request count. No model call, installer or telemetry call is included in this kit.

**Safety:** outside writes use ActionGate; file access for agents uses FolderGate. Skills are text and grant nothing; imports stay disabled/unassigned until owner action. Manager has no tools. No unrequested subagents. Real desktop tests may use only engine-owned disposable windows; no owner windows. Unattended workforce operation is unavailable until Guardian Tier B is verified.

**Checks for a future authorized implementation:** use relevant synthetic/fake-service tests while working and `npm run check` before presenting work for a commit. Browser scripts use scratch data and test-owned resources. Inspect each script's effects first; some overwrite tracked evidence. No real-provider script without a new exact-count approval. Tests for this kit are document checks only.

**NOT VERIFIED:** this kit's inclusion/behavior in Claude Projects; real device/screen-reader/provider usability; Guardian Tier B; owner recovery; the Windows flake's cause; any claim that adopting a skill improves reliability. Consult the board for current integration-specific limits.

**Records:** update the existing decision board, progress and handover after authorized changes. In a chat without file-writing access, provide a handover draft and say it has not been saved. Do not create a competing capability registry, project store or decision authority.

**Preference:** plain language and meaningful clickable choices with numbered equivalents; save handover after each step when authorized file access exists. No commit or activation is implied by approving a plan.
