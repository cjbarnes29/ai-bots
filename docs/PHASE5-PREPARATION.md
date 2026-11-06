# Phase 5 preparation (2026-11-06). **STATUS: the owner approved the recommendations ('approve all') and the work was built as 'Interface levels' (D-079). See section 8.**

Facts, assumptions and recommendations are separated. Nothing in this file has been built.

## 1. Where "Phase 5" comes from (fact)
- The only statement of this requirement is the owner's brief of 2026-11-06, section **F. Progressive Disclosure**: "Do not expose every technical feature immediately. Use three levels of interaction: **Simple** (describe what you want in chat; AI handles the configuration), **Intermediate** (review the proposed agents, tools, workflows and settings), **Advanced** (detailed configuration, visual workflow editing, execution logs and technical controls). Users should be able to move between these levels without losing their work." Section **C** adds "show advanced settings only when needed" and "explain unfamiliar features through contextual guidance", and **G** lists acceptance tests ("Users can understand task progress without navigating multiple sections", etc.).
- **The repository docs never recorded this.** The words "Phase 5" in `docs/` mean something else: the ORIGINAL project's Phase 5 (the approval system, built long ago) and the REDESIGN's phase 5 (Knowledge Center, Settings polish, Creative Studio, completed 2026-11-05). `docs/PROGRESS.md` and `docs/KNOWLEDGE-AND-ASSISTANT.md` mention "Phase 5 (Simple / Review / Advanced)" as not built, but there is no spec beyond the brief. **Recommendation:** give it an unambiguous name, for example "Interface levels" (D-079), so it cannot be confused with the earlier Phase 5s.
- The brief says "Simple / Intermediate / Advanced"; the later instruction wrote "Simple / Review / Advanced". Assumption: the same thing (the middle level is where proposals are reviewed). **Needs the owner to confirm the name**, because "Review" is already a word with a different meaning (below).

## 2. What exists that Phase 5 must reuse (facts)
| Existing piece | Where | Relevance |
|---|---|---|
| A Beginner / Intermediate / Advanced setting that only changes what is shown | `src/recommendations/` (`PUT /api/recommendations/mode`), `RecommendedSettings.tsx` `ModeSwitcher`, D-052 | **The same idea already exists but only inside Recommended Settings.** Phase 5 should extend this single setting, not create a second one. |
| ~17 `<details>` sections, an "Advanced" Settings category, an "Advanced" usage-limits page | `web/src/pages/` | Already hide some technical controls; Phase 5 must decide which of these follow the level. |
| One navigation list | `web/src/components/shell/nav.ts` | Level-dependent visibility of sidebar items would be edited here only. |
| Assistant results, review cards, suggestions, change log | `web/src/components/assistant/` | The Simple level is "describe what you want in chat"; most of its pieces exist. |
| Workflow draft with revise, opened UNSAVED in the editor | `src/workflows/draft.ts`, `WorkflowsSection.tsx` | The Simple -> Advanced move for workflows already works (draft, then the visual editor). |
| Project hub with eight tabs, attention list | `components/hub/` | A Simple view of a project could show Overview only. |
| sessionStorage for UI state (draft text, conversation, results) | Assistant page | Precedent for "move between levels without losing work" (UI state only, no database). |

## 3. Dependencies on Phase 4 (facts)
1. The Assistant's lookups, suggestions and action cards are the natural Simple level. Phase 5 depends on them being reliable with a REAL model, which has **never been tested** (`PHASE4-AUDIT.md` section 7B, R1-R5).
2. The Phase 4 action levels (**Safe / Review / Restricted**) and the interface levels (**Simple / Review / Advanced**) both use the word "Review" for different things (a kind of change vs. a kind of screen). **Conflict to resolve before any UI text is written.** Recommendation: keep "Safe / Review / Restricted" for what the assistant may DO; call the interface levels "Simple / Guided / Advanced" or "Simple / Intermediate / Advanced" (the brief's own words).
3. Hiding something must never remove a safety control: the owner guard, approvals, the restricted refusals and the "Not verified" labels must stay visible at every level. (Fact: they are not level-dependent today.)

## 4. Potential conflicts and architectural issues (facts and assumptions)
- **Two level systems** if built naively (Recommended Settings mode + a new one). Avoid: one `interface level` value, stored where the recommendation mode is stored (server side, per owner, `PUT`-able from a phone) or in the browser only. Decision needed: server (follows the owner across devices; needs a small settings field, possibly a migration) or browser (no migration; per device). Recommendation: **browser-only first** (no database change, no restart hazard, see A1), server-side later if wanted.
- **Tests pin visible text and roles** (404 dashboard tests, 6 browser suites). A level that hides elements must default to a level that shows what the tests expect, or tests need a level set explicitly; changing defaults would break many assertions. Recommendation: default = **Advanced** for the existing owner (everything shown as today), Simple opt-in; avoids touching existing tests.
- **Duplicated functionality risk:** a separate "simple mode" page would duplicate the Assistant. Recommendation: the Simple level IS the Assistant page plus a reduced sidebar; no new page.
- **Progressive disclosure vs. discoverability:** hiding sections from the sidebar makes the global search and Assistant lookups the only way in at Simple level; both exist and are tested.
- **Phone:** the bottom bar already has 4 primary items + More; Simple level could use only Assistant, Dashboard, Projects, Approvals.
- **Do not invent:** per-feature explanations ("contextual guidance") need real copy for each unfamiliar feature; the brief lists the requirement but not the list of features. The owner (a beginner, per `PROGRESS.md`) should choose which pages get guidance first.

## 5. Proposed scope (recommendation, to be approved; NOT in the brief verbatim)
1. One interface-level setting (Simple / Intermediate / Advanced), a visible control in the header or Settings, and a short "what changes" explanation. Default Advanced (unchanged for the owner).
2. Simple: sidebar and phone bar reduced to AI Assistant, Dashboard, Projects, Decisions & approvals (+ search and a "Show everything" link); lists and detail pages keep working by URL.
3. Intermediate: adds Workflows, Knowledge Center, Tasks & history, Agents, with settings shown as proposals to review (the Phase 4 cards).
4. Advanced: everything as today, including logs, the visual editor and technical settings.
5. Per level, panels on existing pages may fold (`<details>`) but nothing is removed; moving levels never reloads the page or loses unsaved text.
6. Section G acceptance: extend `scripts/e2e/hub-e2e.mjs`/`phase4-e2e.mjs` with a level script (switch levels, state survives, restricted/approval controls always visible, six sizes).

## 6. Recommended implementation sequence
0. **Before anything:** the owner confirms the name (D-079), the middle level's name, and that browser-only storage is acceptable. Run `npm run backup` (no migration is planned, but the rule is the rule).
1. Real-model validation of Phase 4 (R1-R5, 12 requests, P-47) so Simple level rests on tested behaviour. Can run in parallel with step 2.
2. Level model: one small module (`web/src/lib/interfaceLevel.ts`) + a hook, reading/writing browser storage, reusing the Recommended Settings mode values; unit tests; no UI change yet.
3. Navigation by level in `nav.ts` (one list) + AppShell; tests for each level; existing tests keep passing at the default.
4. Page-level folding for the three or four heaviest pages (Settings, Workflows, Monitor, Agent page) using the existing `<details>` pattern.
5. Contextual guidance (plain-language hints) for the first pages the owner names.
6. Browser acceptance script + documentation (D-079, `PROGRESS.md`, `REDESIGN-PLAN.md`, `CLAUDE.md`).

## 7. Estimated complexity and blockers (assumptions)
| Step | Size | Risk |
|---|---|---|
| 2 level module | small (hours) | low |
| 3 nav by level | small-medium | medium: many tests name sidebar links; default Advanced keeps them valid |
| 4 folding | medium | medium: per-page judgement, risk of hiding a needed control |
| 5 guidance | medium | content decisions belong to the owner |
| 6 acceptance | medium | flaky waits (the browser scripts needed many wait fixes in Phase 4) |
| 1 real-model validation | small to run | **blocker: owner approval of P-47; free-tier rate limits (Groq about 8,000 tokens/min); a model that does not follow the JSON prompts would need prompt work** |
**Blockers:** (a) naming decision; (b) P-47; (c) a decision on where the level is stored; (d) whether the Manager should also be able to locate/open (`PHASE4-AUDIT.md` A7), which is a separate feature, not part of Phase 5.
Nothing in Phase 5 needs a database migration, a new package, or a change to a restricted action.

## 8. What was built (2026-11-06, D-079; uncommitted)
Follows the sequence in section 6, with the owner's approvals: name **Interface levels**, levels **Simple / Intermediate / Advanced**, **browser-only** storage, default **Advanced**.
- Level model `web/src/lib/interfaceLevel.ts`; navigation by level in `nav.ts` (still ONE list); `LevelBar`, `HiddenScreenNotice`, `GuidanceNote` in `components/shell/LevelBar.tsx`; guides in `lib/guidance.ts`; AppShell and the phone More sheet follow the level.
- One idea, not two: choosing a level also sets the Recommended Settings detail level (Simple = beginner). The reverse is not done on purpose.
- Tests: `web/src/interfaceLevels.test.tsx` (9), `scripts/e2e/levels-e2e.mjs` (33 checks: three menus, persistence, notice, approvals and their count at every level, assistant and search reach hidden screens, restricted request still refused, unsent message survives level changes, all 15 screens load at Simple, six sizes, phone bottom bar and More sheet).
- Deliberately NOT done: folding panels inside pages (it risks hiding a control), a server-stored level, guides for every screen, the Manager locating and opening (separate feature, `PHASE4-AUDIT.md` A7).
- Existing tests were not changed for this work: the default is Advanced and the new controls use distinct accessible names ("Simple level" etc.).

## 9. Beginner evaluation and what it changed (2026-11-06, D-080)
**Method (stated honestly):** no human beginner was involved. I measured the guides (Flesch-Kincaid grade, sentence length, undefined terms), ran a scripted walkthrough of seven beginner tasks at Simple using only what Simple's menu offers (`scripts/e2e/levels-e2e.mjs`), and read the screenshots. This shows each task is POSSIBLE and the text is simple; it does not show that a person understands it.

**Guides (16 pages now, was 9).** Mean grade 5.9 -> 4.8. The real problem was jargon: "agent" appeared undefined in four guides, "model" in two, "workflows" in the projects guide, and seven screens Intermediate lists had no guide (an agent's page, Activity & Logs, Inbox, Schedules, Bot Studio, Groups, Workforce). Now an agent is always "an AI helper (called an agent)" and a model "the AI brain". `web/src/guidance.test.ts` pins: at most 75 words and 20 words per sentence, grade 9.5 or lower, terms explained, one allowed "never" (the assistant's), and a guide for every screen listed at Simple or Intermediate.

**Seven tasks at Simple, all passed:** ask the assistant a question; ask why the last task failed (real reason plus a link); approve a waiting request from the menu; open a project; attach a file and ask about it (temporary by default, not saved to the Knowledge Center, answer shows its source); draft a workflow and open it (the hidden screen explains itself, the draft is not saved); read the Dashboard guide.

**Two complexity leaks found by the walkthrough, fixed (view-only, nothing removed):** a project page showed all eight tabs at Simple (now five); the Dashboard showed the full technical page (now the essentials, with "Show more detail").

**Intermediate** adds Workflows, AI Agents, Knowledge Center and Tasks & history, the project page gets its eight tabs, the Dashboard its technical panels, and the guides stay: gradual in terms of screens. Its content is unchanged by this round.

**Still weak for a beginner (not fixed, recommended):**
1. **Settings and the first AI connection are unreachable from the Simple menu.** A first-time user with no model has to be told to switch level (the notice offers it). Recommendation: a first-run "Connect an AI model" step reachable from the Assistant at Simple (the Manager plan's task recipe 1).
2. The Knowledge Center is not listed at Simple (documents are reachable through chat attachments, search and the assistant). Whether it belongs at Simple is a product decision.
3. Several pages still show developer wording inside their own content (for example "Failures (24 h)", "Providers"), outside the guide.
4. The level is per browser, so a phone and the PC can differ.
5. A real beginner has not used it. Recommendation: one supervised session, then adjust.
