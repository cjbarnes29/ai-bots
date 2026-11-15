# Real-provider validation plan (M5 prepare, M8 run only after approval)

Status: **RUN ONCE 2026-11-07 (P-49); no rerun approval.** The owner approved a ceiling of 16 free Groq requests. The run used 9 requests on a scratch copy, which was deleted; the live database was rechecked with integrity `ok`. Raw assertion results: `docs/evidence/real-modernization/results.json`.

## What is NOT yet verified against a real provider
Everything built in D-081 to D-083 was tested with fake services and simulated worlds only: the capability registry and feasibility checker, automatic discovery, the Assistant's capability answers, independent result verification (M4), outside-action workflow boxes (M6), group collaboration with real models (NV-15). The facts that need a real model to be believed:
1. A real model's text answer is shown as "not checked" and never as confirmed.
2. A real model that boasts about an action it did not take is caught as "contradicted" (or honestly declines; either outcome is recorded, one sample proves nothing about frequency).
3. A real model asks for approval for a file, the owner approves, the file exists and the platform confirms it.
4. A workflow with a real bot step followed by an outside-action box waits for approval and continues after it.
5. The Manager accepts a possible goal and plans it with a real model.
6. Two real agents in a group: an @mention starts only the named one.
The Assistant's capability answers, the registry and the feasibility refusal use **no** provider request (rule-based) and were checked in the run at zero cost.

## Run results and limits (2026-11-07)
- 17/19 script assertions passed; 9/16 approved requests used. The provider was Groq only. The scratch database copy was deleted, and the live database integrity check returned `ok`.
- R1 passed: the real text answer remained `unverified`. R2 passed its safety assertion, but the model did not make an unsupported action claim, so claim detection was not exercised.
- R3 approval, execution and file existence passed. Its verification assertion failed because “has been sent for the owner’s approval” was classified as an external send. The detector now excludes approval/review handoff phrasing, with regression coverage; this change has not been rerun against a real model.
- R4 workflow and R5 Manager checks passed. R6 verified that the @mention started only the named bot. The reply assertion failed because the script expected old message property names; it now checks `senderKind` and `senderName`. The real reply content/identity has not been asserted by a corrected rerun.
- No additional real-provider request is authorized by the completed run. A rerun requires a new approval of an exact request ceiling.

## Original request estimate (script: `scripts/e2e/real-modernization.mjs`)
| Step | What | Requests |
|---|---|---|
| R0 | Registry, Assistant answer, refusal of an impossible Manager goal (no provider) | 0 |
| R1 | Real text task, expect "unverified" | 1 |
| R2 | Task that tempts a claim with no tool | 1 |
| R3 | File task through the approval gate, owner approves, platform confirms | 2 (action, final reply) |
| R4 | Workflow: bot step then outside-action box, approve | 1 to 2 |
| R5 | Manager run on a possible goal (plan, steps, review) | 3 |
| R6 | Group of two agents, one @mention | 4 to 5 |
| R7 | Assistant answer after the run (no provider) | 0 |
| **Planned total** | | **12 to 14** |
| **Ceiling to approve** | one spare attempt on two steps | **16** |

## How the count is enforced (not just promised)
- Free Groq only (`allowedProviders: ["groq"]`), every other provider switched off in the copy, retries off.
- The script runs on a scratch COPY of the database (`VACUUM INTO`, like `npm run backup`); the real database is only read. The copy holds the vault key and is deleted at the end; the live database is re-checked afterwards.
- Groq's daily request cap on the copy is set to today's use + 16, so the platform itself refuses request 17.
- The script refuses to start unless `AWP_APPROVED_PROVIDER_REQUESTS=16` and `AWP_USE_COPY_OF_REAL_DB=1` are both set.
- Pacing of 20 s after a step that used requests, because Groq's free tier allows about 8,000 tokens per minute per model.
- Fictional prompts only. Keys are never printed or written. Evidence goes to `docs/evidence/real-modernization/results.json` (no keys).

## What the owner approves
The owner approved **exactly 16 free Groq requests** for the single run already recorded above. A future run requires fresh approval of its exact count. The original command was:
`AWP_APPROVED_PROVIDER_REQUESTS=16 AWP_USE_COPY_OF_REAL_DB=1 node --import tsx scripts/e2e/real-modernization.mjs`
That approval covered only the one run already completed. It does not cover a rerun. Not covered: Gemini (no model is verified), other models, reliability (one sample each), real Gmail/Telegram/Drive, phones, screen readers, any use while the owner is away (all work stays supervised until Guardian Tier B is verified).

## Free alternatives already done
Fake-provider collaboration and verification are tested in `src/groups/groups.test.ts`, `src/verification/verification.test.ts`, `src/workflows/integration-nodes.test.ts` and browser scripts `groups-e2e.mjs` (44/44), `modernization-e2e.mjs` (34/34), `capabilities-e2e.mjs` (58/58 after the selector correction).
