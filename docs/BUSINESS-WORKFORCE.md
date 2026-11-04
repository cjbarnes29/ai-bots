# Business Workforce

Find small businesses in the UAE (designed for more countries), check their websites, score them openly, and prepare English proposals for the owner's approval.

**Status: built and tested against FAKE data only. No real request has ever been made to the map service or to any website.** Outside requests are switched OFF by default.

## What it can and cannot do
- **Can:** look up businesses in public map data (OpenStreetMap); read the home page of a business's website (one GET, read-only); score each lead from a visible table; keep leads in a CSV file (and export Excel); give the Proposal Writer plain facts for an English draft.
- **Cannot:** send, publish, contact or buy anything. Saving leads and creating documents wait for the owner's approval on the Approvals page. It never writes a price.

## The lock
`Outside requests` (Business Workforce page) is OFF unless the owner switches it on. It is checked on EVERY request, in three places (the connector's door, the map client, and the website fetcher), so a bug in one cannot start a request. Switching it off in the middle of a run stops the next request. Daily limits (counted from the audit log, so a restart does not reset them): 20 map searches, 300 website requests. Each request is logged by host only.

## Three website situations that are never mixed
| Situation | Meaning | Score effect |
|---|---|---|
| `none_listed` | The source lists no website. **Unverified**: a person must check. | 50 points, flagged "unverified" |
| `confirmed_none` | The owner confirmed there is none (only possible when no address exists). | 70 points |
| `not_audited` | An address exists but has not been checked. | 0, flagged "needs a check" |
| `audited` | Reached and assessed. A score 0 to 100 and a list of problems. | 70 x (100 - score) / 100, capped at 35 if low confidence; a placeholder/parked page counts 65 |
| `audit_failed` | An address exists but the check could not be completed (reason code). **Says nothing about quality.** | 0, flagged "needs a manual look" |

## Scoring (0 to 100, computed by code, no model)
Website situation up to 70 (table above), phone listed 20, address listed 10. Priority: high from 60, medium from 35, low below. Every lead shows its own points and reasons ("Why this score?").

## Website audit (read-only, fixed checks, 100 points)
Secure connection 15, security certificate 10, works on phones 15, page title 5, search description 5, looks up to date 10, loads quickly 10, easy to contact 15, modern page build 10, language declared 5. Checks that cannot be judged (for example a page built by JavaScript) are left out and the result says "low confidence".
**Website content is untrusted.** The page is read only by fixed code patterns; nothing from it is copied into the result except numbers and the parsed address. Every sentence is a template, so a hostile page has nothing to inject into an agent's prompt. Map data is cleaned the same way (no backticks, no control characters), and results given to agents are labelled as untrusted data.

## Safety of each outside request
- **Map search:** the question is built only from fixed tables (an emirate code, a category's tags, a number). One fixed address (`overpass-api.de`). Results cached 6 hours; at least 6 seconds between searches.
- **Website check:** the same public-address guard as the browser connector (no private or internal networks, no IP numbers, no credentials, no odd ports), applied again on every redirect (at most 3); the connection goes to the checked address; 10-second timeout and an overall deadline; 1 MB limit; one GET, no cookies, no scripts.

## Saving is bound to exactly what the owner approved
Results are staged in memory only. `save_leads {batchId, rowsHash}` is a write, so it always waits for approval, and the approval is tied to a SHA-256 of the exact rows. If the rows change afterwards (more audits), or the batch expired, or the app restarted, nothing is saved. The file (`workspace/business-workforce/leads/leads.csv`) is written atomically with a backup of the previous version, UTF-8 with a byte-order mark (Arabic shows correctly in Excel), and formula-looking text is guarded against spreadsheet injection.

## The team (installed by an owner click, safe to repeat)
Business Researcher, Lead Scout, Site Auditor, Proposal Writer; three skills; one workflow ("Business: find, check and propose (UAE)") with three checkpoints. Everything is created OFF. Web reading (the existing "browser" switch) is given only to NEW Researcher, Lead Scout and Site Auditor. Existing agents with the same name are left untouched; the Manager's specialist list only grows.

## Where things are
`src/business/`: `markets.ts` (UAE, categories), `leads.ts` + `csv.ts` (record, dedupe, CSV), `audit.ts` + `netfetch.ts` (website check), `discovery.ts` (map search), `scoring.ts`, `staging.ts`, `store.ts`, `service.ts`, `connector.ts` (what an agent can ask for), `proposal.ts`, `team.ts` + `team-install.ts`, `routes.ts`. Dashboard: `web/src/pages/Business.tsx`, `components/business/LeadCard.tsx`.
Adding a country = adding an entry to `markets.ts`.

## Free resources used, and what is NOT verified
- OpenStreetMap through the public Overpass service: free, no key. **Not yet verified:** that the emirate codes (`AE-AZ`, `AE-DU`, ...) select areas on the live service, how complete the UAE data is, and the service's CURRENT usage policy (check before use).
- No LLM is needed for discovery, auditing or scoring. The agents do need a model (free tiers) for their own reasoning; each task uses a few calls.
- Not used: Google Maps/Places (paid, and scraping is not allowed), social-media scraping.
- Cold outreach: UAE data-protection (PDPL) and telecom-regulator rules apply to YOU. The app never contacts anyone by itself.

## Proposed first real tests (NOT run; waiting for the owner's approval)
Run by a one-off script that calls the same code directly (no agent, no LLM, no change to the saved lock setting):
1. **Map search: 1 request.** `POST https://overpass-api.de/api/interpreter`, body `data=` + this query (Dubai, fitness, 10 results):
   ```
   [out:json][timeout:25];
   area["ISO3166-2"="AE-DU"]->.a;
   (
     nwr["leisure"="fitness_centre"]["name"](area.a);
     nwr["leisure"="sports_centre"]["name"](area.a);
   );
   out center tags 10;
   ```
   User-Agent: `AIWorkforceDiscovery/1.0 (read-only business lookup)`. Checks: the emirate code works, the answer parses, how many have a website tag.
2. **Pipeline check on a neutral site: 1 request.** `GET https://example.com/` (the IANA example site), to see the website check work end to end without touching any business.
3. **Up to 3 businesses' own websites from test 1: at most 9 requests** (each check is 1 request, up to 3 if it has to try plain http or follow redirects). One GET of the home page each, User-Agent `Mozilla/5.0 (compatible; AIWorkforceSiteCheck/1.0; read-only homepage check)`.
Total: at most 11 external requests. Nothing is sent to anyone, nothing is saved unless you approve a save, and the results are printed for you to read.
