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

  /** How many events of one kind happened since a moment in time, optionally only those whose detail contains a fragment (no agent needed). */
  countKindSince(kind: string, sinceMs: number, detailContains?: string): number {
    const like = detailContains === undefined ? "" : " AND detail LIKE ? ESCAPE '!'";
    const params: (string | number)[] = [kind, sinceMs];
    if (detailContains !== undefined) params.push(`%${detailContains.replace(/[!%_]/g, (c) => `!${c}`)}%`);
    return Number(this.db.prepare(`SELECT COUNT(*) AS n FROM audit_events WHERE kind = ? AND created_ms >= ?${like}`).get(...params)?.["n"] ?? 0);
  }

  /** The newest event of any of these kinds, optionally only if its detail text contains every given fragment. Read-only; used for "last verified / last used". */
  latest(kinds: string[], detailContains: string[] = []): AuditEvent | null {
    if (kinds.length === 0) return null;
    const marks = kinds.map(() => "?").join(", ");
    // "!" is the escape character, so a fragment can contain % or _ and still match literally.
    const likes = detailContains.map(() => " AND detail LIKE ? ESCAPE '!'").join("");
    const params: string[] = [...kinds, ...detailContains.map((f) => `%${f.replace(/[!%_]/g, (c) => `!${c}`)}%`)];
    const r = this.db.prepare(`SELECT * FROM audit_events WHERE kind IN (${marks})${likes} ORDER BY id DESC LIMIT 1`).get(...params);
    if (!r) return null;
    return {
      id: Number(r["id"]),
      createdAt: String(r["created_at"]),
      kind: String(r["kind"]),
      actor: String(r["actor"]),
      botId: r["bot_id"] === null ? null : String(r["bot_id"]),
      detail: JSON.parse(String(r["detail"])) as Record<string, unknown>,
    };
  }

  /** Newest events whose kind starts with a prefix (for example "access."). */
  listPrefix(prefix: string, limit: number): AuditEvent[] {
    return this.db
      .prepare("SELECT * FROM audit_events WHERE kind LIKE ? ESCAPE '!' ORDER BY id DESC LIMIT ?")
      .all(prefix.replace(/[!%_]/g, (c) => `!${c}`) + "%", limit)
      .map((r) => ({
        id: Number(r["id"]),
        createdAt: String(r["created_at"]),
        kind: String(r["kind"]),
        actor: String(r["actor"]),
        botId: r["bot_id"] === null ? null : String(r["bot_id"]),
        detail: JSON.parse(String(r["detail"])) as Record<string, unknown>,
      }));
  }

  /** The newest events of these kinds, newest first. Read-only. */
  recent(kinds: string[], limit: number): AuditEvent[] {
    if (kinds.length === 0) return [];
    const marks = kinds.map(() => "?").join(", ");
    return this.db
      .prepare(`SELECT * FROM audit_events WHERE kind IN (${marks}) ORDER BY id DESC LIMIT ?`)
      .all(...kinds, limit)
      .map((r) => ({
        id: Number(r["id"]),
        createdAt: String(r["created_at"]),
        kind: String(r["kind"]),
        actor: String(r["actor"]),
        botId: r["bot_id"] === null ? null : String(r["bot_id"]),
        detail: JSON.parse(String(r["detail"])) as Record<string, unknown>,
      }));
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
