# Tasks

Honest status. `[x]` = built AND tested as described. `[~]` = built, partly tested or not tested on the real thing. `[ ]` = not built. `[owner]` = only the owner can do it.

## Modular modernization: workflow restart safety (2026-11-15, D-085)
- [x] Conservative recovery of uncertain outside-action steps and full-descendant retry protection; 16 new in-memory tests and targeted workflow suites 70/70. Details and full-check status: `docs/WORKFLOW-RESTART-SAFETY.md`.
- [ ] Durable correlation/reconciliation of orphaned approvals and uncertain remote effects; no exactly-once remote guarantee.
- [x] Shared task-entry assessment implemented and fake-tested under D-086; evidence/recovery and modular UI phases remain pending.
- [~] No browser/live-provider crash drill for this fix; the development server's incidental reloads and read-only live checks are documented in the safety report. No commit or dependency installation.
Decisions: `docs/DECISION-BOARD.md`. Details: `docs/GUARDIAN.md`, `docs/ACCESS-CONTROL.md`, `docs/TIER-B-PLAN.md`, `docs/SECURITY-AUDIT.md`, `docs/HANDOVER.md`.

## Shared execution assessment (2026-11-15, D-086, uncommitted)
- [x] Shared capability assessment before task execution (including delegated children) and internal Manager planning; preserve ordinary text fallback and scope best-effort choices to their exact root/run.
- [x] 18 new fake-provider tests plus existing regression checks; exact full-check status and sandbox/concurrency-test findings: `docs/EXECUTION-ASSESSMENT.md`.
- [ ] Real-provider validation, durable approval correlation, broader evidence/recovery and modular UI integration remain separate work.

## Atomic workflow approval linkage (2026-11-15, D-088, uncommitted)
- [x] Existing-table transactional approval/link/audit creation, validated reconnection and cold-start uncertainty handling; gate, owner decision and D-085 retry protections preserved. Exact fake-service checks/full-check outcome: `docs/ATOMIC-APPROVAL-LINKAGE.md`.
- [ ] Real crash/power-loss or real-service verification, legacy orphan reconciliation, multiple workers and exactly-once remote effects are not supplied by this change.
- [x] Synthetic backup/restore rehearsal under D-089: nine new cases, 12/12 targeted backup tests; integrity, relationships, search, approval identity, synthetic vault/key and negative candidates. Procedure/results: `docs/BACKUP-RESTORE-REHEARSAL.md`.
- [ ] Actual owner recovery, broader result verification and modular UI work remain. No live DB/vault opened or copied for D-089.

## Result-verification assessment (2026-11-15, D-090, planning only)
- [x] Local evidence map, three synthetic pure-function reproductions and ordered small-patch/test plan: `docs/RESULT-VERIFICATION-PLAN.md`. Existing staged verifier work preserved.
- [ ] Chain completeness ceiling; exact action matching; trusted authored-text boundary; Manager/workflow read-only projections. No implementation or new test suite from this assessment.

## Chain completeness implementation (2026-11-15, D-091)
- [x] Chain lifecycle counts/details and confirmation ceiling; preserve stronger verdicts and staged verifier files. Four incomplete states, evidence/agent-count/audit/API regressions: 14 new tests, targeted verification 42/42. Full-check evidence: `docs/CHAIN-COMPLETENESS.md`.
- [ ] Exact action matching, trusted authored-text provenance and Manager/workflow projections remain separate work. No real-model/browser/live-data run.

## Exact action matching specification (2026-11-15, D-092, planning only)
- [x] Source action matrix, exact metadata/matcher/verdict contract and fake-test plan saved in `docs/EXACT-ACTION-MATCHING-PLAN.md`; staged work preserved.
- [ ] Implement exact action matching under a separate owner selection; no target/content/receipt or provenance claim from this plan.

## Exact action matching implementation (2026-11-15, D-093)
- [x] Source-owned exact action/object support, task receipt ownership, unknown-effect ceiling and fake-service regression coverage. Staged P-49 blobs preserved, approved new edits separate in working diff. Evidence/full-check result: `docs/EXACT-ACTION-MATCHING.md`.
- [ ] Trusted authored-text provenance (RV-3), exact targets/content/remote receipts and Manager/workflow aggregate checks remain separate work.

## Backend checkpoint review (2026-11-15, D-094, review only)
- [x] Completed reliability/evidence map, remaining gaps and concrete conditions for a limited Dashboard/Approvals redesign: `docs/BACKEND-CHECKPOINT.md`.
- [ ] First visual slice specification/implementation and trusted reply provenance remain next choices; review changes no application code or verification status.

## Dashboard/Approvals specification (2026-11-15, D-095, planning only)
- [x] Exact layout/data/file/phone-accessibility/rollback and fake acceptance plan saved in `docs/DASHBOARD-APPROVALS-PLAN.md`.
- [ ] Implement/test the two-page slice after owner selection; no new UI/browser verification from this specification. RV-3/aggregate limits retained.

## Dashboard/Approvals implementation (2026-11-15, D-096)
- [x] Two-page presentation/query-state/focused-ID slice and shared modal accessibility; existing decision rules retained. New component and synthetic browser evidence/full-check result: `docs/DASHBOARD-APPROVALS.md`.
- [ ] Real phone/screen reader/Guardian-browser pairing, trusted authored provenance and Manager/workflow result projections remain separate work; no commit included.

## Reliable reply checking and resume handover (2026-11-15, D-097, planning only)
- [x] Saved source-informed segment/manifest/atomic-write/decoder/truncation/failure-test plan in `docs/REPLY-PROVENANCE-PLAN.md`; current owner scope and next step saved at the top of `docs/HANDOVER.md` for Claude/later sessions.
- [ ] Owner implementation choice, then fake codec/transaction/engine/verification regressions and full checks. RV-3 is NOT fixed by the plan. No app change/new test run/commit.

## Reliable saved reply origins (2026-11-15, D-098, uncommitted)
- [x] Implemented labelled results, atomic existing-table persistence and strict one-task/chain origin checks; no marker fallback/backfill. Failure tests 46/46; full 2,220 backend + 461 dashboard/typechecks/build and fake modernization browser 34/34. Evidence/resume state: `docs/REPLY-PROVENANCE.md`, `docs/HANDOVER.md`.
- [ ] Independent Manager/workflow final-result projections, semantic/target/receipt proof and operational isolation/recovery remain separate work. No commit implied.

## Manager evidence checks and panel (2026-11-15, D-099, uncommitted)
- [x] Read-only Manager check, bound/deduplicated/bounded task-chain evidence and on-demand panel. Final summary always separately unverified; existing controls/gates retained. New cases 38 backend + 11 dashboard; full 2,258 + 472/typechecks/build and synthetic browser 29/29 passed. Evidence and Claude resume state: `docs/MANAGER-RESULT-CHECKS.md`, `docs/HANDOVER.md`.
- [ ] Workflow-wide result projection, independent final-summary proof, exact targets/content/delivery/quality and operational isolation/recovery remain separate work. No commit implied.

## Workflow result-check plan (2026-11-15, D-100, planning only)
- [x] Saved existing-records verification/panel plan, source binding limits, exact failure/browser/full-check acceptance and Claude resume state: `docs/WORKFLOW-RESULT-CHECKS-PLAN.md`.
- [ ] Implement only after owner selection; workflow Manager backlinks/read receipts and independent output proof remain separate work. No application change/new test run/commit from this plan.

## Workflow result checks and panel (2026-11-15, D-101, uncommitted)
- [x] Existing-records projection/panel, shared D-088 approval binding/action observations, bounded task/approval evidence and conservative uncertainty. Final full check: 2,322 backend + 484 dashboard/typechecks/build; new 76 cases and synthetic browser 42/42 passed. Earlier test failures/corrections and Claude resume state saved in `docs/WORKFLOW-RESULT-CHECKS.md`, `docs/HANDOVER.md`. No commit included.
- [ ] Exact workflow→Manager backlinks, durable read receipts, independent output/target/content/delivery proof and operational isolation/recovery remain separate work. No commit implied.

## Ordered daily-use and Projects/Assistant plans (2026-11-15, D-102/D-103)
- [x] First plan saved: `docs/DAILY-USE-WALKTHROUGH-PLAN.md`; then second plan: `docs/PROJECTS-ASSISTANT-REDESIGN-PLAN.md`. Source-informed scope, scenarios, evidence, local-component design, tests and rollback; Claude resume updated.
- [x] D-104 executed the selected fresh scratch/fake walkthrough and saved actual findings: 60 passes/3 automated findings, 10 scenarios; 19 targeted UI tests passed. Report: `docs/DAILY-USE-WALKTHROUGH.md`. No real-user/provider proof.
- [x] D-103 refined from those observations, with two additional visual copy/layout observations; current Claude handover saved.
- [ ] Implement separately selected Projects then Assistant slices; resolve the recorded findings. UI NOT IMPLEMENTED. No commit implied.

## Done and committed
- [x] Stages 1-9: routing, Manager, tools and skills, PC agent, documents, workflows, integrations, memory, shell and Settings (see `docs/PROGRESS.md`)
- [x] Commit 3 (ignore-rule fix + `registry.ts`), decision board + `CLAUDE.md`, Phase 4 Integrations Center, Business Workforce (fake data only), board decisions D-023 to D-028

## Guardian Tier A (committed 8733e5f, P-14)
- [x] Guardian core: four states, closed command set, hash-chained journal, scrypt passphrase with lockout, leases, restart-to-PAUSED
- [x] Stops only the Manager's descendants (fake table and real harmless programs); never Windows programs, the Guardian or the Manager
- [~] Presence: session lock and 15 minutes without input (helper reading tested; real lock/idle NOT tested) [owner: manual checks, `docs/GUARDIAN.md` section 11]
- [x] App checks: no new task / schedule / workflow tick / approved action while not RUN; running tasks stop at a safe point; fails closed
- [x] Owner proof (10-minute window) on owner-only routes and approvals; stopping directions never need it
- [x] Dashboard: Guardian banner (all states) and passphrase dialog
- [~] VM suspend/stop and firewall-rule adapters (fake runners only; NOT VERIFIED)
- [x] Docs: `docs/GUARDIAN.md`, `docs/SECURITY-AUDIT.md`, board, README, CLAUDE.md, PROGRESS
- [x] Prepared and syntax-checked, NOT run: `scripts/security/firewall-audit.ps1`

## Access module: applications and folders (committed 573eaf8, P-16) - `docs/ACCESS-CONTROL.md`
- [x] Read-only application discovery (installed, running, executables, embedded publisher, services, startup, scheduled tasks, existing integrations); one real scan done on this PC
- [x] Application levels Unknown / Approved / Trusted / Protected; session approvals; capabilities are program-only (no files/accounts); trusted needs a publisher name, a review date and a SHA-256 pin; protected cannot be approved
- [x] Folder permissions: default deny, read/create/edit/rename/delete, explicit sub-folder inheritance, secrets need their own 24-hour grant, expiry, immediate revoke, change records, full audit, Guardian hold, tamper checksum
- [x] Routes are owner-only with the passphrase proof; revoke is open to a paired phone
- [x] PC agent and document writer obey folder grants (checked after approval, right before acting)
- [x] Access page (Folders, Applications) with a "show me exactly what this allows" preview
- [~] Not enforced by Windows (S-19); signatures not verified (NV-12); page never opened in a real browser; no desktop-control connector exists yet to call the application policy
- [owner] Open Access in the dashboard, approve a real test folder, watch the PC agent obey it, revoke it (NV-11)

## Settings audit and zero-cost engine plan (committed 8960389) - `docs/SETTINGS-AUDIT.md`
- [x] Existing settings inspected (all providers off, no keys, no models, Ollama not installed); free tiers verified against official pages on 2026-11-04 (parts UNVERIFIED, NV-13)
- [x] Comparison table, suitability by task, local-vs-model split, cost-protection review, recommended combination
- [x] Settings > AI Models: cost class, privacy, capabilities, quota exhaustion, per-provider "allow for application automation" (off by default)
- [x] Closed a gap: Ollama cloud models (billed) are blocked
- [ ] Image and tool support in the model adapter; UI-Automation bridge; screenshot capture and OCR; quota reading (all unbuilt; see audit section 7)
- [owner] Decide the engine direction, Ollama trial, Gemini key (P-18)

## Desktop engine: UI Automation + local OCR (committed 8960389) - `docs/DESKTOP-ENGINE.md`
- [x] Windows host with process registry, window identity, redaction, overwrite/close guards, no attach, private screenshots (verified on real disposable windows)
- [x] Engine: plans of closed steps, evidence-based results, dialogs, file dialog + folder checks, Guardian and revoke respected
- [x] Connector `desktop` (list_applications, inspect, run_steps with owner approval), Access > Desktop control page
- [x] Picture/tool architecture in the model adapter (policy, gating; nothing enabled), local-vision interface (not installed)
- [x] Incident 2026-11-04 reviewed and corrected (SECURITY-AUDIT 1c, S-23)
- [~] Only a disposable test program and Winver were driven. Office, browsers, VS Code, Photoshop/Resolve/Premiere: NOT tested; Store apps refused; Tier A gives no OS isolation
- [owner] Recovery of the lost Notepad tab and any key rotation; approval of a real program to try next; Ollama/vision only if OCR proves insufficient

## Bot Studio / groups / router / workflows upgrade (see `docs/IMPLEMENTATION-MATRIX.md`)
- [x] Phase 0 audit and matrix written
- [x] Bot templates (20), content-only export/import, operating modes (ceilings), AI-drafted bots (draft only), model capability flags + capability-aware routing (`src/bot-studio/`, `src/routing/capabilities.ts`, page **Bot Studio**)
- [x] Groups database: migration 017_groups revision 2 approved (D-047) and applied after a verified backup; existing data proven intact (`docs/MIGRATION-PROPOSAL-GROUPS.md` section 11)
- [x] Easy AI Integration Wizard: provider cards, Connect wizards, tutorials, Ollama guide, AI setup assistant (D-048; mocks/fakes only)
- [x] Bot status means something: Active needs a model; only Active bots run (D-049)
- [x] Desktop: open/read and edit of existing files verified on real disposable windows; S-25 listing leak fixed
- [owner] Create a free Gemini key and connect it with the wizard, then approve ONE real Test connection (no tokens) and ONE test message
- [owner] Give "carlo" a model and set it Active if you want it to run
- [x] Groups service built and tested with fake providers (`src/groups`, `docs/WORKFORCE.md`): authorization, visibility, participation limits, loop prevention, Guardian hold. [owner] Switch groups on in the Groups page when you want them (NV-15). Not run against a real provider.
- [ ] Avatars, per-bot folder grants, new workflow nodes (approval/quality/parallel/merge), workspace regrouping of the navigation, mobile group chat: not started
- [x] Migration 017 committed (d2cded6, P-20); groups stay OFF. [owner] later, approval to switch groups on once the service is tested

## Inbox, Projects, Decisions, model switching and registry (committed 8960389 backend, d3987ec dashboard)
- [x] Inbox (bots appear only for real events), Projects, Decisions backend + migrations 018/019 applied; dashboard screens browser-tested (50/50 in Edge, fake model)
- [x] Model switching (output contracts, truthful task record) and model registry (verification, retirement, parallel chains)
- [x] Demo mode works under enforced verification; routing/failover e2e 40/40 and demo e2e 16/16 (fake services)
- [~] Known flaky dashboard test: `web/src/ai.test.tsx` OpenClaw chat test under default parallelism (passes alone / `--maxWorkers=4`)
- [x] Decisions UI: own options, edit wording as versions, assignees and duties at approval, agreement panel, Manager loop, execution record
- [ ] Projects: item picker instead of raw ids; reassigning an already assigned decision duty (assignments are immutable by database rule)

## Security plan (D-040)
- [owner] 0. Tier A manual checks: lock, 15-minute idle, STOP during a task (`docs/GUARDIAN.md` section 11)
- [owner] 1. Run the elevated read-only audit (`scripts/security/firewall-audit.ps1`) and give the output to the assistant
- [ ] 2. Review UltraViewer / UltraVNC (known facts and the questions the output answers: `docs/TIER-B-PLAN.md` section 4; needs the output)
- [ ] 3. Review Public-profile any-port rules (needs the output)
- [~] 4. Host-to-VM restriction design: rule script prepared (`scripts/security/tier-b/02-firewall-rules.ps1`, NOT RUN, subnets to be confirmed from the output)
- [ ] 5. NetBIOS / file sharing on the VMware adapters (needs the output)
- [ ] 6. MetaTrader and VMware Authd exposure (needs the output)
- [~] 7. In-guest connectivity test: plan written (`docs/TIER-B-PLAN.md` section 6); needs a VM

## Tier B and isolation: prepared, NOT built, NOT run (D-043, `docs/TIER-B-PLAN.md`)
- [~] Plan, trust-anchor design, drills, rollback and recovery written; review-only scripts `scripts/security/tier-b/01..03, 99` (dry run by default, parse-checked, never executed)
- [ ] Tier B Guardian bundle, protected-state grant confirmation command, in-session presence helper (code and tests: no approval needed to write; installation needs it)
- [ ] Owner approval of the Tier B design (P-17); then, each separately: dedicated standard account, protected install, firewall rules
- [ ] VMware VM and network (design first, D-026); Windows evaluation image terms (NV-7)
- [ ] Unattended operation (only after Tier B is verified and the owner approves in writing)

## Real external tests (need the owner)
- [ ] Map request, `https://example.com/`, up to 9 website requests (P-5); Gemini key (NV-3); Google client (NV-4)

## Later (deferred or not started)
- [ ] Phases 5-6, 8-9 of the UI roadmap; YouTube Studio; local GPU generation (deferred, D-025)

## Workforce, groups, collaboration, Workforce Board (committed; `docs/WORKFORCE.md`, D-065)
- [x] One Central Manager, four divisions; shared / dedicated / temporary bots (temporary agents archived reversibly at expiry)
- [x] Groups: create/edit/archive, members, responsibilities, division and project groups, modes, handoffs through the delegation allow-list, activity, recommendations and escalation into Decisions
- [x] Collaborate first, escalate to the owner: Manager loop (<= 2 rounds), consensus only from recorded views, outcome recorded
- [x] Instruction versions, approval of an exact version, execution record, comments never change instructions
- [x] Workforce Board from the real records (filters, inspector, history, saved layouts, phone list); browser e2e 44/44 with fake providers incl. automatic provider switching inside a group
- [ ] A group's own `model_ref` is stored but not applied to tasks; bots do not hand work to each other by themselves (owner/Manager starts every handoff)
- [owner] Switch groups on; real-provider checks of group answers and of the Manager loop (P-29-style approved requests)

## Real-world task (docs/REAL-TASK.md, D-066, P-34)
- [x] Audit of what is operational / partial / missing
- [x] Local email draft with real attachments (`documents.create_email_draft`); rehearsal of the whole task with simulated parts (passes)
- [x] Real run approved (P-34) and attempted twice: real Groq requests, real map request; NO files produced (see docs/REAL-TASK.md section 0)
- [x] Third real attempt (P-35): both map searches timed out; ONE map request more than approved was sent (platform now enforces approved counts; D-068)
- [x] P-36: the map service status page did not answer within 40 s (one request); the host is not reachable from this PC, query size is not the cause
- [x] P-37: configurable map service (default unchanged; mirror overpass.kumi.systems added, not contacted), status check counted against the allowance, health, tests
- [x] P-38: the Kumi mirror's status page did not answer within 15 s (one request)
- [ ] [owner] P-39: open both Overpass status pages in your browser and report whether either answers; no file was produced yet
- [ ] Desktop application control (Excel, Word, Outlook): not tried, not claimed (NV-14)
- [ ] Gmail drafts/attachments (Google sign-in unverified, NV-4)

## Model switching and failover (P-40 / P-41, D-072)
- [x] Switching record and dashboard panel ("Answering now", "Recent model switches"); simulated tests for rate limit, timeout, outage, context, capabilities, recovery
- [x] Real check: real Groq answered a real task and recalled conversation context after an injected failure; recovery to the preferred model (2 real requests)
- [ ] [owner] P-42: verify one Gemini model (up to 6 Google requests) to allow real provider-to-provider switching
