import type { DatabaseSync } from "node:sqlite";
import type { Runtime } from "../agent-manager/types.js";

type Row = Record<string, unknown>;

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export const FINAL_STATUSES: readonly TaskStatus[] = ["completed", "failed", "cancelled"];

export interface TaskRecord {
  id: string;
  rootId: string;
  parentId: string | null;
  assigneeBotId: string;
  assigneeName: string;
  requestedBy: string;
  requestedByName: string;
  instruction: string;
  depth: number;
  status: TaskStatus;
  result: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TaskEventRecord {
  id: number;
  taskId: string;
  kind: string;
  detail: string;
  createdAt: string;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  responsibilities: string[];
  archived: boolean;
  model: string | null;
  runtime: Runtime;
}

export interface DelegationAuditRecord {
  id: number;
  targetBotId: string;
  targetName: string;
  action: "allowed" | "removed";
  actor: string;
  createdAt: string;
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const TASK_SELECT = `
  SELECT t.*, COALESCE(a.name, '(unknown)') AS assignee_name,
         CASE WHEN t.requested_by = 'user' THEN 'You' ELSE COALESCE(r.name, '(unknown)') END AS requested_by_name
  FROM tasks t
  LEFT JOIN bots a ON a.id = t.assignee_bot_id
  LEFT JOIN bots r ON r.id = t.requested_by`;

function toTask(r: Row): TaskRecord {
  return {
    id: String(r["id"]),
    rootId: String(r["root_id"]),
    parentId: str(r["parent_id"]),
    assigneeBotId: String(r["assignee_bot_id"]),
    assigneeName: String(r["assignee_name"]),
    requestedBy: String(r["requested_by"]),
    requestedByName: String(r["requested_by_name"]),
    instruction: String(r["instruction"]),
    depth: Number(r["depth"]),
    status: String(r["status"]) as TaskStatus,
    result: str(r["result"]),
    errorCode: str(r["error_code"]),
    errorMessage: str(r["error_message"]),
    llmCalls: Number(r["llm_calls"]),
    inputTokens: Number(r["input_tokens"]),
    outputTokens: Number(r["output_tokens"]),
    createdAt: String(r["created_at"]),
    startedAt: str(r["started_at"]),
    finishedAt: str(r["finished_at"]),
  };
}

export interface NewTask {
  id: string;
  rootId: string;
  parentId: string | null;
  assigneeBotId: string;
  requestedBy: string;
  instruction: string;
  depth: number;
  createdAt: string;
}

/** All SQL for tasks, the delegation allow-list and its settings. No rules here. */
export class TaskRepository {
  constructor(private readonly db: DatabaseSync) {}

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // ---- tasks ----
  insertTask(t: NewTask): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, root_id, parent_id, assignee_bot_id, requested_by, instruction, depth, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(t.id, t.rootId, t.parentId, t.assigneeBotId, t.requestedBy, t.instruction, t.depth, t.createdAt);
  }

  getTask(id: string): TaskRecord | undefined {
    const row = this.db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id);
    return row ? toTask(row) : undefined;
  }

  listRoots(limit: number): TaskRecord[] {
    return this.db
      .prepare(`${TASK_SELECT} WHERE t.parent_id IS NULL ORDER BY t.created_at DESC, t.rowid DESC LIMIT ?`)
      .all(limit)
      .map(toTask);
  }

  /** Every task in one chain, oldest first. */
  listChain(rootId: string): TaskRecord[] {
    return this.db.prepare(`${TASK_SELECT} WHERE t.root_id = ? ORDER BY t.created_at, t.rowid`).all(rootId).map(toTask);
  }

  countInChain(rootId: string): number {
    return Number(this.db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE root_id = ?").get(rootId)?.["n"] ?? 0);
  }

  callsInChain(rootId: string): number {
    return Number(this.db.prepare("SELECT COALESCE(SUM(llm_calls), 0) AS n FROM tasks WHERE root_id = ?").get(rootId)?.["n"] ?? 0);
  }

  markRunning(id: string, now: string): void {
    this.db.prepare("UPDATE tasks SET status = 'running', started_at = ? WHERE id = ? AND status = 'pending'").run(now, id);
  }

  /** Finishing never overwrites a cancellation. */
  finish(
    id: string,
    status: "completed" | "failed",
    now: string,
    detail: { result?: string | null; errorCode?: string | null; errorMessage?: string | null },
  ): void {
    this.db
      .prepare(
        `UPDATE tasks SET status = ?, result = ?, error_code = ?, error_message = ?, finished_at = ?
         WHERE id = ? AND status IN ('pending', 'running')`,
      )
      .run(status, detail.result ?? null, detail.errorCode ?? null, detail.errorMessage ?? null, now, id);
  }

  addUsage(id: string, calls: number, inputTokens: number, outputTokens: number): void {
    this.db
      .prepare(
        "UPDATE tasks SET llm_calls = llm_calls + ?, input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE id = ?",
      )
      .run(calls, inputTokens, outputTokens, id);
  }

  /** Cancels every unfinished task in a chain. Returns the ids that were cancelled. */
  cancelChain(rootId: string, now: string): string[] {
    const ids = this.db
      .prepare("SELECT id FROM tasks WHERE root_id = ? AND status IN ('pending', 'running')")
      .all(rootId)
      .map((r) => String(r["id"]));
    this.db
      .prepare("UPDATE tasks SET status = 'cancelled', finished_at = ? WHERE root_id = ? AND status IN ('pending', 'running')")
      .run(now, rootId);
    return ids;
  }

  /** At startup: anything still marked unfinished was cut off by a restart. */
  failInterrupted(now: string): { id: string; rootId: string }[] {
    const rows = this.db
      .prepare("SELECT id, root_id FROM tasks WHERE status IN ('pending', 'running')")
      .all()
      .map((r) => ({ id: String(r["id"]), rootId: String(r["root_id"]) }));
    this.db
      .prepare(
        `UPDATE tasks SET status = 'failed', error_code = 'interrupted',
           error_message = 'The app was stopped while this task was running.', finished_at = ?
         WHERE status IN ('pending', 'running')`,
      )
      .run(now);
    return rows;
  }

  insertEvent(taskId: string, rootId: string, kind: string, detail: string, now: string): void {
    this.db
      .prepare("INSERT INTO task_events (task_id, root_id, kind, detail, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(taskId, rootId, kind, detail, now);
  }

  listEvents(rootId: string): TaskEventRecord[] {
    return this.db
      .prepare("SELECT * FROM task_events WHERE root_id = ? ORDER BY id")
      .all(rootId)
      .map((r) => ({
        id: Number(r["id"]),
        taskId: String(r["task_id"]),
        kind: String(r["kind"]),
        detail: String(r["detail"]),
        createdAt: String(r["created_at"]),
      }));
  }

  // ---- allow-list ----
  listTargets(botId: string): TeamMember[] {
    return this.db
      .prepare(
        `SELECT b.id, b.name, b.role, b.responsibilities, b.archived, b.model, b.runtime
         FROM bot_delegation_targets d JOIN bots b ON b.id = d.target_bot_id
         WHERE d.bot_id = ? ORDER BY b.name, b.id`,
      )
      .all(botId)
      .map((r) => ({
        id: String(r["id"]),
        name: String(r["name"]),
        role: String(r["role"]),
        responsibilities: JSON.parse(String(r["responsibilities"])) as string[],
        archived: Number(r["archived"]) === 1,
        model: str(r["model"]),
        runtime: String(r["runtime"]) as Runtime,
      }));
  }

  /** Replaces the allow-list and logs each addition and removal. */
  replaceTargets(botId: string, targetIds: string[], now: string): void {
    const current = new Set(this.listTargets(botId).map((t) => t.id));
    const next = new Set(targetIds);
    const insert = this.db.prepare("INSERT INTO bot_delegation_targets (bot_id, target_bot_id) VALUES (?, ?)");
    const remove = this.db.prepare("DELETE FROM bot_delegation_targets WHERE bot_id = ? AND target_bot_id = ?");
    const audit = this.db.prepare(
      "INSERT INTO delegation_audit (bot_id, target_bot_id, action, created_at) VALUES (?, ?, ?, ?)",
    );
    for (const id of next) {
      if (!current.has(id)) {
        insert.run(botId, id);
        audit.run(botId, id, "allowed", now);
      }
    }
    for (const id of current) {
      if (!next.has(id)) {
        remove.run(botId, id);
        audit.run(botId, id, "removed", now);
      }
    }
  }

  listAudit(botId: string): DelegationAuditRecord[] {
    return this.db
      .prepare(
        `SELECT a.*, COALESCE(b.name, '(unknown)') AS target_name FROM delegation_audit a
         LEFT JOIN bots b ON b.id = a.target_bot_id WHERE a.bot_id = ? ORDER BY a.id DESC LIMIT 100`,
      )
      .all(botId)
      .map((r) => ({
        id: Number(r["id"]),
        targetBotId: String(r["target_bot_id"]),
        targetName: String(r["target_name"]),
        action: String(r["action"]) as "allowed" | "removed",
        actor: String(r["actor"]),
        createdAt: String(r["created_at"]),
      }));
  }

  // ---- settings ----
  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM delegation_settings WHERE key = ?").get(key);
    return row ? String(row["value"]) : null;
  }

  setSetting(key: string, value: string, now: string): void {
    this.db
      .prepare(
        `INSERT INTO delegation_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, now);
  }

  deleteSetting(key: string): void {
    this.db.prepare("DELETE FROM delegation_settings WHERE key = ?").run(key);
  }
}
