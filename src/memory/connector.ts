import { z } from "zod";
import type { ConnectorDefinition } from "../connectors/types.js";
import { containsSecret } from "../skills/service.js";
import { MEMORY_LIMITS, type MemoryService } from "./service.js";

/**
 * How a bot uses memory: through the same gate as everything else.
 *  - recall (read): search its own notes, the shared knowledge if the owner allowed it, or its own finished tasks.
 *  - remember (write): ask to save a private note. It waits for the owner's approval and can never create shared knowledge.
 */
export function createMemoryConnector(memory: MemoryService): ConnectorDefinition {
  return {
    id: "memory",
    label: "Memory",
    authorize: (botId, action, args) => {
      const s = memory.settings(botId);
      if (action === "remember") {
        if (!s.usePrivate) return "Memory is switched off for this bot.";
        if ([args["title"], args["text"]].some((x) => typeof x === "string" && containsSecret(x))) return "That looks like a key, token or password. Memory never stores secrets.";
      }
      if (action === "recall" && !s.usePrivate && !s.useShared && args["scope"] !== "history") return "Memory is switched off for this bot.";
      return null;
    },
    actions: {
      recall: {
        kind: "read",
        description: 'Search saved notes (scope "notes") or your own finished tasks (scope "history")',
        args: z.strictObject({ query: z.string().min(2).max(MEMORY_LIMITS.queryChars), scope: z.enum(["notes", "history"]).default("notes") }),
        summarize: (a) => `Search memory (${String(a["scope"])}) for "${String(a["query"]).slice(0, 80)}"`,
        execute: async (a, ctx) => {
          if (!ctx.botId) throw new Error("Memory belongs to a bot.");
          const hits = memory.recall(ctx.botId, String(a["query"]), a["scope"] as "notes" | "history");
          return hits.length === 0 ? "Nothing found." : hits.map((h) => `[${h.scope}] ${h.title}: ${h.snippet}`).join("\n");
        },
      },
      remember: {
        kind: "write",
        resultSupport: [{ operation: "create", objects: ["note"] }, { operation: "save", objects: ["note"] }],
        description: "Ask to save a private note for yourself (needs the owner's approval; never saves secrets)",
        args: z.strictObject({ title: z.string().min(1).max(MEMORY_LIMITS.title), text: z.string().min(1).max(MEMORY_LIMITS.content) }),
        summarize: (a) => `Save a private memory note: "${String(a["title"]).slice(0, 100)}"`,
        execute: async (a, ctx) => {
          if (!ctx.botId) throw new Error("Memory belongs to a bot.");
          const n = memory.create({ title: a["title"], content: a["text"], tags: [], pinned: false }, "bot", ctx.botId, "bot");
          return `Saved note ${n.id}`;
        },
      },
    },
  };
}
