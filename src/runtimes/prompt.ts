import type { BotContent } from "../agent-manager/types.js";

/** Builds the instructions a model receives before the conversation starts. */
export function buildSystemPrompt(bot: Pick<BotContent, "name" | "role" | "personality" | "instructions" | "responsibilities">): string {
  const parts: string[] = [`You are "${bot.name}", an AI assistant working inside the AI Workforce Platform.`];
  if (bot.role.trim()) parts.push(`Your role: ${bot.role.trim()}`);
  if (bot.personality.trim()) parts.push(`Your personality and tone:\n${bot.personality.trim()}`);
  if (bot.responsibilities.length > 0) {
    parts.push(`Your responsibilities:\n${bot.responsibilities.map((r) => `- ${r}`).join("\n")}`);
  }
  if (bot.instructions.trim()) parts.push(`Your instructions:\n${bot.instructions.trim()}`);
  parts.push(
    [
      "Ground rules:",
      "- You can only reply with text in this conversation.",
      "- You have no tools. You cannot browse the web, read or send email or messages, run code, or take any action outside this chat.",
      "- If someone asks you to do something that needs a tool, say that you cannot do it yet.",
    ].join("\n"),
  );
  return parts.join("\n\n");
}
