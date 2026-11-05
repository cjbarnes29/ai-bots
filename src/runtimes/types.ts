import type { BotRecord } from "../agent-manager/types.js";
import type { ChatMessage } from "../llm/types.js";

export interface RuntimeInput {
  bot: BotRecord;
  /** Earlier messages in this conversation (user and assistant only), oldest first. */
  history: ChatMessage[];
  userMessage: string;
  conversationId: string;
  /** The owner's project notes for this conversation, when it belongs to a project. Context only: it grants nothing. */
  projectContext?: string | null;
}

export interface RuntimeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  providerId: string;
  modelId: string;
  latencyMs: number;
  warning: string | null;
}

/**
 * Anything that can make a bot "think". The built-in engine is the first implementation;
 * OpenClaw can be added later as another one without changing the rest of the platform.
 */
export interface AgentRuntime {
  readonly id: string;
  /** Phase 2: always false. Runtimes cannot use tools until the approval system exists and is tested. */
  readonly toolsEnabled: false;
  run(input: RuntimeInput): Promise<RuntimeResult>;
}
