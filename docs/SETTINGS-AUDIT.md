# Settings audit: free tiers and available resources for operating desktop applications

Purpose: find out which existing services, models, integrations and tools can operate **approved** desktop applications at **zero additional cost**, before an application execution engine is chosen or built.
Audit date and provider-fact verification date: **2026-11-04**. Facts about providers come from their own pages, fetched that day; anything I could not confirm there is marked **UNVERIFIED** and was not used to recommend anything. Provider pages mention models newer than my own training knowledge; I quote them as the page states them.
Nothing was installed, registered, connected, purchased or activated. No API key was read, printed or copied (none exists on this PC, see 1.1). The only network access was reading public documentation pages.

## 1. What is configured today (read-only inspection)
### 1.1 State of this installation
| Item | Finding |
|---|---|
| Providers (Gemini, Groq, OpenRouter, Ollama, OmniRoute) | All five exist as entries and are **switched off**; none confirmed free; no connection ever tested |
| API keys | **None.** The vault holds 0 secrets and there is no `.env` file. (Board NV-3: the Gemini key is the owner's to create.) |
| Models | **0** models listed, 0 enabled |
| Usage | **0** recorded requests, nothing to report on quotas |
| Local AI | **Ollama is not installed** (not on PATH). OmniRoute: stated as installed by the owner earlier, not running, not inspected |
| Hardware (board T-8) | Intel Core 5 120U, 23.6 GB RAM (7.2 GB free when measured), Intel integrated graphics only, no NVIDIA/CUDA. Local models run on the CPU |
| Integrations (Integrations Center) | Telegram, Gmail, GitHub, Notion, n8n, MCP, Google Workspace: all unverified against the real services (board section 5) |

### 1.2 What the platform can and cannot do with a model today (code)
- **Text only.** The one model adapter sends `model`, `messages`, `temperature`, `max_tokens`, `stream=false`. A message's content is a plain string: **no image input, and no tool or function calling**; if a model asks for a tool, the request is ignored (`src/llm/types.ts`, `docs/PROVIDERS.md`). So **no provider can read a screenshot or call a function through this app today**, whatever the provider offers. This is the largest single gap (section 7).
- Free-only is locked on; a model must pass a free-status check to be callable; daily request caps (Gemini 50, Groq 50, OpenRouter 40, OmniRoute 40; Ollama none) are **the app's own caps, not the providers' real quotas** (board T-5, D-017); limits, a pause switch, a circuit breaker and automatic routing across free models already exist.
- Existing tools (no extra cost): the PC agent (file actions and a closed list of developer commands: node, npm, git, python, adb, code), the document writer, a read-only web page reader (no scripts, https only), Telegram/Gmail/GitHub/Notion/n8n/MCP connectors behind the approval gate, memory, workflows, schedules.
- Desktop and browser automation libraries: **none are a dependency.** `playwright-core` is only a dev dependency of the dashboard tests; Microsoft Edge is installed. AutoHotkey, Tesseract, FFmpeg, a real Python: not installed (board T-6, T-10; Tesseract re-checked today).
- Built into this Windows (verified today): **.NET UI Automation** (`UIAutomationClient` loads in Windows PowerShell 5.1 on this PC). It reads the structured tree of an application's windows, buttons and fields and can invoke them, with no screenshot and no AI model. Windows also ships a built-in OCR engine; **its availability on this PC was not checked**.

## 2. Free-tier verification (official pages, 2026-11-04)
| Question | Gemini API | Groq | OpenRouter | Ollama |
|---|---|---|---|---|
| Permanent free tier? | **Yes, with limits.** The pricing page lists a Free tier for several current models (Gemini 3.8 Flash, 3.6 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite, 3 Flash Preview, Gemma 4, embeddings, speech). 2.5-series models are listed free but **deprecated and rerouted on 2026-12-01** | **A Free plan exists** (its tab is named on the rate-limit page) but the free figures are only visible after sign-in. **UNVERIFIED** | **Yes, for `:free` models** | **Local use: free and unlimited** (FAQ: "Running models on your own hardware is always unlimited") |
| Temporary trial? | The free tier is described as "Active project or free trial"; no expiry stated | Not stated | No | No |
| Card needed? | **Page does not say** (UNVERIFIED) | **Page does not say** (UNVERIFIED) | Not stated for free models | No |
| Limits | Per **project**; RPM, input-tokens/minute, requests/day (reset midnight Pacific); "not guaranteed"; real numbers are shown in AI Studio, not on the docs page | Per organisation. Third parties quote ~30 req/min and ~1,000 req/day for Llama-4-class (disagree on tokens). **UNVERIFIED** | `:free` models **20 req/min, 50 req/day** until 10 credits have ever been bought, then **1,000/day** (per-minute stays 20). Buying credits is a purchase: never automatic here | None locally beyond this PC's speed |
| Commercial use | Not verified | Not verified | Not verified | Per model licence (not checked) |
| Data / privacy | **Free tier: "Used to improve our products: Yes"** for most models; paid tier: No | Not verified (pricing page silent) | OpenRouter stores no prompts unless you opt in; **underlying free providers' handling is not stated** on the page checked | Local models: nothing leaves the PC |
| Images / screenshots | Pricing page lists image/video input for several models | **Not shown** on the official model table (UNVERIFIED) | Depends on model; not verified | Library has many vision models (2B to 27B); the 27B one is 18 GB |
| Tool / function calling | Believed yes; **not confirmed on the pages read** | Not shown on the page read | Not verified | Library lists "tools" for most vision models |
| Paid risk | Paid tier exists; stays free only without billing | Paid Developer plan exists | Negative balance can block even free models | **Ollama "cloud" models are paid per token** ($0 plan has no credits) |

Other services checked: **GitHub Models was retired on 2026-07-30** (not an option). **Cloudflare Workers AI**: 10,000 "neurons"/day free, fails beyond the limit on the free plan, charges only on the paid plan; card requirement not stated; model list and vision not evaluated. **Mistral La Plateforme**: official pages not reachable (404); third parties say a free "Experiment" tier exists with data-training opt-in: **UNVERIFIED, not recommended until read at the source.**

## 3. Free-tier comparison (cost classes: 1 permanently free, 2 free with usage limits, 3 temporary trial/credits, 4 paid, 5 local/open-source no API cost, 6 unknown/unverified)
| Provider / tool | Class | Relevant capabilities | Limits | Suitable tasks | Recommendation |
|---|---|---|---|---|---|
| **Windows UI Automation** (built into Windows; verified loadable) | 5 | Reads application controls as text; can click/type through control patterns; needs no model | None (local) | Finding and operating controls in most standard Windows programs; reading what is on screen as text | **Use first.** Needs a fixed read/act script like the discovery one, gated by the access module and approval. Not built |
| **Windows built-in OCR** | 5 (UNVERIFIED on this PC) | Text from a screenshot, locally | Local | Reading text in programs that expose no controls | Check availability; free fallback before any vision model |
| **Ollama (local)** + a small vision model | 5 | Image + (listed) tool support, private | This PC: CPU only, ~7 GB free RAM when measured; speed/accuracy on screenshots **untested** | Reading screenshots of **private** screens; light planning | Best private option; **needs your approval to install**; test one 2B-9B model. The 27B model (18 GB) does not fit comfortably |
| **Google Gemini API free tier** | 2 | Strong general models; image input; large context | Per project, unpublished in docs; app cap 50/day | Manager planning; reading screenshots of **non-private** screens | Best free cloud option. Free-tier content is used by Google: never private screens. Needs the owner's key (NV-3) and app image support (not built) |
| **Groq free plan** | 2 (limits UNVERIFIED) | Very fast text models (Llama 3.x, gpt-oss) | Quoted by third parties only | Worker steps, quick planning | Good text helper; do not rely on it for screenshots (vision not shown) |
| **OpenRouter `:free` models** | 2 | Many models, rotating | 20/min, 50/day (1,000/day only after buying credits) | Occasional text fallback | Too few requests for step-by-step work; fallback only |
| **OmniRoute** (local gateway) | 6 | Gateway; adds no capability; upstream decides terms | Upstream | Optional route | Keep; not evaluated |
| **Cloudflare Workers AI** | 2 (partly verified) | Hosted open models | 10,000 neurons/day free | Possible text/vision fallback | Candidate only; research models/vision first; not connected |
| **Ollama cloud models** | 4 | Large hosted models | Per token | none | **Blocked in this app** (new guard) |
| **GitHub Models** | n/a | Retired 2026-07-30 | | | Not an option |
| **Mistral free tier** | 6 | | | | Unverified; not recommended yet |
| **PC agent / document writer / Telegram, Gmail, GitHub, Notion, n8n, MCP** | 5 (existing, no per-use fee) | Files, developer commands, messages, documents | App safety limits | Hand-offs around desktop work | Reuse as they are |
| **Browser reader** (existing) | 5 | Fetches public pages' text; no scripts, no clicks | App limits | Reading public information | Not desktop automation |
| **Playwright / Edge automation** | 5 (dev dependency only; Edge installed) | Real browser control | Local | Web applications opened in the browser | Possible later; needs a dependency decision (D-018) and approval |
| **AutoHotkey, Tesseract, FFmpeg, Python** | 5 but **not installed** | Input simulation / OCR / media / scripting | Local | | Install only with approval; the first two are not needed if UI Automation + built-in OCR work |
| **Your Claude / ChatGPT subscriptions and the ChatGPT/Codex desktop apps seen on this PC** | 6 | Used by you directly | Unknown | | **Not an API for this app.** Whether a chat subscription covers API use was not verified here (assume it does not). Driving those apps through their windows is not recommended and they are flagged Protected |

## 4. Suitability by task (judgement, with the evidence it rests on)
| Task | Can it run with no AI model? | Best zero-cost option | What blocks it today |
|---|---|---|---|
| Finding and operating standard controls | **Yes** (UI Automation) | UI Automation, no model | UI Automation bridge not built |
| Reading a custom-drawn or image-only screen | No (OCR first, vision second) | Windows OCR, then a local vision model; Gemini for non-private screens | Images not supported by the adapter; OCR/vision untested |
| Manager planning (break a goal into steps) | No | Gemini free (non-private) or local model for private goals | Needs a key / an installed model |
| Worker step selection ("which control next") | Partly (rules for fixed flows) | Groq or Gemini text, fed the UI-Automation tree as text (small, cheap) | Tool calling not supported; use structured text replies instead |
| Tool/function calling | n/a | Parse a JSON reply the app validates (the app already does this for its `action` blocks) | Native tool calling not needed to start |
| Error recovery | Partly (retry, re-read the tree) | Same models; rules for known errors | Limits of free models; design work |
| Long multi-step workflows | Partly | Local rules + a model only at decision points | **Request caps**: a 20-step flow is ~20 calls; Gemini's app cap is 50/day, OpenRouter's 50/day. Raising caps needs the provider's real quota first (D-017) |
Honest conclusion: **free cloud models cannot carry heavy visual automation**: quotas are small and unpublished, and the free Gemini tier uses your content. The workable design keeps the model small: structured UI-Automation text, rules for fixed steps, a model only for planning and ambiguity.

## 5. Which tasks run locally with no API charges, and which genuinely need a model
- **Local, no model:** application discovery (done), reading and operating standard controls (UI Automation), launching approved programs, waiting and retrying, folder and file work under the access module, logging, approvals.
- **Local, small model (untested):** OCR text interpretation, "what is this dialog asking", light planning of private tasks.
- **Genuinely needs an external model:** open-ended planning across unfamiliar applications, interpreting complex visual layouts, long-context reasoning. Only on non-private content, within the free allowance.

## 6. Cost and usage protection: what exists, what was added, what is missing
| Requirement | State |
|---|---|
| Prefer existing and free resources; prefer local | Existing: free-only gate (locked on), automatic routing prefers local/free, Ollama as backup |
| Never silently switch to a paid model | Existing gate. **Gap found and closed today:** a local Ollama can list `-cloud`/`:cloud` models that run on Ollama's servers and are billed per token; they were classed "runs locally, free". They are now **blocked** (tested) |
| Never buy credits / activate paid APIs | No purchase or payment code exists; the free-only gate has no switch (owner decision D-001/D-002). OpenRouter's 1,000/day tier requires buying credits: documented, never automatic |
| Show when a free quota is exhausted | **Added** in Settings: "Today's allowance is used up (n of cap)... nothing switches to a paid model". This is the **app's own cap**; the providers' real remaining quota is not available for Gemini (AI Studio only), unverified for Groq, partly for OpenRouter (its per-minute figure is not reported) |
| Owner-configurable limits | Existing (daily caps per provider, per bot, overall) |
| Estimated cost before a paid operation | **Not applicable and not built:** no paid operation can occur. If the owner ever chooses paid providers (D-002, Phase 9) an estimate screen is required first; listed as future work |
| Privacy considerations visible | **Added** per provider (free-tier data use, retention statements, "not stated") |
| Per-provider "enabled for application automation" | **Added**, off by default, owner-only with the passphrase proof (existing providers route is owner-only), requires the provider to be switched on, and switching the provider off removes it. It only records a choice: no engine exists |

## 7. What still needs integration (none done; each needs the stated approval)
1. **Image and tool support in the model adapter** (code only, no dependency): needed for any screenshot. Must keep the free-only gate and add a per-provider "may receive images" rule that blocks free tiers which train on content for private screens.
2. **A fixed UI-Automation bridge** (read the control tree; invoke/type) in the same style as the discovery script: closed actions, no free-form commands. Acting on a program must pass the application policy, the Guardian hold and the approval gate.
3. **Screenshot capture and OCR**: capture through built-in .NET; check Windows OCR on this PC. Windows Home may not allow reliable capture in a second account's background session (board assumption); the VM route may be needed.
4. **Quota awareness**: read rate-limit headers or 429 replies and show them (not built); never raise caps without the provider's real numbers.
5. **Local vision model trial**: needs your approval to install Ollama and download one small model (free, but disk and download). Measure speed and accuracy on real screenshots before relying on it.
6. **Keys**: Gemini (NV-3) and optionally Groq, created by you. Confirm on your own account whether a card is required and read the free limits shown in AI Studio / the Groq console.

## 8. Report: best zero-additional-cost combination for the Universal Desktop Application Execution Engine
| Layer | Choice | Why |
|---|---|---|
| Operating applications | **Windows UI Automation** (built in) | Structured, exact, no model, no quota, private |
| Reading screens when controls are missing | **Windows built-in OCR**, then a **small local vision model** (Ollama, after your approval) | Free, private; cloud vision only as a last resort on non-private screens |
| Planning and ambiguity | **Gemini free tier** for non-private goals; **a local model** for private ones; **Groq free** as a fast text helper | Best free quality; keeps private data local |
| Control and safety | Existing: access module, Guardian, approval gate, free-only gate, caps | Already built and tested |
| Hand-offs | Existing PC agent, documents, connectors | No extra cost |
Expected recurring cost: **$0**. Expected effort: items 1-3 above (the bridge and image support) are the real work.
**Not recommended:** relying on OpenRouter free models; any Ollama cloud model; the chat subscriptions as an API; paying for credits to lift a cap.

## 9. Not verified
Groq free limits, card requirement and retention terms; Gemini card requirement, function-calling support, commercial terms and actual free limits for your project; OpenRouter free-provider data handling; Mistral entirely; Cloudflare model coverage and card requirement; Windows OCR on this PC; speed and accuracy of any local vision model on this PC; whether a chat subscription covers API use; OmniRoute's current state. Provider terms change often: the dashboard shows the check date and flags it after 90 days.

## 10. Decisions that are yours
1. Approve designing the UI-Automation bridge and image support (code only), or choose a different engine direction.
2. Approve installing Ollama and trying one small vision model (disk space and a download; free).
3. Create a Gemini key with no billing (NV-3) when you want real tests, and read the limits AI Studio shows for your project.
4. Confirm that free-tier cloud models may never receive screens that show private content.

## 10b. Follow-up (desktop engine milestone)
The engine now uses UI Automation and local OCR, both verified present on this PC (OCR languages en-US, en-GB). The model adapter has the picture/tool types, a picture policy (private pictures never go to cloud providers) and gating, all OFF; provider capability flags stay false, so the Settings cards still say screenshots are not possible with any provider. A local vision model is an interface only (`docs/DESKTOP-ENGINE.md` section 9); nothing was installed or downloaded.

## 11. Where this is implemented
`src/llm/profiles.ts` (the verified facts, dated), `src/llm/catalog.ts` (profile, quota and the application-automation flag in the existing provider view; stored in the existing `llm_settings` table: no migration), `src/llm/plugins/ollama.ts` (cloud-model block), `web/src/components/ProviderProfilePanel.tsx` inside the existing **Settings > AI Models > Providers** cards. Tests: `src/llm/profiles.test.ts` (4), `web/src/providerProfile.test.tsx` (4).
