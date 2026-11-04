import { LlmError } from "../llm/errors.js";
import { DEFAULT_TEMPERATURE } from "../llm/limits.js";
import type { LlmService } from "../llm/service.js";
import { estimateMessagesTokens, type ChatMessage } from "../llm/types.js";
import { buildSystemPrompt } from "./prompt.js";
import type { AgentRuntime, RuntimeInput, RuntimeResult } from "./types.js";

const TOOL_REQUEST_NOTICE =
  "(The model tried to use a tool. Tools are disabled, so nothing was done and no action was taken.)";

/**
 * The built-in engine. It sends the conversation to the bot's chosen model and returns the reply.
 * It sends text only: there is no way to pass tools to a model, and a tool request is ignored.
 */
export class BuiltInRuntime implements AgentRuntime {
  readonly id = "builtin";
  readonly toolsEnabled = false as const;

  constructor(
    private readonly llm: LlmService,
    /** Extra instructions for a bot (its assigned skills). */
    private readonly promptExtras: (botId: string) => Promise<string> = async () => "",
  ) {}

  async run(input: RuntimeInput): Promise<RuntimeResult> {
    const { bot } = input;
    if (!bot.model) {
      throw new LlmError("no_model_selected", "Choose a model for this bot on the Details tab first.");
    }
    const limits = this.llm.limits();
    const extras = await this.promptExtras(bot.id);
    const system: ChatMessage = { role: "system", content: buildSystemPrompt(bot) + (extras ? `\n\n${extras}` : "") };
    const user: ChatMessage = { role: "user", content: input.userMessage };

    // Keep the most recent messages, dropping the oldest until the prompt fits the size limit.
    let history = input.history.slice(-limits.historyMessages);
    while (history.length > 0 && estimateMessagesTokens([system, ...history, user]) > limits.maxPromptTokens) {
      history = history.slice(1);
    }
    while (history[0]?.role === "assistant") history = history.slice(1);

    const out = await this.llm.complete({
      botId: bot.id,
      conversationId: input.conversationId,
      modelRef: bot.model,
      messages: [system, ...history, user],
      temperature: bot.temperature ?? DEFAULT_TEMPERATURE,
      maxOutputTokens: bot.maxOutputTokens,
    });

    return {
      text: out.text.trim() === "" && out.toolCallsIgnored ? TOOL_REQUEST_NOTICE : out.text,
      inputTokens: out.inputTokens,
      outputTokens: out.outputTokens,
      estimated: out.estimated,
      providerId: out.providerId,
      modelId: out.modelId,
      latencyMs: out.latencyMs,
      warning: out.warning,
    };
  }
}
