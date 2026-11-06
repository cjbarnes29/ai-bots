# Knowledge Center, chat attachments and the AI Assistant (Phase 4, D-078)

Status: built and tested with fake providers and a real browser (fake local model). **Never run against a real model.** Read `docs/DECISION-BOARD.md` (D-076, D-077, D-078, NV-27 to NV-30) first.

## 1. What exists

| Part | Code | Notes |
|---|---|---|
| Migration `020_knowledge.sql` | `src/db/migrations/` | ADDITIVE only: `knowledge_collections`, `knowledge_docs`, `knowledge_text`, `knowledge_chunks`, `knowledge_fts`, `chat_attachments`, `chat_message_sources`, `assistant_actions`. Applied by the normal runner. **On the owner's database it was applied automatically on 2026-11-06 at 00:27:51Z** (the dev server restarts on file changes); see `docs/PHASE4-AUDIT.md` and D-078a. Test: `src/db/knowledge-migration.test.ts`. Take `npm run backup` first if you want a restore point. |
| Extraction | `src/knowledge/extract.ts` | txt, md, csv, json, xml read as text; docx and xlsx through the existing ZIP reader (`src/documents/zip.ts`, now with an optional per-entry size cap against decompression bombs); a deliberately SIMPLE pdf reader. All readers scan LINEARLY (`indexOf` only; an earlier regex version took 40 s on a crafted 800 KB file; timing tests in `extract-perf.test.ts`). Pictures are stored, not read. No package was added. |
| Knowledge service + routes | `src/knowledge/service.ts`, `routes.ts` | upload (base64 in JSON, 8 MB), duplicates by SHA-256, statuses `queued/processing/ready/failed/unsupported` with a reason, reprocess from the stored original, collections, folders, tags, categories, global or project scope, soft delete + restore, full-text search (FTS5, chunks of about 1,200 characters) |
| Chat attachments | `src/chat/service.ts`, `src/knowledge/service.ts` | `POST /api/chat-attachments` with retention `temporary` (default) / `knowledge` / `project` / `collection`. Attached text and (optionally) Knowledge Center passages go to the model as ONE block marked untrusted. Sources are numbered `[A1]` (files) and `[K1]` (passages); the reply is scanned and the ones it cites are marked. Stored per message in `chat_message_sources`. |
| Assistant | `src/assistant/` | `locate.ts` (find and open), `actions.ts` (safe / review / restricted editing, log, undo), `suggestions.ts` (from real records), `routes.ts` (`POST /api/assistant/interpret`, `GET /api/assistant/suggestions`, `GET /api/assistant/actions`, `POST /api/assistant/actions/:id/(confirm\|reject\|undo)`) |
| Dashboard | `web/src/pages/Assistant.tsx`, `components/assistant/`, `components/knowledge/Documents.tsx`, `components/chat/Attachments.tsx`, `api/knowledgeHooks.ts`, `api/assistantHooks.ts` | Knowledge page gained a **Documents** tab; the chat component gained attachments (button, drag and drop, previews, sizes, real upload progress, removal), a retention choice, a "Use the Knowledge Center" switch and source lists |

## 2. How the Assistant decides (`POST /api/assistant/interpret`)
Order: (1) an editing request (restricted refused first), (2) "why did ... fail", (3) a status overview (a whole-phrase match only), (4) locate and open. Anything else is ordinary chat sent to the chosen agent. Starting a message with `ask:` skips 1-4. A message with files attached skips them too (the owner wants the model to read the files).

**Locate** is rule-based on purpose (no model, no cost, cannot be talked into anything): entity words (project, workflow, agent, conversation, task, approval, decision, document, note), verbs (open/go to open a single clear match at once; show/find/list only list), "latest/last", dates (today, yesterday, this week/month), states (failed, pending, running, done) and name words. It reads the real tables and returns real IDs. A document is found by its name, then by what it says (the text index). Several matches: it asks which. None: it says so. Sections of the app (AI Models, Apps & Integrations, Creative Studio, Knowledge Center, Settings...) open by name. The text is only ever a parameter of a parameterised query (`%` and `_` are plain characters).

## 3. Action levels (owner request 2026-11-06)
| Level | Examples | What happens |
|---|---|---|
| **Safe** | rename a project, set its description, tag / categorise / move / rename a document, move it to a folder or collection | Done at once through the existing service; logged with before and after; **Undo** puts the old value back, but only if nothing changed it since (otherwise it refuses rather than overwrite newer work) |
| **Review** | improve an agent's instructions, draft a project description, cancel a task | The model drafts (agent/project text) or the target is found; the change is only PROPOSED (before and after shown). Nothing changes until the owner presses **Apply** (a phone is refused). Applying adds a new bot version (the old text is kept); undo is another new version. Refuses to apply if the item changed after the proposal. Cancelling a task cannot be undone and says so. |
| **Restricted** | deleting, approving or denying, permissions or access, sending / publishing / sharing, purchases, deployments, installs, accounts, turning off the Guardian | **No code path.** The request is refused, logged as `refused`, and the owner is pointed at the page where they do it themselves. A test lists many phrasings and checks nothing changed. Ordinary chat ("give me a summary", "order the list by date") is not caught. |

**Owner guard (audit fix A2):** an edit or a proposal is an owner act, like the routes it stands in for. From a phone it is refused (`owner_only`); when a Guardian is configured it needs the passphrase proof (`proof_required`, the dashboard asks for it as for any owner change). Lookups, overviews and refusals of restricted requests stay open. Confirm, reject and undo are owner-only routes.

Every result message is composed AFTER the service answered, so the assistant never says something was done that was not. A secret-looking value is never used. Model text is untrusted: it is length-limited, secret-scanned, and a new web address in an instruction rewrite discards the draft.

Deleting a document needs the owner to type its exact title in the Knowledge Center; the assistant has no route to it. Removed documents are hidden, not erased, and can be restored.

## 4. Suggestions (`GET /api/assistant/suggestions`)
Computed from real records: approvals waiting, tasks and workflow runs that failed in 24 h, active agents without a model, projects without a description (offers a REVIEW draft), documents that failed to process, identical copies, untagged documents, an empty Knowledge Center, and the same task given three or more times in two weeks (offers to draft a workflow). A suggestion changes nothing by itself.

## 5. Limits (stated plainly)
- **PDF:** only simple PDFs (text drawn with standard operators in plain or Flate streams). Scanned, encrypted or embedded-font PDFs end as `failed` with the reason. No OCR.
- **Pictures:** accepted, stored, previewed; their content is NOT read (no vision or OCR model is verified). The model is told the file is not readable.
- **Temporary attachments** stay with their conversation and are never added to the Knowledge Center or its search by the application. They are not deleted automatically (conversations are append-only); the owner can keep one with a button.
- **Not verified with a real model:** every prompt (instruction rewrite, description draft, workflow draft, citation behaviour). The fake model always cites correctly; a real one may not. The "cited" mark only means the reply text contains `[A1]` or `[K1]`; it does not prove the claim is supported.
- **Retrieval** is keyword search (FTS5), not semantic. A question using different words than the documents may find nothing.
- **Tasks:** "updating tasks" is limited to cancelling a running or waiting task (tasks are append-only by design).
- **Not built (outside this scope):** Phase 5 (Simple / Review / Advanced levels), an editor for the contents of an uploaded file, semantic search, scheduled re-indexing.
- Not tested on a real phone or with a screen reader.

## 6. Tests
Backend: `src/knowledge/knowledge.test.ts`, `src/assistant/assistant.test.ts`, `src/workflows/draft.test.ts`, `src/db/knowledge-migration.test.ts` (plus the migration-count facts in `upgrade.test.ts`, `agent-manager.test.ts`, `groups-proposal.test.ts`, `decisions-proposal.test.ts`, updated for 020). Dashboard: `web/src/assistantKnowledge.test.tsx`. Browser: `scripts/e2e/phase4-e2e.mjs` (91 checks, fake local model, six screen sizes).

## 7. Changes after the real-model runs (2026-11-06, D-080)
- **Citation marks:** a source counts as "cited" when the answer contains `[K1]`, `[ K1 ]`, `[K1, K2]`, `[A1][A2]`, `**[K1]**`, `［K1］` or the full-width `【K1】` (written by gpt-oss-120b). Round brackets are NOT read (`(A1)` may be a spreadsheet cell). Tests: `knowledge.test.ts`.
- **Prompts:** the instruction-rewrite prompt now forbids copying the ROLE into the instructions and telling the bot to verify facts from its own memory, and asks for second person and "answer only from the sources you are given, say plainly when they do not contain the answer"; the description prompt must not guess a purpose; the workflow-revise message puts the requested change first and says a question for the owner is a checkpoint. A real model still applies a revision correctly only about half the time (P-48), so:
- **Revision note:** after "Revise the draft" the card says exactly what changed ("What changed: added ...") or "Nothing changed: ... your change was not applied" (`web/src/lib/draftDiff.ts`). The owner reads the draft before opening it, as always.
- **Round trip with the app's own writers:** `src/knowledge/writer-roundtrip.test.ts` reads back DOCX, XLSX and PDF written by `src/documents/` (still NOT files from Microsoft Office or a PDF printer).
- Real findings about the Groq models (qwen's 1,000 output-token minute limit, unverified models refused for agents, no observed explicit fail-over) are in `docs/PHASE4-AUDIT.md` section 9 and board NV-34.
