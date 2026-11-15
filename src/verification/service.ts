import type { DatabaseSync } from "node:sqlite";
import { combine, verifyTask, type ActionFact, type FileProbe, type TaskFact, type Verification, type VerificationStatus } from "./verify.js";
import { copyResultSupport } from "./action-support.js";
import { assessProvenance, type AuthorshipAssessment } from "../delegation/result-provenance.js";
import { checkManager, type ManagerVerification } from "./manager.js";
import { checkWorkflow, type WorkflowVerification } from "./workflow.js";

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
    /** Exact-task read receipts (hashes only). Optional so older fakes keep working. */
    readReceipts?(taskId: string, limit?: number): { createdAt: string; connector: string; actionName: string; resultChars: number }[];
  };
  /** Checks a file the platform itself created. Goes through the folder permission gate; "unreadable" is an honest answer, never a pass. */
  probe: FileProbe;
  /** Exact action's source-owned metadata only; never executes or checks readiness/credentials. */
  resultSupport?: (connector: string, action: string) => unknown;
}

type Row = Record<string, unknown>;
type Member = TaskFact & { rootId: string; botId: string; authorship: AuthorshipAssessment };
type ChainSnapshot = { task: Member; actions: ActionFact[] }[];
const TASK_SELECT = `SELECT t.id,t.root_id,t.assignee_bot_id,t.status,t.result,
 (SELECT COUNT(*) FROM task_events e WHERE e.task_id=t.id AND e.kind='result_provenance') AS provenance_count,
 (SELECT e.detail FROM task_events e WHERE e.task_id=t.id AND e.kind='result_provenance' ORDER BY e.id LIMIT 1) AS provenance_detail,
 (SELECT e.root_id FROM task_events e WHERE e.task_id=t.id AND e.kind='result_provenance' ORDER BY e.id LIMIT 1) AS provenance_root
 FROM tasks t`;

export interface ChainVerification extends Verification {
  tasks: number;
  completion: Record<TaskFact["status"], number> & { total: number };
  incompleteTasks: { id: string; status: TaskFact["status"] }[];
}

export class VerificationService {
  constructor(private readonly d: VerificationDeps) {}

  private fromRow(r: Row): TaskFact & { rootId: string; botId: string; authorship: AuthorshipAssessment } {
    const task = { id: String(r["id"]), rootId: String(r["root_id"]), botId: String(r["assignee_bot_id"]), status: String(r["status"]) as TaskFact["status"], result: r["result"] === null ? null : String(r["result"]) };
    const detail = r["provenance_detail"];
    return { ...task, authorship: assessProvenance(task, r["provenance_count"], typeof detail === "string" ? { taskId: task.id, rootId: String(r["provenance_root"]), detail } : undefined) };
  }

  private task(id: string) {
    const r = this.d.db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id) as Row | undefined;
    if (!r) return null;
    return this.fromRow(r);
  }
  private actions(taskId: string): ActionFact[] {
    return this.d.db
      .prepare("SELECT id, task_id, connector, action, status, result, error, summary FROM approval_requests WHERE task_id = ? ORDER BY created_at")
      .all(taskId)
      .map((r: Row) => this.actionFact(r));
  }

  private actionFact(r: Row): ActionFact {
    const connector = String(r["connector"]), action = String(r["action"]);
    let resultSupport;
    try { resultSupport = copyResultSupport(this.d.resultSupport?.(connector, action)); } catch { /* unavailable metadata remains unknown */ }
    return { id: String(r["id"]), taskId: r["task_id"] === null ? null : String(r["task_id"]), connector, action, resultSupport, status: String(r["status"]) as ActionFact["status"], result: r["result"] === null ? null : String(r["result"]), error: r["error"] === null ? null : String(r["error"]), summary: String(r["summary"]) };
  }

  /** One task. Undefined when the task does not exist. */
  verifyTask(id: string): Verification | undefined {
    const t = this.task(id);
    return t ? verifyTask(t, this.actions(t.id), this.d.probe, t.authorship) : undefined;
  }

  /**
   * Outside reads recorded for the tasks of one chain (D-112/D-114). Purely informational: it NEVER changes a verdict, and it says only that a read ran for that task,
   * not that its content was used or correct. Hashes and counts only. Bounded; older reads without a task id are not listed.
   */
  readReceiptsForChain(rootId: string, limit = 20): { taskId: string; connector: string; actionName: string; at: string; resultChars: number }[] {
    if (!this.d.audit.readReceipts) return [];
    const out: { taskId: string; connector: string; actionName: string; at: string; resultChars: number }[] = [];
    for (const row of this.d.db.prepare("SELECT id FROM tasks WHERE root_id = ? ORDER BY created_at, id LIMIT 50").all(rootId)) {
      const taskId = String(row["id"]);
      for (const r of this.d.audit.readReceipts(taskId, limit - out.length)) {
        out.push({ taskId, connector: r.connector, actionName: r.actionName, at: r.createdAt, resultChars: r.resultChars });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  /** Lifecycle completeness is separate from evidence: an unfinished/failed member can never make a whole chain confirmed. */
  verifyChain(rootId: string): ChainVerification | undefined {
    return this.checkChain(this.readChain(rootId));
  }

  private readChain(rootId: string): ChainSnapshot {
    return this.d.db.prepare(`${TASK_SELECT} WHERE t.root_id = ? ORDER BY t.created_at, t.id`).all(rootId)
      .map(r => { const task = this.fromRow(r); return { task, actions: this.actions(task.id) }; });
  }

  private checkChain(snapshot: ChainSnapshot): ChainVerification | undefined {
    const members = snapshot.map(s => s.task);
    if (members.length === 0) return undefined;
    const completion: ChainVerification["completion"] = { total: members.length, completed: 0, pending: 0, running: 0, failed: 0, cancelled: 0 };
    for (const member of members) completion[member.status]++;
    const incompleteTasks = members.filter(t => t.status !== "completed").map(({ id, status }) => ({ id, status }));
    const verdict = combine(snapshot.map(({ task: t, actions }) => verifyTask(t, actions, this.d.probe, t.authorship)));
    if (incompleteTasks.length > 0) {
      if (verdict.status === "verified") verdict.status = "unverified";
      const details = (["failed", "cancelled", "pending", "running"] as const).filter(s => completion[s] > 0).map(s => `${completion[s]} ${s}`).join(", ");
      const warning = `${incompleteTasks.length} of ${members.length} task(s) did not complete successfully (${details}); this chain is not fully confirmed.`;
      // Keep stronger contradiction/approval warnings, without repeating combine's all-confirmed wording.
      verdict.summary = verdict.status === "contradicted" || verdict.status === "waiting" ? `${verdict.summary} ${warning}` : warning;
    }
    return { ...verdict, tasks: members.length, completion, incompleteTasks };
  }

  /** No writes/audit/model work. Snapshot references and evidence before any folder-gated file observations. */
  verifyManager(id: string): ManagerVerification | undefined {
    return checkManager(this.d.db, id, rootId => this.readChain(rootId), snapshot => this.checkChain(snapshot)!);
  }

  /** Uses exact saved workflow records only; never resolves approvals or ticks an executor. */
  verifyWorkflow(id: string): WorkflowVerification | undefined {
    return checkWorkflow(this.d.db, id, rootId => this.readChain(rootId), snapshot => this.checkChain(snapshot)!, row => this.actionFact(row), this.d.probe);
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
