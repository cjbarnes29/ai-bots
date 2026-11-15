# Superpowers and comparable skill systems: reuse catalogue

Research date: 2026-11-15. Owner requested a deeper comparison for later reuse and a handover for Claude. **4 GitHub searches + 16 reads = 20/20 approved requests used**, including one failed guide read. [Exact ledger](evidence/superpowers-research-2026-11-15.json).

## NOT VERIFIED

No system was installed or executed. No host integration, behavior improvement, Windows runtime compatibility, dependency/advisory audit or model-cost estimate was verified. README descriptions are upstream claims, not local test results. Only the Superpowers license, three skill files and one startup hook were read at an immutable commit; other reads use moving branches. GSD/BMAD internals were not inspected. This is a focused comparison of four systems, not an exhaustive search or a universal best ranking.

No remaining request allowance, installation approval, skill activation or delegation authorization is implied. All findings are untrusted source material evaluated against AGENTS.md. Recommendations below are development practices, not new entries claiming operational workforce capabilities.

## What is worth considering here

**Best fit among the examined systems: selected Superpowers skills for Claude's development work.** Combine those with a lightweight Spec Kit-style feature plan when a change is large. Preserve the current backend, tests, security rules and decision/progress/handover documents. Do not install all four systems or introduce multiple competing planning processes.

| Priority | System | Reuse recommendation | Main reason to limit adoption |
|---|---|---|---|
| 1 | [Superpowers](https://github.com/obra/superpowers) | Adapt individual debugging, verification and planning instructions | Some workflows include commits, delegation, branch cleanup and optional outside traffic; host behavior needs separate review |
| 2 | [GitHub Spec Kit](https://github.com/github/spec-kit) | Reuse a small specification/plan/checklist structure for substantial features | Full CLI needs Python/uv and offers executable extensions; unnecessary for a Markdown template |
| 3 | [GSD Core](https://github.com/open-gsd/gsd-core) | Later reference for milestone context and resumable handovers | Delegation/PR-oriented phase loop and an installer; existing project records already cover much of the need |
| 4 | [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD) | Later reference for product/architecture/UX questions on large modules | Broader process, Python/uv setup, and preview branch churn; excessive for a small fix |

This ranking is an integration judgment for this repository, not a quality or security certification. Skill software licensing does not make a coding model or its tokens free; no extra provider or paid service is proposed.

## 1. Superpowers: inspectable building blocks

[README reviewed](https://github.com/obra/superpowers/blob/main/README.md). Resolved main to **`22f0b463e7a5e579904dd6211a520321035526f7`**, whose commit subject identifies v7.0.2 (2026-11-03). This is the inspected revision, not a claim about the latest marketplace release. Do not use archived `obra/superpowers-skills` as the current source; the repository search marked it archived.

The README lists planning, debugging, testing and review skills and describes automatic activation. It also describes worktrees, delegation and branch finishing. Treat the process as adaptable rather than importing its defaults. Its optional visual companion loads an external branded image and describes telemetry opt-outs: do not start it during an offline trial. Full plugin/configuration and update paths remain unaudited.

### Highest-priority skills actually read

| Skill | Reusable behavior | Required project adaptation |
|---|---|---|
| [systematic-debugging](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/systematic-debugging/SKILL.md) | Reproduce, compare working paths, trace the cause, test one hypothesis, then make a small fix | Never log incoming/outgoing content, environment values or credentials indiscriminately. Use synthetic fixtures and redacted metadata. No owner desktop probing or live-service reproduction without its own authorization. Stop guessing after repeated unsuccessful fixes; record evidence and unresolved causes. |
| [verification-before-completion](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/verification-before-completion/SKILL.md) | Tie completion statements to actual checks; inspect output and failure counts; verify a claimed fix against its symptom | Respect the project's test policy and distinguish historical checks from new checks. Do not weaken or temporarily remove real stop/kill/network guards to demonstrate a regression. Use fakes only for such failure injection. Verification is not permission to commit or make a real request. |
| [writing-plans](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/writing-plans/SKILL.md) | Small tasks with concrete files, interfaces, assumptions, checks and proportionate self-review | Replace recurring commit steps with owner-controlled commit checkpoints. Keep current docs authoritative, avoid unnecessary file splitting and do not default to subagents. Preserve an already-selected execution method and approvals; don't repeatedly restart planning. |

These are instruction files, not enforcement mechanisms. Their references to additional skills and supporting files are not evidence those resources were read. In particular, this round did not inspect the full TDD, brainstorming, review, worktree, branch-finishing or delegation skills.

### Startup hook actually read

[Pinned `hooks/session-start`](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/hooks/session-start) is Bash code that reads the bootstrap skill and emits host-specific JSON context. No explicit network command or project-file mutation was seen in this file. **That narrow inspection is not an audit of the plugin:** hook registration, wrapper, injected bootstrap content, other hooks, visual companion, install/update scripts and host tool permissions still need review. It was not run. Bash/Windows comments are not local compatibility evidence.

Do not copy the hook into the workforce or register it in Claude/Codex settings under this plan. If developer-host activation is later selected, first review that full execution path at a pinned revision, list every file/command/network effect, and test in a disposable scratch project with outside traffic blocked. No screen capture, owner-window interaction, automatic commits or unattended runs are permitted by such a trial.

## 2. Spec Kit: useful structure without its CLI

Sources: [README](https://github.com/github/spec-kit/blob/main/README.md), [plan template](https://github.com/github/spec-kit/blob/main/templates/plan-template.md), [license](https://github.com/github/spec-kit/blob/main/LICENSE).

The README describes independent specification, bug-fix and idea-assessment processes and Python 3.11+/uv setup. It also lists executable extensions and workflows. No installation is needed to borrow a planning structure. Its template records technical context, constraints, project layout and a check against project principles.

Recommended local adaptation: one plan for a selected large module with problem/outcome, exclusions, current APIs, permissions, target files, data changes, acceptance evidence and rollback. Map principles to AGENTS.md and the decision board rather than creating a conflicting constitution. Keep actual paths (`src/`, `web/`) rather than reorganizing the repository to match an example. No CLI, Python, branch creation, extension or external catalog is proposed.

## 3. GSD: follow the move, borrow context discipline only

Sources: [archived repository redirect](https://github.com/gsd-build/get-shit-done/blob/main/README.md), [successor README](https://github.com/open-gsd/gsd-core/blob/main/README.md), [successor license](https://github.com/open-gsd/gsd-core/blob/main/LICENSE). Search marked the old repository archived; its own README directs readers to Open GSD. Do not install the archived package by name from old recommendations.

The successor describes staged milestones, fresh-context workers, persistent artifacts and a verify/ship loop. Its README says runtime compatibility depends on its installer; internals and installer were not read. A guessed onboarding-guide path returned 404, counted in the allowance; no onboarding claims are based on that missing page.

For this project, reuse the idea of a small resumable checkpoint inside the existing handover: selected task, exact files, verified evidence, failures, limits and next choice. Do not add a parallel STATE/CONTEXT authority, assume a model's context size, launch workers automatically or create PRs. A full GSD installation adds little immediate value until an actual orchestration need is demonstrated.

## 4. BMAD: reserve for a genuinely larger product decision

Sources: [README](https://github.com/bmad-code-org/BMAD-METHOD/blob/main/README.md), [license](https://github.com/bmad-code-org/BMAD-METHOD/blob/main/LICENSE). No internal workflow or individual skill inspected.

At the inspected branch, the README distinguishes stable v6.12 from preview v7 and describes Python/uv setup. It offers product, architecture, UX and testing perspectives and an existing-codebase path. These are upstream descriptions; release channels were not independently validated.

Useful later for deciding the scope of Business Workforce or YouTube Studio: answer product goals, user journey, existing integrations and acceptance questions in the current docs. Do not initialize its modules now or adopt its unattended-loop add-on. No runtime role or bot permission is added by borrowing a review perspective.

## License and provenance checklist

Four complete license files were read: Superpowers MIT (Jesse Vincent, 2025), Open GSD MIT (Open GSD, 2026), BMAD MIT (BMad Code, LLC, 2025) and Spec Kit MIT (GitHub, Inc.). Treat applicable full notices as part of any later substantial source/instruction reuse. BMAD's file also reserves trademark rights and refers to contributor attribution; detailed trademark/contributor files were not read. Do not rebrand a local feature as an endorsed upstream product.

This confirms the inspected top-level license texts only. Before copying, pin the exact target files, inspect their individual notices/resources and relevant dependency terms, and retain required full notices with the adapted material. No upstream code or skill text is copied into production by this report. License summaries here are not a full compliance audit.

## Reuse backlog: what Claude should prepare later

| Order | Proposed local pack | Destination | Readiness |
|---|---|---|---|
| 1 | Root-cause debugging checklist | Development docs for Claude | Source inspected; adapt redaction, fakes and scope rules before use |
| 2 | Evidence-based completion checklist | Development docs for Claude | Source inspected; map to relevant tests/full-check/commit rules |
| 3 | Small implementation-plan template | Existing feature docs | Superpowers plan and Spec Kit template inspected; adapt commit/delegation defaults |
| 4 | Review-response checklist | Development docs | Listed by Superpowers; exact skill not inspected, further review needed |
| 5 | Test-first behavior-change guide | Development docs | Listed by Superpowers; exact skill not inspected, adapt to meaningful project tests |
| 6 | Compact cross-session handover | Existing HANDOVER/PROGRESS | Local adaptation of GSD concept; no new store needed |
| 7 | Product/architecture review questions | Future large-module plans | BMAD overview only; individual resources not vetted |

For runtime bots, translate only suitable problem-solving/reporting text through the **existing Skill Library** after owner review. The service does not run development commands or host hooks. Imported skills remain disabled and unassigned; they cannot grant tools, models, applications, folders or approvals. Respect 6,000-character skill instructions and the shared 4,000-character prompt budget. Do not import an entire repository or require nonexistent tools. The Manager still has no tools.

## Concrete instructions for Claude

1. Read current AGENTS.md, decision board, progress and handover; preserve active work. This report supplements the earlier [hooks/skills proposal](HOOKS-SKILLS-GITHUB-PROPOSAL.md) with a more relevant development-method shortlist. It supersedes its first-choice recommendation for this broader purpose, not any approved implementation decision.
2. Offer the owner **A: prepare the three inspected checklist/template drafts (recommended); B: prepare a scratch-only pinned Superpowers integration audit; C: keep this catalogue for later**. Use clickable choices and numbered equivalents. Research approval alone does not select an implementation or installation.
3. If A is selected, author concise documentation drafts first. Record upstream revision, applicable notices, project-specific overrides, trigger conditions, output format and acceptance examples. Preserve one authoritative decisions/progress/handover path. Do not register host skills/hooks or import/assign bot skills as a side effect.
4. If B is selected, present the exact extra read count before fetching missing bootstrap/registration/wrapper/install files. Prepare the scratch plan before any dependency or security-boundary approval. Include external-asset/telemetry blocking, no automatic updates, no delegation, no Git writes and no live data/key access. Do not invoke upstream setup instructions simply to inspect them.
5. When a concrete implementation is separately selected, use existing services and APIs; add no permission, second store or capability claims. Test changed behavior with synthetic fixtures, run relevant/full checks as required, report failures and limits, and update handover. Real-service requests require their own approved counts; no paid provider, commit/push, destructive cleanup, deployment or autonomous operation.

**Project overrides to preserve explicitly:** no automatic commits; no reset/clean/delete or worktree cleanup without the required approval; no unrequested subagents; no real guard mutation testing; no secret/environment/content logging; no owner desktop windows; no paid fallback; no outside calls beyond approved counts; no unattended operation. A skill cannot supersede these rules.

## Acceptance and rollback for a later pilot

Pilot one selected aid on an already-authorized small task using synthetic data. Compare against the existing process: correct scoping, no repeated planning, useful root-cause evidence, truthful completion report and preserved handover. Record observed cost/latency only if actually measured; a passing code suite alone does not prove a skill improved the work. Check that no new Git writes, outside calls, permissions or automatic actions occurred.

Documentation-only drafts can be revised or set aside. A future host installation needs its own manifest of changes and disable/rollback instructions before activation; do not use blanket deletion of skill/config directories. Runtime skills use existing unassign/disable/version controls. Never erase audit history to roll back a pilot.

Research/report only: **no tests, builds, scripts, model calls, app edits, installs, imports, assignments, settings changes or commits were performed**. Claude's instructions are saved locally, not sent to a separate session.
