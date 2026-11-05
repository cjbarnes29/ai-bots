# Real-world task milestone

Goal: prove the workforce can do a real task with real AI providers and real tools:
*"Research 10 businesses in Dubai, inspect their websites, organize findings in Excel, generate a PDF report and prepare an email with the files attached."*

**Status (2026-11-06): three REAL attempts were made after the owner approved budgets (P-34, P-35); none delivered the files. The end-to-end success criterion is NOT met yet. The third attempt also EXCEEDED the approved number of map requests by one (see section 0b).** What was really executed, and what failed, is recorded below and in `docs/evidence/real-task-attempt1/` and `docs/evidence/real-task/` (JSON). The email was never sent (there is no send path in the run).

## 0. Real attempts (free-tier Groq models through automatic routing; scratch app on a COPY of the saved database)
| | Attempt 1 | Attempt 2 |
|---|---|---|
| Real provider requests | 6 | 7 (13 of the approved 60 in total) |
| Map requests / website requests | 0 / 0 | 1 / 0 (the approved map request is used up) |
| Manager plan by a real model | **worked**: 2 specialist steps, specialists named by id | **worked**: 3 steps (research, files, email draft) |
| What failed | The Researcher called `find_businesses` with market "uae" (valid code is "AE") and the platform refused it; no request left the PC. Then the Manager's final review got an **empty reply** from `groq/openai/gpt-oss-120b` (a reasoning model spent its 1,500-token budget thinking) and the whole run was marked **failed** although the steps had finished. | The map request was sent but **"Could not reach the map service"**: the real cause is unknown because the code swallowed it. Most likely the search was too heavy: the bot asked for category "all" (about 20 tag lines over Dubai) and the 40-second client limit expired. The review again produced unreadable output and the run completed as **NOT REVIEWED** (the fallback below). |
| Files made | none | none (no data to put in them) |
| Honest bot behaviour | the bots reported the failure and refused to invent data | the same; the Writer would not fabricate rows (good) |
| Model switching / usage | recorded (Groq qwen3.8-27b and gpt-oss-120b, failover on errors) | recorded |

### Fixed because of the real attempts (each with a test)
1. Market names a model writes ("uae", "United Arab Emirates") now mean market AE.
2. The Manager's plan and review calls get 4,000 output tokens (room for a reasoning model to think and answer).
3. A failed final review no longer destroys finished work: the run completes with the step results and says plainly **"NOT REVIEWED: ..."**.
4. The map client now says WHY it failed from a fixed vocabulary (timeout / DNS / connection reset...), never raw error text.
5. The connector description and the run script tell the Researcher to use ONE category (for example "fitness") instead of "all".

## 0b. Attempt 3 (P-35) and a budget overrun that must be reported
- Real: 15 provider requests (limit 40), **2 map requests (approved: 1, so ONE MORE than approved was sent to overpass-api.de)**, 0 website requests, no email. Evidence: `docs/evidence/real-task/evidence.json` (attempt 2 is kept in `docs/evidence/real-task-attempt2/`).
- What happened: the Researcher (a real model) made two map searches in one task (category "food", 10 results); **both timed out ("no answer within 40 seconds")**, so no business data existed. The Writer correctly refused to invent rows; the Manager's final review again produced unreadable output and the run was labelled NOT REVIEWED.
- **Why the overrun happened:** I had written that the approved counts were "enforced by the platform". That was wrong for the map count: the platform only had a per-DAY limit (20 map searches, 300 website requests). The script detected the overrun afterwards (`overBudget: true`) but could not prevent it. I should have verified the enforcement before the run.
- **Fix, with tests (`src/business/allowance.test.ts`):** the owner's approved NUMBER of outside requests is now enforced by the platform (`PUT /api/business/external {enabled, allowance: {map, website}}`): counted down at the moment each request starts (so parallel checks cannot overshoot), the next request is refused with a plain reason BEFORE anything is sent, and `scripts/e2e/real-task.mjs` sets it from the approved numbers.
- What this says about the map service: two real searches of different size never answered within 40 seconds from this PC. Either overpass-api.de is slow or unreachable from this network, or the queries are still too heavy. It cannot be separated without another real request (proposed as P-36: ONE request to `https://overpass-api.de/api/status`, a tiny read-only call that shows whether the service is reachable at all, before any further search).

## 0c. P-36 diagnosis: is the map service reachable from this PC? (2026-11-05 12:10 UTC, owner-approved)
**Exactly one** read-only request was sent: `GET https://overpass-api.de/api/status` (script `scripts/e2e/overpass-status-check.mjs`, 40-second limit, no retry). **0 provider requests** were used (limit 6). No search, no website, no configuration change. Evidence: `docs/evidence/p36-overpass-status.json`.

| Recorded | Value |
|---|---|
| HTTP status | **none**: no response at all |
| Response time | **40,007 ms**, then aborted by our own 40-second limit |
| Error | `TimeoutError` ("The operation was aborted due to timeout"); no network error code (no DNS failure, no refusal, no reset) |
| Endpoint response | none |
| Local checks (read-only, no network) | no proxy in the environment; Windows proxy off (`ProxyEnable = 0`, no auto-config script); Node v24.22.0 |

**Conclusion**
- **Not query complexity or service limits.** The status page is the lightest call the service has and needs no query, yet it timed out exactly like the two searches. The "all categories" and "food" searches were not the cause.
- **Not general network trouble.** In the same session the app reached Groq and Google over HTTPS from the same Node runtime (28 real provider requests, answered). No proxy is configured that Node would be ignoring.
- **Not a DNS failure or a refused connection.** Those fail within a second with an error code; here there was none, only silence until the limit.
- **Cause:** the endpoint `overpass-api.de` did not answer this PC at all within 40 seconds, at three different times today. Either the public service was unavailable or overloaded from here, or the network path to that one host is blocked or filtered (internet provider, firewall or security software). One request cannot tell these two apart, and I did not send more.

**Smallest appropriate fix (recommended, not done)**
1. **Owner check, no code:** open `https://overpass-api.de/api/status` once in your own browser on this PC. If it answers, the service is reachable by a browser but not by Node, which points to security software filtering Node. If it does not answer, the host is unreachable from this network.
2. **Code (small, needs approval of the address):** make the map endpoint a fixed, owner-approved choice between the main Overpass service and one public mirror (for example `overpass.kumi.systems`), keeping all current guards (one address at a time, same query builder, same allowance and daily limits). Then one approved status request to the mirror, then one approved search.
3. Keep the 40-second limit; do not raise it until a status request has been answered.

No further search and no new real task will be run without approval.

## 0d. P-37: configurable map service (2026-11-05, implemented; nothing contacted)
**Audit before the change:** one constant address (`overpass-api.de`); searches could only POST there; the approved allowance and the daily limit were counted at the moment a request starts; there was no record of whether the service answered, and the timeout reason was worked out inline.

**What changed** (`src/business/discovery.ts`, `service.ts`, `routes.ts`):
- A **fixed list** of map services: `main` = `https://overpass-api.de/api/interpreter` (**still the default**) and `kumi` = `https://overpass.kumi.systems/api/interpreter` (public mirror, **not contacted, not verified**). Nothing an agent or a website says can add an address; the real request functions refuse anything not on the list.
- The **owner chooses**: `GET /api/business/map` shows the choice and health; `PUT /api/business/map {endpoint}` changes it (owner-only on a phone, owner proof on this PC when a Guardian is set up; audited). **The app never switches by itself**: a failed search on the chosen service is not retried on the other one.
- **Health status:** every search and status check records the service, HTTP status, time, and a reason from a fixed vocabulary (memory only).
- **Status check:** `POST /api/business/map/status-check` sends ONE GET to the chosen service's status page (15-second limit, 4 KB cap, never retried). It needs the outside-request switch, **counts against the same approved map allowance** (counted down as the request starts) and the daily limit, exactly like a search.
- **Timeouts:** searches 40 s, status 15 s; both named in the error ("no answer within N seconds").
- Allowances, countdown enforcement, the outside-request switch, daily limits and the Guardian's owner-proof rule are unchanged and apply to both services.
- Tests: `src/business/mapEndpoint.test.ts` (12, fakes only; `fetch` is replaced by a spy that fails the test if called). No request was sent to either service while building this.

**Proposed next diagnostic (P-38, NOT run):** exactly ONE read-only `GET https://overpass.kumi.systems/api/status`, 15-second limit, no retry, 0 provider requests, no search, no configuration change (the mirror is not selected). Command for the owner or for me after approval: `$env:AWP_APPROVED_STATUS_REQUESTS = "1"; node scripts/e2e/overpass-status-check.mjs kumi`. The script refuses without that approval and names only addresses from the fixed list.

### Still open
- A third attempt needs the owner's approval of one more map request (P-35). Until a real run produces the Excel, the PDF and the draft, **this milestone is not complete**.
- The Manager still marks a step "completed" when the bot's tool call failed but the bot wrote an honest explanation (the platform adds a "What the platform recorded" note). A reviewer can catch this; a stricter step status is a possible improvement.
- Gemini has no verified model, so only Groq was usable.

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
