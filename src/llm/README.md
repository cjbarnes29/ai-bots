# llm: talking to AI models

Provider-independent layer. **Free-only mode is permanently on**: only free models can ever be called.

| File | Job |
|---|---|
| `types.ts` | Shared shapes. A request has **no field for tools**. |
| `errors.ts` | Every failure as a clear category (rate limited, timeout, blocked...) |
| `secrets.ts` | Reads API keys from environment variables and removes them from any text |
| `plugins/` | One small file per provider: Gemini, Groq, OpenRouter, Ollama (OmniRoute is defined but not connected) |
| `providers/openai-compatible.ts` | The one adapter that talks to all of them (built-in `fetch`, no SDK) |
| `policy.ts` | The free-only gate that every call must pass |
| `catalog.ts` | Providers and models: connection tests, model discovery, free badges |
| `limits.ts`, `usage.ts`, `resilience.ts` | The approved limits, the append-only usage log, retries and the circuit breaker |
| `service.ts` | Every call goes through here: pause, policy, size, breaker, limits, concurrency, call, record |
| `routes.ts` | `/api/llm/...` endpoints for the Settings and Usage pages |

## Adding a provider later
Add one file in `plugins/` (address, key name, how its models are judged free) and list it in
`plugins/index.ts`. Most providers reuse the same adapter.

## Rules that cannot be switched off
- No tools are ever sent to a model, and a model's tool request is ignored.
- A model flagged "blocked" cannot be enabled (the database refuses it).
- A provider that reports a cost on a free model gets that model blocked automatically.
- Cloud provider addresses and key names are fixed in code. The local provider's address must be on this PC.
- Keys are never returned by the API, never stored in the database, and scrubbed from error messages.
