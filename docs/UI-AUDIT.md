# AI Workforce Studio: UI/UX, responsive design and integration audit

Status: **SUPERSEDED IN PART (2026-11-06): the redesign this audit planned has been built; see `docs/REDESIGN-PLAN.md` for what exists now. The text below is the original 2026-11-04 audit and is kept unchanged.** Original status: **AUDIT AND PLAN ONLY. Nothing has been implemented.** Written 2026-11-04 against commit `170544b` + uncommitted Gmail test-email work.
Method: read the dashboard source (`web/src`, 8.6k lines excluding tests), the backend route/feature list, `docs/PROGRESS.md` and `docs/PROVIDERS.md`.
NOT done: no screenshots were taken and no new viewport tests were run for this audit. Responsive findings below come from reading the code
(breakpoint usage, fixed pixel sizes, markup), so they are labelled "from code". The viewport matrix in section 12 is the plan to prove them.

Legend: **[DONE]** implemented and tested | **[PART]** partly implemented | **[NONE]** not implemented | **[EXT]** needs external setup by the owner | **[INV]** needs investigation

---

## 1. Current architecture and interface assessment

**Stack.** Backend: Fastify + `node:sqlite` + zod (`src/`). Dashboard: React 19, Vite, Tailwind 4, TanStack Query, React Router (`web/`). Only four
runtime dependencies in the web app, which is a strength: no component library, no canvas library, no icon set.

**Shape of the dashboard.** One top bar with 8 text links (Bots, Monitor, Tasks, Automation, Knowledge, Approvals, Usage, Settings), a permanent amber
banner, and a centred `max-w-6xl` column. 10 routes. `Settings.tsx` is 564 lines and `Automation.tsx` 647 lines: both are long single-page stacks of sections.

**Design system today** ([web/src/index.css](web/src/index.css), 47 lines): Tailwind utilities `btn`, `btn-primary`, `btn-secondary`, `btn-danger`, `card`, `label`, `hint`; shared
components `StatusBadge`, `FreeBadge`, `ConfirmDialog`, `ModelSelect`. Indigo accent. Dark mode follows the OS only (no in-app toggle). No icons, no logos, no
tooltips, no toast system, no skeleton/empty-state components (each page writes its own "Loading…" text). Two `Switch` and two `ErrorLine` components are
copy-pasted in `Settings.tsx` and `Automation.tsx`.

**Verdict.** Functionally rich and honestly labelled, but it is a *developer's control panel*, not a beginner's studio. The backend is far ahead of the front end.

## 2. Existing features and verified status

"Verified" = covered by automated tests in this repo (1012 backend / 185 dashboard tests pass). Nothing below has been verified against a real external
service unless stated. The Gemini and Gmail real-service checks are still waiting for the owner's key/Google client.

| Area | Status | Evidence / caveat |
|---|---|---|
| Bots (create, edit, versions, archive, chat, per-bot permissions) | **[DONE]** | `BotList`, `BotEditor` (tabs Details/Chat/Team/Versions/Permissions) |
| Teams / delegation (allow-list, loop check, depth 2, 3 teammates, cancel) | **[DONE]** backend, **[PART]** UI | UI is a single "Team" tab per bot; no team concept, templates or overview |
| Manager AI (plans, picks bots, fan-out) | **[DONE]** backend | `src/manager`, `ManagerPanel` |
| Workflows (visual editor, validation, persistent runs, checkpoints, recovery, triggers) | **[DONE]** | `WorkflowEditor.tsx`, `src/workflows`. See section 5 for gaps |
| Schedules, triggers, inbound events, kill switch | **[DONE]** | `Automation.tsx` |
| LLM providers: Gemini, Groq, OpenRouter, Ollama, OmniRoute | **[DONE]** code, **[EXT]** keys | One OpenAI-compatible adapter; free-only gate locked on. No real call made yet |
| Provider test + refresh models + enable/disable models | **[DONE]** | `ProviderCard`, `ModelsSection` |
| Provider OAuth sign-in | **[NONE]** | All providers are API-key based (correct for these free tiers) |
| Approval gate (reads gated per bot, writes always need approval) | **[DONE]** | `Approvals.tsx`, `src/approvals`. Strong, keep untouched |
| Gmail (search/read/send, OAuth PKCE, test email) | **[DONE]** vs fake Google, **[EXT]** Google client | No draft action |
| Google Workspace (Drive/Docs/Sheets read, Calendar, Tasks) | **[DONE]** vs fake, **[EXT]** | Read-oriented; no Sheets writes, no editing |
| GitHub, Notion, n8n, MCP | **[DONE]** vs fake, **[EXT]** tokens | `integrations.ts` |
| Telegram | **[DONE]** vs fake, **[EXT]** bot token | |
| Browser tools | **[DONE]** | SSRF-guarded fetcher |
| PC control (5 permissions, workspaces, command rules, emergency stop, log) | **[DONE]** | `PcSection`, `docs/PC-AGENT.md` |
| Remote/phone access (Tailscale hosts, pairing, device revoke, push alerts) | **[DONE]** code, **[EXT]** Tailscale | `DevicesSection`, `AlertsSection` |
| Memory / knowledge (private + shared notes, FTS search) | **[DONE]** | `Knowledge.tsx` |
| Documents (Word, PDF, Excel, CSV, PPTX, web page, SVG charts) | **[DONE]** | verified opening in real Office per PROGRESS.md |
| Usage meters and limits | **[DONE]** | `Usage.tsx`, `LimitsSection` |
| Microsoft services (Outlook/OneDrive/Teams) | **[NONE]** | |
| Generic REST/webhook *outbound* node | **[NONE]** | inbound events exist (`POST /api/events`); n8n connector exists |
| Image / audio / music / video generation | **[NONE]** | PROGRESS.md: "no free, verified service connected". Must stay honest |
| Global "AI Assistant" chat | **[NONE]** | chat exists only inside each bot |
| Landing dashboard / overview | **[NONE]** | `/` is the bot list. `Monitor` is the closest thing |
| Learning centre / tutorials / examples | **[NONE]** | |
| Workflow templates | **[NONE]** | `STARTER` graph only |
| AI workflow builder | **[PART]** | the Manager AI plans task trees, but nothing generates a workflow graph |
| In-app dark/light toggle, settings search, tooltips | **[NONE]** | |

## 3. Navigation and usability problems

1. **No home.** The first screen is the bot list; there is no "how is my workforce doing" view. (`Monitor` has attention items and counts but is buried as link 2.)
2. **Eight flat links, mixed vocabulary.** "Automation" holds schedules, triggers, test events, runs, limits **and workflows**. A beginner looking for "workflows" will not look under Automation.
3. **Settings is a 14-section scroll.** Safety, Keys, Gmail, Google Workspace, Devices, Alerts, Routing, Tools, PC, Skills, Providers, Models, Limits, Teamwork limits. Unrelated things sit together (phone pairing next to model limits) and there is no way to jump or search.
4. **Integrations are scattered:** Keys (vault) in one section, Gmail in another, Google Workspace in a third, GitHub/Notion/n8n/MCP secrets inside the Keys list, per-bot access in each bot's Permissions tab. There is no single "is Gmail working, and who can use it?" view.
5. **Duplicate concepts:** two "Limits" sections (LLM limits, Automation limits) plus "Teamwork limits"; two "Safety" sections (Settings and Automation); `Tasks` vs workflow runs vs automatic runs vs Monitor activity are four separate lists of "things that happened".
6. **Permanent amber banner** on every page uses vertical space and reads as a warning even when nothing is wrong. Better as a one-time explainer plus a status chip.
7. **Jargon:** "vault", "connector", "gate", "refresh models", "checkpoint", "circuit breaker", "args". Needs plain wording and tooltips.
8. **Approvals** is a good page, but the pending count is only a text suffix in the nav; there is no attention indicator elsewhere.
9. **Mobile nav:** the 8 links just wrap to extra rows (`flex-wrap`), pushing content down. (from code)
10. **Responsiveness is thin:** only 15 uses of `sm:/md:/lg:` across the whole app (from code). Earlier real-browser checks at 375px caught and fixed overflow bugs, so it is usable, but it is "squeezed desktop", not designed for touch.

## 4. Dashboard proposal

**New `/` Dashboard (new page, reuses existing endpoints; no backend change needed except possibly one aggregate read).** Cards, top to bottom on mobile, 3-4 columns on desktop:

| Card | Data source today | Status |
|---|---|---|
| Needs attention (pending approvals, failed runs, warnings, paused switches) | `/api/external/status`, `/api/monitor` | **[PART]** `Monitor.tsx` already computes "attention" |
| Agents & teams (count, active, idle) | `/api/bots`, delegation | **[DONE]** data exists |
| Workflows (running / completed / failed, last 24h) | `/api/workflows/runs` | **[DONE]** data exists |
| Tasks in progress | `/api/tasks` | **[DONE]** |
| AI providers (connected N of M, default model, last verified) | `/api/llm/providers`, `/api/llm/status` | **[PART]** "last verified" must be recorded (see 8) |
| Integrations health (connected / needs reconnect) | `/api/external/status`, `/api/gmail/status`, `/api/gworkspace/status`, vault | **[PART]** no single status endpoint |
| Today's usage vs free limits | `/api/llm/usage` | **[DONE]** |
| Recent activity feed (last 10 events) | `/api/audit`, monitor | **[DONE]** |
| Quick actions: Ask the assistant, New agent, New workflow, Run a task | n/a | **[NONE]** |
| System health strip (emergency stop state, pause switches, backup age) | existing | **[PART]** |

Rules: at most ~8 cards above the fold, one headline number each, a colour + word status (never colour alone), a "see all" link per card. Technical detail stays one click away.

## 5. Workflow Studio proposal (n8n-inspired)

**What exists** ([WorkflowEditor.tsx](web/src/components/WorkflowEditor.tsx), `src/workflows`):
- Drag boxes on a fixed 1100×520 canvas via pointer events **[DONE]**; arrows drawn by "Arrow from here / Arrow to here" buttons (no drag-to-connect) **[PART]**
- Node types: Start(trigger), Bot task, Manager, If, Checkpoint, Set text, End **[DONE]**. Limits: 25 nodes, 60 edges; up to 2 branches run in parallel **[DONE]**
- Live server-side validation (loops, missing Start, unconnected boxes) **[DONE]**; versions; created OFF; persistent runs with recovery; triggers; recent-runs list **[DONE]**
- Editor is embedded inside the Automation page, with a 360px-high scroll area. No zoom, no pan other than scrolling, no minimap, no undo, no multi-select **[NONE]**

**Gaps against the request:**

| Requested | Status |
|---|---|
| Searchable node library | **[NONE]** (7 fixed "Add a box" buttons) |
| LLM-model node | **[NONE]** (model is chosen on the bot; a node that calls a model directly would be new backend work **[INV]**) |
| Tool / integration nodes (Gmail, Drive, GitHub…) | **[NONE]** in workflows. Integrations are only reachable through a bot's reply. Adding a node type that calls `ActionGate.request` keeps the approval gate **[INV]** |
| HTTP / webhook / REST node | **[NONE]**. Must go through a new gated connector; SSRF guard exists in the browser connector and could be reused **[INV]** |
| Conditions / branching | **[DONE]** (If with true/false) |
| Sequential + parallel | **[DONE]** (parallel capped at 2 by design) |
| Test a single node / dry-run, pinned sample data | **[NONE]**; whole-workflow "Run" exists |
| Execution monitoring on the canvas (node colours live) | **[PART]**: run list and step results exist; not painted on the graph |
| Execution history | **[DONE]** list, **[PART]** no per-run replay view |
| Templates | **[NONE]** |
| AI workflow builder | **[NONE]**; feasible by asking the Manager/LLM for a *graph JSON* and validating it with the existing `graph.ts` zod schema + validator. Created OFF, never auto-enabled |

**Proposal.**
- Own page `/workflows` (move out of Automation). Three panes on desktop: node library (search) | canvas | inspector. Bottom drawer: test run + execution log.
- **Do not add a canvas library.** The current hand-rolled SVG + pointer approach works and keeps the dependency count at four. Add: drag from an output handle to an input handle, zoom/pan with transform, fit-to-view, grid snap, delete, undo/redo (state history), keyboard shortcuts. Revisit a library (e.g. React Flow) only if these prove too costly **[INV]**.
- New node families in phases: *Ask an agent* (exists), *Ask the Manager* (exists), *Condition* (exists), *Use an integration* (gated), *Wait for approval* (exists as Checkpoint, rename), *Set / format text* (exists). Defer *Call a model directly* and *HTTP request* until the gate design is agreed.
- Templates: 5-8 JSON graphs shipped in the repo (e.g. "Daily email digest to me", "Research then summarise", "Review before sending"), each validated by the existing validator and created OFF.
- **Mobile editor (do not shrink the canvas):** default to a *Steps view*: a vertical list of nodes in execution order with branches shown as indented "If yes / If no" groups; tap a step to open a full-screen bottom sheet for configuration; "Add step" inserts after the selected step; Run / Stop / Test pinned in a bottom bar. A read-only pinch-zoom/pan canvas ("Map") is a secondary tab for seeing connections. Editing connections on mobile is done with "Next step" pickers, not dragging.

## 6. Agents & Teams proposal

Today: bots are created on `/` with a small form, edited in 5 tabs (DetailsTab is 368 lines). Teams are per-bot allow-lists.

| Request | Status | Proposal |
|---|---|---|
| Creation wizard | **[NONE]** | 4 steps: purpose + name → instructions (with examples) → model (recommended default shown) → what it may use (all OFF by default). Reuse `ModelSelect`, existing create endpoint |
| Role / instructions / model / tools / permissions | **[DONE]** | Re-lay out, don't rebuild |
| Memory & context settings | **[DONE]** (Stage 8, per-bot switches) | Surface in the wizard and on a summary |
| Test an agent | **[PART]** | Chat tab exists; add a "Test" button with a canned prompt and visible result |
| Enable / disable | **[PART]** archive exists; no pause-this-agent toggle **[INV]** |
| Activity & execution history per agent | **[PART]** | Tasks filtered by bot; add as a tab |
| Manager coordination, delegation, parallel, bounded retries | **[DONE]** backend | Keep limits as they are |
| Reuse existing agents before creating new | **[PART]** | The Manager only plans with existing allowed teammates; "suggest creating an agent" flow is **[NONE]** and must still require owner approval |
| Team templates, team overview page | **[NONE]** | A "Team" = a named manager + allowed members; mostly a UI grouping over `bot_delegation_targets` **[INV]** whether a stored team entity is needed |
| Output validation | **[PART]** | Checkpoint/If nodes exist; no dedicated validator step |

## 7. Settings redesign

Split `Settings.tsx` into a left-nav (desktop) / list-then-detail (mobile) layout with a global search box. Mapping of the existing 14 sections:

| New category | Takes over (existing component) |
|---|---|
| General | new: theme toggle (light/dark/system), startup page; "About" |
| AI Models | `ProvidersSection`, `ModelsSection`, `RoutingSection`, LLM `LimitsSection` |
| Integrations | → becomes the Integrations Center (section 9); `SecretsSection`, `GmailSection`, `GoogleWorkspaceSection`, `ToolsSection` |
| Agents & Permissions | `SkillsSection`, defaults for new agents |
| Workflow Settings | Automation `LimitsSection`, `DelegationLimitsSection`, retries |
| PC & Remote Access | `PcSection`, `DevicesSection` |
| Security | `SecretsSection` (vault), Safety switches, pairing, audit export |
| Notifications | `AlertsSection` |
| Advanced | limits "reset to approved defaults", raw routing options, backup |

Requirements mapping: searchable **[NONE]**, descriptions **[PART]** (most sections have text), defaults **[DONE]**, status chips **[PART]**, contextual help **[NONE]**. This is mostly *moving* existing components, so risk is low and tests mostly carry over (route and heading names change).

## 8. LLM connection and verification

**Today ([Settings.tsx](web/src/pages/Settings.tsx) `ProviderCard`):** per-provider card with status badge, free-policy label, "Test connection", "Refresh models", model list with enable switches. Keys are saved through the vault section, which is a *separate* place from the card. Backend: `POST /api/llm/providers/:id/test`, `/refresh-models`.

**Gaps:**
- Key entry is not inside the provider card **[NONE]** → add "Paste key → Save → Test → Fetch models → Pick default" as one guided flow reusing vault PUT + test + refresh endpoints. Combining steps is front-end only.
- "Last successful verification" timestamp **[INV]**: check whether the provider record stores it; if not, a small column/field is needed (that is a schema change; needs your approval).
- Usage per provider **[DONE]** (Usage page) → show inside the card.
- Logos **[NONE]**: use text monograms, not third-party logo files (licensing + no new assets).
- OAuth for LLM providers **[NONE]** and not recommended: the configured free providers use keys.
- Honest status: keep today's rule that "Connected" only follows a successful test call; show "Not tested" for a saved but untested key.
- **Real calls are still unverified** (waiting on `GEMINI_API_KEY`).

## 9. Unified Integrations Center

New page `/integrations`: a catalog grid (card per service: name, monogram, status chip, one-line purpose) → detail drawer.

**Shared framework already exists and should be the foundation:** `ConnectorDefinition` (`src/connectors/types.ts`) with `secrets`, `notReady()`, typed `actions` marked read/write; the `ConnectorRegistry`; the vault; the `ActionGate`; the shared Google OAuth (`registerGoogleOAuthRoutes`); `/api/external/status`. Do **not** add a second connection system.

| Service | Status |
|---|---|
| Gmail | **[DONE]** code · **[EXT]** Google client · no drafts |
| Google Drive / Docs / Sheets / Calendar / Tasks | **[DONE]** vs fake · **[EXT]** same Google client; Sheets write **[NONE]** |
| Microsoft (Outlook, OneDrive, Teams) | **[NONE]**; would be a new connector using the same OAuth pattern **[INV]** |
| REST API / webhook (outbound) | **[NONE]**; inbound events **[DONE]** |
| MCP servers | **[DONE]** connector |
| n8n / automation platforms | **[DONE]** n8n connector |
| GitHub, Notion, Telegram | **[DONE]** · **[EXT]** tokens |
| Browser tools, PC tools | **[DONE]** |
| Image / audio / music / video generation | **[NONE]**, **[EXT]** free verified service needed; keep "not connected" honest |

**Per-integration detail panel** (all backed by existing data except where marked):
status ✔ · Connect / Reconnect / Disconnect (**[PART]**: disconnect today = delete vault secret manually, needs a button) · Test connection (**[NONE]** generic; needs a per-connector `test` action or a read-only ping **[INV]**) · capabilities list = the connector's `actions` with read/write badges (**[DONE]** data) · permission overview = scopes (**[DONE]** for Google) · authorised agents = reverse view of `bot_permissions`/`integration_access` (**[PART]**) · last verified (**[NONE]**) · token-expiry warning (**[PART]**: "Testing" mode Google tokens expire in about 7 days; the error message exists, a proactive warning does not) · troubleshooting text (**[NONE]**, content to write).

## 10. Agent access, autonomy and approvals

**Already enforced in code (preserve exactly):**
- Reads are off by default per bot (`bot_permissions`, `integration_access`); each connector read needs the owner's per-bot switch **[DONE]**.
- Every **write** to an outside service waits for the owner and executes once; `write_policy` locked to `approval_required` in the database **[DONE]**.
- Args-hash check, expiry, kill switch, rate limits, secret redaction **[DONE]**.
- PC actions: five separate permissions, workspaces, command rules, emergency stop **[DONE]**.
- Phone cannot change permissions or start OAuth (owner-only route list in `src/remote/access.ts`) **[DONE]**.

**Maps to the owner's approval list:**

| Needs approval | Status |
|---|---|
| Sending emails/messages | **[DONE]** |
| Publishing / deploying | **[DONE]** where a write connector exists (GitHub, Notion, n8n); no deploy connector |
| Destructive file/system operations | **[DONE]** PC rules |
| Changing permissions | **[PART]**: changes are owner-only and audited; they are not "approvals" and a bot cannot change them at all (stronger) |
| Paid APIs / purchases | **[DONE]** by design: free-only gate has no off switch |
| Disclosing confidential info | **[INV]**: no content classifier exists; outbound writes are reviewed by the owner but nothing detects "confidential" |

**UI proposal:** one **Access matrix** (rows = agents, columns = integrations/capabilities; cells: Off / Read / Ask-first). A permanent legend with three words used everywhere: **Automatic** (internal, safe reads you switched on), **Ask first** (shows in Approvals), **Never** (blocked). Role presets (Research, Email, Media, Manager) are just pre-filled switch sets, applied only with the owner's click. Connecting a service never grants anything by itself (matches today's behaviour).

## 11. Desktop, tablet, mobile improvements (from code)

- Replace the top bar with a **persistent left sidebar** (≥1024px), **icon rail** (768-1023px), **bottom tab bar + "More" sheet** (<768px). Needs small inline-SVG icons (no icon library).
- Cards: `grid` with `auto-fit minmax` so dashboards reflow without per-breakpoint rules.
- Touch targets: `btn` is `py-2 text-sm` ≈ 36px high; raise to ≥44px on touch (`pointer: coarse`). Switches need the same.
- Dialogs: `ConfirmDialog` should become a bottom sheet on mobile.
- Tables/lists (Usage by-day, approvals args) must wrap or become cards; check for horizontal scroll at 360px.
- Workflow editor: the fixed 1100×520 canvas and 360px viewport is the main non-responsive element; see section 5.
- Safe-area insets and `viewport-fit=cover` for the installed phone app (PWA exists: manifest + service worker **[DONE]**).
- Theme: add system/light/dark toggle stored in `localStorage`; nothing else changes.

## 12. Responsive testing plan

Real-browser tests already run through `playwright-core` + Edge against a fake provider (scripts live in the session scratchpad; earlier runs covered 375px). Plan:
- Matrix: 1920×1080, 1366×768, 768×1024 (portrait) and 1024×768 (landscape), 390×844, 360×800, plus 844×390 landscape phone.
- Pages per size: Dashboard, Agents list + wizard, Agent editor, Workflow (steps view + canvas), Integrations (catalog + detail), Settings (nav + search), Approvals, Activity/Logs, Learning, each dialog.
- Assertions per page: no horizontal scrollbar (`scrollWidth ≤ clientWidth`), no element clipped outside the viewport, every button ≥44×44 on touch sizes, focus visible, heading order, text contrast in both themes, keyboard-only pass for nav + dialogs.
- Keep the existing jsdom suite (185 tests) green at each phase; add a Playwright smoke script kept in `scripts/` (no new dependency: `playwright-core` is already a dev dependency).
- Screenshots saved to a scratch folder for your review, not committed.

## 13. Components and systems worth preserving

Backend (do not rewrite): `LlmService` + provider plugins + free-only gate; `ActionGate`/approvals/audit; `ConnectorRegistry` + vault (AES-256-GCM) + redaction; delegation engine; workflow engine/graph validator; automation scheduler; PC policy engine; memory service; remote access + pairing; migrations and backup.
Front end: `api/client.ts` (client header + friendly errors), `api/hooks.ts` (859 lines of tested hooks), `api/types.ts`, `StatusBadge`, `FreeBadge`, `ConfirmDialog`, `ModelSelect`, `PermissionsTab`, `Approvals`, `Knowledge`, `Usage`, `Monitor` stat blocks, `WorkflowEditor` drag logic, `test/fakeApi.ts` (the whole test harness). Keep the PWA shell and service-worker rule that `/api/` is never cached.
**Do not weaken:** the owner-only route list, the dashboard client header, redaction of keys, and "writes always wait for approval".

## 14. Files likely to change

New: `web/src/components/shell/{Sidebar,BottomNav,PageHeader}.tsx`, `pages/Dashboard.tsx`, `pages/Workflows.tsx`, `pages/Agents.tsx`, `pages/Integrations.tsx`, `pages/Assistant.tsx`, `pages/Learning.tsx`, `pages/settings/*`, shared `ui/{Switch,ErrorLine,Sheet,EmptyState,Tooltip,Icon}.tsx`, workflow `StepsView.tsx` / `NodeLibrary.tsx` / `Inspector.tsx`, `lib/theme.ts`, `docs/UI-AUDIT.md` (this file).
Edited: [web/src/App.tsx](web/src/App.tsx) (layout and routes), [web/src/index.css](web/src/index.css) (tokens), [web/src/pages/Settings.tsx](web/src/pages/Settings.tsx) (split), [web/src/pages/Automation.tsx](web/src/pages/Automation.tsx) (workflows moved out), [web/src/components/WorkflowEditor.tsx](web/src/components/WorkflowEditor.tsx), `BotList`/`BotEditor`/`DetailsTab`, `web/src/api/hooks.ts` (few additions), `fakeApi.ts` and tests.
Backend (small, only if approved): one aggregate `GET /api/overview`; connector `test` action + "last verified" storage (**schema change**); workflow "integration step" node and graph schema; `POST /api/workflows/generate` (AI builder, validated by existing zod). Everything else is front-end only.

## 15. Technical risks and dependencies

- **Test churn:** moving headings/routes breaks many jsdom tests; budget time to update them, never delete coverage.
- **Canvas scope creep:** a polished n8n-like editor is the biggest effort. Mitigation: ship Steps view + improved canvas first; evaluate a library later.
- **Gate integrity:** an integration node in workflows must call `ActionGate.request` and inherit per-bot read switches and approval waits. A shortcut here is the one real security risk.
- **Honesty risk:** logos, "one-click" wording and "Connected" badges must not claim more than a real test proved. Nothing here has been proved against a real Google/Gemini/Telegram yet.
- **Owner-only routes:** every new mutating route must be added to the remote-access owner-only list.
- **Schema changes** (last-verified, teams) need explicit approval; migrations are append-only.
- **Single-user, local-first assumption** holds; multi-user "departments" are out of scope and would need an auth model **[INV]**.
- **Dependencies:** none required. Optional later: a canvas library, an icon set (both avoidable).
- **External prerequisites:** Gemini key, Google Cloud client, Telegram token, Tailscale; the UI can be built without them but "verified" claims can't.

## 16. Recommended implementation phases (each ends with `npm run check` and a browser pass)

1. **Shell and design tokens** [front-end only]: sidebar / rail / bottom nav, theme toggle, shared `Switch`/`ErrorLine`/`Sheet`/`EmptyState`, 44px touch targets. Keep every existing route working.
2. **Dashboard + Activity page** [mostly front-end]: cards from existing endpoints; fold Monitor/Tasks/runs into one Activity & Logs with filters.
3. **Settings split + search** [front-end]: nine categories; no behaviour change.
4. **Integrations Center + AI Models flow** [front-end + small backend if approved]: catalog, detail drawer, guided key → test → models → default; Disconnect buttons; access matrix.
5. **Agents & Teams**: wizard, activity tab, test button, enable/disable, team view and templates.
6. **Workflow Studio v2**: own page, node library with search, handle-drag connections, zoom/pan, undo, templates, live run colouring, **mobile Steps view**.
7. **Workflow integration nodes + AI builder** [backend, needs approval of design]: gated integration node, graph generator that returns validated JSON, created OFF.
8. **Learning Center and AI Assistant**: guided tours, example workflows; global assistant chat (reuses chat service with a default "assistant" bot).
9. **Responsive/accessibility hardening**: full viewport matrix, keyboard and contrast pass, fix findings.

Suggested first step for approval: **Phases 1-3** (no backend change, no new dependency, no external services).

---

### What I need from you before any implementation
1. Approve the navigation (section 2 of your brief) as written, or tell me what to merge. My only suggestion: fold **Approvals** badge into the sidebar and put **Usage** under Settings > AI Models.
2. Approve starting with Phases 1-3.
3. Decide on the open items marked **[INV]**: whether to add a stored "Team" entity, a "last verified" column (schema change), and a generic connector `test` action.

---

## 17. Implementation log: Phases 1-3 (approved 2026-11-04) and findings on the deferred decisions

**Status: Phases 1, 2 and 3 are IMPLEMENTED and tested. Phases 4-9 have NOT been started; they wait for the owner's review.** No backend code, API, database schema, dependency or approval rule was changed.

Owner adjustments applied: Approvals badge on the sidebar item; Usage moved under Settings > AI Models; Workflow Studio is a top-level item; Integrations Center is the central connection area.

### What was built
- **Phase 1, shell:** one `<nav aria-label="Main">` drawn three ways by CSS: phone bottom bar (4 main places + a "More" sheet), tablet icon rail, desktop sidebar. Nine places: Dashboard, Agents & Teams, Workflow Studio, Approvals (badge), Integrations Center, Schedules, PC Control Center, Activity & Logs, Settings. Section tabs: Agents | Knowledge, Overview | Tasks. In-app theme (follow device / light / dark, kept in this browser only). The permanent safety banner is now dismissible. `/` is the Dashboard, the bot list moved to `/agents`, `/usage` redirects to Settings > AI Models. Workflows moved out of Automation into `/workflows`. Gmail/Google/Keys moved to `/integrations`; PC and Phones to `/pc`.
- **Phase 2, Dashboard:** needs-attention list, eight stat cards (each links to its page), get-started checklist, quick actions, system health (dot + word), recent activity. Built only from existing endpoints (`/api/monitor/overview`, `/api/llm/providers`, `/api/external/status`, `/api/workflows`). A provider counts as connected only when its stored test status is "connected". "Active teams" is NOT shown (no team entity; see below).
- **Phase 3, Settings:** nine categories at `/settings/:category` with a search box over a fixed index of settings; two-column on desktop, list-then-detail on phones. Existing panels were moved, not rewritten.
- **Not built (kept out of scope, no dead links):** AI Assistant page and Learning Center (Phase 8).

### Deferred decision 1: stored Team entity: DEFER (reuse what exists)
Investigated: there is no `teams` table. Delegation is a per-agent allow-list (`bot_delegation_targets`) with its own audit and limits (`src/delegation`), and the Manager (`src/manager`) plans over allowed teammates. A "team" is therefore *derived*: an agent that has at least one allowed teammate, plus those teammates. Recommendation: build the Agents & Teams "teams" view by reading `GET /api/bots/:id/team` (already exists) or one new read-only aggregate route later. No table, no duplicate.

### Deferred decision 2: "last verified" column: DEFER (no migration needed so far)
Investigated: **providers already store it**: `llm_providers.last_status` and `last_checked_at` (shown today as `lastCheckedAt` in the providers API; the Dashboard now shows the newest one among connected providers). **Connectors** have no stored verification time, but `audit_events` (append-only, no pruning code found) records `gmail.connected`, `gworkspace.connected`, `external.read` (with ok true/false) and `approval.executed` / `approval.failed` with timestamps. A read-only query over those gives "last successful use" per connector without any migration. Caveat: that is last *use*, not a deliberate *test*; honest wording must say "Last used successfully", not "Verified". A true verification time needs the interface below plus recording its result in the audit log (still no schema change).

### Deferred decision 3: proposed reusable connector verification interface (NOT implemented)
```ts
// src/connectors/types.ts: one optional member on ConnectorDefinition
interface ConnectorDefinition {
  // ...existing fields...
  /** A harmless check that the saved credentials really work. Read-only, no side effects, no paid call, no message sent. */
  verify?: (ctx: { secret: (name: string) => string | null }) => Promise<VerifyResult>;
}
type VerifyResult =
  | { ok: true; summary: string; account?: string; capabilities?: string[] }   // e.g. "Signed in as me@gmail.com"
  | { ok: false; reason: "not_configured" | "auth_rejected" | "expired" | "unreachable" | "insufficient_permission"; message: string };
```
- Route: `POST /api/integrations/:id/verify` (owner-only, listed in `src/remote/access.ts`), runs with a 15 s timeout, redacts secrets, writes `integration.verified` / `integration.verify_failed` to the audit log, returns the result. The UI shows "Connected" only after `ok: true`.
- Per-connector implementations (all read-only): Gmail `GET users/me/profile` (already used by the test-email route); Google Workspace Drive `about?fields=user`; GitHub `GET /user`; Notion `GET /users/me`; n8n a read-only workflow list; Telegram `getMe`; MCP an `initialize` + `tools/list` handshake; browser/memory/PC/documents `ok` from local state. Connectors without `verify` show "Not testable" instead of a guess.
- Reuses what exists (token source, `googleFetch`, redaction, audit). Fits the Integrations Center catalog (Phase 4). Needs the owner's approval before coding.

### Test results at the end of Phase 3
See the report in the conversation; the final counts are recorded in `docs/PROGRESS.md` (Stage 9).
