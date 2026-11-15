# Backend checkpoint and redesign entry criteria (D-094)

2026-11-15. **Review only.** Owner selected a summary of completed reliability work, remaining gaps and conditions for starting Dashboard/Approvals modernization. No application/test change, new test run, dependency, database/key access, outside request or commit.

## Recommendation

**Prepare the first Dashboard and Approvals design slice now, using existing components and APIs.** A limited presentation update can proceed after its scope is chosen, while preserving current controls, truthful statuses and recorded limitations. The backend does not need to be replaced or rebuilt from scratch.

Do not extend this into new automated execution, new “everything verified” summaries or Manager/workflow confirmation badges yet. Trusted separation of AI-written text from platform notes (RV-3) is the next result-verification fix. Independent Manager/workflow result projections remain subsequent work. This review is a recommendation for the next owner choice, not approval to implement a redesign or revise the approved backend-first direction silently.

## Completed reliability work

“Tested” below means the named automated/synthetic behavior passed. It does not mean a real remote action, power failure or full owner recovery was verified.

| Delivered checkpoint | Result | Evidence and limits |
|---|---|---|
| D-085 restart/retry safety | Interrupted outside-action steps fail uncertain; retries cannot reset protected downstream actions and resend them blindly | 16 new cases; `WORKFLOW-RESTART-SAFETY.md`. No exactly-once remote guarantee or real crash drill |
| D-086 shared execution assessment | Task execution, delegated children and internal Manager planning reuse the existing capability assessment; permissions and text fallback retained | 18 new fake-provider cases; `EXECUTION-ASSESSMENT.md`. Assessment is not permission; language/real-session coverage limited |
| D-088 atomic approval linkage | New approval, exact workflow link and related audit commit together; pending requests reconnect; cold approved/no-receipt stays uncertain without resend | 29 synthetic persistence/fault cases; `ATOMIC-APPROVAL-LINKAGE.md`. Existing tables; no orphan guessing or distributed-worker guarantee |
| D-089 backup/restore rehearsal | Existing backup restores synthetic committed data, relationships/search and matching encrypted sample; wrong key, damaged/empty candidates and overwrite cases checked | 9 new + 3 existing backup cases; `BACKUP-RESTORE-REHEARSAL.md`. No owner DB/key copied; actual recovery NOT RUN |
| D-091 chain completeness | Failed, cancelled, pending or running members prevent a wholly confirmed chain; lifecycle details are returned | 14 new cases; `CHAIN-COMPLETENESS.md`. Completed text alone is still unverified |
| D-093 exact action/object matching | Source-owned exact action rules replace service-wide inference; mismatched effects contradict and unknown effects remain unverified | 73 new cases; `EXACT-ACTION-MATCHING.md`. Action type does not prove exact recipient/content/delivery; RV-3 remains open |

Together these added **159 backend regression cases** above the 2,015-test modernization baseline. Latest full implementation check, **D-093: 2,174 backend tests (102 files), 447 dashboard tests (48 files), both typechecks and dashboard production build passed**. No separate backend build or new real-browser/provider run for those latest backend changes. Existing DEP0190 and 999.91 kB bundle warnings remain. The earlier restricted connector/process-test failures passed in the normal-permission full run; no guards were weakened.

## What remains

| Gap | Practical implication | Effect on the first visual slice |
|---|---|---|
| RV-3 authored-text provenance | A model can imitate the text separator currently used to exclude platform notes, hiding claims from scanning | Keep it disclosed; do not introduce stronger confirmation claims. Plan/fix before adding richer evidence rollups |
| No independent combined Manager/workflow result check | Their completed/model-reviewed status is not a platform-confirmed final deliverable | Keep execution status separate; link to existing records, never invent aggregate verification |
| Target/content/count/receipt limits | A supported send type is not proof of who received/read it; a matching file size is not content quality | Use precise labels and check details; no “delivered/read/everything verified” shortcuts |
| Legacy orphan approvals and uncertain outside effects | Old unlinked requests and real remote outcomes need review; local history cannot establish exactly-once execution | Surface history and uncertainty; no automatic reconciliation/retry controls added by redesign |
| Recovery coverage | Synthetic DB/key recovery passed; live restore, full-installation backup, cross-version recovery and power-loss behavior unverified | Keep backup information accurate; no restore/replacement feature in the visual slice |
| Guardian Tier B / isolation | Dedicated account/VM/firewall programme remains unbuilt/unverified; unattended operation unavailable | Preserve supervision/hold banners. Not a prerequisite for styling existing screens; no autonomy added |
| Source-library compatibility | Upstream top-level licenses/docs reviewed, but immutable pins/transitive audits/install/build/browser compatibility not established | Use current local components. No new library needed for the first slice |
| Uncommitted mixed working tree | Original staged P-49 changes coexist with unstaged reliability work | Keep separation; no implicit commit. Any future commit still needs its own staged export/full check and owner approval |

Existing historical reports contain “pending” statements from the date each phase was written. The completion table above and decision-board follow-ups describe the current checkpoint; do not interpret old lists as proof later work was never delivered. The D-085 watcher reload incident is recorded in its report; no blanket claim that every earlier phase left every live row unchanged is made here.

## Existing UI and data to reuse

Source inspected during this review:

- `web/src/pages/Dashboard.tsx` already uses monitor/provider/external-status/workflow hooks, local Stats/Panel components and interface levels. Pending approval counts and waiting workflows are separate facts. Provider connection/setup is not proof of current operational/result verification. Reuse their existing sources and label sample/time windows accurately.
- `web/src/pages/Approvals.tsx` already uses the pending/history hooks, exact argument display, confirmation dialog, approve/deny hooks, external pause switch and context links. Those controls and their server authorization remain the transaction path; a visual update must not create another path.
- `web/src/components/shell/nav.ts` remains the one navigation list; interface levels control menu/guidance visibility only. Existing API hooks/TanStack Query remain the client data layer. No second backend store or component-owned approval state.
- `docs/REDESIGN-PLAN.md` records the older completed redesign; `UI-AUDIT.md` is partly superseded historical context. Use the current implementation as the starting point. The saved `docs/design/workforce-preview.html` is a fictional design reference, not a browser-verified production screen.

## Conditions for implementing the first Dashboard/Approvals slice

1. **Concrete scope first:** agree on a small file/visual specification for those two screens and shared presentation components. Reuse the present React/Vite/Tailwind stack, existing hooks and APIs. New assistant/canvas libraries, streaming, chat adapters, new systems and provider changes stay outside this slice.
2. **Truthful information:** Dashboard prioritizes requests needing the owner, running/failed work, setup blockers and recorded activity from current services. Distinguish waiting/approved/executed/failed/denied/expired; “executed” means the recorded action ran, not confirmed remote delivery. New totals must name their time/sample scope. Loading, errors, stale/unavailable data and unknown capability states must not become reassuring zero/green values.
3. **Preserve approval decisions:** retain exact request identity/content, expiry, confirmation, owner-proof/Guardian behavior, denied/failed feedback and pause control. No auto-approve, batch decision, resend, permission grant or new retry mechanism; retain the existing decision endpoints. Prevent UI repeat submissions through existing mutation pending states; the server remains authoritative. No control or waiting count hidden at Simple level.
4. **Preserve reachability/accessibility:** all existing routes/search access, seven headings and menu levels remain; one h1 per page, keyboard/focus behavior, readable status words alongside color, reduced motion and 44 px touch targets. Phone layouts must keep all decision content/controls usable; no read-only layout choice may conceal an approval.
5. **Use synthetic test data:** cover pending, approved, executed, denied, expired, failed, empty/loading/error/paused states and mixed workflow/task states with fake services. Browser checks use a fresh synthetic scratch DB and test-owned browser/server processes, not a copy of the owner DB/vault or an owner window. No real approval execution/provider request is needed.
6. **Verify the actual slice:** relevant component tests plus applicable redesign/levels/hub/modernization browser checks for changed paths, then full `npm run check`. Report new viewport/focus/console evidence and what was not observed. Existing backend full-check results do not certify a future UI. Avoid running unrelated paid/live scripts. No new dependency without its own approval.
7. **Keep rollback simple:** presentation-only diffs over unchanged contracts; preserve existing security dialogs/handlers and return to the previous components if acceptance fails. No data migration, live restore or destructive Git operation. Commit/push/deploy/publishing remain outside authorization.

These conditions do not require connecting real services, proving unattended operation or copying the live database just to redesign existing screens. Those are separate operational milestones. They also do not declare the unresolved backend evidence issues complete.

## Next choices

Follow-up D-095: owner selected the limited Dashboard/Approvals specification. Saved in `DASHBOARD-APPROVALS-PLAN.md`; planning only, no UI implementation or new test evidence. The original recommendation follows.

Recommended: prepare the exact Dashboard/Approvals visual/file/test specification using current components, with RV-3 and aggregate-verification limitations explicitly carried forward. Alternative: finish the trusted-reply provenance design and implementation before the visual slice. Either can be selected with a clickable choice; this review itself implements neither.

Review validation: local source/docs/status inspection and documentation whitespace checks only. No new test/full-check/browser/service run. D-093 remains the latest implementation evidence; all staged blobs are preserved by this docs-only checkpoint.
