import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { ChatService } from "./service.js";

const idSchema = z.string().uuid();
const chatBodySchema = z.strictObject({
  message: z.string(),
  conversationId: z.string().uuid().optional(),
});

function parseId(value: unknown, code: string, message: string): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new AppError(404, code, message);
  return parsed.data;
}

export async function registerChatRoutes(app: FastifyInstance, chat: ChatService): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/bots/:id/conversations", async (req) => {
    const botId = parseId(req.params.id, "bot_not_found", "Bot not found");
    return { conversations: chat.listConversations(botId) };
  });

  app.get<{ Params: { id: string; conversationId: string } }>(
    "/api/bots/:id/conversations/:conversationId/messages",
    async (req) => {
      const botId = parseId(req.params.id, "bot_not_found", "Bot not found");
      const conversationId = parseId(req.params.conversationId, "conversation_not_found", "Conversation not found");
      return { messages: chat.listMessages(botId, conversationId) };
    },
  );

  app.post<{ Params: { id: string } }>("/api/bots/:id/chat", async (req) => {
    const botId = parseId(req.params.id, "bot_not_found", "Bot not found");
    const body = chatBodySchema.parse(req.body);
    return chat.sendMessage(botId, body);
  });
}
