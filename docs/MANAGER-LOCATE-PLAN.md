# Manager: locate, open, explain and guide. Implementation plan (2026-11-06). RECOMMENDATION ONLY: nothing here is built.

The owner asked for a plan before implementation ("for larger architectural changes, present the recommendation before implementation"). Facts, assumptions and recommendations are separated. Four decisions are needed from the owner (section 8).

## 1. What the owner asked for (brief, section 4 of the latest message)
The Manager should: locate any screen, feature or setting; open the requested screen; explain what a feature does; guide beginners through tasks; identify unavailable features and explain how to access them; respect the selected interface level; never bypass permissions, approvals or restrictions.

## 2. What exists today (facts, read from the code)
| Piece | Where | What it can do | Gap against the brief |
|---|---|---|---|
| Assistant lookup | `src/assistant/locate.ts`, `/api/assistant/interpret` | Finds and opens **records** (projects, workflows, agents, conversations, tasks, approvals, documents, notes, decisions) and 9 **sections** by name ("open ai models"). Rule-based, no model, no cost. | Does not know features ("where do I add a Telegram bot?"), settings, or what anything does. Ignores the interface level. |
| Settings search | `web/src/pages/settings/categories.tsx` (24 entries with `label`, `to`, `where`, `words`) | Finds a setting by what it does, inside Settings only. | Not reachable from the Assistant or global search. |
| Global search | `src/project-hub/search.ts` | Titles of records only. | No screens, features or settings. |
| Guides | `web/src/lib/guidance.ts` (16 pages, tested for reading level) | Explain a screen once you are on it. | Cannot be asked for from elsewhere; the Assistant cannot say them. |
| Navigation + levels | `web/src/components/shell/nav.ts`, `lib/interfaceLevel.ts` | One list of sections and tabs, each section has a level; a hidden screen explains itself and can be added to the menu. | The Assistant does not consult it. |
| Manager engine | `src/manager/` | Plans a goal in steps, hands steps to allowed specialist bots, reviews. **It has no tools by design** ("cannot create bots, change settings or reach outside"). | It is not a navigation helper. Giving the engine tools would break its safety model. |
| Availability signals | existing status endpoints (integrations, groups switch, LLM status, Guardian view) | Say whether Gmail/Telegram are connected, whether groups are on, whether a model key exists. | Nothing combines them into "why can't I use this and how do I enable it?". |

## 3. Recommendation in one paragraph
Do **not** give the Manager engine new tools. Build the capability into the **Assistant** (the owner's main entry point) as a new, read-only "guide" step that runs before the record lookup: it matches the question against ONE **feature catalog**, answers in plain words at the owner's level, and offers an Open button. The catalog is a single list (screens, features, settings, tasks) reused by the menu, the guides, the settings search and the Assistant, so they cannot drift apart. The guide step can only navigate and explain; any "do it for me" still goes through the existing Safe / Review / Restricted pipeline and the owner checks.

## 4. Design
**4.1 Feature catalog** (new, additive, `web/src/lib/catalog.ts`)
```
FeatureEntry { id, title, kind: "screen" | "feature" | "setting" | "task",
               path, level (lowest level that lists it), summary (plain words; reuses the guide text where one exists),
               keywords/synonyms, requires?: { probe, how }, steps?: [{ text, path? }] }
```
- Seeded from what already exists: every `nav.ts` section and tab (about 25), the 24 settings-search entries, the 16 guides (as `summary`), plus about 10 features that live inside screens (attach a file, drafts, undo, Keep in the Knowledge Center, pair a phone, switch groups on, create a schedule, add a provider key, ...).
- Client-side (the interface level is stored in the browser, so resolving there needs no new server API and no database). Pure functions: easy to unit test.
- A **consistency test** is the heart of it: every `nav.ts` entry/tab, settings-index item and guide has a catalog entry; every catalog `path` matches a real route in `App.tsx`; every entry has a summary and a level; no two entries share a path+title. It fails the build when the UI changes and the catalog does not.

**4.2 Matcher** (rule-based, offline, free; same approach as `locate.ts`). Intent words: where / how do I / what is / take me to / open / explain / help me. Score by title, keywords and synonyms (the settings index already uses a `words` string). Return at most three matches. Anything not confidently matched falls through to the existing record lookup and then ordinary chat (unchanged pipeline order: edit, why-failed, overview, **guide (new)**, locate, chat).

**4.3 Answer shape (per match)**: what it is (one or two sentences), where it is, whether it is listed at the current level, whether it is available right now, and one of: `[Open]`, `[Show it in the menu and open it]` (sets the level, the existing mechanism), or the steps to make it available.

**4.4 Level respect.** A match above the current level is shown, not hidden or refused: "This is part of the Advanced level, so it is not in your menu at Simple. [Show it in the menu and open it]". At Simple the answer uses the guide wording only (no technical terms); at Intermediate it adds the short "how it connects" line; at Advanced it adds the technical note. Nothing is removed at any level.

**4.5 Availability** (`requires.probe`). Each probe wraps an existing read-only status call and returns one of `available`, `needs-setup`, `switched-off`, `not-built`, `could-not-check`. Examples: Groups (switched off until the owner turns it on, NV-15), Gmail/Google (needs the owner's Google configuration, NV-4), Telegram (needs a bot token), Creative Studio (honestly "not connected": no image/video/audio service), PC control (needs the Guardian and an approved folder). The answer says exactly what is missing and the numbered steps, never claims availability it did not check, and says "I could not check" when a call fails.

**4.6 Beginner task recipes** (static step lists, each step with an Open button; a step never performs anything). Proposed first eight: connect an AI model; create your first agent; ask a question about a document; approve a request; start a project; draft a workflow; schedule something; find out why a task failed. The owner should choose or change this list.

**4.7 Permission rules (non-negotiable).** The guide step is read-only: it calls no write route and never creates an approval. Opening a screen grants nothing; owner-only screens and actions still need the owner checks (phone refused, passphrase proof when a Guardian is configured). The Manager engine, its settings and the Guardian are untouched. A request such as "turn on groups for me" is not handled by the guide step: it is explained (steps and the Open button); doing it stays an owner act.

## 5. Tests to add (planned)
1. Catalog consistency tests (above).
2. Matcher table tests: at least 60 phrasings per intent family with expected top match; a precision check (no false positives on ordinary chat such as "give me a summary"); ambiguity and no-match behaviour.
3. Level tests: the same question at Simple, Intermediate and Advanced; a hidden match offers the switch; the answer text at Simple uses no unexplained term (reuse the guide readability rules).
4. Availability tests with stubbed probes (each state, and "could not check").
5. Browser script (`levels-e2e.mjs` style): ask five questions at each level, press Open, check where it lands and that the menu level changed only when the owner pressed the switch; six screen sizes.
6. Safety test: the guide step makes no non-GET request (asserted on the recorded calls), and a "do it" request is routed to the existing pipeline or refused.

## 6. Recommended sequence and size
| Step | What | Size | Risk |
|---|---|---|---|
| 1 | Catalog + consistency tests (additive; nothing migrated) | M | drift if the test is weak: make it strict |
| 2 | Matcher + guide step in the Assistant (client side) | M | false matches: precision tests, "I am not sure" answer |
| 3 | Level-aware answers + the switch-and-open button | S | none new (reuses `useChooseLevel`) |
| 4 | Availability probes (read-only) | M | an endpoint changes shape: probes tested against the real routes in the scratch app |
| 5 | Eight task recipes | S-M | wording; owner chooses |
| 6 | Browser acceptance + docs | M | flaky waits (known) |
| 7 (optional) | A free-model paraphrase fallback for questions the matcher cannot place (the model sees ONLY the catalog, returns catalog ids, never actions) | M | model quality; counts against the free quota; needs approval of request counts; would be tested with a real model |
No database migration, no new dependency, no change to the Manager engine, no paid service.

## 7. Risks and what could block it
- **Two sources of truth** (menu, guides, settings index, catalog): mitigated by the consistency test now, by migrating the menu and settings index to read the catalog later (separate, optional step).
- **English-only, keyword-based**: unusual wording falls through to ordinary chat (stated limitation, same as the record lookup).
- **Over-promising**: probes may lag reality; answers say what was checked and when.
- **Settings screens are Advanced**: at Simple the answer offers the switch; it never opens a screen silently.
- **Naming**: the brief says "Manager"; today's Manager is a different, tool-less engine. Calling this capability "the Manager" in the UI could confuse; the owner decides the name.

## 8. Decisions needed from the owner
1. **Where it lives:** the Assistant's new guide step (recommended) rather than tools for the Manager engine (not recommended: it would remove the engine's "no tools" guarantee). OK?
2. **Client-side catalog** (recommended; no server change) versus a server-side catalog.
3. **The first eight task recipes** (list above): confirm or change.
4. **Optional free-model paraphrase fallback** (step 7): wanted now, later, or never?
