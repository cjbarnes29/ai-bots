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
- `POST /api/bots/:id/tasks`: direct task submissions are assessed before a task is created. An otherwise unsupported task is refused when the wording explicitly matches a policy prohibition (for example, deploying or purchasing); `proceedAnyway: true` requests a best-effort attempt and grants nothing. Requests that mention an unavailable capability without a policy prohibition are accepted with their assessment so existing text-work and fallback flows remain usable. Every assessment is audited with `via: "delegation"` and a short, clipped instruction.
- Changes of a capability's state between listings are written to the audit log as `capability.changed` (that is how "reassess when something changes" is recorded without a new table). The registry is rebuilt on every call (10 s cache), so connecting a provider, passing a test or pausing approvals shows at once.

## Execution assessment follow-up (2026-11-15, D-086)

The production TaskEngine now assesses every task (including delegated children) before context preparation and its first model call. This covers schedules, triggers, group mentions, decision assignments, workflow bot steps and Manager specialist tasks, superseding the older schedule/event assessment limitation below. Internal Manager starts also assess before planning. The shared predicate preserves route semantics: non-policy missing capabilities still allow task text fallback; explicit prohibitions are refused unless the owner requested best effort for that exact root. A Manager goal keeps its existing broader missing-capability policy. Best-effort choices grant nothing and are not inherited by generated children/specialist tasks. HTTP acceptance and execution checks have distinct audit phases. Internally created work can be recorded as failed after acceptance with zero model calls for that work. Keyword matching remains limited; all action/permission/Guardian checks remain authoritative. Chat/other direct text-generation features and Manager self-step/review text are not converted into separately assessed tasks. Evidence and limits: `EXECUTION-ASSESSMENT.md` (18 new fake-provider cases; no real-provider run).

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

## Independent result verification (M4, D-083)

"Completed" only means an agent stopped. `src/verification/` compares what a task's reply CLAIMS with the platform's own record. It reads only, uses no model and cannot approve, run or change anything.

| Verdict | Meaning |
|---|---|
| verified | at least one independent piece of evidence (an approved action that ran; a file that exists with the size the action reported) and nothing contradicts the result |
| unverified | finished, but nothing the platform can check (a text answer): the agent's own words |
| waiting | an outside action is still waiting for the owner's approval |
| contradicted | the reply claims an action (sent, saved, published...) with no matching executed action, an action failed, or a reported file is missing or has a different size |
| not_applicable | the task did not finish with a result |

- Claims are found by plain word patterns, only for things outside the chat ("I have sent...", "the file was saved"), skipping negations, plans and questions; only the agent's own words are scanned (the platform's appended record is not). A reply cannot talk its way into "verified".
- Files are checked through the folder permission gate; a file that cannot be read is "not confirmed", never a pass.
- A chain's verdict is its worst step. The verdict is always recomputed from the current record, so approving an action later turns "waiting" into "verified". It is written to the audit log (`task.verification`) when new or changed.
- API: `GET /api/tasks/:id/verification` (one task), `GET /api/tasks/:id/chain-verification` (the chain, records the verdict). Dashboard: the "Result check" panel on the task page.
- Registry link: an agent's **verified** level is "yes" only when at least one of its recent finished chains is currently verified; contradicted results are listed in its limits.
- Not covered: whether a text answer is correct or good; numbers or facts inside a reply; actions other than approved connector actions (for example things a Manager step did through its own tasks are covered through their task ids, but a Manager's final text is not separately scanned).

**Result-check assessment follow-up (2026-11-15, D-090, planning only):** source map and three synthetic probes in `RESULT-VERIFICATION-PLAN.md` qualify the preceding M4 description. Current claims match connector ID rather than exact action, chain aggregation ignores non-completed members, and the literal platform separator is not trusted provenance. Manager finals and workflow runs have no combined verification endpoint. These fixes are NOT implemented; do not treat an existing confirmed badge as proof every step/claim/recipient/file content was checked. Proposed next slice is a chain-completeness ceiling; gates and permissions remain unchanged.

**Chain-completeness implementation (2026-11-15, D-091):** supersedes the incomplete-member omission described in the D-090 assessment. The chain now returns lifecycle counts and incomplete task IDs/statuses; any non-completed member prevents a verified aggregate. Stronger waiting/contradicted verdicts and standalone task semantics remain. Existing registry counts reuse the corrected chain verdict. Evidence: `CHAIN-COMPLETENESS.md` (14 new synthetic cases; targeted verification 42/42). Exact-action matching, authored-text provenance and Manager/workflow combined checks remain pending; permissions are unchanged.

**Exact-action specification (2026-11-15, D-092, not implemented):** `EXACT-ACTION-MATCHING-PLAN.md` proposes exact connector/action operation/object matching through source-owned ActionSpec metadata. Unknown effects remain unverified; no permission/registry duplication or claim of recipient/content/delivery proof. RV-1 and RV-3 remain open; current implementation is still described above.

**Exact-action implementation (2026-11-15, D-093):** supersedes connector-wide claim support described above. Current task checks use exact task-bound connector/action declarations and normalized operation/object; unknown effects/ambiguous objects cap confirmation, known incompatible actions contradict. Supporting details explicitly confirm action type only, not target/content/delivery. Nineteen source-owned action declarations; no second capability list or permission grant. Full evidence/staged separation: `EXACT-ACTION-MATCHING.md`. RV-3 separator provenance, remote receipts and Manager/workflow projections remain open. D-091 lifecycle ceiling retained.

**Trusted reply-boundary proposal (2026-11-15, D-097, NOT implemented):** `REPLY-PROVENANCE-PLAN.md` specifies host-origin-labelled ranges, atomic result/event persistence and strict legacy/truncation handling. Mixed fallback output makes a single guessed prefix unsafe. RV-3 stays open; no current capability/evidence level is promoted. Claude/later-session resume state is saved in HANDOVER.

**Saved reply-origin implementation (2026-11-15, D-098):** supersedes the D-097 pending implementation statement. New TaskEngine results carry host-assigned origin ranges, bound to the exact saved task/result by an atomic existing-table transaction. Individual and chain checks require one valid manifest; model-written headings grant no trust. Legacy, invalid, mixed/untrusted and incomplete authored text cannot earn full confirmation. No backfill or capability promotion from fake evidence. Action/chain safeguards and permissions remain; target/content/receipt/quality and Manager/workflow final projections remain open. Evidence: `REPLY-PROVENANCE.md` (46 new cases, full 2,220 backend + 461 dashboard, modernization browser 34/34).

**Manager evidence projection (2026-11-15, D-099):** the read-only `GET /api/manager/runs/:id/verification` and on-demand Manager result panel now expose bounded, run-bound specialist chain evidence and missing/unfinished/self-step limits. Repeated roots count once; unchecked reported files prevent a fully confirmed Manager supporting verdict. The final Manager summary is always separately unverified; no claim scanning/provenance assumption, registry evidence promotion or model/tool/permission is added. Workflow-wide/final-claim/semantic/target/receipt checks remain open. Evidence: `MANAGER-RESULT-CHECKS.md` (38 new backend, 11 dashboard cases; full 2,258 + 472/typechecks/build; synthetic browser 29/29). Earlier statements that all Manager projections are unbuilt are historical.

**Workflow evidence projection (2026-11-15, D-101):** `GET /api/workflows/runs/:id/verification` and the on-demand run panel now check saved-graph task/approval evidence using shared D-088 linkage and existing task/action/file observations. Missing/foreign/ambiguous/unlinked/incomplete/skipped/uncertain records and read/file limitations remain explicit. Managers without an exact originating workflow-run/node backlink contribute zero inherited evidence; output stays separately unverified. Source text/arguments/results are not copied into the new response. No permission, executor, registry evidence promotion, model or outside call is added. Actual full/fake/browser evidence and limits: `WORKFLOW-RESULT-CHECKS.md`. Earlier statements that the whole projection is unbuilt are historical; backlinks/read receipts/final-output proof remain unbuilt.

## Outside-action workflow boxes (M6, D-083)

Workflow Studio has a new box, **Outside action** (`type: "integration"`): an agent, a service, an action and its fields (templates like `{{input}}` allowed). It goes through the SAME approval gate as an agent: a read runs at once only if that agent is allowed to read that service; a write never runs by itself, it creates an approval request and the run **waits** (step status `waiting`, kind `approval`). The owner decides on the Approvals page; the run continues at once after the decision (the approve/deny routes tell the workflow engine; the 30-second clock is only a backstop). Executed means the action's result becomes the box's output; failed, denied or expired fails the box with that reason. The existing **Checkpoint** box is the plain "approve before continuing" box. Rules: the checkpoint buttons can NOT decide an outside-action box (409 `needs_approval`); such a box is never retried automatically or by hand once it asked; the pause switch, folder gate and Guardian hold still apply; the box grants nothing. The registry's workflow entry depends on the agents and services its boxes use, and a run is refused (422 `workflow_not_ready`, `proceedAnyway` overrides) when they cannot work. Limit: a restart in the instant between the request and the saved wait can create a second request (documented, same as other boxes).

### Outside-action recovery follow-up

**Outside-action recovery update (2026-11-15, D-085):** supersedes the request-to-saved-wait replay limitation in the preceding section. A running integration interrupted before its result is durably saved now fails with an uncertain-outcome explanation; no reference is not proof that nothing happened. A persisted `integration_uncertain` marker blocks direct retry, and every descendant is checked before an upstream retry resets any state. Existing waiting approvals still resolve normally. No automatic approval/reconciliation or exactly-once remote execution is provided. Evidence: 16 new in-memory regression tests and targeted workflow suites 70/70; see `WORKFLOW-RESTART-SAFETY.md` for full results, watcher observation and remaining limits. Existing task-entry assessment gaps and Guardian restrictions are unchanged.

## Menu headings (M7, D-083)

**Atomic linkage follow-up (2026-11-15, D-088):** new workflow approval insertion and its waiting/reference row now commit in one synchronous existing-table transaction, with same-connection/attempt/snapshot checks and transaction-local audit records. Notifications occur after commit. Reconnection validates the exact stored binding; no new request is created. A startup-only pass fails a linked approved/no-receipt outcome as uncertain without changing the approval or re-executing it; routine ticks keep live approvals waiting. D-085 retry protection remains. Old orphaned requests are not automatically matched. This supersedes the new-request linking-window limitation above, not the no-exactly-once-remote guarantee. Evidence and limits: `ATOMIC-APPROVAL-LINKAGE.md`.

The 12 menu entries are unchanged (same order, addresses, levels, tabs; the AI Assistant is still first). They are grouped under seven caption headings: **Global Assistant** (AI Assistant), **Inbox** (Dashboard), **Projects** (Projects), **Workflow Studio** (Workflows), **Business Workforce** (AI Agents, Knowledge Center), **Activity** (Tasks & history, Decisions & approvals), **Settings** (AI Models, Apps & Integrations, Creative Studio, Settings). A heading appears only when one of its entries is listed at the current interface level. The Inbox page and the Business Workforce page stay where they were (tabs under Tasks & history and Apps & Integrations). The mapping lives in `web/src/components/shell/nav.ts` (`HEADINGS`, `heading` on each entry).

## Desktop and VM readiness (M9, D-083)

`GET /api/capabilities/vm-readiness` and a card on the Capabilities page: a read-only checklist of 12 steps between today's supervised desktop engine and an isolated VM, with the evidence for each, what needs the owner's separate approval, where the review-only material is, a sizing suggestion from the real host (always leaves the owner 8 GB) and the approval order from D-040. It is never "ready". The only look at the machine is a file-exists check for VMware's usual install folders. Nothing is installed, created, started or changed.

## Limits (state these plainly)

- Matching is by keywords in English; it can miss an ability or over-match. The answer says so (`caveat`).
- "Authenticated" for a provider means its last call or model-list request was accepted. It does not prove a particular model works; that is what verified means.
- All evidence today comes from fake services in development except the Groq runs recorded on the decision board. Nothing here proves a real Gmail, Google, Telegram, GitHub or Notion connection (NV-3, NV-4).
- Limits: tool probes are cached 30 s so a program installed a moment ago may take that long to show ("Check again now" re-probes); real-provider runs of the checker and Assistant answers, browser-driven checks of the page, and languages other than English for Assistant questions remain unverified or unsupported. Tasks launched by schedules and event triggers still enter through their existing automation path; they are not pre-assessed here.
- Per-model entries are limited to callable or verified models (80 at most).
- Everything is supervised-only. No autonomy was added.

## Tests

Discovery: `src/capabilities/discovery.test.ts` (30 simulated-world scenarios: registration of agents, models and workflows, additions, removals, authentication / configuration / operational changes, Guardian hold, no-change writes nothing, baseline persistence across a restart, damaged baseline, shared builds, planning summary, Assistant answers) and `src/capabilities/discovery-api.test.ts` (real app wiring: a created bot registers, a completed task moves the operational level, archiving removes and is logged, a provider switched off changes registry and Assistant at once, workflow gate with `proceedAnyway`, Manager prompt, background rescan). Dashboard: `web/src/capabilities.test.tsx` (7).


`src/capabilities/capabilities.test.ts` (50 simulated scenarios: every level combination, rejected keys, paid and simulated providers, retired models, Guardian states, mixed tasks, policy blocks, hostile and oversized wording, no mutation) and `src/capabilities/capabilities-api.test.ts` (real app wiring with fake services: routes, Manager gate, `proceedAnyway`, audit lines, read-only proof).
