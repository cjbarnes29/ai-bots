# Exact action/object matching (D-093)

2026-11-15. Owner selected implementation of `EXACT-ACTION-MATCHING-PLAN.md`, with fake-service checks, existing gates/chain safeguards, no staging/commit and a separate new working diff above P-49.

## Result

Task verification now matches a detected completion claim against **that task's exact recorded action and its source-declared operation/object**. Connector-wide BACKING lists are removed. Creating a Google Doc cannot confirm sending an email; a draft cannot confirm a send; Telegram does not support an explicit email claim; calendar events cannot confirm spreadsheets or invitations; folder creation cannot confirm a saved spreadsheet. A trash move cannot confirm rename/permanent deletion.

Supporting checks name the approval ID and connector.action and state that target, content and delivery were not checked. Matching action type is not proof of factual correctness, recipient identity, artifact identity, content, cardinality or remote delivery/read status.

## How it works

- ActionSpec has optional, closed `resultSupport` operation/object declarations owned by each connector. Nineteen reviewed actions declare their types in Telegram, Gmail, documents, PC, memory, GitHub, Notion and Google Workspace. No second capability registry or permission mechanism.
- app.ts supplies metadata by ConnectorRegistry.action's exact own-property lookup, accepting write specs only. It does not execute, authorize, check readiness/credentials, ask a model or contact a service. VerificationService copies/validates the declarative shape; missing/throwing resolver or malformed metadata remains unknown. Metadata accessors are rejected without calling them.
- Generic MCP/n8n/command/server/install/desktop/form actions and Business batch saves have no specific-effect declaration. Their execution remains visible but caps an otherwise confirmed result at unverified, even if the reply makes no recognized claim. A known action cannot erase another unknown effect.
- Every action fact must belong to the task being checked. An unrelated task's send or a workflow's unbound approval is not borrowed.
- A known incompatible operation/object produces an unsupported-claim contradiction. An unknown effect or ambiguous object produces an unchecked note and unverified ceiling. No executed action plus a completion claim still contradicts. Failed actions remain stronger; pending/approved requests retain waiting behavior; denied/expired add no evidence.
- File checks still use the existing gated probe; existence/size does not support an email send. D-091 incomplete-chain ceiling, audit/agent-count consumers and all execution/approval/folder/Guardian rules remain intact. Old verdicts can become less confident when recomputed; no approval or action is modified/replayed.
- English matching remains bounded to 20,000 characters/eight claims and short local object clauses. Added operation/object interpretation includes email drafts, invitations, append/post-comment and permanent-delete wording. Unknown objects stay unverified rather than guessing. This is deliberately limited pattern matching, not language understanding.

## Changed files and separated staged work

| Area | New working change |
|---|---|
| connectors/types.ts | Optional closed metadata types/constants on ActionSpec |
| Owning connector definitions | Declarative metadata only; execute/authorize functions unchanged |
| verification/action-support.ts | New defensive metadata-copy helper |
| verification/verify.ts | Exact operation/object matcher, task ownership, unknown-effect ceiling and scoped check details; P-49 handoff exclusion retained |
| verification/service.ts and app.ts | Exact read-only metadata resolver/materialization; earlier D-091 lifecycle logic retained |
| verification/action-matching.test.ts | New pure/service/fake-app regressions |
| verification/action-support-contract.test.ts | New source-action contract tests using throwing PC/memory/network/DNS dependencies |
| verification/verification.test.ts | Existing fixture actions gain explicit synthetic metadata; original assertions and P-49 cases retained |
| verification/chain-completeness.test.ts | Fake exact-action resolver added; original completeness assertions retained |

**Index unchanged:** staged verify.ts blob `4a0b918a79e2f68ed4a629b21246c494cf197c7d`; staged verification.test.ts blob `7f003fcb877831c1601e4fd1e7486e3c738b3a96`. Unlike the planning checkpoints, their working files now intentionally contain the approved additional edits. The separation is inspectable with:

```
git diff --cached -- src/verification/verify.ts src/verification/verification.test.ts
git diff -- src/verification/verify.ts src/verification/verification.test.ts
```

The first shows only the original staged handoff-language fix/tests. The second shows this implementation above that exact baseline. Nothing was staged, unstaged, committed or merged with earlier P-49 work.

## Evidence and corrections

New tests cover the Google Doc/send counterexample, positive type matches, email vs message/draft/event/folder/trash/comment/note distinctions, foreign/unbound task receipts, unknown effects even without claims, mixed known/unknown actions, ambiguous objects, all approval states, injected metadata wording, sentence boundaries, bounded parsing, malformed/accessor metadata and independent copies. Service tests cover missing/throwing resolvers without changing requests. Contract tests check all nineteen declarations, undeclared reads/generic actions and exact registry lookup.

The fake-app test creates one synthetic document request, confirms it has not executed before owner approval, approves it through the normal API, observes exactly one fake execution, then rejects the email-send claim. Verification adds no model or action call. No real Google service is used.

Intermediate verification suites passed 112/112; subsequent append/resolver cases are included in the final full run: **115 verification cases across four files, including 73 new cases**. Initial fixture type errors used an unavailable taskEngine property and a wrong browser fake dependency name; fixed to ordinary task polling and throwing request/lookup fakes. A larger restricted-environment targeted run passed 218 and failed 35: fake HTTP services were unreachable and two existing test-owned process-stop cases timed out. No guard/assertion was weakened; full checks were rerun with their normal local test execution permissions.

**Final `npm run check` passed:** 2,174 backend tests (102 files), 447 dashboard tests (48 files), both typechecks and dashboard production build. The previously failing connector/harmless-process suites passed in this full run. Existing Node DEP0190 and large-bundle warning (999.91 kB main JS) remain. `git diff --check` passed; new files are not ignored. No separate backend build/browser/provider run; only documentation changed after the full run.

## Remaining limits

- **RV-3 trusted reply provenance remains OPEN.** A model-supplied platform separator can still hide authored text under the pre-existing split rule. Action-type matching alone cannot certify every authored claim until that boundary is trustworthy.
- Exact targets/content/count, real remote receipts, file contents, semantic quality, non-English/other claim phrasings, historical action implementation versions and Manager/workflow combined verification remain unverified/unbuilt. Installed metadata is a current source contract, not a durable versioned remote receipt.
- No migration, dependency, real-service request, live database/key access, browser/desktop-host drill, production restart or commit. App ports 3000/5173 had no listeners before edits. Automated checks use fake services, synthetic databases/probes and the existing harmless test-owned process cases; no owner window was used.
