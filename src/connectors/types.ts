import { z } from "zod";
import type { Connector } from "../agent-manager/types.js";

/**
 * What a connector (Telegram, Gmail, browser...) must provide. No real connector exists yet:
 * Phases 6 to 8 add them. Until then the list of connectors is EMPTY, so no bot can reach anything outside.
 */
export interface ActionContext {
  /** Looks up a stored secret (from the vault, or .env). Connectors never see other secrets. */
  secret(name: string): string | null;
  /** The bot that asked (null when the platform itself is acting). */
  botId: string | null;
}

export interface ActionSpec {
  /** "read" actions run straight away if the bot may read this connector. "write" actions ALWAYS need the owner's approval. */
  kind: "read" | "write";
  /** A short description shown to the bot and to you. */
  description: string;
  /** The exact shape of the arguments. Anything else is rejected. */
  args: z.ZodType<Record<string, unknown>>;
  /** One line shown in the approval screen, e.g. "Send a Telegram message to Sam". */
  summarize(args: Record<string, unknown>): string;
  /** How long the gate waits for execute() before giving up. Default 30 seconds. */
  timeoutMs?: number;
  /** Does the real work. Only ever called by the gate, and for writes only after the owner approved. */
  execute(args: Record<string, unknown>, context: ActionContext): Promise<string>;
}

export interface ConnectorDefinition {
  id: Connector | "pc" | "documents";
  label: string;
  /** The vault secrets this connector needs (for the Secrets screen). */
  secrets?: { name: string; description: string }[];
  /** Returns a plain-language reason if the connector cannot be used yet (for example, no token saved), otherwise null. */
  notReady?(context: Pick<ActionContext, "secret">): string | null;
  /** Per-bot permission beyond the generic read switch (the PC agent's five permissions). Returns the reason to refuse, or null. Checked when asked AND when approved. */
  authorize?(botId: string, action: string, args: Record<string, unknown>): string | null;
  actions: Record<string, ActionSpec>;
}

export class ConnectorRegistry {
  private readonly connectors = new Map<string, ConnectorDefinition>();

  constructor(definitions: ConnectorDefinition[] = []) {
    for (const d of definitions) this.register(d);
  }

  register(definition: ConnectorDefinition): void {
    if (this.connectors.has(definition.id)) throw new Error(`Connector ${definition.id} is already registered`);
    this.connectors.set(definition.id, definition);
  }

  list(): ConnectorDefinition[] {
    return [...this.connectors.values()];
  }

  get(id: string): ConnectorDefinition | undefined {
    return this.connectors.get(id);
  }

  action(connector: string, action: string): ActionSpec | undefined {
    const spec = this.connectors.get(connector)?.actions;
    return spec && Object.prototype.hasOwnProperty.call(spec, action) ? spec[action] : undefined;
  }
}
