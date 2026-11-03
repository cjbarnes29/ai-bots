import { randomUUID } from "node:crypto";
import type { BotRecord, Runtime } from "../agent-manager/types.js";
import { AppError } from "../errors.js";
import { LlmError } from "../llm/errors.js";
import type { LlmService } from "../llm/service.js";
import type { AgentRuntime } from "../runtimes/types.js";
import type { ChatRepository, ConversationRecord, MessageRecord } from "./repository.js";

export interface ChatReply {
  conversationId: string;
  userMessage: MessageRecord;
  assistantMessage: MessageRecord;
  warning: string | null;
}

/**
 * Test chat: you send a message, the bot's runtime answers using its chosen model.
 * Only runs when you send a message, on any bot that is not archived, whatever its status.
 */
export class ChatService {
  constructor(
    private readonly repo: ChatRepository,
    private readonly getBot: (id: string) => BotRecord,
    private readonly runtimeFor: (runtime: Runtime) => AgentRuntime,
    private readonly llm: LlmService,
    private readonly now: () => number = Date.now,
  ) {}

  listConversations(botId: string): ConversationRecord[] {
    this.getBot(botId); // 404 if the bot does not exist
    return this.repo.listConversations(botId);
  }

  listMessages(botId: string, conversationId: string): MessageRecord[] {
    this.getBot(botId);
    const conversation = this.repo.getConversation(conversationId);
    if (!conversation || conversation.botId !== botId) {
      throw new AppError(404, "conversation_not_found", "Conversation not found");
    }
    return this.repo.listMessages(conversationId);
  }

  async sendMessage(botId: string, input: { message: string; conversationId?: string | undefined }): Promise<ChatReply> {
    const bot = this.getBot(botId);
    if (bot.archived) {
      throw new AppError(409, "bot_archived", "This bot is archived. Unarchive it to chat.");
    }

    const message = input.message.trim();
    const maxChars = this.llm.limits().maxMessageChars;
    if (message.length === 0) throw new AppError(400, "empty_message", "Type a message first.");
    if (message.length > maxChars) {
      throw new AppError(
        413,
        "message_too_long",
        `That message is too long (${message.length.toLocaleString()} characters; the limit is ${maxChars.toLocaleString()}).`,
      );
    }
    if (!bot.model) {
      throw new LlmError("no_model_selected", "Choose a model for this bot on the Details tab first.");
    }

    let conversation: ConversationRecord | undefined;
    if (input.conversationId) {
      conversation = this.repo.getConversation(input.conversationId);
      if (!conversation || conversation.botId !== botId) {
        throw new AppError(404, "conversation_not_found", "Conversation not found");
      }
    }
    const conversationId = conversation?.id ?? randomUUID();
    const history = conversation
      ? this.repo.lastMessages(conversationId, this.llm.limits().historyMessages).map((m) => ({ role: m.role, content: m.content }))
      : [];

    // Ask the model BEFORE saving anything, so a failed call leaves no half-finished conversation.
    const result = await this.runtimeFor(bot.runtime).run({ bot, history, userMessage: message, conversationId });

    const createdAt = new Date(this.now()).toISOString();
    const { userId, assistantId } = this.repo.transaction(() => {
      if (!conversation) {
        const title = message.length > 60 ? `${message.slice(0, 57)}…` : message;
        this.repo.createConversation(conversationId, botId, title, createdAt);
      }
      const userId = this.repo.insertMessage({
        conversationId,
        role: "user",
        content: message,
        botVersion: bot.currentVersion,
        createdAt,
      });
      const assistantId = this.repo.insertMessage({
        conversationId,
        role: "assistant",
        content: result.text,
        botVersion: bot.currentVersion,
        providerId: result.providerId,
        modelId: result.modelId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        tokensEstimated: result.estimated,
        createdAt,
      });
      return { userId, assistantId };
    });

    const userMessage = this.repo.getMessage(userId);
    const assistantMessage = this.repo.getMessage(assistantId);
    if (!userMessage || !assistantMessage) throw new AppError(500, "internal_error", "Something went wrong");
    return { conversationId, userMessage, assistantMessage, warning: result.warning };
  }
}
