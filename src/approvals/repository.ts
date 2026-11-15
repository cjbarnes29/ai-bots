import type { DatabaseSync } from "node:sqlite";

type Row = Record<string, unknown>;

export type ApprovalStatus = "pending" | "approved" | "executed" | "failed" | "denied" | "expired";

export interface ApprovalRecord {
  id: string;
  botId: string;
  taskId: string | null;
  connector: string;
  action: string;
  summary: string;
  argsJson: string;
  argsHash: string;
  status: ApprovalStatus;
  result: string | null;
  error: string | null;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  executedAt: string | null;
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function toApproval(r: Row): ApprovalRecord {
  return {
    id: String(r["id"]),
    botId: String(r["bot_id"]),
    taskId: str(r["task_id"]),
    connector: String(r["connector"]),
    action: String(r["action"]),
    summary: String(r["summary"]),
    argsJson: String(r["args_json"]),
    argsHash: String(r["args_hash"]),
    status: String(r["status"]) as ApprovalStatus,
    result: str(r["result"]),
    error: str(r["error"]),
    createdAt: String(r["created_at"]),
    expiresAt: String(r["expires_at"]),
    decidedAt: str(r["decided_at"]),
    decidedBy: str(r["decided_by"]),
    executedAt: str(r["executed_at"]),
  };
}

export class ApprovalRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** One connection, synchronous work only; BEGIN failure must never roll back a caller's transaction. */
  transaction<T>(work: (db: DatabaseSync) => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work(this.db);
      if (result !== null && (typeof result === "object" || typeof result === "function") && typeof (result as { then?: unknown }).then === "function") {
        if (result instanceof Promise) void result.catch(() => undefined);
        throw new Error("Approval transactions must be synchronous.");
      }
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  insert(a: Pick<ApprovalRecord, "id" | "botId" | "taskId" | "connector" | "action" | "summary" | "argsJson" | "argsHash" | "createdAt" | "expiresAt">): void {
    this.db
      .prepare(
        `INSERT INTO approval_requests (id, bot_id, task_id, connector, action, summary, args_json, args_hash, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(a.id, a.botId, a.taskId, a.connector, a.action, a.summary, a.argsJson, a.argsHash, a.createdAt, a.expiresAt);
  }

  get(id: string): ApprovalRecord | undefined {
    const row = this.db.prepare("SELECT * FROM approval_requests WHERE id = ?").get(id);
    return row ? toApproval(row) : undefined;
  }

  list(onlyPending: boolean, limit: number): ApprovalRecord[] {
    const sql = onlyPending
      ? "SELECT * FROM approval_requests WHERE status = 'pending' ORDER BY created_at DESC, rowid DESC LIMIT ?"
      : "SELECT * FROM approval_requests ORDER BY created_at DESC, rowid DESC LIMIT ?";
    return this.db.prepare(sql).all(limit).map(toApproval);
  }

  countPending(botId?: string): number {
    const row =
      botId === undefined
        ? this.db.prepare("SELECT COUNT(*) AS n FROM approval_requests WHERE status = 'pending'").get()
        : this.db.prepare("SELECT COUNT(*) AS n FROM approval_requests WHERE status = 'pending' AND bot_id = ?").get(botId);
    return Number(row?.["n"] ?? 0);
  }

  countCreatedSince(botId: string, sinceIso: string): number {
    return Number(
      this.db.prepare("SELECT COUNT(*) AS n FROM approval_requests WHERE bot_id = ? AND created_at >= ?").get(botId, sinceIso)?.["n"] ?? 0,
    );
  }

  /**
   * Claims a pending request for approval. Returns false if it was not pending, so two clicks can never both win:
   * an action can only ever be approved (and so run) once.
   */
  claimApproval(id: string, nowIso: string, by: string): boolean {
    return Number(this.db.prepare("UPDATE approval_requests SET status = 'approved', decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending'").run(nowIso, by, id).changes) === 1;
  }

  claimDenial(id: string, nowIso: string, by: string, reason: string | null): boolean {
    return (
      Number(
        this.db
          .prepare("UPDATE approval_requests SET status = 'denied', decided_at = ?, decided_by = ?, error = ? WHERE id = ? AND status = 'pending'")
          .run(nowIso, by, reason, id).changes,
      ) === 1
    );
  }

  finish(id: string, status: "executed" | "failed", nowIso: string, detail: { result?: string | null; error?: string | null }): void {
    this.db
      .prepare("UPDATE approval_requests SET status = ?, result = ?, error = ?, executed_at = ? WHERE id = ? AND status = 'approved'")
      .run(status, detail.result ?? null, detail.error ?? null, nowIso, id);
  }

  /** Marks pending requests that are past their expiry. Returns their ids. */
  expireOld(nowIso: string): string[] {
    const ids = this.db
      .prepare("SELECT id FROM approval_requests WHERE status = 'pending' AND expires_at <= ?")
      .all(nowIso)
      .map((r) => String(r["id"]));
    if (ids.length > 0) {
      this.db
        .prepare("UPDATE approval_requests SET status = 'expired', decided_at = ?, decided_by = 'system' WHERE status = 'pending' AND expires_at <= ?")
        .run(nowIso, nowIso);
    }
    return ids;
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM approval_settings WHERE key = ?").get(key);
    return row ? String(row["value"]) : null;
  }

  setSetting(key: string, value: string, nowIso: string): void {
    this.db
      .prepare(
        `INSERT INTO approval_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, nowIso);
  }
}
