# Task-chain completeness (D-091)

2026-11-15. Owner selected implementation of checkpoint A from `RESULT-VERIFICATION-PLAN.md`, with synthetic/fake-service tests, full checks and preservation of staged verifier files.

## Behavior

`VerificationService.verifyChain` now reads each member's status/result together, retains lifecycle counts and computes the existing evidence checks. If any member is failed, cancelled, pending or running, a formerly verified aggregate becomes **unverified** with an explicit count/status warning. Contradicted and waiting verdicts remain stronger and retain their original explanation, followed by the completeness warning. An entirely non-completed chain remains not_applicable, with lifecycle details. A fully completed chain keeps its existing evidence verdict.

The chain response adds:

```
completion: { total, completed, pending, running, failed, cancelled }
incompleteTasks: [{ id, status }]
```

Existing fields/status vocabulary are unchanged. Recorded evidence remains visible but cannot override incomplete execution. The existing task panel receives the plain summary without needing new UI behavior. One-task verification and the pure combine function retain their existing contracts. Agent counts and verdict-change audit use the corrected chain verdict automatically; no new store or capability list. Audit deduplication still compares status/evidence, not every lifecycle transition.

Implementation: `src/verification/service.ts`. New tests: `src/verification/chain-completeness.test.ts`. No permission, gate, execution/retry path, provider, schema or dependency change.

## Evidence

Targeted verification suites: **42/42 passed**, including **14 new tests**; backend typecheck passed. Cases cover:

- Each failed/cancelled/pending/running child caps the chain while leaving one-task verification unchanged.
- Completed text-only work stays unverified; all-completed confirmed work stays verified.
- Contradiction/approval-waiting warnings survive alongside lifecycle details.
- Entirely non-completed chains and unknown chains retain their contracts.
- Child completion recomputes the verdict; repeated identical verdicts do not duplicate audit records; changed verdict and agent counts update.
- Incomplete chains do not promote agent confirmation counts.
- A fake denied file probe stays a note and contributes no file-confirmed evidence.
- Route-only Fastify injection returns the counts/warning while approval rows remain byte-for-byte equal as serialized. No provider, connector, gate or network listener is installed in that fixture. Existing unchanged verification tests continue to cover the full fake-provider app, no-action reads and unknown-task 404.

Initial new fixtures attempted invalid executed-to-failed/pending approval transitions and used a nonexistent app database handle. Corrected fixture construction to seed the desired synthetic starting state and use an injected route-only service. Existing database transition guards were not changed or bypassed in production. No existing test file was overwritten.

Staged P-49 `verify.ts` and `verification.test.ts` blobs and their working-file SHA256 values matched before/after implementation. No staging operation or commit performed.

Full `npm run check` passed: **2,101 backend tests (100 files), 447 dashboard tests (48 files), both typechecks and dashboard production build**. Existing Node DEP0190 and 999.91 kB main-bundle warnings remain. `git diff --check` passed. No separate backend build/browser/provider run; only documentation updated after the full check.

## Limits and remaining work

- This fixes **RV-2** from D-090 only. Connector-only claim matching (**RV-1**) and model-spoofable platform separator (**RV-3**) remain open. Do not interpret a completed chain as proof of exact action target/content, answer quality or every authored claim.
- Manager/workflow combined verification projections remain proposed, not implemented. No new endpoint or UI design added.
- No real model/service, browser, live database/key or crash/power-loss run. Tests use synthetic in-memory SQLite and fake probes only. No production server restart; ports 3000/5173 had no listeners before source edits.
- No migration, installation, external request, live data access or commit. Earlier staged and unstaged work remains separate.
