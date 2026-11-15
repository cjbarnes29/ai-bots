# Shared task and Manager execution assessment

Date: 2026-11-15. D-086, owner-selected continuation of backend reliability. Status: implemented; focused tests and final full check passed; uncommitted. No migration, dependency, outside request or commit.

## What changed

HTTP acceptance checks alone did not cover internal callers. Schedules, triggers, groups, decisions, workflow steps, Manager specialist tasks and delegated children now enter the same TaskEngine execution assessment before task context preparation or the first task model call. Internal Manager starts (including workflow Manager boxes) are assessed before planning calls.

Production app composition supplies both hooks through the existing CapabilityService. The helper fails closed if the registry is unavailable or rejects. Optional hooks on the engine/Manager dependency interfaces support existing isolated unit constructors; there is no production API/configuration switch to disable this assessment. The Manager still has no tools.

Files: new src/capabilities/execution-policy.ts; src/app.ts; src/delegation/engine.ts, service.ts and routes.ts; src/manager/service.ts and routes.ts. No group/decision/workflow/automation API had to become asynchronous. Existing synchronous creation still returns a pending task/planning run; internal refusal is recorded as failed before a model call rather than pretending no task record was created.

## Existing semantics preserved

- A shared assessmentBlocks predicate retains the established distinction: ordinary tasks refuse unsupported explicit policy prohibitions, while unsupported non-policy capabilities retain best-effort text fallback. Manager goals retain their broader existing missing-capability refusal policy. Both use the existing registry/keyword matcher, not a second feature list.
- HTTP routes still provide their existing 422 readiness responses before creating work. Execution assesses current facts again after creation/queueing. Audit records distinguish phase=acceptance from phase=execution and include source, taskId/runId and refusal/override status.
- An explicit direct-task proceedAnyway choice is carried in that root's queue entry; an explicit Manager choice is carried in that run's execution invocation. The platform records the choice in its created/run-started records. No text supplied by a model can create this flag. Delegated children, generated specialist tasks and later scheduled work do not inherit it.
- These transient execution flags are not a second persistent store and grant no permissions. Existing restart recovery fails interrupted tasks/Manager runs; it does not automatically resume them with an omitted override.
- Task cancellation and Guardian hold are rechecked after the asynchronous assessment. Manager cancellation is rechecked before continuing to planning. Existing model/gate/Guardian checks, limits and owner authorization remain responsible for their effects.
- Outside-action approval continuation remains in ActionGate; it does not call a model for assessment or gain a bypass. Chat conversations, decision option drafting and other direct text-generation features were not converted into TaskEngine tasks.

## Coverage boundaries

Assessment runs once at each task's execution entry and once at each Manager run's planning entry; it is not a semantic scan of every later model reply or a replacement for checking each outside action. Manager's own self-executed text steps/review replies are within the assessed run and are not separately assessed as new tasks. Specialist tasks and delegated children ARE separately assessed. The keyword matcher remains English-only and can over-match or miss wording, including context embedded in generated instructions.

Registry rebuilding can run existing fixed local probes and append audit/settings snapshot records. It makes no provider request; probe/latency and bundle impact were not benchmarked. Do not claim this work adds OS isolation or makes unattended operation available.

## Tests and actual outcomes

New src/capabilities/execution-assessment.test.ts: 18 fake-provider integration cases cover scheduled, event, group, decision, workflow bot/Manager and internal Manager starts; ordinary text fallback; explicit root/Manager best effort; delegated-child override isolation; later-schedule isolation; assessment failure; cancellation during task/Manager assessment; missing registry and shared policy semantics. Requests refused by execution have zero calls for the refused task/run; a parent may have made its own separate calls before delegating.

Focused existing Manager/workflow/automation/capability suites initially passed 148/148. The new suite and delegation/group/decision/capability suites passed in the broader focused run; Guardian tests in that sandbox run failed because their local loopback server was unreachable. The unchanged Guardian suite passed 12/12 outside the sandbox.

The first full check failed one existing parallel-chain test: max overlap 2 rather than its expected 3. Its fake provider released calls after 40 ms, which did not reliably cover the added assessment/route latency under full-suite load. Changed only that test's synchronization: hold fake calls behind a barrier until all three arrive, then release. The original maxActive=3, distinct answers and exactly-three-call assertions remain; an explicit active=3 assertion was added. No safety assertion was removed or weakened. The focused new assessment + parallel suites passed 24/24 after this fix.

An initial new delegated-child assertion used the wrong API field (tree.tasks); corrected to the existing tree.task.children shape. This was a test-shape error, not an application defect.

Final `npm run check` passed (exit 0, outside sandbox): 2,049 backend tests across 97 files, 447 dashboard tests across 48 files, both typechecks and dashboard production build. Backend tests: 123.84 s; dashboard tests: 55.15 s. Existing Node DEP0190 and Vite >500 kB warning remain (main JS 999.91 kB, gzip 266.32 kB). No separate backend build, browser/real-provider suite or real external service test was run. `git diff --check` passed. The development server stayed stopped throughout this phase, so no source-watcher reload was triggered. No direct live-database command was issued.

## Remaining work

Follow-up D-088: new-approval atomic workflow linkage is now implemented and fake-tested (`ATOMIC-APPROVAL-LINKAGE.md`). Legacy orphan reconciliation and uncertain remote effects remain unresolved; the following list records the earlier D-086 scope.

- Durable approval correlation/reconciliation, broader result verification and scratch restore proof remain separate phases.
- UI candidates remain uninstalled and their production compatibility unverified.
- Guardian Tier B/OS isolation and real lock/idle checks remain as documented; supervised-only operation continues.
- Commit review requires a separate request, isolated staged export checks and explicit owner approval. Existing staged P-49 work remains separate.
