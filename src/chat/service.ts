import { randomUUID } from "node:crypto";
import { runRefusal } from "../agent-manager/service.js";
import type { BotRecord, Runtime } from "../agent-manager/types.js";
import { AppError } from "../errors.js";
import { LlmError } from "../llm/errors.js";
import type { LlmService } from "../llm/service.js";
import type { AgentRuntime } from "../runtimes/types.js";
import type { KnowledgeService, SourceRef } from "../knowledge/service.js";
import type { ChatRepository, ConversationRecord, MessageRecord } from "./repository.js";

export interface ChatReply {
  conversationId: string;
  userMessage: MessageRecord;
  assistantMessage: MessageRecord;
  warning: string | null;
  /** What the answer was given from (attached files and Knowledge Center passages), numbered; `cited` marks the ones the answer's text refers to. */
  sources: SourceRef[];
}

/**
 * Test chat: you send a message, the bot's runtime answers using its chosen model.
 * Only runs when you send a message, and only for a bot that is switched on (status "active", not archived).
 */
export class ChatService {
  constructor(
    private readonly repo: ChatRepository,
    private readonly getBot: (id: string) => BotRecord,
    private readonly runtimeFor: (runtime: Runtime) => AgentRuntime,
    private readonly llm: LlmService,
    private readonly now: () => number = Date.now,
    /** Optional: the project notes for a conversation, and a way to put a NEW conversation into a project. Supplied by the app. */
    private readonly projects?: { contextFor(conversationId: string): string | null; contextForProject(projectId: string): string | null; attach(projectId: string, conversationId: string): void; projectIdOf?(conversationId: string): string | null },
    /** Optional: file attachments and Knowledge Center retrieval for a message. */
    private readonly knowledge?: KnowledgeService,
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

  async sendMessage(botId: string, input: { message: string; conversationId?: string | undefined; projectId?: string | undefined; attachmentIds?: string[] | undefined; useKnowledge?: boolean | undefined }): Promise<ChatReply> {
    const bot = this.getBot(botId);
    if (bot.archived) {
      throw new AppError(409, "bot_archived", "This bot is archived. Unarchive it to chat.");
    }
    // Checked before anything is stored: a switched-off bot leaves no half conversation behind.
    const refusal = runRefusal(bot);
    if (refusal) throw new AppError(409, "bot_not_active", refusal);

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

    // Attached files and (if asked) Knowledge Center passages go to the model as one block of untrusted data. Checked BEFORE anything is saved.
    const attachmentIds = input.attachmentIds ?? [];
    if (attachmentIds.length && !this.knowledge) throw new AppError(400, "attachments_unavailable", "Attachments are not available.");
    if (attachmentIds.length) this.knowledge!.checkAttachments(attachmentIds);
    const projectId = conversation ? (this.projects?.projectIdOf?.(conversationId) ?? null) : (input.projectId ?? null);
    const kctx = this.knowledge && (attachmentIds.length > 0 || input.useKnowledge || conversation) ? this.knowledge.buildContext({ conversationId: conversation?.id, newAttachmentIds: attachmentIds, message, projectId, useKnowledge: input.useKnowledge === true }) : { text: null, sources: [] as SourceRef[] };
    const baseContext = (conversation ? this.projects?.contextFor(conversationId) : input.projectId ? this.projects?.contextForProject(input.projectId) : null) ?? null;
    const projectContext = [baseContext, kctx.text].filter(Boolean).join(String.fromCharCode(10).repeat(2)) || null;
    // Ask the model BEFORE saving anything, so a failed call leaves no half-finished conversation.
    const result = await this.runtimeFor(bot.runtime).run({ bot, history, userMessage: message, conversationId, projectContext });

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

    // A conversation started from inside a project is linked to it (after the messages are saved; a failed link never loses the chat).
    if (!conversation && input.projectId && this.projects) {
      try {
        this.projects.attach(input.projectId, conversationId);
      } catch {
        /* the chat is kept; the owner can link it later */
      }
    }
    let sources: SourceRef[] = [];
    if (this.knowledge) {
      try {
        if (attachmentIds.length) this.knowledge.attachToMessage(conversationId, userId, [...new Set(attachmentIds)]);
        if (kctx.sources.length) sources = this.knowledge.saveSources(assistantId, kctx.sources, result.text);
      } catch {
        /* the chat is kept even if the attachment record could not be written */
      }
    }
    const userMessage = this.repo.getMessage(userId);
    const assistantMessage = this.repo.getMessage(assistantId);
    if (!userMessage || !assistantMessage) throw new AppError(500, "internal_error", "Something went wrong");
    return { conversationId, userMessage, assistantMessage, warning: result.warning, sources };
  }
}
