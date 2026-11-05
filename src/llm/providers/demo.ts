import { LlmError } from "../errors.js";
import type { CompletionRequest, CompletionResult, LlmProvider, ModelInfo } from "../types.js";

/** Every demonstration reply starts with this exact line, so a simulated answer can never be mistaken for a real one (also in workflow outputs and saved chats). */
export const SIMULATED_MARK = "[SIMULATED RESPONSE - no real AI was used]";

export const DEMO_MODELS: ModelInfo[] = [
  { id: "simulated-echo", displayName: "Simulated AI (echo, always answers)", contextWindow: 8000, priceInput: 0, priceOutput: 0 },
  { id: "simulated-failing", displayName: "Simulated AI (always fails, to practise error handling)", contextWindow: 8000, priceInput: 0, priceOutput: 0 },
];

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The built-in demonstration provider. It runs INSIDE this app: no network, no key, no cost, no real intelligence.
 * It does not answer questions; it shows what a real model would have been given (your message, how much instruction and history),
 * so you can see how agents, workflows, routing and approvals behave before a real provider is connected.
 */
export class DemoProvider implements LlmProvider {
  async listModels(): Promise<ModelInfo[]> {
    return DEMO_MODELS;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    if (request.model === "simulated-failing") {
      throw new LlmError("provider_unavailable", "Simulated failure: this demonstration model always fails, on purpose, so you can see how errors and fallbacks look.", { retryable: false });
    }
    const system = request.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const turns = request.messages.filter((m) => m.role !== "system");
    const last = [...turns].reverse().find((m) => m.role === "user")?.content ?? "";
    const text = [
      SIMULATED_MARK,
      "This is a built-in demonstration reply. A real AI model would answer here; connect a provider in the Integrations Center to get real answers.",
      "",
      `What this agent was asked: "${clip(oneLine(last), 400)}"`,
      `Instructions it was given: ${system ? `${system.length} characters, starting "${clip(oneLine(system), 80)}"` : "none"}`,
      `Earlier messages in this conversation: ${Math.max(0, turns.length - 1)}`,
      `Settings: temperature ${request.temperature}, up to ${request.maxOutputTokens} output tokens`,
    ].join("\n");
    return { text, inputTokens: null, outputTokens: null, finishReason: "stop", costReportedMicro: 0, toolCallsIgnored: false, modelReturned: request.model };
  }
}
