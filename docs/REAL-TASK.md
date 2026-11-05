# Real-world task milestone

Goal: prove the workforce can do a real task with real AI providers and real tools:
*"Research 10 businesses in Dubai, inspect their websites, organize findings in Excel, generate a PDF report and prepare an email with the files attached."*

**Status (2026-11-06): PREPARED and REHEARSED with simulated parts. The REAL run has NOT been done**, because it needs the owner's approval of the exact outside requests (CLAUDE.md section 5). Nothing below claims a real execution.

## 1. Audit: what is operational, partial, missing
| Capability | State | Evidence / limit |
|---|---|---|
| Model registry and routing, failover | Operational | Real evidence only for Groq `gpt-oss-20b`, `qwen3.8-27b`, `gpt-oss-120b` (P-26, P-29). Failover verified with FAKE providers (`scripts/e2e/routing-e2e.mjs` 40/40, `groups-e2e.mjs` 44/44). Gemini: no model currently verified. |
| Central Manager (plan, delegate, review) | Operational with fakes; never run on a real model | `src/workforce/real-task-rehearsal.test.ts`. **Finding:** the Manager's plan must name a specialist by its bot **id**. A name is silently treated as "no specialist": the Manager does the step itself and the raw action text becomes the step result. The planning prompt lists the ids; a real model must copy them correctly. |
| Groups and collaboration | Operational with fakes | `docs/WORKFORCE.md`. |
| Browser tools | Operational with fakes | `browser.read_page` (public https, text only, no scripts), `submit_form` (approval). Never run against a real site. |
| Business discovery + website audit | Operational with fakes; **never run live** (NV-1, NV-2) | One map request (Overpass), then home-page GETs; per-day limits; outside-request lock; the audit log counts every request. |
| File handling | Operational | PC agent workspaces + folder gate; every file creation waits for the owner's approval. |
| Excel / PDF / Word / PowerPoint | Operational: real, valid files (structure tested). **Not opened in real Office or a PDF reader** | `src/documents/*`, tests. |
| Email | **Gap closed locally:** new action `documents.create_email_draft` writes a standard `.eml` draft with up to 5 real attachments (byte-exact, tested). It is NOT sent; the owner opens it in a mail program. **Gmail** can send plain text only (no attachments, no drafts) and its sign-in is unverified (NV-4). Not opened in a real mail program yet. | `src/documents/eml.ts`, `eml.test.ts` (6) |
| Installed desktop applications | **Not claimed.** The desktop engine was only driven on disposable test windows and Winver (NV-14). No Excel, Word or Outlook control was tried. | |
| MCP integrations | Only exercised with a fake server (`scripts/e2e/mcp-n8n-e2e.mjs`); no real MCP server used. | |

## 2. What was added
- `documents.create_email_draft` (approval-gated, workspace-only, no executables, size caps, header-injection safe).
- `src/workforce/real-task-rehearsal.test.ts`: the whole task with a scripted model, fake map data and fake websites: Manager plan, two specialist bots, a map read and ten website checks (one site deliberately unreachable), three approvals, real xlsx/pdf/eml on disk (the draft carries the byte-exact files), nothing sent. **SIMULATED: it proves the plumbing, not model quality.**
- `scripts/e2e/real-task.mjs`: the real run, ready and syntax-checked, **not run**.

## 3. The real run: exact outside requests proposed (board P-34)
Run by the owner in their own terminal (keys never in chat) against a SCRATCH app (port 3107, temp database and workspace; the real `data/app.db`, vault and settings are untouched).

| Request | Count | Cap enforced by |
|---|---|---|
| AI provider requests, free tiers only (Groq and/or Gemini), automatic routing among verified free models | **at most 60** (list-models x2, test x2, Manager plan 1, specialist turns about 8-12, review 1-2, retry/failover headroom) | the provider's daily cap in the scratch app is set to the approved number; the script also stops above it |
| Map data (`POST https://overpass-api.de/api/interpreter`, Dubai, 10 results) | **1** | business module (queries per day) |
| Business websites (one GET of each home page, public https only) | **at most 10** | business module (limit 10 results, per-day site limit) |
| Email | **0 sent** | no Gmail action exists in the run; the email is a `.eml` file |

Approvals: the script plays the owner on the scratch app for exactly three file approvals (Excel, PDF, email-draft file, in that order) and DENIES anything else.
Evidence is written to `docs/evidence/real-task/`: JSON with every step, usage by model, audit counts, plus the real files and their hashes.
Honest expectation: free models can be unreliable at structured action blocks; failures and recoveries are recorded, not hidden. The business data is public map data. PDPL and telecom checks (NV-5, NV-6) concern contacting the businesses, which this run does not do.

## 4. Setup for the owner
1. `$env:GROQ_API_KEY = "<free key>"` (and/or `$env:GEMINI_API_KEY`, from a project with NO billing).
2. `$env:AWP_APPROVED_PROVIDER_REQUESTS = "60"; $env:AWP_APPROVED_MAP_REQUESTS = "1"; $env:AWP_APPROVED_SITE_REQUESTS = "10"`.
3. `node scripts/e2e/real-task.mjs`. Without the three approval variables it refuses and sends nothing.
