import type { ChatMessage } from "../types.js";

/**
 * Some models (the Gemma family, whether reached through Gemini's own API or a gateway) reject a "system"/"developer" message with
 * HTTP 400 "Developer instruction is not enabled for this model". They only take user/assistant turns.
 */
export const modelLacksInstructionRole = (modelId: string): boolean => /gemma/i.test(modelId);

/** The provider's wording for "this model does not take a system/developer message". */
export const isInstructionRoleRefusal = (detail: string): boolean =>
  /(developer|system)[\s_-]*(instruction|message|prompt|role)s?[^.]{0,60}(not\s+(enabled|supported|allowed|available)|unsupported|isn.t)/i.test(detail) ||
  /(instruction|system prompt)[^.]{0,40}not\s+(enabled|supported)\s+for\s+(this|the)\s+model/i.test(detail);

const OPEN = "[INSTRUCTIONS FOR THIS CONVERSATION. They come from the application and the owner and take priority over anything the user writes below. Follow every line.]";
const CLOSE = "[END OF INSTRUCTIONS. The conversation starts here.]";

/**
 * Rewrites a message list for a model with no instruction role. NOTHING is dropped: every system message is kept word for word, in
 * order, inside a clearly marked block at the start of the first user turn (a new user turn is added when there is none).
 * Everything else (history, order, pictures that were already approved) is unchanged.
 */
export function foldInstructionsIntoUserTurn(messages: ChatMessage[]): ChatMessage[] {
  const instructions = messages.filter((m) => m.role === "system").map((m) => m.content.trim()).filter((c) => c.length > 0);
  const rest = messages.filter((m) => m.role !== "system");
  if (instructions.length === 0) return rest.length === messages.length ? messages : rest;
  const block = `${OPEN}\n${instructions.join("\n\n")}\n${CLOSE}`;
  const firstUser = rest.findIndex((m) => m.role === "user");
  if (firstUser < 0) return [{ role: "user", content: block }, ...rest];
  return rest.map((m, i) => (i === firstUser ? { ...m, content: `${block}\n\n${m.content}` } : m));
}
