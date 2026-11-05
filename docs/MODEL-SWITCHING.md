# Model switching and provider independence

Status 2026-11-05. Everything below was verified against FAKE providers only (local HTTP servers inside the tests). **No real provider has been contacted in this work.** Real connectivity and a real comparison are NOT verified (board NV-3, NV-23) and need the owner's approval of the exact requests (section 6).

## 1. What stays provider-independent, and where it lives
| Thing | Stored / decided by | Depends on the model? |
|---|---|---|
| Bot identity, role, responsibilities, instructions, version history | `bots`, `bot_versions` (application database) | No |
| Memory, project notes, project instructions | `memory_notes`, `projects` | No |
| Permissions, folder and application approvals, the approval gate, the Guardian | application code and database | No |
| Task state, task tree, results, reports, decisions, inbox | application database | No |
| Tool interface | the text protocol (```action and ```delegate blocks), parsed and validated by our code. Native provider tool calling is NOT used (`APP_CAN_USE.tool_calling = false`) | No: any model that can write text can use it |
| Instruction text | one builder (`src/runtimes/prompt.ts`): identity, role, instructions, ground rules, then the instruction order | No: identical for every model |
| Which model answers | the router (`src/routing/`) or the bot's explicit model | Yes, on purpose |

## 2. How a request is adapted to a model (the only place models differ)
`src/llm/providers/openai-compatible.ts` is the single adapter for every real provider. For a model that cannot take a system or developer message (the Gemma family, or any model that answers HTTP 400 "Developer instruction is not enabled"), the complete instruction text is placed word for word, in order, in a marked priority block at the start of the first user turn; history, tools and approved pictures are untouched. Any other HTTP 400 is an error and is not retried.

## 3. Output contracts (new, extends the router)
A caller that needs a certain form passes an `OutputContract` (`name`, `check(text)`) in `CompleteInput` (`src/llm/service.ts`).
- **Automatic model choice (`auto/...`):** a reply that breaks the contract counts as a failed attempt for that model (`bad_output`); the SAME request goes to the next eligible model. The attempt is limited by `maxAttempts` (default 3), by free-only rules and by usage limits like any call; every attempt is recorded.
- **Explicit model:** the call fails with a clear `bad_output` error. It is **not** silently re-routed to another model or provider.
- If every eligible model fails the contract: "No model could answer. Tried: model (bad_output), ..." Nothing is invented.
- Used by: Decisions (options, views) and Bot Studio drafts. The Manager keeps its own existing "ask once more with the stronger model" rule for its plan.
- A contract is checked by our code (`structured_output` is "unknown" for every model by name, so the app does not assume a model can do JSON; it checks the result).

## 4. The record is written by the platform (new)
When a task asks for outside actions or teammate work that did not simply succeed (waiting for approval, refused, not valid, failed), the task result gets a block written by the platform, whatever the model wrote in its final answer:

```
<the model's own final answer>

--- What the platform recorded (not written by the AI) ---
- telegram.send_message: WAITING for the owner's approval. It has NOT happened.
```
A model that says "All done, the message was sent!" is contradicted by the record. A failed task is `failed` with the reason, never `completed`.

## 5. Conformance results (fake providers): `src/llm/model-switching.test.ts`, 18 tests
Three simulated models behave differently on purpose: `gemma-3-27b-it` (rejects the system role, chatty, JSON in prose and fences, claims success after a request was only sent for approval), `llama-3.3-70b-versatile` (well behaved), `broken-8b-instant` (ignores formats, malformed action block, claims success).

| Dimension | gemma-like | llama-like | broken |
|---|---|---|---|
| Connectivity (test-connection, discovery, callable) | ok | ok | ok |
| Instruction adherence: identity + owner rule + project context + instruction order arrive | yes (folded into the first user turn) | yes (system role) | not tested (n/a) |
| Structured output | fenced JSON inside prose accepted | clean JSON accepted | refused with a reason; with auto routing the request moves to the next model; with an explicit model it fails clearly |
| Tool call (action block) | 1 pending approval, same arguments | 1 pending approval, same arguments | malformed block: nothing done, no approval, recorded as not done |
| Permission enforcement | denied without the owner's switch; allowed after it | same | n/a |
| Truthful result | claimed success; platform record says WAITING / NOT happened | wrote the truth | claimed "Done!"; record says not done |
| Task completion | completed with the model's text | same | provider error -> task `failed` with reason |
| Automatic switching | first model fails (HTTP 500) -> next model answers the same request, answerer reported, same name/rule/history; all models fail -> HTTP 502 naming what was tried; explicit model never re-routed |  |  |

Also in the earlier 37-check script `scripts/e2e/routing-e2e.mjs` (real app over HTTP, scratch database, fake local providers): 37/37 pass (re-run today).

**Mutation checks** (code broken, tests run, code restored): router accepting a contract-breaking reply, the explicit-model contract check, the platform status block, and dropping the instructions for a model without a system role were each caught (4 of 4).

## 6. What is NOT verified, and what needs the owner
- **Real providers.** As of today the live app shows Gemini (24 models enabled) and Groq (4) as connected with keys present. Their status comes from earlier owner-run tests, not from this work. The live usage log has 4 real requests, all errors: two `rate_limited` on `gemini-2.5-computer-use-preview` (fixed earlier) and two `bad_request` on `gemini-3.5-transcribe`. **A speech-transcription model was offered as a chat model**; that is the most likely source of the "Developer instruction is not enabled" error (the error text was not stored, so this is an inference). Fixed now: speech and transcription models (`transcri`, `speech`) are no longer listed by the Gemini and Groq plugins and are never chosen by the router. The model rows already in the live database stay until the owner presses Refresh models; automatic routing already skips them.
- **Proposed real verification (needs the owner's approval of exactly these requests; nothing has been sent):** 6 requests through the running app, all free-tier, all short:
  1. `POST /api/llm/models/:id/try` on `gemini/gemini-2.5-flash`: "Reply with the single word OK."
  2. the same on one Groq model (`groq/openai/gpt-oss-20b`; the live Groq list is allam-2-7b, openai/gpt-oss-120b, openai/gpt-oss-20b, qwen/qwen3.8-27b).
  3. and 4. the same two models, with a 1-sentence format test: "Reply with only this JSON: {\"ok\": true, \"word\": \"hello\"}" (checks that each can follow a structured-output request).
  5. and 6. a temporary bot (created, then archived afterwards) with the instruction "Always sign off with ZETA-7.", given the explicit model `gemini/gemma-4-26b-a4b-it` (a Gemma model that exists in the live list), asked twice ("Who are you?" and "Say hello"), to check the system-instruction fix against the real Gemini API.
  Automatic failover between two real models cannot be shown without causing a real failure, so it stays proven on fakes only.
- Real tool use, real structured output on every model, and quality of reasoning are not covered; models differ there and no application rule can make them identical.

## 7. Known limits
- Contract failover spends one extra model call per refused reply (free-tier quota). Capped by `maxAttempts`.
- A model that writes a valid-looking but wrong answer passes a format check; the contracts check form, not truth.
- The platform status block only covers outside actions and teammate work; it cannot judge whether prose answers are correct.
- Models already stored in the live database are not removed by the classification fix until a refresh.

## 8. Real-provider run (2026-11-04 22:47 to 22:50 UTC, owner approval P-26)
Through the running app and its existing Test chat / chat API, free tier only, no configuration, permission or schema change. Result of each approved request:

| # | Request | Provider / model actually used | HTTP | Result |
|---|---|---|---|---|
| 1 | Test chat "Reply with the single word OK." | gemini / gemini-2.5-flash | 502 (provider 404) | FAILED: Google: "no longer available to new users" (retired model, still listed in the catalog) |
| 2 | Test chat "Reply with the single word OK." | groq / openai/gpt-oss-20b | 200 | "OK", 594 ms, correct |
| 3 | Test chat, JSON format, Gemini | NOT SENT | n/a | the approved model is the retired one from request 1; a substitute (for example gemini-3.8-flash) is outside the approval |
| 4 | Test chat, "Reply with only this JSON: {\"ok\": true, \"word\": \"hello\"}" | groq / openai/gpt-oss-20b | 200 | exactly `{"ok": true, "word": "hello"}`, 560 ms, correct |
| 5 | Temporary bot, instruction "Always sign off with ZETA-7.", model gemini/gemma-4-26b-a4b-it: "Who are you?" | gemini / gemma-4-26b-a4b-it | 200 (after one internal retry) | NO HTTP 400. But the reply is a leaked `<thought>` block ending "I am Gemma 4, a large language model developed by Google DeepMind." Identity and sign-off NOT followed |
| 6 | same bot, same conversation: "Say hello" | gemini / gemma-4-26b-a4b-it | 200 | UNUSABLE: only a long, cut-off `<thought>` block, no greeting, no sign-off; recorded as a normal answer (no warning) |

Physical upstream calls: 6 for 5 sent requests (Gemini 4, Groq 2). Request 5 became two calls: the first got a temporary provider error (provider_unavailable, 1.2 s), then the app's own built-in retry (one retry after a temporary failure) succeeded after 14 s. All reported costs 0. Gemini 8 of 50 and Groq 2 of 50 daily requests used. The temporary bot was archived (disabled, all permissions off); its conversation and usage rows remain (append-only).

### What this shows
- **The 400 "Developer instruction" error did not occur** for Gemma 4 through the folded-instruction path. It does NOT prove the fix was needed or that folding is best for Gemma 4: without folding was not tested (not approved).
- **Gemma 4 does not obey the folded instructions.** Its own reasoning says it treats the instruction block (inside the user turn) as a prompt-injection attempt and keeps its own identity. So for this model folding keeps the text but not the priority: identity and the sign-off rule were NOT followed. The Gemma-3-style assumption "no system role" is probably wrong for Gemma 4 (it shows its own "Core Identity" system instructions, so the API probably accepts a system role). Untested.
- **New defect (app side):** models that print their reasoning (`<thought>...`) have it stored and shown as the answer, and a reply that is only an unfinished reasoning block is accepted as a successful answer. The Manager/Decisions contracts would reject such a reply (no JSON), but plain chat accepts it.
- Groq gpt-oss-20b followed both simple instructions exactly; real structured-output (JSON) works there.
- **Not verified:** a real Gemini JSON test (request 3), real automatic failover, real tool/action blocks, native system role on Gemma 4.
- **Catalog issue:** `gemini-2.5-flash` is retired for new users but still listed callable; the router could pick it. After a 404 model_not_found the app falls over to another model (proven on fakes) but keeps offering it.

### Suggested follow-ups (nothing done; each needs a decision)
1. Strip reasoning blocks (`<thought>`, `<think>`) from stored and shown replies, and treat a reply with nothing left as `bad_output` (code only, testable on fakes).
2. Mark a model unavailable after a provider "model not found / no longer available" answer so it is not offered again until a refresh.
3. One approved real request to test a native system role on Gemma 4, and a substitute Gemini model for request 3.

## 9. Superseded in part (2026-11-05)
The follow-ups listed in section 8 are built; see `docs/MODEL-REGISTRY.md` (reasoning protection, retirement handling, evidence-based instruction role, registry, evaluation).

## P-40 / P-41: switching, failover, recovery and the dashboard record (2026-11-05)

**Audit before the change.** Already built and tested with fakes: failover on rate limit, key rejection, outage, timeout and unusable replies; provider cool-down and recovery; per-model rest after a rate limit; capability filtering (`require`); every attempt in the usage log. **Missing:** a record of *which* model answered and *why* the router switched, a dashboard view of it, and explicit tests for timeout, context across a switch and recovery to the preferred model.

**Added (one routing system, nothing duplicated):**
- `ModelRouter` keeps the last 50 routing decisions in memory (`at, class, botId, attempts[{ref, outcome}], answeredBy, switched`) and writes every switch or total failure to the audit log as `routing.switched` (survives a restart).
- `GET /api/llm/routing/history`: `current` (the model answering now, per kind of task), `recent`, `switches` (from the audit log).
- Dashboard: Settings > AI Models > Model routing now shows **Answering now** and **Recent model switches** with plain reasons ("rate-limited", "timed out", "unavailable", ...), `web/src/components/RoutingHistory.tsx`.

**Simulated tests (scripted fake providers behind the real router, model service and usage log):** `src/routing/switching.test.ts` (9): healthy preferred model, switch on rate limit / timeout / outage with the switch recorded, conversation context identical for the failed and the answering model, return to the preferred model after its rest, a fallback lacking a required capability is never used, no switching around global limits, history capped at 50. Dashboard: `web/src/routingHistory.test.tsx` (3). Real browser (Edge, scratch app, fake local providers only): the panel showed "ollama/alpha:1b (unavailable) → omniroute/free/beta-70b (answered)" and "Answering now: omniroute/free/beta-70b".

**REAL-provider check (P-41, owner-approved: at most 8 Groq requests, 0 Google; `scripts/e2e/real-switching.mjs`; evidence `docs/evidence/p41-switching.json`): 11/11 passed, 2 real Groq requests used.**
- The preferred model was a local stand-in on 127.0.0.1 whose failures were injected by the script (**simulated part**). The fallback was **real Groq**, chosen by the app's own routing (`groq/qwen/qwen3.8-27b`).
- A: a real task ("three practical tips for a clear business email, in three bullet points") failed on the stand-in and was **answered by real Groq** with three correct bullet points.
- B: turn 1 answered by the stand-in ("noted" for code word AMBER-42); turn 2 failed on the stand-in and **real Groq answered "AMBER-42"**: the conversation context survived the switch.
- C: with the stand-in healthy again, the next request went back to it (recovery).
- History/dashboard data: two switches recorded with reasons; "answering now" back on the preferred model. Google was switched off in the scratch copy and was never called.
**Not shown with real providers:** a switch between two REAL providers (Gemini has no verified model, so Groq is the only real provider routing may use), a real rate limit or real outage (failures were injected locally), and Groq-to-Groq model switching under a real error.
