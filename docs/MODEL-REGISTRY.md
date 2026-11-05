# Model registry, verification and free-tier utilization (Gemini and Groq)

Status 2026-11-05. Built and tested with SIMULATED providers (local fake Gemini/Groq servers). The live app has been pointed at the real providers for **model-list discovery only** (6 read-only GET requests, no tokens, no chat). **No real chat request was sent in this phase.** Real verification of any model beyond the earlier P-26 run needs the owner's approval of the exact models and requests (section 7, board P-29).

## 1. What was found in the existing code (before changes)
- Eligibility was decided in two places: `checkCallable` (free policy, key, switched on, listed) and the router's `candidates` filter. Nothing recorded whether a model had ever been *tested*, what kind of model it was beyond name hints, or why one was excluded.
- Every model a provider listed was filtered by `isTextModel` and the rest were silently dropped, so non-chat models were invisible, and a speech model (`gemini-3.5-transcribe`) and an image model (`gemini-nano-banana-2.1`) had been offered as chat models.
- A retired model (`gemini-2.5-flash`) stayed "callable"; every request to it would be sent and refused again.
- A reply that was only the model's reasoning (`<thought>...`) was stored as a successful answer.
- The task engine ran separately started jobs strictly one at a time; the model service *refused* (not queued) calls above its concurrency limit.
- App-level daily cap per provider: 50 requests (an arbitrary low cap, see section 6).
- No migration was needed or made: the registry is one JSON document in the existing `llm_settings` table.

## 2. The registry (`src/llm/registry.ts`, `model-kinds.ts`, `evaluation.ts`, `registry-routes.ts`)
Three eligibility states, shown in Settings > AI Models > Model registry and at `GET /api/llm/registry`:
| State | Meaning | Automatic routing | Can be given to a bot |
|---|---|---|---|
| **Verified** | passed the core tests with real requests (connectivity, a simple instruction, JSON output) and has no failed test | yes | yes |
| **Unverified** | discovered but not (fully) tested, or a test failed | no | no |
| **Unavailable** | retired, no longer listed, not a chat model, switched off or otherwise blocked | no | no |
Per model it records: provider and exact id, kind, modalities, context window, output limit, the provider's own operation list (Gemini), tests with result/source/date/latency/detail, suitability, last verification, retirement, failure counts by category, limitations, usage and measured latency, rest (cooldown) time. Untested abilities are shown as untested, never assumed.

**Kinds** (a model is never offered as a general chat model unless it genuinely generates text): chat, reasoning, coding, chat with picture input, image generation, video generation, speech synthesis, transcription, other audio (music), embedding, safety filter, realtime/live, computer control, built-in agent system, other. The provider's own data wins (Gemini `supportedGenerationMethods`, Groq `active`), then the id.

**Tests** (one request each): connectivity + simple instruction ("Reply with the single word OK."), JSON output, identity + owner rule through the real bot system prompt, conversation history, a valid outside-action block, and (opt-in) a native system message. Error handling, rate-limit handling, timeout/retry, failover, permission enforcement and the approval gate are properties of the application and are tested with simulated providers (see section 5), not per model. Response consistency is read from repeated results over time (not a single request).

**Evidence-based instructions:** whether a model gets a real system message or the instructions folded into the user turn is stored per model once *tested* (`instructionRole`), instead of guessed from the name. A refusal during the test means "folded"; a model that accepts but ignores a native message is also switched to "folded"; the identity test then says whether that works.

**Previously recorded real evidence** (board P-26, 2026-11-04) is loaded for the real application only: `groq/openai/gpt-oss-20b` passed connectivity, instruction and JSON (verified for routing; system-role, history and action-block tests still missing); `gemini/gemma-4-26b-a4b-it` failed the identity test with folded instructions (unverified); `gemini/gemini-2.5-flash` was reported retired by Google.

## 3. Failure handling
| Category | Examples | Effect |
|---|---|---|
| temporary | network, timeout, HTTP 5xx, breaker open | counted; model unchanged |
| rate limit | HTTP 429, daily quota | the model rests (existing: 1/5/15/60 min or until the quota resets); verification kept |
| authentication | 401/403, key missing | provider-level; counted; no model is touched |
| unsupported request | HTTP 400 (for example a refused system role) | counted; during a test, recorded as a limitation or a failed test |
| bad output | reasoning-only reply, a reply that breaks an output contract | fails that call; automatic routing tries the next model |
| **retired** | HTTP 404/410/400 whose body says, about the model, "no longer available / decommissioned / deprecated / retired" (a bare 404 is NOT enough) | excluded with the provider's own words; **no further request is sent to it**; returns only after a refresh lists it again AND a real connectivity test passes, and then it must be verified again from scratch |

## 4. Reasoning-output protection
`src/llm/reasoning.ts`: a block at the very start of a reply (`<thought>`, `<think>`, `<thinking>`, `<reasoning>`, `<reflection>`; nested and repeated blocks handled by depth) is removed; a reply that is only reasoning, or whose block never closes, fails with `bad_output` (never recorded as a success, and automatic routing fails over). Tags later in a reply, inside code, or in prose about HTML are left untouched. A lone closing `</think>` (no opening tag) is recognised only for the model families that print it (Qwen, DeepSeek, gpt-oss and similar).

## 5. Routing, failover and utilization
- The existing router is extended, not replaced: candidates must be callable AND routable (verified); failover on model-level problems (`rate_limited`, `model_not_found`, `model_unavailable`, `model_mismatch`, `bad_response`, `bad_output`) and provider-level ones; the same request, history, instructions, output contract and permission context go to the next model; `maxAttempts` bounds it; the answerer is reported; all-fail gives one clear error naming what was tried.
- An explicitly assigned model is never silently replaced (tested). Paid models stay blocked by the free-only policy.
- **Bots can be given only models that are verified**; unverified, retired or non-chat models are refused with the reason; unchanged existing assignments keep working. The bot model dropdown greys out such models with the reason.
- **Sharing work** (`spreadLoad`, off by default; Recommended Settings suggests it): equally good models take turns, so both providers' free allowances are used.
- **Parallel chains** (`maxParallelChains`, default 1 = unchanged): separately started jobs may run together up to the owner's setting, never more than "simultaneous cloud requests" minus one slot kept for chat. Work inside one job stays in order. Tested: real overlap, the cap, no duplicated outside actions (three parallel jobs produce three separate pending approvals and nothing is sent).
- Rate limits use the provider's own retry/reset information (existing); resting models return by themselves. No invented quota figures: neither provider exposes remaining quota.

## 6. Decisions needed about capacity
1. **App-level daily cap of 50 requests per provider** is an arbitrary low cap and the main limit on use of the free tiers. The project rule is not to raise a provider limit without checking the provider's real quota; neither provider reports remaining quota and I did not invent one. Proposal (board P-30): with the owner's approval, set it to "no application cap" for Gemini and Groq and rely on the providers' own 429 responses and the per-model rest.
2. **Automatic capacity is one model today** (the strict verification rule): only `groq/openai/gpt-oss-20b` is verified. More capacity needs the real tests below.
3. `maxParallelChains`, `spreadLoad` and `maxConcurrentCloud` (default 2) are the owner's settings; none was changed.

## 7. Live inventory (discovery on 2026-11-05; 3 GET requests per refresh, two refreshes)
- **Gemini**: about 60 distinct models in total (21 via the OpenAI-compatible list, the rest only in Gemini's native list). Chat catalog (21): `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3-flash-preview`, `gemini-flash-latest` (moving alias), `gemini-2.5-flash` (**retired for this account**), `gemini-2.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.1-flash-lite-preview`, `gemini-3.5-flash-lite`, `gemini-flash-lite-latest`, `gemini-2.5-pro`, `gemini-3.1-pro-preview`, `gemini-3.1-pro-preview-customtools`, `gemini-pro-latest`, `gemini-4-argon`, `gemini-omni-1.1-flash`, `gemini-omni-flash-preview`, `gemma-4-26b-a4b-it`, `gemma-4-31b-it`. Context windows: 1,048,576 for the Gemini line, 131,072 for omni, 262,144 for Gemma 4. All unverified except that `gemini-2.5-flash` is unavailable and Gemma 4 has a recorded failure.
- **Groq** (11 listed, 4 chat): `openai/gpt-oss-20b` (**verified**), `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, `allam-2-7b` (4k context); others are speech, transcription or safety models.
- **Not chat models** (43 entries across both): image generation 8, realtime/live 9, speech synthesis 7, transcription 3, embedding 3, music 3, safety 3, agent systems 3, computer control 2, other 2. Three native-only names (`antigravity-preview-*`) can generate text but are not a recognised chat family; they are listed, not added, and need a manual decision.
- **Retirement alternatives**: for `gemini-2.5-flash` Google itself names `gemini-3.8-flash`. Suitable currently available general-purpose Flash model: **`gemini-3.8-flash`** (non-preview, 1,048,576 context, supports `generateContent`, listed as a thinking model). Alternatives: `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`; cheaper `gemini-3.5-flash-lite` / `gemini-3.1-flash-lite`; avoid the moving alias `gemini-flash-latest` for verification (its target can change).
- Provider rate limits per model are NOT exposed by either listing and were not invented.

## 8. Proposed real tests (NOT RUN; waits for the owner's approval, board P-29)
Everything goes through the app's own evaluation (`POST /api/llm/registry/evaluate`, owner-only, budget-limited, one request per test, stops at the first provider problem), free tier only, no configuration change.
**A. The two tests you asked me to prepare (2 requests):**
1. `gemini/gemini-3.8-flash`, test `json_output`: "Reply with only this JSON: {"ok": true, "word": "hello"}". Expected: exactly that JSON. 1 request (about 100 tokens).
2. `gemini/gemma-4-26b-a4b-it`, test `native_system_role`: a real system message (the bot prompt with the name Evaluator and the rule "Always sign off with ZETA-7.") and "Who are you? Answer in one short sentence." Expected: a reply naming Evaluator and ending ZETA-7 (native system role works), a refusal HTTP 400 (it needs folding), or an answer that ignores the rule (native role accepted but not obeyed). 1 request (about 500 tokens). Earlier this model needed 14 to 22 s and had a temporary 5xx, so the app's single built-in retry may make it 2 physical calls.
**B. Optional, to unlock capacity (22 more requests, about 8,000 tokens in total):** the full 5-test battery (counted as 5 requests each; for `gemini-3.8-flash` it includes test A1) on `gemini/gemini-3.8-flash`, `gemini/gemini-3.5-flash-lite`, `groq/openai/gpt-oss-120b`, `groq/qwen/qwen3.8-27b`; and the 3 missing tests (identity, history, action block) on `groq/openai/gpt-oss-20b`. Totals if A and B are both approved: 24 logical requests (Gemini 11, Groq 13; up to a handful more physical calls on temporary errors). Today's counters are Gemini 8 of 50 and Groq 2 of 50 (the app cap, section 6), so all of it fits.
Estimated free-tier use: well under 1 percent of any published daily allowance for these models as far as the app can tell, but the providers do not expose remaining quota, so this is an estimate, not a measurement.

## 9. Limits
Simulated-provider results are not real-provider results. A verified model is verified for the recorded tests only; a pass does not guarantee identical reasoning or wording from model to model. The registry stores facts and results, no secrets. Discovery depends on the providers' listings; the id rules for kinds are rules of thumb and the provider's own operation list overrides them where it exists (Gemini only).

## 10. Real run P-29 (2026-11-05, owner approved "all"): results
Free tier, through the app's own evaluation, 23 physical requests (Gemini 10, Groq 13) for 24 approved; reported cost 0. A first batch ran 12 requests; a second batch ran the approved requests that had not been used (Groq's 10-per-minute application limit had blocked two tests before they reached Groq).
| Model | Result | Status now |
|---|---|---|
| groq/qwen/qwen3.8-27b | all 6 tests passed (0.1 to 0.2 s) | **verified** |
| groq/openai/gpt-oss-120b | connectivity, instruction, JSON, identity, history passed; one early history probe returned an empty reply because the 64-token budget was used up by reasoning (probe budgets raised afterwards, history then passed); action-block test not run | **verified** (5 of 6 tests) |
| groq/openai/gpt-oss-20b | connectivity, instruction, JSON, history, action block passed; **identity FAILED** ("I am ChatGPT, an AI language model. ZETA-7": it signs off but drops the bot's name) | unverified (was the only verified model) |
| gemini/gemini-3.5-flash-lite | connectivity, instruction, JSON, identity, history passed; **action block FAILED** (no block written) | unverified |
| gemini/gemma-4-26b-a4b-it | **native system message accepted and obeyed**; the model is now sent real system messages. Core tests not yet run; the earlier identity failure came from the folded instructions and is shown as outdated | unverified (untested) |
| gemini/gemini-3.8-flash | **HTTP 503 "high demand"** on both attempts (4 physical calls, one a 60 s timeout); nothing learned | unverified (untested) |
Findings: (1) Gemma 4 does accept a native system role, so the earlier "ignores instructions" result was caused by the name-based folding; the evidence-based instruction role fixes that. (2) A strict "any failed test blocks" rule excludes useful chat models (gpt-oss-20b fails only on identity; 3.5-flash-lite only on action blocks): an owner decision whether such models may serve bots that do not need that ability (board P-32). (3) Application limits are low: Groq 10 requests per minute (a global limit) blocked two tests. (4) The probe token budgets were too small for reasoning models (fixed).
Live automatic routing now uses two verified models, both on Groq: qwen3.8-27b and gpt-oss-120b. No Gemini model is verified.
**P-30 carried out:** the daily cap is 10,000 for both Gemini and Groq (the app refuses to remove a cloud provider's cap entirely; that rule was not weakened). The separate per-minute limit (10) was not changed.
