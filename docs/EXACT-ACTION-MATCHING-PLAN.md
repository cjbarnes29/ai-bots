# Exact action matching proposal (D-092)

2026-11-15. **PLAN ONLY. No application/test changes or new tests run.** Owner selected a local specification of which recorded actions support which claims, with an exact patch and fake-service tests. D-091 chain completeness is already implemented; this proposal addresses RV-1 in `RESULT-VERIFICATION-PLAN.md`. RV-3 reply provenance remains separate work.

Implementation follow-up: owner selected this proposal under **D-093**; exact action/object matching and unknown-effect ceiling are now implemented. See `EXACT-ACTION-MATCHING.md` for tests, scope and staged-vs-working diff separation. The D-092 proposal below is retained as history; RV-3 provenance remains open.

## Decision proposed

Replace connector-wide claim support with **exact connector + action + declared operation/object matching**. Declare those semantics on the existing trusted ActionSpec owned by each connector. Read them through ConnectorRegistry.action; never call execute, verify, authorize, notReady, a provider or a secret lookup to determine a verdict. No second capability registry, database table, migration or dependency.

Example: an executed `gworkspace.drive_create_doc` supports creating a cloud document. It does not support sending email, deleting a file or publishing a public page. `documents.create_email_draft` supports saving a local draft, never sending it. `telegram.send_message` supports a message send, never an explicit email send.

This establishes **action-type support**, not exact recipient, artifact identity, content, count, delivery/read status or factual correctness. Use that wording in check details. Current human-readable results and clipped summaries do not supply trustworthy typed remote receipts. Target-level verification needs a separate specification; do not imply it is solved here.

## Current source findings

- `verify.ts` receives both action ID and connector but currently uses only `BACKING[claim.kind].includes(action.connector)`. Its four broad categories also group created/saved/scheduled/booked and published/posted/uploaded/submitted together.
- `VerificationService.actions` reads approval_requests by exact task_id. Only executed rows can support completion claims. Pending/approved/failed/denied/expired retain their current treatment. D-091 lifecycle ceiling remains above claim checks.
- ConnectorRegistry.action already does an own-property lookup of an exact action key. It is the appropriate metadata lookup; do not use substring matches, action-name prefixes, descriptions, model output or summaries as declarations.
- Gate reads return text and audit external.read; they do not create these approval rows. Metadata must not turn a read into a recorded write or grant any permission.
- The existing P-49 handoff-language fix and tests are staged. Preserve that content and show any future edits to the same files as a separate additional diff. Do not stage/unstage or replace those files wholesale.

Inspected implementations: `src/connectors/{types,telegram,gmail,documents,integrations}.ts`, `src/connectors/pc/connector.ts`, `src/connectors/browser/browser.ts`, `src/{memory,business,desktop,project-workspace}/connector.ts`, `src/verification/{verify,service}.ts`, registry construction in app.ts. Source inspection only: no factories, connectors, network calls, app, database or vault opened.

## Proposed action matrix

These declarations describe the implemented action contract after a recorded successful execution; they are **not live-service verification**. Object restrictions matter: creating an event cannot support creating a spreadsheet merely because both use “created.”

| Exact action(s) | Allowed completion operation/object | Must not support |
|---|---|---|
| gmail.send_message | send email/message | save document, publish page, delete; exact recipient/delivery is unchecked |
| telegram.send_message | send message | explicit email send, public publishing/uploading |
| documents.create_document | create/save/write document/file | send, publish, delete |
| documents.create_spreadsheet | create/save/write spreadsheet/workbook/sheet/file | email send, generic public publication |
| documents.create_presentation | create/save/write presentation/slides/file | send/publish/delete |
| documents.create_chart, create_diagram | create/save/write chart/diagram/file | send/publish/delete |
| documents.create_email_draft | create/save/write draft/file | send email/message, delivery |
| pc.write_file | create/save/write file | send, publish, delete/rename |
| pc.make_dir | create folder | create/save spreadsheet, delete/rename |
| pc.delete_path | remove original path by moving to trash | permanent erase, rename to an arbitrary requested destination; current parser groups rename with delete, so separate them |
| gworkspace.drive_create_doc | create/save cloud document | email send, public publish/upload claim, remove |
| gworkspace.calendar_create_event | create/schedule calendar event | email/invitation send (implementation has no guests and sendUpdates=none), create file/spreadsheet, booking confirmed by another party |
| gworkspace.tasks_create | create task | send email, schedule calendar event, create file |
| github.create_issue | create issue | arbitrary public publish/upload, save local file, delete |
| github.comment_issue | add/post issue comment | create issue, publish page, upload file, delete |
| notion.create_page | create/save page | publish page publicly, delete, send |
| notion.append_text | add/write text to page | create a new page, publish publicly, remove |
| memory.remember | save/create private note | create a disk file, send, publish |
| business.save_leads | **unknown specific saved-row effect in this slice** | a returned batch summary can include added/updated/skipped rows; do not certify “saved all leads” or an exact new-row effect from action identity alone. Leave undeclared until a typed count/receipt contract is specified |
| browser.submit_form | **unknown specific business effect** | no confirmation of booking, purchase, publication or message delivery from an arbitrary response; current function returns response text/status, including redirects, rather than a typed accepted-submission receipt |
| n8n.start_workflow | **unknown downstream effect** | do not infer any send/save/publish/delete/booking merely because the trigger request returned |
| mcp.call_tool | **unknown tool effect** | same; tool name/description/returned text is untrusted data, not a declaration |
| pc.run_command, start_server, install_dependencies | **unknown claim-specific effect** | a completed command does not independently establish that a file was saved, email sent or page published |
| desktop.run_steps | **unknown claim-specific effect in this slice** | no inference of file save/send/publication from a generic plan. Do not run desktop tests or change engine guards for metadata matching |
| All read actions, including workspace.read_entries/search | no write-effect declaration | no invented approval/effect evidence; reads still require their own permissions |

“Remove” here means trashing the original path, not permanent deletion. “Published” or “uploaded” has no generic supported declaration in the current matrix. An issue/comment/Notion page is not proven public. No current action implements an arbitrary file rename or externally confirmed reservation; do not declare those effects.

## Exact patch contract

### 1. Trusted metadata and lookup

In `src/connectors/types.ts`, export a closed `ResultOperation` union (`send`, `create`, `save`, `write`, `append`, `schedule`, `remove_to_trash`, `post_comment`) and `ResultObject` union (`email`, `message`, `file`, `folder`, `document`, `spreadsheet`, `presentation`, `chart`, `diagram`, `draft`, `event`, `task`, `issue`, `comment`, `page`, `note`, `lead_rows`). Add optional `resultSupport?: readonly { operation: ResultOperation; objects: readonly ResultObject[] }[]` to ActionSpec.

Only reviewed source declares support. Empty/omitted metadata means unknown, never inherited from connector ID or kind=write. This field cannot carry a function or request permissions. Imports/templates/AI drafts cannot set it. Declare matrix entries at the owning action definitions, not in a central second list. Broad/generic actions can omit it; do not edit desktop/PC execution code to make a declaration possible.

Add an optional read-only resolver to VerificationDeps, e.g. `resultSupport(connector, action)`. app.ts injects `registry.action(connector, action)?.resultSupport` via an immutable copied value. It performs metadata lookup only. A missing resolver in standalone fixtures is unknown, never a connector-wide fallback. Read ActionSpec.kind to reject declarations for reads defensively. Validate/ignore malformed tags from JavaScript-defined test/custom connectors; invalid or unknown metadata caps confirmation instead of throwing or executing anything.

Extend ActionFact with optional normalized `resultSupport` and materialize it from that resolver in `VerificationService.actions`. Do not put these derived facts into approval args or change the immutable stored request. Existing rows are assessed against currently installed exact-action definitions. This does not establish historical implementation-version identity; replaced/removed/custom definitions with no trustworthy compatible contract remain unknown. Durable versioned receipts are outside this patch.

### 2. Claim interpretation and verdicts

Keep bounded, linear claim scanning, negation/plans/questions exclusions and the staged P-49 review/approval handoff exclusion. Preserve the existing broad `kind` for compatibility, adding a normalized operation and optional object constraint. Use the already captured verb plus bounded local object words; do not rescan the rest of a long file or ask a model.

Explicit `emailed` or “sent the email” requires email send. Generic “sent a message” may use email/message send. Saved spreadsheet requires spreadsheet or a file-producing action with a compatible explicit object contract, never calendar/task creation. `renamed`, `booked`, `published`, `uploaded` remain recognized claims but have no supporting effect in this initial matrix. `posted` requires explicit comment context for post_comment; it cannot assume a public publication. Unknown/ambiguous objects or omitted recipients do not become exact identity proof. Ambiguous action/object interpretation caps confirmation at unverified instead of inventing a match.

For every detected claim, inspect only executed rows for this exact task. Record the supporting approval ID and connector.action in check details, plus “action type only; target/content not checked.” Do not credit one task's action to an unrelated task. Chain aggregation continues to combine each task's own verdict.

| Evidence situation | Required result |
|---|---|
| A known, exact executed operation/object supports the claim | claim_supported check for action type; retain all other checks and ceilings |
| All candidate executed actions have known incompatible semantics, e.g. only drive_create_doc for an email send | claim_unsupported fail → contradicted |
| Unknown metadata/ambiguous claim could account for the effect, but no known support | explanatory note and unverified ceiling; do not claim false success or assert proof of failure |
| No executed actions at all; agent asserts completion | preserve current unsupported-claim failure, mentioning pending approval if present |
| Any failed action | preserve contradicted |
| Pending/approved action with honest waiting text | preserve waiting; declared semantics never bypass owner approval |
| Denied/expired action without success claim | preserve current informational treatment; no evidence credit |
| Unknown-effect execution, even without a recognized claim | show recorded execution but cap otherwise verified to unverified; an opaque tool success is not proof of an interpreted result |

Maintain existing `evidence` as a count of independent recorded checks, separate from coverage. A note/unknown effect adds no extra evidence. A known matching action does not erase uncertainty from another opaque execution. Stronger contradicted/waiting outcomes outrank the new unknown-effect ceiling. D-091's incomplete-chain ceiling stays intact. Add check kinds `action_effect_unknown` / `claim_unchecked` if needed; web check.kind is already a string. Keep existing status vocabulary and API routes.

### 3. Scope of files and order

1. Shared types: connectors/types.ts; normalized claim types/matcher: verification/verify.ts; metadata resolver/materialization: verification/service.ts and app.ts.
2. Explicit declarations in telegram.ts, gmail.ts, documents.ts, integrations.ts, pc/connector.ts and memory/connector.ts, limited to the matrix. Generic actions, business batch saves and read paths remain without declarations. These changes alter result interpretation only; no execute/authorize/gate/FolderGate/Guardian path changes. Read the applicable domain/security docs before future edits.
3. New `src/verification/action-matching.test.ts` and `src/verification/action-support-contract.test.ts` after checking tracked/untracked existence. Add a small service/route integration fixture with fake connectors; do not overwrite the existing staged verification test. Existing pure fixture actions will need explicit synthetic semantics to keep positive tests honest: present that additional test delta separately above the preserved P-49 staged baseline. Do not weaken original assertions to retain an old false positive.
4. Update CAPABILITIES, plan/decision/progress/security/handover records. No new navigation, page, schema, endpoint, dependency or provider run.

Recommended internal implementation sequence: pure matcher/types + exhaustive table tests → owning metadata and resolver → current fixture declarations → fake app regressions → full check. Do not ship a temporary connector-wide fallback between those steps. Do not stage or commit automatically.

## Required fake-service tests (proposed, NOT run)

| Group | Cases and assertions |
|---|---|
| Core false-positive fix | Completed task + executed gworkspace.drive_create_doc + email-send claim is contradicted; same action + document-create claim is type-supported. No provider/Google call. |
| Medium and object distinctions | Telegram cannot back explicit email; Gmail can back email; draft file cannot back send; calendar event cannot back spreadsheet/invitation/booking; make_dir cannot back saved spreadsheet; trash move cannot back permanent erase/rename; comment cannot back public publication; memory note cannot back disk-file creation. |
| Unknowns | Removed connector, missing exact action, generic MCP/n8n/command/desktop, absent resolver, malformed metadata and ambiguous object all remain unverified when otherwise eligible. Metadata wording in a model reply or tool result changes nothing. No substring/inherited-property match. |
| Status and ownership | Pending/approved/denied/expired/failed rows keep current semantics; failed action still contradicts. Foreign task's matching send is not borrowed. Read action metadata is rejected; checking never asks for/approves/retries/executes anything. |
| Chain regression | Four D-091 incomplete child states cannot yield verified; all-complete correctly matched chain retains type confirmation; unknown effect remains visible at chain/agent count level. Audit changes only for changed status/evidence as currently defined. |
| File/wording regression | Gated file existence/size/missing/unreadable behavior unchanged. Preserve P-49 owner-approval/review handoff cases, genuine send detection, negations/plans/questions and platform-notes exclusion. File presence cannot support an email-send claim. |
| Bounded matching | Hostile long text/ambiguous repeated verbs remains within current scan limits and linear-time timing expectations. Multiple claims require appropriate effect types; one generic receipt never establishes many target identities. |
| Contract matrix | Table-driven checks on action declarations: each known source action has its intended operations/objects; all generic/read actions have none. Construct only with fake dependencies. Browser/fetch/desktop/process/SDK functions are throwing fakes; no real host, network, path or guard mutation. |

Run new pure/contract/service tests, existing verification and chain-completeness suites, relevant connector regressions with fakes, then full `npm run check`. Any existing test requiring metadata should get explicit fake declarations while retaining meaningful expectations. No real model, browser, desktop host or live database/key run is needed for this patch.

## Rollout, compatibility and remaining limits

- No persistent change. Recomputed old verdicts and agent counts can become unverified/contradicted after this change; explain that evidence interpretation became stricter, not that requests were modified or replayed. Audit records remain history.
- ResultSupport is optional for connector compatibility, but omission is intentionally conservative. Test/custom connectors with no declarations stop providing claim-type confirmation; they still execute only through the unchanged gate when separately permitted.
- Existing staged P-49 verifier blobs at planning start/end: verify.ts `4a0b918a79e2f68ed4a629b21246c494cf197c7d`; verification.test.ts `7f003fcb877831c1601e4fd1e7486e3c738b3a96`. Working-file SHA256 values also matched before/after. `git diff --check` passed; the new document is not ignored. Implementation will necessarily add visible unstaged deltas to these files without changing the index.
- RV-3 spoofable text separator is NOT fixed here. Until trusted authored-text provenance exists, an action-type matcher alone cannot reliably certify every authored claim. English/bounded-pattern coverage, exact target/content/count, remote receipts, file contents, historical connector versions and Manager/workflow aggregate checks remain unverified or unbuilt.
- Last full implementation check remains D-091: 2,101 backend + 447 dashboard tests, both typechecks/dashboard build. No test/full-check run for this documentation-only proposal. No installation, database/key access, outside request, app change or commit.
