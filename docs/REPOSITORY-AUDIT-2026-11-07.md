# Repository audit — 2026-11-07

This is a source and documentation audit of the current local checkout. Checks below are evidence from source inspection and the test/build run recorded at the end. Real integrations and host security properties are not inferred from fake-service tests.

## Current state

- **Core platform:** Fastify, SQLite migrations through 020, Zod, React/Vite dashboard, task orchestration, agents, workflows, schedules, projects, inbox, approvals, audit log, and encrypted credential vault are present. The latest modernization work is committed as `f5cb7e5`.
- **AI orchestration:** model registry/routing, Manager planning, delegation allow-lists, workspace handoffs, capability discovery/feasibility, workflow readiness checks, and platform-record-based result verification are implemented. Direct task submission now gets a capability assessment before creation (NV-38).
- **Files and knowledge:** knowledge indexing, chat attachments, document read/write connectors, and folder permissions are implemented. Folder permissions remain application-level; they are not an OS boundary.
- **Browser and desktop:** a browser connector and a constrained desktop engine exist. Desktop control is limited to engine-started, approved applications; this is not a general-purpose agent browser with verified authenticated form completion. CAPTCHA and human checkpoints must remain untouched.
- **Human control:** writes go through `ActionGate`; approval and permission changes are owner-controlled; Guardian Tier A is present. Guardian Tier B, VM isolation, dedicated account, firewall audit and unattended operation remain unbuilt or unverified. The product must remain supervised.
- **Integrations:** connectors exist for multiple services, but provider/service tests are primarily fake. Gemini/Google, Gmail, maps, web data, and other live integrations remain as listed in the decision board. P-49 is prepared but not approved or run.
- **Requested capabilities not established by evidence:** job-search and CV/application workflows are not evidenced as complete. Image/video/audio creation is not connected. No paid service or new dependency was introduced in this phase.

## Findings and action

1. **Closed in this phase:** direct bot task submissions previously bypassed the capability assessment used by Manager and workflow entry points. The route now audits its assessment and refuses requests that are both unsupported and explicitly match a policy prohibition, unless the caller sets `proceedAnyway`. That override only permits a best-effort task; approvals and permissions still apply. Requests with unavailable non-policy capabilities retain the existing text fallback behavior.
2. **Remaining feasibility gap:** scheduled and event-trigger task starts do not yet receive this pre-task assessment. They remain supervised and subject to their existing approval, permission, Guardian, and capability gates. A future extension should avoid disrupting already-configured schedules and must test false-positive wording before enforcing refusals.
3. **Documentation drift:** `docs/HANDOVER.md` still contains a 2026-11-05 snapshot and older status descriptions that conflict with later progress entries. `docs/PROGRESS.md` has the newer record; reconcile the handover as a separate documentation pass rather than treating its old counts as current.
4. **Known quality warning:** dashboard build succeeds but emits a chunk-size warning for a ~1 MB minified JavaScript bundle. No code-splitting change was made in this phase because it needs profiling and route-level design.

## Verification

- Targeted capability API tests: 12/12 passed.
- `npm run check`: backend 2,013 tests (95 files), dashboard 447 tests (48 files), both typechecks, and production build passed.
- The build reports the large-chunk warning noted above.
- Not run: real-provider tests, real external requests, Guardian Tier B/VM/firewall checks, real phone hardware, screen reader, or browser completion against authenticated sites.
