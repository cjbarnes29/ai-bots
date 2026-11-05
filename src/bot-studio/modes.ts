import { AppError } from "../errors.js";

/**
 * Operating modes: named CEILINGS over what a bot may ask for. A mode can only take things away, never add them:
 *  effective permission = what the owner granted (read switches, PC grants, delegation, application and folder approvals)  AND  what the mode allows.
 * Changing a mode therefore never gives a bot a tool, an application, a file or an outside action. A bot with no mode set behaves exactly as before.
 * Stored in the existing key-value table (no migration). Only the owner sets a mode (owner-only route, passphrase proof when a Guardian runs).
 */
export const MODES = ["chat_only", "research", "workflow_execution", "desktop_operator"] as const;
export type BotMode = (typeof MODES)[number];

export const MODE_INFO: Record<BotMode, { label: string; description: string }> = {
  chat_only: { label: "Chat Only", description: "Conversation only. The bot cannot ask for any outside action, file, application or tool, even if it holds permissions." },
  research: { label: "Research", description: "May read from allowed information sources (web pages, memory, business discovery, GitHub, Notion). Cannot write anything or use the PC, documents, mail, messages or desktop applications." },
  workflow_execution: { label: "Workflow Execution", description: "May use everything the owner granted for approved internal work, except operating desktop applications." },
  desktop_operator: { label: "Desktop Operator", description: "May also operate desktop applications, but only those the owner approved, in folders the owner approved, with every plan approved by the owner." },
};

const RESEARCH_READ = new Set(["browser", "memory", "business", "github", "notion"]);

/** The reason the mode forbids this, or null when the mode allows it. (The bot's own permissions are checked separately and still apply.) */
export function modeAllows(mode: BotMode, connectorId: string, kind: "read" | "write"): string | null {
  const label = MODE_INFO[mode].label;
  switch (mode) {
    case "chat_only":
      return `This bot is in ${label} mode, so it cannot use ${connectorId}.`;
    case "research":
      return kind === "read" && RESEARCH_READ.has(connectorId) ? null : `This bot is in ${label} mode: it can only read from information sources, not use ${connectorId}${kind === "write" ? " to change anything" : ""}.`;
    case "workflow_execution":
      return connectorId === "desktop" ? `This bot is in ${label} mode, which does not include operating desktop applications.` : null;
    case "desktop_operator":
      return null;
  }
}

export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
}
const KEY = "bot_studio.modes";

export class BotModes {
  constructor(private readonly kv: KeyValue) {}

  private all(): Record<string, BotMode> {
    try {
      const v = JSON.parse(this.kv.get(KEY) ?? "{}") as Record<string, unknown>;
      return Object.fromEntries(Object.entries(v).filter(([, m]) => (MODES as readonly string[]).includes(String(m)))) as Record<string, BotMode>;
    } catch {
      return {};
    }
  }
  get(botId: string): BotMode | null {
    return this.all()[botId] ?? null;
  }
  list(): Record<string, BotMode> {
    return this.all();
  }
  set(botId: string, mode: string | null): BotMode | null {
    if (mode !== null && !(MODES as readonly string[]).includes(mode)) throw new AppError(400, "invalid_mode", `Choose one of: ${MODES.join(", ")}.`);
    const all = this.all();
    if (mode === null) delete all[botId];
    else all[botId] = mode as BotMode;
    this.kv.set(KEY, JSON.stringify(all));
    return mode as BotMode | null;
  }
  /** What the approval gate asks. null = allowed (including: no mode set). */
  block(botId: string, connectorId: string, kind: "read" | "write"): string | null {
    const mode = this.get(botId);
    return mode ? modeAllows(mode, connectorId, kind) : null;
  }
}
