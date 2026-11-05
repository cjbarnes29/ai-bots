# AI Workforce Studio redesign: inspection and implementation plan

Status: **APPROVED 2026-11-06 (D-075). Phases 1 (e56f27d) and 2 (91e3100) committed; phase 3 built; phases 4-6 not built.** The owner later approved all remaining phases, commits included, within the stated approval boundaries. Written from the code in `web/src` at commit `a43b685`. Not a screenshot audit; no browser was opened for this plan. Requires the owner's approval before any build (see "Decisions needed").

## 1. What exists today (from the code)

- **Stack:** React 19, Vite, Tailwind 4, TanStack Query, React Router. Four runtime dependencies; no component library, no animation library, no icon set beyond `Icon.tsx`.
- **Shell (`components/shell/AppShell.tsx`, `nav.ts`):** already responsive in three shapes: phone bottom bar + "More" sheet (< 768 px), tablet icon rail (768-1023 px), desktop sidebar (>= 1024 px). One flat list of **17 navigation entries**; content is one centred `max-w-6xl` column.
- **Design system (`index.css`, 47 lines):** `btn`, `btn-primary/secondary/danger`, `card`, `label`, `hint`. Indigo accent, dark mode follows OS/theme setting. `Switch` and `ErrorLine` are copy-pasted in several pages.
- **Pages:** 27 page files (5,866 lines). Long single-stack pages: `Automation` 645, `ProviderWizard` 581, `Settings` 541. Settings already has a category layout (`pages/settings/`).
- **Workflow editor (`WorkflowEditor.tsx`, 368 lines):** already a drag-box and SVG-arrow editor with a side panel. No execution animation.
- **Motion:** almost none (a few `transition-colors`). **No `prefers-reduced-motion` handling anywhere.**
- **Tests:** 34 dashboard test files, 339 tests; many assert on text, roles and routes, so route paths and labels are a compatibility surface.

## 2. Mapping the brief's nine sections to what exists

| Brief section | Existing pages / routes | Status |
|---|---|---|
| A Dashboard | `/` Dashboard (304 lines) | Exists; becomes the overview-only page |
| B AI Agents | `/agents`, `/bots/:id`, `/studio`, `/groups`, `/workforce`; agent knowledge in `/knowledge` | Rich backend; UI is split over several flat pages |
| C Workflows | `/workflows`, `/automation` (schedules/triggers), `/decisions` | Editor exists. Templates: only a starter graph. |
| D AI Models | Settings > AI Models, `/usage`, routing, model registry, provider wizard | Backend complete; UI buried in Settings |
| E Apps & Integrations | `/integrations*`, `/pc`, `/access`, `/business`, MCP/webhook parts of Settings | Backend complete (fake-tested); real services mostly NOT verified |
| F Creative Studio | **Nothing** | **No backend.** No video, image, audio or music service is connected (the board and `docs/PROGRESS.md` say so; no FFmpeg on this PC). |
| G Knowledge Center | `/knowledge`, documents, project workspace | Exists |
| H Monitoring | `/monitor`, `/tasks*`, `/approvals`, `/inbox` | Exists |
| I Settings | `/settings/*` | Exists |

**Honest limit:** the brief asks for video editing, image generation, audio and music. The backend supports none of them, and the brief itself says not to invent functionality. Creative Studio can be built as a real workspace shell with only the parts that work today (document/file creation, content drafting by agents, YouTube package planning if present) and clearly labelled "not connected" cards for the rest. It cannot have a working editor.

## 3. Proposed structure (no route removed)

Primary navigation shrinks from 17 flat entries to 9 sections. Each section has a secondary tab bar listing its existing pages, so every current route keeps working and every current test can still find its page.

| Section | Tabs (existing routes) |
|---|---|
| Dashboard | `/` |
| AI Agents | Agents `/agents`, Studio `/studio`, Teams/Groups `/groups`, Workforce `/workforce`, (agent detail `/bots/:id`) |
| Workflows | Editor `/workflows`, Schedules `/automation`, Decisions `/decisions`, Projects `/projects` |
| AI Models | Providers/Models, Routing, Usage (today under `/settings/ai-models`; the section links there first, no duplicate page) |
| Apps & Integrations | Integrations `/integrations`, PC Control `/pc`, Access `/access`, Business `/business` |
| Creative Studio | New: honest workspace (section 2) |
| Knowledge Center | `/knowledge`, project files |
| Monitoring | Activity `/monitor`, Tasks `/tasks`, Approvals `/approvals`, Inbox `/inbox` |
| Settings | `/settings/*` (unchanged) |

Approvals keeps its waiting-count badge and a Dashboard card. Inbox and Approvals stay one tap from the phone bar.

## 4. Design-system work (shared first, pages second)

New reusable pieces in `web/src/components/ui/`, all plain React + Tailwind, **no new dependency**:
`Card` (variants: stat, entity, panel), `Panel` (expandable), `SectionTabs` (exists; extend), `Breadcrumbs`, `Modal` (reuse the focus trap from `MoreSheet`), `Drawer`, `Dropdown`, `Toast`, `Skeleton`, `StatusDot`, `ResponsiveGrid`, `SplitPane` (resizable by pointer and keyboard).

Motion lives in `index.css` as CSS only: tokens for the durations in the brief (120-200 ms micro, 150-250 hover, 200-300 panel, 250-400 workspace), one easing curve, `transform`/`opacity` only, and a single `@media (prefers-reduced-motion: reduce)` block that turns them off. A test pins that the block exists. Workflow execution animation = CSS dash-offset on SVG edges while a run is live; no continuous animation when idle.

"Preserve open workspaces as tabs": a small tab strip holding recently opened pages per section, stored in `sessionStorage` (UI state only; no database, no migration). Real multi-window popups are not planned; the brief says only where they genuinely help.

## 5. Phases (each ends with `npm run check`, a viewport check, and your review before any commit)

1. **Foundation:** tokens, motion rules + reduced-motion, ui components with tests, the 9-section navigation and secondary tabs, breadcrumbs. Pages unchanged inside.
2. **Dashboard + Monitoring:** overview cards linking into sections (only data the API already returns).
3. **Agents + Models + Integrations:** card layouts, detail workspaces, split panes. The model hub is a view over existing Settings/AI Models components, not a copy.
4. **Workflows:** execution-path animation, node status transitions, a simplified mobile list/edit mode (the drag editor stays desktop/tablet).
5. **Knowledge + Settings polish, Creative Studio shell.**
6. **Cross-cutting:** phone/tablet/desktop pass at 360, 390, 768, 1024, 1366, 1920 px with a real-browser script (the repo has Playwright and the workspace e2e as a pattern), keyboard and contrast pass, docs.

Each phase is a separate commit you approve. Phase 1 is the riskiest for tests because it touches navigation; routes and visible labels will be kept so existing tests keep passing, and any label change is listed for you first.

## 6. Constraints that stay (CLAUDE.md)

No backend change unless a card needs data the API lacks (then listed for approval); no new dependency; no migration; the approval gate, owner-only rules and honest "not verified" labels are untouched; nothing is committed, pushed or published without your approval; real-browser checks use the app with a fake model only.

## 7. Decisions needed from the owner

1. **Creative Studio:** build the honest shell (recommended), or defer the section until a creative service is approved?
2. **Navigation:** group the 17 entries into 9 sections with tabs (recommended), keeping every route.
3. **Tabs of open workspaces:** session-only (recommended, no storage) or remembered across restarts?
4. **Order and size:** one phase at a time with a review after each (recommended).
5. **Mobile workflow editing:** simplified list/step editor on phones (recommended) rather than the drag canvas.
