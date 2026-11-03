/**
 * How a bot asks to hand work to a teammate: a fenced text block in its reply.
 *
 *   ```delegate
 *   {"to": "Researcher", "task": "Find three facts about solar panels."}
 *   ```
 *
 * The PLATFORM reads these blocks. Nothing is sent to a model as a "tool", so the Phase 2
 * guarantee (bots produce text only) still holds. Unknown or invalid requests are rejected.
 */

export type DelegationRequest =
  | { ok: true; to: string; task: string }
  | { ok: false; reason: string };

const BLOCK = /```delegate[ \t]*\r?\n([\s\S]*?)```/g;

export interface ParsedReply {
  requests: DelegationRequest[];
  /** The reply with every delegate block removed. */
  text: string;
}

export function stripDelegations(text: string): string {
  return text.replace(BLOCK, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function parseDelegations(text: string, maxTaskChars: number): ParsedReply {
  const requests: DelegationRequest[] = [];
  for (const match of text.matchAll(BLOCK)) {
    const raw = (match[1] ?? "").trim();
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      requests.push({ ok: false, reason: "the request was not valid JSON" });
      continue;
    }
    const obj = typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
    const to = typeof obj?.["to"] === "string" ? obj["to"].trim() : "";
    const task = typeof obj?.["task"] === "string" ? obj["task"].trim() : "";
    if (!to || !task) {
      requests.push({ ok: false, reason: 'the request needs a "to" (teammate name) and a "task" (instructions)' });
    } else if (to.length > 80) {
      requests.push({ ok: false, reason: 'the "to" name is too long' });
    } else if (task.length > maxTaskChars) {
      requests.push({ ok: false, reason: `the task is too long (${task.length} characters; the limit is ${maxTaskChars})` });
    } else {
      requests.push({ ok: true, to, task });
    }
  }
  return { requests, text: stripDelegations(text) };
}

export interface Teammate {
  name: string;
  role: string;
  responsibilities: string[];
}

/** Added to the instructions of a bot that is allowed to delegate. */
export function buildDelegationAddendum(teammates: Teammate[], maxPerReply: number): string {
  const list = teammates
    .map((t) => {
      const details = [t.role.trim(), t.responsibilities.slice(0, 5).join("; ")].filter(Boolean).join(" | ");
      return `- ${t.name}${details ? `: ${details.slice(0, 300)}` : ""}`;
    })
    .join("\n");
  return [
    "Teamwork:",
    "You may hand part of this work to one of these teammates:",
    list,
    "",
    "To do that, put a block like this in your reply (one block per teammate, at most " + maxPerReply + " in a reply):",
    "```delegate",
    '{"to": "<teammate name exactly as listed>", "task": "<complete, self-contained instructions>"}',
    "```",
    "Rules: teammates cannot see this conversation, so write complete instructions. Only delegate when it truly helps.",
    "You will receive their answers and then write the final answer yourself. If you do not need help, just answer.",
  ].join("\n");
}
