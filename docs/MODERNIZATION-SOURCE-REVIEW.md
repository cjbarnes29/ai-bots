# Modernization source review and reuse proposal

Date: 2026-11-15. Research round 2, under the owner's explicit ceiling of 20 read-only requests (4 searches and 16 reads). No package download, installation, production code change or service connection. Findings are a proposal under D-084, not an approved dependency manifest.

## NOT VERIFIED

No candidate was installed, compiled or browser-tested in this app. Published npm artifacts, full transitive dependency licenses, security advisories and bundle sizes were not audited. Branch reads used main; no immutable commit SHA was obtained. Versions below are package.json values in the inspected source, not proof of the latest published npm release or an approved version pin. Complete compatibility remains unverified. No further request is covered by this consumed research allowance.

## Local baseline compared

web/package.json: React/React DOM ^19.3.1, Vite ^8.3.5, Tailwind ^4.3.4, React Router ^7.18.5, TanStack Query ^5.105.3, TypeScript ^7.0.2. These are declared ranges; this review did not resolve every installed package version. web/tsconfig.json uses strict/noUncheckedIndexedAccess, bundler resolution and skipLibCheck=true. Existing local StatCard, StatusDot, Tabs, SplitPane, ChatTab and AssistantPanels already implement useful functionality.

The separately recorded current baseline passed 2,015 backend and 447 dashboard tests, both typechecks and dashboard build. It does not establish compatibility with uninstalled candidates. Existing main bundle: 999.91 kB; additional chat/canvas dependencies need production lazy-loading and bundle-delta measurement.

## Compatibility and adoption matrix

| Candidate | Evidence actually read | Fit and remaining concern | Proposed decision |
|---|---|---|---|
| shadcn/ui | [Vite setup](https://ui.shadcn.com/docs/installation/vite), [MIT license](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md) | Official guide includes an existing-project path. Individual component dependencies vary; exact component files not yet inspected | Use selected patterns; retain current primitives for the first UI slice. Do not run init or overwrite app configuration |
| shadcn-admin | [package.json](https://github.com/satnaing/shadcn-admin/blob/main/package.json), [header source](https://github.com/satnaing/shadcn-admin/blob/main/src/components/layout/header.tsx), [MIT license](https://github.com/satnaing/shadcn-admin/blob/main/LICENSE) | Source version 2.2.1 declares React 19, Tailwind 4 and Vite 8 ranges, but uses TanStack Router plus Clerk and many UI/state packages. Our app uses React Router and its own owner authorization | Layout reference only. No template-wide import or dependency/config merge |
| @assistant-ui/react | [ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/external-store), [package.json](https://github.com/assistant-ui/assistant-ui/blob/main/packages/react/package.json), [MIT license](https://github.com/assistant-ui/assistant-ui/blob/main/LICENSE) | Source version 0.15.36; peer ranges include React/DOM 18 or 19. ExternalStoreRuntime explicitly supports an existing TanStack Query/custom store and custom message conversion. Runtime/build behavior still untested | Good conditional candidate for a later isolated chat adapter; no immediate installation |
| @xyflow/react | [official quick start](https://reactflow.dev/learn), [package.json](https://github.com/xyflow/xyflow/blob/main/packages/react/package.json), [MIT license](https://github.com/xyflow/xyflow/blob/main/LICENSE), [issue 5734](https://github.com/xyflow/xyflow/issues/5734) | Source version 12.12.1 declares React/DOM >=17; this includes React 19 but is not a runtime guarantee. Open Vite 8/rolldown issue reports a problem on 12.10.1 | Hold production adoption until exact-version ESM build and browser smoke tests pass. Keep current editor |

### License evidence and handling

All four complete top-level license files were successfully read and identify MIT. Copyright notices: shadcn (2023), Sat Naing (2024), AgentbaseAI Inc. (2026), webkid GmbH (2019-2025). The texts permit modification/reuse subject to preserving the copyright and permission notice in copies or substantial portions and include an as-is warranty disclaimer.

This verifies the inspected top-level terms only, not every package, bundled asset, example or transitive dependency. If source is adapted, include the applicable full upstream notice with a provenance record for the exact files/revision. No upstream code or licensed asset is copied into production in this review. Do not infer permission for separately sold examples or third-party assets from a repository's top-level license.

## Important technical findings

### The admin template is not a drop-in shell

Its manifest declares TanStack Router, Clerk, Zustand, Axios and numerous Radix/form/table/chart packages. Importing its full package/configuration would introduce responsibilities unrelated to the selected layout. Its header also imports a cn helper, Separator and SidebarTrigger, so that file is not standalone.

Proposed adaptation: reproduce the approved shell structure using existing AppShell/nav.ts/WorkspaceTabs and local styling. Preserve seven headings, Assistant-first order, interface levels, approval counts, owner proof and current React Router routes. The first slice requires zero new runtime dependencies. This is a design/implementation judgment based on the inspected source, not an upstream guarantee.

### assistant-ui fits an adapter, with explicit feature limits

The external-store documentation makes the application the owner of messages and persistence; callbacks enable UI features. Proposed initial adapter: map existing conversation/message IDs and text into its message shape, retain TanStack Query/API hooks, and provide only the existing send operation. Leave editing, branching, regeneration and automatic tool execution unavailable until their behavior is separately designed.

The inspected package has dependencies including @assistant-ui/core/store/tap, assistant-cloud, assistant-stream, radix-ui, autosizing textarea, safe-content-frame, zod and Zustand. Presence of assistant-cloud in the dependency list does not prove a hosted service is required, nor prove that none is contacted. Offline/no-cloud behavior must be tested. Attachments, citations, project context and existing review cards need explicit adapter acceptance cases rather than assuming they work automatically.

### React Flow needs a Vite 8 production test, not a forced install

Issue 5734 is open in the fetched metadata (updated 2026-11-11). The author reports an ESM dynamic-require problem with Vite 8 and React Flow 12.10.1, attributed to Zustand 4 dependencies. The inspected 12.12.1 source still declares Zustand ^4.4.0 and also classcat and workspace @xyflow/system. That overlap is a reason to test, not proof the issue affects our exact app. Comments and the released package's resolved dependency tree were not read.

Use an isolated, explicitly approved dependency prototype with the existing Vite/React/TypeScript settings. Require successful production build AND loading/interacting with the built bundle: dev-server success alone is insufficient. Do not downgrade Vite, force peer installs, add broad dependency overrides or weaken type checks to make it pass. If it fails, keep and improve the existing editor while documenting the blocker.

## Stack Overflow: checked, not treated as authoritative compatibility evidence

Read the [react-flow question index](https://stackoverflow.com/questions/tagged/react-flow) and [Edges are not rendering](https://stackoverflow.com/questions/79525988/edges-are-not-rendering-in-my-reactflow-component). The latter is an older question using the legacy reactflow package; its community answer is not evidence that a current version works with this app. No community code was copied and no implementation decision depends on that answer. Confirm concrete integration details against official docs and tests. This was one discussion, not an exhaustive Stack Overflow survey.

## Exact reuse proposal: first slice

No source downloads or new dependencies are proposed for the immediate backend fix or first UI slice. The existing approved design can be implemented locally.

| Destination / existing module | Proposed work | Reuse decision |
|---|---|---|
| web/src/components/shell/AppShell.tsx and nav.ts | Approved shell spacing and grouping; preserve routes/levels/counts | Existing local components; admin header is reference only |
| web/src/components/ui/Stats.tsx and Tabs.tsx | Harmonize local cards, status presentation and tabs | Extend current components; no upstream copy needed |
| Existing Dashboard and approvals pages | Real attention/status data and links through existing hooks | Local implementation; preserve owner proof/approval semantics |
| Existing chat plus proposed components/chat/AssistantRuntimeAdapter.tsx | Later conditional display adapter | @assistant-ui/react candidate only; exact published pin/provenance pending |
| Existing WorkflowEditor plus proposed graph display adapter | Later conditional canvas with lossless WfGraph mapping | @xyflow/react candidate only; production compatibility gate pending |

The proposed new adapter path is not a new file created by this review. Before any upstream source copy or package installation, supply immutable SHA/published integrity, exact files/package pin, all necessary notices, resolved dependencies, owner approval and rollback instructions. Those unresolved fields mean this is not an installation-ready manifest.

## Recommended next plan and choices

1. Implement the already specified conservative workflow restart and descendant-retry fix with existing dependencies and fake-service crash tests. This does not depend on any UI library.
2. Apply shared execution assessment after that fix is verified.
3. Implement Dashboard/approvals using local components and the approved design, with zero new runtime dependencies initially.
4. Request a separately bounded source/artifact investigation and explicit dependency approval for an isolated assistant-ui prototype.
5. Evaluate the React Flow production prototype later; retain the current canvas until it passes.

Do not replace the backend or adopt an orchestration framework in these steps. Preserve the separate Guardian/security programme and supervised-only restriction.

## Request ledger

Approved: up to 20 read-only requests, consisting of 4 searches and 16 reads. Used: 20 attempts (no uncounted retry).

| # | Request | Outcome |
|---|---|---|
| 1 | Search: site:ui.shadcn.com docs installation vite Tailwind React | Search submitted; combined response did not supply a useful separately attributed result |
| 2 | Search: site:assistant-ui.com docs external store runtime React custom backend | Search submitted; combined response did not supply a useful separately attributed result |
| 3 | Search: site:github.com/xyflow/xyflow/issues React 19 peer dependencies | GitHub issue leads returned |
| 4 | Search: site:stackoverflow.com reactflow nodeTypes useMemo shadcn Vite alias | Search submitted; no useful Stack Overflow result in the combined response |
| 5 | raw.githubusercontent.com/shadcn-ui/ui/main/LICENSE.md | Read |
| 6 | raw.githubusercontent.com/satnaing/shadcn-admin/main/LICENSE | Read |
| 7 | raw.githubusercontent.com/assistant-ui/assistant-ui/main/LICENSE | ConnectTimeout; counted |
| 8 | raw.githubusercontent.com/xyflow/xyflow/main/LICENSE | Read |
| 9 | ui.shadcn.com/docs/installation/vite | Read |
| 10 | www.assistant-ui.com/docs/runtimes/custom/external-store | Read |
| 11 | reactflow.dev/learn | Read; no claim of reading all linked subpages |
| 12 | stackoverflow.com/search?q=reactflow+nodeTypes+useMemo | Cache miss; counted |
| 13 | raw.githubusercontent.com/satnaing/shadcn-admin/main/package.json | Read |
| 14 | raw.githubusercontent.com/assistant-ui/assistant-ui/main/packages/react/package.json | Read |
| 15 | raw.githubusercontent.com/xyflow/xyflow/main/packages/react/package.json | Read |
| 16 | github.com/assistant-ui/assistant-ui/blob/main/LICENSE | Read; bounded retry of failed license lookup |
| 17 | github.com/xyflow/xyflow/issues/5734 | Read metadata/body; comments not fetched |
| 18 | raw.githubusercontent.com/satnaing/shadcn-admin/main/src/components/layout/header.tsx | Read |
| 19 | stackoverflow.com/questions/tagged/react-flow | Read |
| 20 | stackoverflow.com/questions/79525988/edges-are-not-rendering-in-my-reactflow-component | Read |

Only documentation changed locally. No implementation tests were run for this research-only change. No commit, publication, installation or live database operation.
