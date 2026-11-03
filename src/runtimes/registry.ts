import type { Runtime } from "../agent-manager/types.js";
import type { LlmService } from "../llm/service.js";
import { BuiltInRuntime } from "./builtin.js";
import { OpenClawRuntime } from "./openclaw.js";
import type { AgentRuntime } from "./types.js";

/** Picks the engine a bot uses. Adding a runtime later means adding one entry here. */
export function createRuntimeRegistry(llm: LlmService): (runtime: Runtime) => AgentRuntime {
  const runtimes: Record<Runtime, AgentRuntime> = {
    builtin: new BuiltInRuntime(llm),
    openclaw: new OpenClawRuntime(),
  };
  return (runtime) => runtimes[runtime];
}
