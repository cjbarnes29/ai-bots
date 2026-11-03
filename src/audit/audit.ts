import type { DatabaseSync } from "node:sqlite";
import { redactKnownSecrets } from "../llm/plugins/index.js";

export interface AuditEvent {
  id: number;
  createdAt: string;
  kind: string;
  actor: string;
  botId: string | null;
  detail: Record<string, unknown>;
}

/**
 * A permanent, append-only record of security-relevant events (approvals, vault changes, outside reads).
 * It must never contain secret values: details are cleaned of anything that looks like an API key.
 */
export class AuditLog {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  record(kind: string, detail: Record<string, unknown> = {}, options: { actor?: string; botId?: string | null } = {}): void {
    const nowMs = this.now();
    this.db
      .prepare("INSERT INTO audit_events (created_at, created_ms, kind, actor, bot_id, detail) VALUES (?, ?, ?, ?, ?, ?)")
      .run(new Date(nowMs).toISOString(), nowMs, kind, options.actor ?? "system", options.botId ?? null, redactKnownSecrets(JSON.stringify(detail)));
  }

  /** How many events of one kind a bot caused since a moment in time (used for daily limits). */
  countSince(kind: string, botId: string, sinceMs: number): number {
    return Number(
      this.db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE kind = ? AND bot_id = ? AND created_ms >= ?").get(kind, botId, sinceMs)?.["n"] ?? 0,
    );
  }

  list(limit: number): AuditEvent[] {
    return this.db
      .prepare("SELECT * FROM audit_events ORDER BY id DESC LIMIT ?")
      .all(limit)
      .map((r) => ({
        id: Number(r["id"]),
        createdAt: String(r["created_at"]),
        kind: String(r["kind"]),
        actor: String(r["actor"]),
        botId: r["bot_id"] === null ? null : String(r["bot_id"]),
        detail: JSON.parse(String(r["detail"])) as Record<string, unknown>,
      }));
  }
}
