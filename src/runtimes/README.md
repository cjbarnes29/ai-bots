# runtimes: what makes a bot "think"

Every bot is run through one interface, `AgentRuntime`, so engines can be swapped without changing
the rest of the platform.

| File | Job |
|---|---|
| `types.ts` | The `AgentRuntime` interface. `toolsEnabled` is the literal `false`. |
| `prompt.ts` | Builds the instructions a model receives from the bot's role, personality, responsibilities and instructions |
| `builtin.ts` | The built-in engine: trims history to fit, calls the bot's chosen model through the LLM service |
| `openclaw.ts` | A placeholder. OpenClaw is not installed; it can be added later behind the same interface |
| `registry.ts` | Picks the engine for a bot |

Phase 2: runtimes produce text only. Tools stay off until the approval system is built and tested.
