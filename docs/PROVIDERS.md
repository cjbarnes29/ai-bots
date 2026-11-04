# AI providers: architecture and configuration guide

## Architecture
```
bot / chat / task / schedule
        |
   LlmService  (pause switch, free-only gate, size limits, daily/monthly limits, circuit breaker, usage log)
        |
   one adapter: OpenAI-compatible chat API (src/llm/providers/openai-compatible.ts)
        |
   provider plugins: Gemini | Groq | OpenRouter | Ollama (local) | OmniRoute (gateway)
```
Every AI request from every bot takes the same road through `LlmService`. A provider is a small "plugin" file (address, key name, how its models
are judged free). Direct providers and OmniRoute use the same adapter, the same limits and the same free-only gate. Nothing can bypass them.

What is always true, for every provider:
- **Free-only is locked on.** There is no switch. A model that is not verified free cannot be enabled or called.
- The adapter sends only `model`, `messages`, `temperature`, `max_tokens`, `stream=false`: never tools, fallback lists or routing options.
- Keys live in the encrypted vault (Settings > Keys), are never returned by the API, and are removed from errors and logs.
- Usage limits (per bot, per provider, overall, per day/month) and the pause switch apply before any call.

## Provider settings
| Provider | Address | Key (vault or .env) | A model is "free" when |
|---|---|---|---|
| Google Gemini | fixed | `GEMINI_API_KEY` | you confirm the Google project has no billing |
| Groq | fixed | `GROQ_API_KEY` | you confirm the account has no billing |
| OpenRouter | fixed | `OPENROUTER_API_KEY` | the id ends in `:free` and its live price is exactly 0 |
| Ollama (local) | editable, this PC only | none | it runs on this PC |
| OmniRoute (gateway) | editable, this PC only; default `http://127.0.0.1:20128/v1` | `OMNIROUTE_API_KEY` | OmniRoute itself lists price 0 for input and output, and it is one explicit model |

## OmniRoute
- **Never assumed free.** A gateway can send a request to a paid provider. A model is usable only when all of these hold: OmniRoute's `/v1/models` lists
  a price of exactly 0 for input and output (missing or unknown = blocked), the id is not an auto-routing, combo, fallback or "best of" name, and you
  switched that model on. Blocked models stay in the list, greyed out, with the reason.
- Bots store the exact id OmniRoute returned (for example `omniroute/free-prov/Llama-3.3-70B:Instruct`).
- **Pricing is checked field by field**: every price-like field OmniRoute lists (prompt/completion, input/output, per token or million, request, image, web search, reasoning, cache...) must be exactly 0, and input and output prices must both be present. Anything missing, unreadable, negative, non-zero or disagreeing blocks the model.
- **Model identity is checked on every reply**: the reply must name exactly the model you asked for. A different or missing name means the reply is thrown away and that model is blocked until you switch it on again.
- **If OmniRoute lists no price for a model**, it stays blocked, but on the PC you may press "I confirm this model is free…" after checking it yourself. That works only when the price is simply missing (never for a priced model or an auto/combo name). The model stays off until you switch it on, is still checked on every reply and by the daily cap, and your confirmation is cancelled automatically if a price appears, it answers as another model, or it reports a cost. A phone cannot do this.
- **Refreshing** the list never deletes bots or your choices. A model that disappears becomes "unavailable" (and returns when listed again). A model that
  starts showing a price is blocked and switched off. A call that reports a cost switches the model off.
- It keeps a daily request cap (default 40, cannot be removed) and counts toward the overall cloud limits.
- The platform never installs, starts, configures or changes your OmniRoute.

### Steps for you (OmniRoute is already installed on your PC)
1. Start OmniRoute yourself and make an API key in it. Note its address (the default is `http://127.0.0.1:20128/v1`).
2. In the dashboard open **Settings > Keys (vault)** and paste the key into `OMNIROUTE_API_KEY`.
3. In **Settings > Providers > OmniRoute**: check the address, switch it **On**, press **Test connection**, then **Refresh models**.
4. Only models marked free (price 0) can be switched on. If every model is blocked with "did not list a price", your OmniRoute does not publish prices;
   tell me and we will decide how you want to authorise models (this needs your explicit decision).
5. On a bot's page choose one of the enabled OmniRoute models.

## Automatic model routing
Choose **Automatic** instead of a model on a bot (Details tab) and the platform picks a free model for each task: general, coding, research or quick/light work. If a provider is down,
rate-limited or out of quota it tries the next eligible one (up to the number you set), with local Ollama models as the backup. It only chooses models that already passed the free-only
checks, and every attempt counts against the normal limits. It never uses a paid model, never goes around a limit and never rotates accounts. A bot with its own specific model always keeps it.
Settings → Model routing lets you turn it off, limit it to chosen providers, prefer local models, refresh the model lists, and see provider health and what would be chosen right now.
