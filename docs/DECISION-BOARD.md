# Decision board

The one central record of what the owner decided, what is waiting, what is NOT verified, and where the code can be rolled back to.
**Everyone (people and AI sessions) reads this board before proposing or executing a change.** Last updated: 2026-11-04.

## Rules for this board
1. **History is never overwritten.** An approved decision is never edited or deleted. To change one, add a NEW entry that says "supersedes D-0xx", and mark the old entry's status as `superseded by D-0yy` (the old text stays).
2. **Nothing moves to "verified" or "complete" without evidence** (a test result, a real response, a document). If there is no evidence, it stays under NOT VERIFIED.
3. Every entry has an ID, a date, and who decided. "Owner" means the project owner. "Assistant proposal" means the owner has NOT explicitly approved it yet.
4. The owner's restrictions (section 7 of `CLAUDE.md`) apply to every item here. In short: no commit, push, deploy, purchase, paid API or real external request without the owner's explicit approval.

---

## PINNED: NOT VERIFIED (do not claim any of these is done)
| # | Item | State | What would count as evidence |
|---|---|---|---|
| NV-1 | UAE emirate area codes (`AE-AZ`, `AE-DU`, `AE-SH`, `AE-AJ`, `AE-UQ`, `AE-RK`, `AE-FU`) select the right areas on the live map service | **NOT VERIFIED.** Live map verification pending. | A real, owner-approved search whose answer lists businesses in the named emirate |
| NV-2 | UAE map data completeness (how many real small businesses and websites OpenStreetMap actually holds in the UAE) | **NOT VERIFIED.** | Owner-approved real searches compared with a known list |
| NV-3 | Gemini integration | **NOT VERIFIED.** Awaiting the owner's API key (`GEMINI_API_KEY`, no billing attached). | One real reply to "Reply with: Gemini connection successful." with the model recorded |
| NV-4 | Google integration (Gmail, Drive, Calendar, Tasks) | **NOT VERIFIED.** Awaiting the owner's Google Cloud client configuration. | A real sign-in, a Test connection that succeeds, and an owner-approved test email |
| NV-5 | UAE data-protection (PDPL) legal checks | **NOT VERIFIED.** Pending the owner's own verification. Not legal advice. | The owner's written confirmation |
| NV-6 | UAE telecom cold-outreach compliance (regulator rules on unsolicited marketing) | **NOT VERIFIED.** Pending the owner's own verification. Not legal advice. | The owner's written confirmation |

---

## 1. Approved decisions
| ID | Date | Decision | Decided by | Status |
|---|---|---|---|---|
| D-001 | 2026-11 | Free services and free LLM tiers only, until the owner explicitly approves paid services. Never silently use a paid API. The design must allow optional paid providers later. | Owner | active |
| D-002 | 2026-11 | Keep the model/provider layer independent so paid services can be added later. The paid-provider opt-in design is part of Phase 9. | Owner | active |
| D-003 | 2026-11-04 | Application navigation approved with four adjustments: pending-approvals badge on Approvals; Usage under Settings > AI Models; Workflow Studio stays top-level; Integrations Center is the central connection area. | Owner | active |
| D-004 | 2026-11-04 | Phases 1-3 (shell, Dashboard, Settings split) approved and implemented. | Owner | done (71ea6ab) |
| D-005 | 2026-11-04 | Stored "Team" entity: DEFERRED. Reuse the existing delegation allow-lists and Manager; do not create a duplicate. | Owner | active |
| D-006 | 2026-11-04 | "Last verified" column: DEFERRED. Use existing records and the audit log instead of a migration. | Owner | active (done this way in Phase 4) |
| D-007 | 2026-11-04 | Connector verification: a reusable interface with provider-specific checks (proposal approved, implemented in Phase 4). | Owner | active |
| D-008 | 2026-11-04 | Business Workforce before YouTube Studio. | Owner | active |
| D-009 | 2026-11-04 | Leads are stored as CSV/Excel files. No database migration. | Owner | active |
| D-010 | 2026-11-04 | Business scope: UAE-wide, all small businesses, English proposals, architecture open to other countries. Leads folder: `workspace/business-workforce/leads/`. | Owner | active |
| D-011 | 2026-11-04 | Start with four Business agents: Researcher, Lead Scout, Site Auditor, Proposal Writer (plus the existing Manager). | Owner | active |
| D-012 | 2026-11-04 | Saving leads uses STAGED, HASH-BASED batch approval (the approval covers exactly the approved rows). | Owner | active |
| D-013 | 2026-11-04 | ALL external discovery and website requests stay disabled until the owner separately approves the specific test, the services and the request counts. | Owner | active |
| D-014 | 2026-11-04 | No outreach, email sending, publishing or purchases without the owner's approval. | Owner | active |
| D-015 | 2026-11-04 | Discovery and auditing are read-only; website content is untrusted input; "no website listed", "audit failed" and "poor website" are kept strictly separate; scoring is transparent and explainable. | Owner | active |
| D-016 | 2026-11-04 | YouTube Studio: manual publishing packages first; automatic uploads deferred; Windows speech first, Piper investigated later. | Owner | active |
| D-017 | 2026-11-04 | Do not increase provider request limits without checking the provider's real quotas and usage. | Owner | active |
| D-018 | 2026-11-04 | Do not install FFmpeg, Piper or any other dependency without approval. No unnecessary database tables or dependencies. | Owner | active |
| D-019 | 2026-11-04 | Phase 3.5 housekeeping (stale links and wording, focus trap on the phone menu, Gmail phone-refusal test) approved and done. | Owner | done |
| D-020 | 2026-11-04 | Commit structure: Commit 3 = `.gitignore` fix + original `src/tools/registry.ts`; then a docs commit (this board + `CLAUDE.md`); then Phase 4; then Business Workforce, each separate and never combined. | Owner | active |
| D-021 | 2026-11-04 | Each commit needs the owner's explicit approval after being shown: Git status, changed files, test results, proposed message and exact commands. Local rollback tags only; tags and commits are never pushed. | Owner | active |
| D-022 | 2026-11-04 | The Gmail "Send test email to myself" feature (approval-gated). | Owner | done (c62cf1c) |

## 2. Pending approvals
| ID | Item | Waiting for |
|---|---|---|
| P-2 | Docs commit (this board + `CLAUDE.md`) | Owner approval |
| P-3 | Phase 4 commit (Integrations Center, verification, provider setup guide, wording fixes) | Owner approval |
| P-4 | Business Workforce commit | Owner approval |
| P-5 | First real external tests: 1 map request, 1 request to `https://example.com/`, up to 9 requests to businesses' own home pages (details in `docs/BUSINESS-WORKFORCE.md`) | Owner approval of exactly these requests; check the map service's current usage policy first |
| P-6 | Gemini API key, Google Cloud client, Tailscale steps | Owner action |
| P-7 | Phases 5-6, 8-9 and the YouTube Studio phases | Owner review after each stage |

## 3. Rejected proposals
None so far. (Deferred, not rejected: D-005 stored Team entity, D-006 "last verified" column, automatic YouTube uploads.)

## 4. Technical assumptions (believed, not proven)
| ID | Assumption | Source | Risk if wrong |
|---|---|---|---|
| T-1 | Business reads reuse each agent's existing "web reading" (browser) switch, because both per-agent permission tables are limited to fixed connector lists by database constraints. | Assistant proposal; the owner has not explicitly confirmed it | Less granular than a separate switch; a separate switch needs a migration |
| T-2 | The public Overpass service accepts a few small read-only queries from this app. | Assistant knowledge, may be out of date | Requests refused or rate-limited |
| T-3 | One agent task may make at most 3 outside actions, so actions are coarse (batch audits, one search). | Code (`engine.ts`) | None (it is a limit of the app) |
| T-4 | The app's per-agent safety limits (50 reads, 20 approval requests per day, 5 waiting) are enough for the Business flow without raising them. | Design | Pipelines may need smaller batches |
| T-5 | The 50 requests per day cap on Gemini and Groq is the APP's own safety cap, not the providers' real quotas. | Code | Real quotas are unknown until checked (D-017) |
| T-6 | No FFmpeg and no real Python on this PC (Windows with only Node). | Checked 2026-11-04 | YouTube Studio assembly needs an approved install |
| T-7 | Git here converts line endings (`autocrlf`), so "LF will be replaced by CRLF" warnings are harmless. | Observed | None |

## 5. Unverified integrations (all tested only against fake services)
Gemini (NV-3), Gmail and Google Workspace (NV-4), Telegram, GitHub, Notion, n8n, MCP, the real internet through the browser connector, OpenStreetMap discovery (NV-1, NV-2), real website audits, phone access over Tailscale, OmniRoute. "Tested" in the progress file means tested against a fake local service unless it says otherwise.

## 6. Security concerns
| ID | Concern | State |
|---|---|---|
| S-1 | Text from websites and map data can try to give orders to an agent (prompt injection). | Mitigated: audit results contain only code-written sentences; map text is cleaned (no backticks or control characters) and labelled untrusted; every outside write needs approval. Not eliminated. |
| S-2 | Spreadsheet formula injection through business names in the leads file. | Mitigated (formula-looking text is guarded in CSV and Excel export). |
| S-3 | Leads contain business names and phone numbers. | `workspace/` is git-ignored (added in the Business commit); never commit it. |
| S-4 | Secrets: API keys live only in the encrypted vault or `.env`, are never shown, never logged, and are redacted from errors. | Active. |
| S-5 | A mutation test once removed the address guard in `overpassPost` and the test then attempted real requests to a non-existent example host and a link-local address (nothing meaningful sent). | Lesson recorded: never mutation-test network-sending guards that way. |
| S-6 | `src/tools/registry.ts` was never tracked since Stage 3 (ignore rule too broad), so a clean clone could not compile. | Fixed by Commit 3 once approved (P-1). |
| S-7 | Cold outreach law (PDPL, telecom rules) is the owner's responsibility (NV-5, NV-6). The app never contacts anyone by itself. | Open. |
| S-8 | No remote repository is configured, so nothing can be pushed by mistake. | Active. |

## 7. Completed milestones
Stages 1-8 (routing, Manager, tools and skills, PC agent, documents, workflows, integrations, memory), Gmail test email, Stage 9 shell/Dashboard/Settings (Phases 1-3 and 3.5): committed. Phase 4 (Integrations Center) and the Business Workforce (7a-7f): BUILT AND TESTED ON FAKE DATA, NOT YET COMMITTED. Details: `docs/PROGRESS.md`, `docs/UI-AUDIT.md`, `docs/BUSINESS-WORKFORCE.md`.

## 8. Git commits and rollback points
All tags are LOCAL. Nothing is ever pushed (there is no remote).
| Point | Commit | Meaning | Rollback |
|---|---|---|---|
| `rollback/before-commit-3` (tag) | `71ea6ab` | Last commit before this sequence: Stage 9 (Phases 1-3 + 3.5). Verified: it was HEAD and the tip of `main` when tagged; no tag conflicts. | `git reset --hard rollback/before-commit-3` (destructive: only with the owner's approval) |
| `c62cf1c` | Gmail test email | committed | |
| `71ea6ab` | Stage 9 | committed | |
| `rollback/before-docs` (tag) | `98964e3` | Commit 3: `.gitignore` fix (`tools/` to `/tools/`) + original `src/tools/registry.ts`. Approved by the owner 2026-11-04. Verified in a scratch export: 1013 backend + 208 web tests, builds clean. | `git reset --hard rollback/before-docs` (destructive: only with approval) |
| Docs commit | pending (P-2) | this board + `CLAUDE.md` | |
| Phase 4 commit | pending (P-3) | | |
| Business Workforce commit | pending (P-4) | | |

Hashes and tags for the pending commits are added here as each one is approved and made (in the next commit, so no commit ever has to describe itself).

---

## Board change log (append only)
- 2026-11-04: Board created from the decisions recorded in the project conversation up to this date.
- 2026-11-04: Commit 3 approved and made (98964e3); P-1 closed; local tag rollback/before-docs created.
