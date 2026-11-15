# Workflow canvas plan (Phase 4 of the modernization plan)

Date: 2026-11-15. Status: **PLAN ONLY. Nothing installed, nothing implemented, no dependency approved.** Parent: `MODERNIZATION-INTEGRATION-PLAN.md` Phase 4; source facts: `MODERNIZATION-SOURCE-REVIEW.md`. Decision board entry D-108.

## NOT VERIFIED
- That `@xyflow/react` builds and runs with this app's Vite 8 / React / TypeScript settings (open upstream issue 5734, Zustand 4 dependency). Nothing has been installed or run.
- Touch/phone behavior, keyboard operation and screen-reader behavior of any candidate canvas.
- Whether the current editor's limits actually bother the owner. No owner feedback on the editor exists in the docs.

## What exists today (read from the code, 2026-11-15)
- `web/src/components/WorkflowEditor.tsx` (546 lines): drawing view and a phone-friendly list view over the SAME graph. Fixed canvas 1100x520, boxes 176x78, boxes dragged with pointer events, arrows drawn as SVG curves, a side panel for the selected box.
- Stored format (`web/src/api/types.ts`): `WfGraph = { nodes: WfNode[]; edges: WfEdge[] }`. Node types: trigger, bot_task, manager, integration, condition, checkpoint, set, end; each has id, label, x, y plus type-specific fields. Edge: id, from, to, when (always/true/false).
- The server validates the graph (`POST /api/workflows/validate`); saving, versions, runs, approvals and the outside-action gate are server-side and must not change.
- `WorkflowRunMap.tsx` (102 lines) shows run status per box.

## Goal and non-goals
Goal: an easier editor for larger workflows (pan, zoom, fit to screen, mini-map, clearer arrows) over the SAME stored graph.
Not goals: new node types, a second workflow engine, any change to execution, approvals, permissions or the saved format. A canvas draws and edits; it never runs a step or decides an approval.

## Decision for the owner first (clickable)
| Option | What it means | Cost / risk |
|---|---|---|
| A. Improve the current editor, no dependency | Add pan, zoom, fit-to-view, larger canvas and better arrows to the existing code | No new dependency or license; more code to maintain |
| B. Try React Flow in an isolated prototype | `@xyflow/react` (MIT) installed ONLY in a scratch copy of the project, tested, then a go/no-go | Needs the owner's dependency approval; Vite 8 compatibility unproven |
| C. Leave the editor as it is | Do nothing now | No change; limits remain |
Recommendation: **B as a scratch-only prototype with a clear stop rule, falling back to A if it fails.** Reason: the source review already found it fits the data model; A is the safe fallback and needs no approval.

## Steps if B is chosen (each ends in evidence, nothing is merged until step 6)
1. **Approval:** owner approves installing `@xyflow/react` in a SCRATCH COPY only (not this repo), and the exact package version.
2. **Prototype build:** in the scratch copy, production build with the existing Vite/React/TypeScript settings. Load the BUILT bundle in a test-owned browser and interact (dev-server success is not enough). Do not downgrade Vite, force peer installs, add overrides or weaken type checks. If it fails, stop and record the blocker; go to option A.
3. **Reversible adapter:** pure functions `graphToFlow(WfGraph)` and `flowToGraph(...)` that keep every field (id, x, y, type, label, every type-specific field, edge id and `when`). Unknown fields pass through untouched.
4. **Round-trip tests (no UI):** every saved example graph, plus generated graphs, must satisfy `flowToGraph(graphToFlow(g))` deep-equal to `g`. Include nodes with extra fields, empty graph, edges with true/false, and maximum-size graphs.
5. **Canvas component behind the existing editor:** same selected-node panel, same list view for phones, same validation call, same save/reopen/version/draft behavior. The Assistant's "draft is never saved by code" rule is kept.
6. **Acceptance:** existing workflow component tests, `workflowIntegration`, `workflow-verification`, redesign/levels/hub/modernization browser scripts, plus new cases: save/reopen, invalid-graph errors, drafts, version selection, run inspection, approval steps still wait and still refuse checkpoint bypass, keyboard-only editing, 44 px touch targets, reduced motion, six screen widths, no page overflow, bundle-size note.
7. **Go / no-go with evidence; then a separate approval to add the dependency to this repo.** Rollback: the existing editor still reads and writes the same saved format; remove the canvas component and the dependency.

## Steps if A is chosen (no approval needed beyond normal work)
1. Pan and zoom wrapper around the existing canvas; fit-to-view button; mini-map optional.
2. Arrow routing and selection clarity; keep 44 px targets and keyboard movement of boxes.
3. Same tests as step 6 above. No format change.

## Risks to watch
- Lossy mapping (a field dropped by the adapter) silently changes a saved workflow: the round-trip tests are the guard.
- A canvas that makes drag/drop faster could make it easier to wire an outside-action box wrongly; the server validation and the approval gate stay the only authority.
- Phone: keep the list view as the default on small screens.

## What this plan does NOT claim
No compatibility, performance or accessibility result. No dependency or external request is approved. Real owner feedback on the editor is absent.

## Prototype result (option B, run 2026-11-15, owner approved a SCRATCH-ONLY install)
Scope: `@xyflow/react` **12.12.1** (MIT) installed in a copy of `web/` outside this repository. This repository's `package.json`, lockfile and `node_modules` were NOT changed. Evidence and the prototype source: `docs/evidence/workflow-canvas-prototype/` (results.json plus `source/`).

| Gate | Result |
|---|---|
| Install | 20 packages (@xyflow/system 0.0.84, zustand 4.5.7, classcat, d3-drag/zoom/selection and related modules, use-sync-external-store); npm reported 0 vulnerabilities |
| Typecheck under the app's existing strict settings | Pass (Node types supplied in the scratch parent, as the repo root supplies them) |
| Vite 8 PRODUCTION build | **Pass.** Extra chunk 185.62 kB (60.22 kB gzip). Upstream issue 5734 did not block this build |
| Adapter round trip (graph to canvas and back) | 5/5: sample graph, empty, unknown fields and edge conditions, position-only change with no input mutation, 500 nodes in order |
| BUILT bundle in headless Edge | 11/12 after correcting two test-page artifacts (a wide debug JSON line and a favicon 404 from the tiny test server; both were mine, not the library's). Observed: boxes and arrows draw; dragging changes only x/y; drawing an arrow adds one edge with from/to/when; zoom changes the view and not the graph; mini-map and controls present; no console errors |
| **Real finding: phone touch targets** | At 390 px the view fits at scale 0.5, so 14 px connection handles render at **7 px**: fails the 44 px rule. The prototype does not solve this |

What this does and does not show: the library BUILDS and RUNS with this app's tooling, and a lossless adapter is feasible. It does NOT show integration with the real editor (server validation, save/reopen, versions, run map, approvals), phone touch use, screen reader, keyboard-only arrow creation, dark mode, reduced motion or large real graphs. Backspace deleted a selected box in the prototype; a real integration must route deletion through the existing validated editor.

Go / no-go (owner's): GO to a proper integration needs (1) a separate approval to add `@xyflow/react` 12.12.1 to this repo, (2) a design that keeps the existing list view as the phone default and enlarges or replaces the touch handles, (3) the acceptance list above. NO-GO falls back to option A. Nothing has been added to this repository.

## Option A built (2026-11-15, owner chose "Fall back to option A"; board D-110)
Changed only `web/src/components/WorkflowEditor.tsx` (presentation) and added `web/src/workflowCanvasZoom.test.tsx` (5 cases). No dependency, API, schema or saved-format change.
- Zoom out/in (60% to 150%, 10% steps), "Actual size", "Fit to window", all 44 px buttons, with a one-line note that zoom only changes how it looks.
- Drag the empty background with a mouse to move around; touch and keyboard use the drawing's own scrolling (the drawing is now keyboard-focusable and labelled).
- Box dragging is zoom-aware: saved x/y stay in actual-size units (tested: drag at 80% saves the same coordinates as at 100%).
- The drawing grows to hold boxes placed far out, never smaller than 1100x520.
- Arrows: the true/false label now has a white backing for readability; arrows touching the selected box are thicker. The list view and phone default are unchanged.
- Checks: new 5/5; existing workflow tests 19/19; full `npm run check` 2,322 backend + 520 dashboard, typechecks, build; browser scripts redesign 89/89 and modernization 34/34 (they open the editor but do not exercise zoom or pan).
- NOT observed: zoom/pan in a real browser with a mouse, on a phone, with a screen reader; no mini-map was added; no owner feedback. The 7 px handle problem found in the React Flow prototype does not apply (this editor keeps its own text buttons), but at zoom below 100% those buttons shrink visually: on a phone the list view stays the default.
