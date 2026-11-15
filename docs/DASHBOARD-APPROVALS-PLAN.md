# Dashboard and Approvals redesign specification (D-095)

2026-11-15. **Planning only.** Owner selected layout, existing data sources, exact files, phone/accessibility checks and rollback. No app/test/dependency/schema/data/key/outside-request/commit change. Current backend checkpoint: `BACKEND-CHECKPOINT.md`; approved visual direction: `MODULAR-MODERNIZATION-PLAN.md` and fictional `design/workforce-preview.html`.

Implementation follow-up: owner selected this slice under **D-096**; delivered changes, exact test/browser evidence, source-only rollback and remaining limits are recorded in `DASHBOARD-APPROVALS.md`. Original D-095 specification is retained below; manual device/zoom and real-service verification are not implied.

## Proposed first slice

Modernize `/` and `/approvals` using the current React/Vite/Tailwind stack, existing Stats/Panel controls, API hooks and server records. No library import, new dependency, backend route, model call or new operating mode. The Assistant remains `/assistant`; navigation order/headings/levels remain unchanged.

Desktop: a clear title, priority information at the top, generous spacing, compact linked metrics and two-column read-only panels. Phone: one vertical reading order, full-width decision cards, wrapped content and controls with 44 px targets. Existing theme and reduced-motion rules apply. Use current indigo/slate styling and local icons; no decorative charts with fictional numbers.

## Layout and behavior

### Dashboard

| Order | Section | Proposed presentation |
|---|---|---|
| 1 | Dashboard title and freshness | One h1, short plain-language description; last successful overview update from query metadata. Guardian/banner/shell remain outside the page as currently implemented |
| 2 | Needs your attention | Full-width priority list; approval count/link and waiting workflow decisions remain distinct. Setup/hold/failure notices use existing attention records. No “everything fine” while a required source is unavailable |
| 3 | At a glance | Existing linked agent/task/approval metrics; separate total waiting approvals from sampled workflow activity. Two columns where space permits, four on wide screens. Unknown values show a dash plus an explanation, never a fabricated zero |
| 4 | Current/recent work | On Intermediate/Advanced, side-by-side task summary and recent workflow list with actual statuses, timestamps, simulation marker and links. At Simple retain the current read-only panel visibility rules; no controls or waiting counts hidden |
| 5 | Setup and connections | Existing get-started steps, provider/setup status and current AiOverview; distinguish connected/setup from verified/operational. Retain DemoCard and its simulated labeling. Existing quick-action links remain navigation, never one-click starts or saves |
| 6 | Recent activity | Existing activity feed, compact timestamp/status rows and links; latest eight records displayed with a link to Monitor. Preserve controls and existing routes |

Keep existing beginner guidance and level-switch behavior. Do not add Manager/workflow confirmation badges, fabricated utilization/productivity percentages, new “verified result” totals, auto-start actions or a second settings system.

### Approvals

| Order | Section | Proposed presentation |
|---|---|---|
| 1 | Approvals title + total waiting | One h1. Display total from external status separately from loaded list length. Waiting approvals remain visible at every interface level |
| 2 | Outside actions control | Existing pause/resume control and concise policy explanation always visible. Unknown/failed status reads show “Status unavailable” rather than the current false-default “allowed” state; disable only a toggle whose next value cannot be determined |
| 3 | Waiting for you | Full-width cards: request summary, agent/service/action, context/task links, exact fields, asked/expiry time, decision errors and Approve…/Deny controls. No selection/bulk approve, preview execution, automatic resend or new permission control |
| 4 | History | Compact status/history cards with result/error and context links. Distinguish approved from executed. Prefer “Executed” over generic “Done”; execution is not delivery/read/content verification. Label the loaded history window |
| 5 | Service details and security log | Compact read-only sections, optionally collapsible; all content remains reachable. Pause control, pending count/cards and decision errors never go into these folds. Log failures/empty states are explicit |

Preserve `?focus=ID`, outline/scroll behavior and stable `approval-ID` anchors. Do not hide fields in a truncated summary, a hover-only view or a desktop-only side panel. Large fields may scroll, but every exact field remains available in both the card and confirmation. Use normal React text rendering, never HTML from request/model content.

## Existing data/API contract

| UI fact | Existing hook → local endpoint | Scope / rule |
|---|---|---|
| Attention, task/agent counts, AI/automation state, activity | useMonitor → GET /api/monitor/overview | Preserve server counts; overview exposes generatedAt and query has dataUpdatedAt. Server activity feed is capped at 40; page currently shows eight |
| Provider connection state | useProviders → GET /api/llm/providers | Exclude simulated providers from connected-real-AI counts; no new provider tests/probes |
| Outside pause/connector setup/total waiting | useExternalStatus → GET /api/external/status | Source for total pending. “Set up” is not “verified”; no new readiness/network checks |
| Workflow list / waiting checkpoints | useWorkflows → GET /api/workflows?archived=0 | Response contains **latest 30 runs**, not all runs. Counts derived from this list must say “among latest 30 runs” (or actual returned N). Waiting checkpoints and approvals are different records |
| Pending approvals | useApprovals(true) → GET /api/approvals?status=pending | Existing server default **100**, newest first. Display all loaded cards; do not call their length the global total |
| Recent request history | useApprovals(false) → GET /api/approvals?limit=100 | Existing query loads latest 100 requests across statuses; client excludes pending. Say “History within latest 100 requests,” not all historical decisions |
| Security log | useSecurityLog(30) → GET /api/audit?limit=30 | Latest 30 recorded entries, not a complete export |
| Focused request outside loaded lists | New narrow useApprovalById → existing GET /api/approvals/:id | Fetch only a valid focused UUID not present in either loaded list. No new server route; same access boundary |
| Decisions | useApprove/useDeny → existing POST /api/approvals/:id/approve or /deny | Existing confirmation/owner proof/server validation authoritative. Same ID and payload; no retry/automatic execution added |
| Pause | useSetExternalPaused → existing PUT /api/external/pause | Existing authorization and refresh behavior retained |

Most relevant existing hooks poll every five seconds. Keep their polling/request frequency unchanged; use query metadata for freshness and no independent timers/poll loops. Existing approval refresh invalidates approvals/external/audit. The focused query key should stay under `["approvals", "by-id", id]` so that invalidation refreshes it too. Monitor's existing polling handles its overview; do not add API traffic merely for a timestamp.

### Correct the time-window presentation

The current Dashboard combines server-wide task/action failure counts with failures from only 30 workflow runs under one 24-hour total. **Do not retain that misleading combined total.** Show server-wide task/action failures separately; label workflow counts as sampled recent-run counts. The monitor's 24-hour fields use record creation time, not completion time: explain the basis as “created in the last 24 hours” where relevant. Do not change backend counting semantics in this presentation slice or describe it as an exact completion-throughput metric.

### List-cap and deep-link handling

If total waiting exceeds the loaded pending list, keep the global count visible and show “Showing N latest requests; M waiting in total.” Do not pretend there is pagination or every older request is loaded. Complete enumeration/pagination is a separate backend contract proposal, not silently added here. The same disclosure applies when a focused lookup retrieves an older request.

For `?focus=ID`, validate UUID syntax locally, fetch through the existing single-request endpoint when needed, and render the real pending/history card once, deduplicated by ID. A missing/invalid/unavailable focused request gets an honest message while other cards stay usable. Query data remains authoritative; no local copy of approval status or a new approval store. Once a decision refreshes it, render its returned status rather than keeping a stale approve button.

## Loading, error, stale and verification language

- Shared query-status presentation distinguishes initial loading, failed initial load, successful empty result, and background refresh failure with cached data. Announce meaningful errors without repeatedly announcing each polling timestamp.
- Never show “Nothing waiting,” “Nothing decided,” an allowed/outside status or a green all-clear merely because a query is absent/failed. Empty-state messages require successful data. Partial Dashboard failures are scoped to their source; retain available cards and label unavailable ones. A source disagreement shows counts with their source/freshness, not a guessed merged value.
- The pause banner reflects its actual query state. The server remains responsible for blocking decisions; a UI status failure does not grant permission or invent another decision path.
- Preserve executed/approved/pending/failed/denied/expired distinctions. No “guaranteed once at the remote service” or delivery promise. Confirmation may retain “Yes, do it once” as one gated request, with outcome checked in history; do not claim remote exactly-once recovery.
- RV-3 trusted reply provenance remains unresolved; Manager/workflow aggregates, exact targets/content/count and remote delivery/read receipts remain unverified/unbuilt. This slice adds no stronger result-verification label. Keep these limits in the implementation report; show an explanation wherever execution could be mistaken for independent delivery/result proof, without placing developer terminology into the normal user flow.

## Exact file manifest

| File | Proposed delta |
|---|---|
| web/src/pages/Dashboard.tsx | Reorder/rebalance existing sections, scoped query states, truthful source/time-window labels and card layout; retain level behavior/actions/data hooks |
| web/src/pages/Approvals.tsx | Priority layout, honest query/total/window states, focused request integration, exact-content wrapping and precise status copy; existing mutation handlers/IDs/context links retained |
| web/src/components/ui/QueryStatus.tsx (new; check existence first) | Small presentational loading/error/stale/empty/freshness helper, no fetch/mutation/permissions or second state store |
| web/src/api/hooks.ts | Add useApprovalById on the existing GET route, enabled only for a valid unloaded focus ID; same approvals invalidation prefix. No changes to decision/pause payloads or polling intervals |
| web/src/components/ConfirmDialog.tsx | **Narrow shared accessibility delta:** constrain to viewport, scroll content independently of footer, trap Tab/Shift+Tab while open and restore focus to the opener. Preserve handlers, confirmation labels, cancel/Escape policy and busy state. No permission/owner-proof changes |
| web/src/dashboard.test.tsx, web/src/approvals.test.tsx | Extend existing tests after reading them; preserve original behavior assertions and update only deliberate copy/window expectations |
| web/src/test/fakeApi.ts | Extend existing fake read-by-ID/error/window fixtures only if needed; no real fetch fallback |
| web/src/dashboard-approvals.test.tsx (new; check existence first) | Source disagreement, caps, stale/failure/empty cases, focus lookup/deduplication and mutation-count regressions |
| web/src/confirmDialog-accessibility.test.tsx (new; check existence first) | Focus cycle/return/Escape/busy state and large-content semantics; no approval or Guardian policy tests replaced |
| scripts/e2e/dashboard-approvals-e2e.mjs (new; check existence first) | Synthetic scratch app + fake services + test-owned browser; viewport/long-content/keyboard/approval regression evidence |
| docs/DASHBOARD-APPROVALS-PLAN.md, docs/PROGRESS.md, docs/DECISION-BOARD.md, docs/HANDOVER.md, TASKS.md | Implementation status/evidence and remaining limits after a separately selected implementation |

Reuse Stats.tsx, local CSS utilities, ContextLinks, guidance, level control and shell unchanged where their contracts suffice. No nav.ts/new page required. No package.json/lockfile, src/ backend, migration, assistant/canvas library, owner-proof dialog or Guardian changes. If implementation reveals a need outside this manifest, report the concrete reason before expanding a sensitive boundary. Styling the shared modal requires regression checks of its existing consumers, not only Approvals.

## Phone/accessibility acceptance (proposed, not run)

| Area | Required check |
|---|---|
| Viewports | 360, 390, 768, 1024 and 1440 px; no page-level horizontal overflow; browser 200% zoom and long localized dates/names. Exact content may have intentional internal scrolling, with all fields readable |
| Decision content | Long email text, nested JSON, Unicode, long URL/file name and many fields visible in card and confirmation. Confirm footer remains reachable; focused older request renders only once |
| Keyboard | Reach every control/link, visible focus, Enter/Space behavior, modal Tab/Shift+Tab containment, Escape cancel, focus restoration, no automatic approval from opening/focusing/closing |
| Touch | At least 44 px actionable targets; wrapping button row; no sticky bar over decision content or phone navigation |
| Structure | One h1/page, logical h2 order, status text plus color, no hover-only facts, accessible dialog name and targeted alert/status announcements |
| Levels/theme/motion | Simple/Intermediate/Advanced retain navigation/guidance and approvals; all addresses still work. Light/dark contrast, existing reduced-motion rule honored; no animated metric inventions |
| Data states | Each query loading/error/stale/empty; unknown pause; pending total > loaded count; missing focused ID; old focus outside both capped lists; sampled workflow history; no false zeros/all-clear |
| Decisions | Open/cancel yields zero writes; confirm yields one existing API mutation; busy blocks duplicate click; deny unchanged; error/expiry/revoked proof/Guardian hold remain server refusals with visible feedback. Fake services only |

Use relevant dashboard/approval/dialog component tests and the new fake browser script, then applicable existing redesign/levels/hub/modernization checks and full `npm run check`. Inspect existing e2e expectations before changing deliberate copy; never weaken route, permission or approval assertions. Do not run real-*.mjs scripts, copy live data/vault, operate an owner's window or install a browser/dependency as part of this slice. Report actual screenshot/viewport/focus/console evidence and omissions.

## Delivery order and rollback

1. Shared query-state helper and narrow dialog accessibility change, with tests of existing consumers.
2. Dashboard layout and source/window corrections; focused fake checks.
3. Approvals layout, read-by-ID hook and capped-list handling; fake decision/error tests.
4. Synthetic browser acceptance and full checks; save evidence and exact changed-file inventory. No commit included.

Rollback is source-only: preserve the pre-slice working-file versions of the manifest before edits, then restore only those exact new deltas if acceptance fails. Do not use reset/clean or overwrite the mixed working tree; original staged P-49 and unstaged reliability changes remain separate. No persistent schema/data changes need reversing. Shared modal/query changes should be individually reviewable to isolate regressions.

Current review validation: source/docs/Git inspection; `git diff --check` passed and the new document is not ignored. Existing staged verifier blob IDs remained unchanged; no staging operation or application/test edit. No mockup render, browser or test suite run; saved preview remains fictional/unverified visually. Last full implementation evidence remains D-093 (2,174 backend + 447 dashboard, typechecks/dashboard build). This specification does not approve implementation or close RV-3/aggregate/operational gaps.
