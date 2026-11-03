import { z } from "zod";
import type { ConnectorDefinition } from "./types.js";

/**
 * Telegram, behind the approval gate (Phase 6).
 *
 * - send_message is a WRITE: it always waits for the owner's approval and runs once.
 * - read_messages is a READ: it only works for a bot whose Telegram read permission the owner switched on.
 *
 * The address is fixed to Telegram's own server. Only tests can point it elsewhere (a fake server on this PC),
 * never a setting or the environment. The bot token is only used inside this file and is never put into an error message.
 */
export const TELEGRAM_BASE_URL = "https://api.telegram.org";
export const TELEGRAM_TOKEN_NAME = "TELEGRAM_BOT_TOKEN";

const TOKEN_SHAPE = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_READ_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4000;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}...` : text);

interface TelegramReply {
  ok: boolean;
  description?: string;
  result?: unknown;
}

async function callTelegram(baseUrl: string, token: string, method: string, body: Record<string, unknown>): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // The real reason can contain the web address, which contains the token. Say only what happened.
    throw new Error("Could not reach Telegram. Check the internet connection and try again.");
  }
  let data: TelegramReply | null = null;
  try {
    data = (await res.json()) as TelegramReply;
  } catch {
    /* not JSON */
  }
  if (!res.ok || !data?.ok) {
    if (res.status === 401 || res.status === 404) throw new Error("Telegram did not accept the bot token. Check the token in Settings.");
    const why = typeof data?.description === "string" ? clip(data.description, 200) : `status ${res.status}`;
    throw new Error(`Telegram refused the request: ${why}`);
  }
  return data.result;
}

function describeUpdate(update: unknown): string | null {
  const message = (update as { message?: { chat?: { id?: number; title?: string; username?: string }; from?: { first_name?: string; username?: string }; text?: string } })?.message;
  if (!message || typeof message.text !== "string") return null;
  const who = message.from?.username ?? message.from?.first_name ?? "someone";
  const chat = message.chat?.id ?? "?";
  return `[chat ${chat}] ${who}: ${clip(message.text.replace(/\s+/g, " "), 500)}`;
}

export function createTelegramConnector(baseUrl: string = TELEGRAM_BASE_URL): ConnectorDefinition {
  return {
    id: "telegram",
    label: "Telegram",
    secrets: [{ name: TELEGRAM_TOKEN_NAME, description: "Telegram bot token (from @BotFather)" }],
    notReady: (ctx) => {
      const token = ctx.secret(TELEGRAM_TOKEN_NAME);
      if (!token) return "paste the bot token in Settings first.";
      if (!TOKEN_SHAPE.test(token)) return "the saved token does not look like a Telegram bot token.";
      return null;
    },
    actions: {
      send_message: {
        kind: "write",
        description: "Send a text message to a Telegram chat (chat is a number, or @channelname)",
        args: z.strictObject({
          chat: z.string().regex(/^(-?\d{1,20}|@[A-Za-z0-9_]{4,64})$/, "must be a chat number or @name"),
          text: z.string().min(1).max(MAX_MESSAGE_CHARS),
        }),
        summarize: (a) => `Send a Telegram message to ${String(a["chat"])}: "${clip(String(a["text"]), 120)}"`,
        execute: async (a, ctx) => {
          const token = ctx.secret(TELEGRAM_TOKEN_NAME);
          if (!token) throw new Error("No Telegram bot token is saved.");
          const result = (await callTelegram(baseUrl, token, "sendMessage", { chat_id: a["chat"], text: a["text"] })) as { message_id?: number };
          return `Sent message ${result?.message_id ?? ""} to ${String(a["chat"])}`.replace("  ", " ");
        },
      },
      read_messages: {
        kind: "read",
        description: `Read the most recent messages people sent to the bot (up to ${MAX_READ_MESSAGES})`,
        args: z.strictObject({}),
        summarize: () => "Read recent Telegram messages",
        execute: async (_a, ctx) => {
          const token = ctx.secret(TELEGRAM_TOKEN_NAME);
          if (!token) throw new Error("No Telegram bot token is saved.");
          // No "offset" is sent, so reading never marks anything as handled: it can be repeated safely.
          const updates = (await callTelegram(baseUrl, token, "getUpdates", { limit: MAX_READ_MESSAGES, timeout: 0, allowed_updates: ["message"] })) as unknown[];
          const lines = (Array.isArray(updates) ? updates : []).map(describeUpdate).filter((l): l is string => l !== null);
          return lines.length === 0 ? "No recent messages." : lines.join("\n");
        },
      },
    },
  };
}
