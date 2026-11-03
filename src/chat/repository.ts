import type { DatabaseSync } from "node:sqlite";

type Row = Record<string, unknown>;

export interface ConversationRecord {
  id: string;
  botId: string;
  title: string;
  createdAt: string;
  messageCount: number;
}

export interface MessageRecord {
  id: number;
  role: "user" | "assistant";
  content: string;
  botVersion: number;
  providerId: string | null;
  modelId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  tokensEstimated: boolean | null;
  createdAt: string;
}

export interface MessageInsert {
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  botVersion: number;
  providerId?: string | null;
  modelId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  tokensEstimated?: boolean | null;
  createdAt: string;
}

const nullableNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const nullableStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function toConversation(r: Row): ConversationRecord {
  return {
    id: String(r["id"]),
    botId: String(r["bot_id"]),
    title: String(r["title"]),
    createdAt: String(r["created_at"]),
    messageCount: Number(r["message_count"] ?? 0),
  };
}

function toMessage(r: Row): MessageRecord {
  return {
    id: Number(r["id"]),
    role: String(r["role"]) as "user" | "assistant",
    content: String(r["content"]),
    botVersion: Number(r["bot_version"]),
    providerId: nullableStr(r["provider_id"]),
    modelId: nullableStr(r["model_id"]),
    inputTokens: nullableNum(r["input_tokens"]),
    outputTokens: nullableNum(r["output_tokens"]),
    tokensEstimated: r["tokens_estimated"] === null || r["tokens_estimated"] === undefined ? null : Number(r["tokens_estimated"]) === 1,
    createdAt: String(r["created_at"]),
  };
}

export class ChatRepository {
  constructor(private readonly db: DatabaseSync) {}

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  createConversation(id: string, botId: string, title: string, now: string): void {
    this.db
      .prepare("INSERT INTO conversations (id, bot_id, title, created_at) VALUES (?, ?, ?, ?)")
      .run(id, botId, title, now);
  }

  getConversation(id: string): ConversationRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c WHERE c.id = ?`,
      )
      .get(id);
    return row ? toConversation(row) : undefined;
  }

  listConversations(botId: string): ConversationRecord[] {
    return this.db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c WHERE c.bot_id = ? ORDER BY c.created_at DESC, c.rowid DESC LIMIT 50`,
      )
      .all(botId)
      .map(toConversation);
  }

  insertMessage(m: MessageInsert): number {
    const result = this.db
      .prepare(
        `INSERT INTO chat_messages
           (conversation_id, role, content, bot_version, provider_id, model_id, input_tokens,
            output_tokens, tokens_estimated, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        m.conversationId,
        m.role,
        m.content,
        m.botVersion,
        m.providerId ?? null,
        m.modelId ?? null,
        m.inputTokens ?? null,
        m.outputTokens ?? null,
        m.tokensEstimated === null || m.tokensEstimated === undefined ? null : m.tokensEstimated ? 1 : 0,
        m.createdAt,
      );
    return Number(result.lastInsertRowid);
  }

  getMessage(id: number): MessageRecord | undefined {
    const row = this.db.prepare("SELECT * FROM chat_messages WHERE id = ?").get(id);
    return row ? toMessage(row) : undefined;
  }

  listMessages(conversationId: string): MessageRecord[] {
    return this.db
      .prepare("SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id")
      .all(conversationId)
      .map(toMessage);
  }

  /** The most recent `count` messages, oldest first. */
  lastMessages(conversationId: string, count: number): MessageRecord[] {
    if (count <= 0) return [];
    return this.db
      .prepare(
        `SELECT * FROM (SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id`,
      )
      .all(conversationId, count)
      .map(toMessage);
  }
}
