# Capability registry and feasibility checker (M1, M2)

Added 2026-11-06 under the owner's modernization brief (decision D-081). Code: `src/capabilities/`. Read-only; no migration, no dependency, no outside request, no new permission.

## What it is

One honest answer to "what can the workforce do right now?", built from facts the existing services already hold. It stores nothing. It reuses:

| Source | Used for |
|---|---|
| `ToolRegistry` (`src/tools/registry.ts`) | programs found by fixed commands, built-in abilities, "not built" features |
| Integration checks in the audit log (`integration.verified` / `integration.verify_failed`, `approval.executed`, `external.read`) | authenticated, tested, operational, verified for outside services |
| `ModelCatalogService` + `ModelRegistry` | provider status ("connected" = a real call or test was accepted), verified / unverified models, cost class |
| Guardian view, approval gate, group switch, PC agent folders | environment and permission entries |
| One fixed `ffmpeg -version` probe (the same injected command runner as the tool registry) | FFmpeg |

## Six levels (registered is not working)

| Level | Means | Needs evidence of |
|---|---|---|
| installed | the program / module exists | probe or build |
| configured | key, address, folder or switch set | settings |
| authenticated | the service ACCEPTED the credential | a recorded check or accepted call (n/a for local things) |
| operational | seen working | a probe that ran, a passing real test, or a recorded successful use |
| tested | a deliberate test passed | recorded test result |
| verified | tested AND really used, no later failure | both; never for simulated or local-readiness-only evidence |

Each level is `yes` / `no` / `unknown` / `n/a` with an evidence sentence. A connector that is only "ready" is **unverified**, not available.

States: `available`, `unverified`, `partial`, `needs_setup`, `unavailable`. Cost: `free`, `free_with_limits`, `local`, `paid`, `simulated`, `not_applicable`, `unknown`. A paid provider is listed as paid and blocked by the free-only lock; the simulated demo provider is never counted as an AI and never verified.

Groups: tool, model, integration, permission, authentication, environment. Includes honest "unavailable" entries for native model tool calling, picture and audio input, Guardian Tier B, a VMware VM, and unattended operation.

## Feasibility checker (M2)

`assess(goal, capabilities)` returns `fully`, `partial` or `unsupported`, with: each requirement and why it matched, what can be done, what cannot, what needs the owner, alternatives, blockers, and a supervised-only note.

- Rule-based on purpose: no model call, free, offline, and goal text (untrusted) is only matched against fixed word patterns.
- A verified, routable real model is always required.
- `fully` only when every requirement is `met` (available). Unproven or restricted capabilities make it `partial`.
- `unsupported` when no model exists, or a hard-blocked requirement (not built, not installed, forbidden by policy) leaves nothing else usable.
- Policy blocks: purchases, deploying/publishing, social posting, administrator/system changes, and working while the owner is away (supervised only until Guardian Tier B is verified, D-035).
- It cannot approve, enable, connect or change anything.

## Where it is used

- `GET /api/capabilities`, `POST /api/capabilities/refresh`, `POST /api/capabilities/assess` (all read-only; assess writes one `capability.assessed` audit line holding a 120-character clip).
- `POST /api/manager/runs`: the Manager assesses the goal first. A task that is **impossible as asked** (something it needs is not built, not installed, or forbidden) is refused with 422 `task_unsupported` and the assessment. The owner may resend with `proceedAnyway: true` for a best-effort plan; this grants nothing. Tasks that merely need setup or are unproven are accepted and the response carries the assessment. One existing test (`skills.test.ts`, "make a video") now sends `proceedAnyway: true` because the behaviour changed on purpose.
- Changes of a capability's state between listings are written to the audit log as `capability.changed` (that is how "reassess when something changes" is recorded without a new table). The registry is rebuilt on every call (10 s cache), so connecting a provider, passing a test or pausing approvals shows at once.

## Automatic discovery and updates (D-082)

Nothing is registered by hand. The registry is rebuilt from the services that own each thing, on every request, so adding a feature to a service is enough for it to appear.

| Kind | Read from | Appears as |
|---|---|---|
| Programs and built-in abilities | `ToolRegistry` probes (own 30 s cache) | `<tool id>` |
| Outside services | connector registry + audit-log checks | `<connector id>` (also any connector the tool list does not name) |
| AI providers and models | model catalog + model registry | `model-provider:<id>`, `ai-models` (aggregate), `model:<provider/model>` (callable or verified, not retired, at most 80) |
| Agents | agent manager + task log | `agent:<id>` (archived agents are simply absent) |
| Workflows | workflow service + run log | `workflow:<id>` (partial when an agent it uses cannot run, or it asks the Manager and no model is verified) |
| Environment, permissions | Guardian, approval gate, group switch, folders, FFmpeg probe | `env-*`, `perm-*`, `auth-*` |

Agents and workflows follow the same six levels. Their **operational** level means a task or run really completed; **tested** stays "not known" (no deliberate test exists) and **verified** stays "no" (a completed task is not an independently checked result, that is milestone M4). A new agent is therefore "set up, not proven", never "working".

**Change detection.** Every rebuild is compared with the last snapshot (one compact line per capability: state plus the six level answers). The snapshot is kept in the existing approval-settings key/value store under `capabilities.snapshot`, so changes made while the app was stopped are still noticed at the next start. A damaged snapshot is rebuilt. Differences are written to the audit log as `capability.changed` with counts and up to 40 entries, each `added`, `removed` or `changed` with the aspects that moved: installation, configuration, authentication, operational status, testing, verification, or plain state. The first ever listing writes `capability.baseline` only. Read the history at `GET /api/capabilities/changes`. The server also rescans every 60 seconds (`capabilityPollMs`) so a change is logged with nobody watching; tests leave this off and call the service directly.

**One source of truth.** All consumers call the same `CapabilityService`:
- **Dashboard:** page `/capabilities` (tab under Apps & Integrations, Advanced level; read-only, refreshes every 15 s, "Check again now" button).
- **Assistant:** "what can you do?", "what can't you do?", "list your capabilities" and "can you <ability>?" are answered from the live list on every ask (reply kind `capabilities`). A "can you" question that names no known ability (plain text work) is left to ordinary chat. Rule-based, English, no model call.
- **Manager:** the planning prompt's "can do / NOT available" lists come from the registry (unproven things are listed as not to be relied on); `POST /api/manager/runs` assesses the goal first (M2).
- **Workflow engine:** `POST /api/workflows/:id/run` is refused with 422 `workflow_not_ready` and the reasons when the workflow's capability is "partly working" because an agent it uses cannot run (paused, no model, model unusable, archived) or the Manager has no verified model. `proceedAnyway: true` overrides this and grants nothing. Workflows that are invalid or switched off keep their existing engine messages.

## Limits (state these plainly)

- Matching is by keywords in English; it can miss an ability or over-match. The answer says so (`caveat`).
- "Authenticated" for a provider means its last call or model-list request was accepted. It does not prove a particular model works; that is what verified means.
- All evidence today comes from fake services in development except the Groq runs recorded on the decision board. Nothing here proves a real Gmail, Google, Telegram, GitHub or Notion connection (NV-3, NV-4).
- Not built yet: checks on delegation tasks created directly (only Manager requests and workflow runs are gated), tool probes are cached 30 s so a program installed a moment ago may take that long to show ("Check again now" re-probes), real-provider runs of the checker and of the Assistant answers, a browser-driven check of the new page, other languages than English for the Assistant questions.
- Per-model entries are limited to callable or verified models (80 at most).
- Everything is supervised-only. No autonomy was added.

## Tests

Discovery: `src/capabilities/discovery.test.ts` (30 simulated-world scenarios: registration of agents, models and workflows, additions, removals, authentication / configuration / operational changes, Guardian hold, no-change writes nothing, baseline persistence across a restart, damaged baseline, shared builds, planning summary, Assistant answers) and `src/capabilities/discovery-api.test.ts` (real app wiring: a created bot registers, a completed task moves the operational level, archiving removes and is logged, a provider switched off changes registry and Assistant at once, workflow gate with `proceedAnyway`, Manager prompt, background rescan). Dashboard: `web/src/capabilities.test.tsx` (7).


`src/capabilities/capabilities.test.ts` (50 simulated scenarios: every level combination, rejected keys, paid and simulated providers, retired models, Guardian states, mixed tasks, policy blocks, hostile and oversized wording, no mutation) and `src/capabilities/capabilities-api.test.ts` (real app wiring with fake services: routes, Manager gate, `proceedAnyway`, audit lines, read-only proof).
