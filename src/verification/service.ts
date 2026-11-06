import type { DatabaseSync } from "node:sqlite";
import { combine, verifyTask, type ActionFact, type FileProbe, type TaskFact, type Verification, type VerificationStatus } from "./verify.js";

/**
 * Reads the platform's own records (tasks, approval requests) and verifies a task or a whole chain with verify.ts.
 * Read-only apart from one audit line (`task.verification`) written when a task's verdict is first recorded or changes: an approval granted later
 * can turn "waiting" into "verified", so the verdict is always recomputed from the current record and never stored as the truth.
 */
export interface VerificationDeps {
  db: DatabaseSync;
  audit: {
    record(kind: string, detail?: Record<string, unknown>, options?: { botId?: string; actor?: string }): void;
    latest(kinds: string[], detailContains?: string[]): { detail: Record<string, unknown> } | null;
  };
  /** Checks a file the platform itself created. Goes through the folder permission gate; "unreadable" is an honest answer, never a pass. */
  probe: FileProbe;
}

type Row = Record<string, unknown>;

export class VerificationService {
  constructor(private readonly d: VerificationDeps) {}

  private task(id: string): (TaskFact & { rootId: string; botId: string }) | null {
    const r = this.d.db.prepare("SELECT id, root_id, assignee_bot_id, status, result FROM tasks WHERE id = ?").get(id) as Row | undefined;
    if (!r) return null;
    return { id: String(r["id"]), rootId: String(r["root_id"]), botId: String(r["assignee_bot_id"]), status: String(r["status"]) as TaskFact["status"], result: r["result"] === null ? null : String(r["result"]) };
  }
  private actions(taskId: string): ActionFact[] {
    return this.d.db
      .prepare("SELECT id, task_id, connector, action, status, result, error, summary FROM approval_requests WHERE task_id = ? ORDER BY created_at")
      .all(taskId)
      .map((r: Row) => ({ id: String(r["id"]), taskId: r["task_id"] === null ? null : String(r["task_id"]), connector: String(r["connector"]), action: String(r["action"]), status: String(r["status"]) as ActionFact["status"], result: r["result"] === null ? null : String(r["result"]), error: r["error"] === null ? null : String(r["error"]), summary: String(r["summary"]) }));
  }

  /** One task. Undefined when the task does not exist. */
  verifyTask(id: string): Verification | undefined {
    const t = this.task(id);
    return t ? verifyTask(t, this.actions(t.id), this.d.probe) : undefined;
  }

  /** A whole chain: the root task and everything it handed on. The worst result wins. */
  verifyChain(rootId: string): (Verification & { tasks: number }) | undefined {
    const ids = this.d.db.prepare("SELECT id FROM tasks WHERE root_id = ? ORDER BY created_at").all(rootId).map((r: Row) => String(r["id"]));
    if (ids.length === 0) return undefined;
    const parts = ids.map((id) => this.verifyTask(id)!);
    return { ...combine(parts), tasks: ids.length };
  }

  /** Writes the verdict to the audit log when it is new or different from the last one recorded for this chain. Never throws. */
  record(rootId: string): VerificationStatus | undefined {
    try {
      const v = this.verifyChain(rootId);
      if (!v) return undefined;
      const root = this.task(rootId);
      const last = this.d.audit.latest(["task.verification"], [`"taskId":"${rootId}"`]);
      if (last?.detail["status"] === v.status && last.detail["evidence"] === v.evidence) return v.status;
      this.d.audit.record("task.verification", { taskId: rootId, status: v.status, evidence: v.evidence, failed: v.checks.filter((c) => c.outcome === "fail").length, summary: v.summary.slice(0, 200) }, { actor: "system", ...(root ? { botId: root.botId } : {}) });
      return v.status;
    } catch {
      return undefined; // a verification problem never stops a task
    }
  }

  /**
   * Per agent: how many of its most recent finished chains (up to 100 overall) are verified / contradicted RIGHT NOW. Computed from the current record,
   * so an approval granted later counts at once. Used by the capability registry: an agent is only "verified" with real confirmation.
   */
  countsByBot(limit = 100): Map<string, { verified: number; contradicted: number }> {
    const out = new Map<string, { verified: number; contradicted: number }>();
    const roots = this.d.db.prepare("SELECT id, assignee_bot_id AS b FROM tasks WHERE id = root_id AND status = 'completed' ORDER BY finished_at DESC LIMIT ?").all(limit) as Row[];
    for (const r of roots) {
      const v = this.verifyChain(String(r["id"]));
      if (!v) continue;
      const e = out.get(String(r["b"])) ?? { verified: 0, contradicted: 0 };
      if (v.status === "verified") e.verified++;
      else if (v.status === "contradicted") e.contradicted++;
      out.set(String(r["b"]), e);
    }
    return out;
  }
}
