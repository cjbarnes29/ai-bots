import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AuditLog } from "../audit/audit.js";
import type { PendingApprovalLink } from "../approvals/service.js";
import type { TaskEngine } from "../delegation/engine.js";
import type { TaskRecord } from "../delegation/repository.js";
import { AppError } from "../errors.js";
import { LlmError } from "../llm/errors.js";
import type { ManagerService, RunView as ManagerRunView } from "../manager/service.js";
import { GRAPH_LIMITS, evaluateCondition, graphSchema, renderTemplate, validateGraph, type Graph, type GraphNode, type Problem } from "./graph.js";
import { linkedWorkflowApproval } from "./approval-binding.js";

/**
 * Workflows (Stage 6): boxes and arrows that start bot tasks and Manager requests, branch on their results, and can wait for a person.
 *
 * Safety and reliability rules (all tested):
 *  - A new workflow is OFF. Off means it never starts by itself; you can still press Run on it.
 *  - A run follows a COPY of the graph made when it started, and every box's result is saved the moment it finishes (a checkpoint).
 *  - After a restart a run continues from its checkpoints: finished boxes are kept, boxes that never started are started, and a box that was in the
 *    middle of a bot task is NOT started a second time (the bot may already have asked for an outside action). You press "Retry" if you want that.
 *  - A box that already asked for an outside action can never be retried automatically (no duplicate requests).
 *  - Nothing here can reach the outside by itself. Bot tasks go through the approval gate as always; "Checkpoint" boxes stop the run until a person decides.
 *  - Limits: 25 boxes, 20 runs a day per workflow and 60 overall, 5 runs alive at once, 30 minutes per run, no loops.
 *  - The automation pause switch holds everything (queued runs wait, running runs stop between boxes).
 */
export const WORKFLOW_LIMITS = { runsPerDayPerWorkflow: 20, runsPerDay: 60, alive: 5, concurrentRuns: 2, parallelBoxes: 2, runMs: 30 * 60_000, dedupeMs: 60_000, maxOutput: 20_000 };

export interface RunStepView {
  nodeId: string;
  label: string;
  type: string;
  status: string;
  output: string | null;
  error: string | null;
  attempts: number;
  refKind: string | null;
  refId: string | null;
  decidedBy: string | null;
}
export interface RunView {
  id: string;
  workflowId: string;
  workflowName: string;
  workflowVersion: number;
  status: string;
  trigger: string;
  input: string;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  steps: RunStepView[];
}
export interface WorkflowView {
  id: string;
  name: string;
  enabled: boolean;
  archived: boolean;
  version: number;
  graph: Graph;
  problems: Problem[];
  updatedAt: string;
  lastRun: { id: string; status: string; createdAt: string } | null;
}

export interface WorkflowDeps {
  db: DatabaseSync;
  audit: AuditLog;
  now: () => number;
  engine: Pick<TaskEngine, "submit" | "cancel">;
  getTask: (id: string) => TaskRecord | undefined;
  manager: Pick<ManagerService, "start" | "view" | "cancel">;
  botExists: (id: string) => boolean;
  /** The approval gate (the same one agents use). Without it, outside-action boxes fail with a clear message. */
  actions?: {
    request(botId: string, taskId: string | null, req: { connector: string; action: string; args: Record<string, unknown> }, link?: PendingApprovalLink): Promise<{ status: "done"; text: string } | { status: "pending_approval"; approvalId: string } | { status: "denied"; reason: string } | { status: "failed"; reason: string }>;
    exists(connector: string, action: string): boolean;
  };
  automationPaused: () => boolean;
  pollMs?: number;
}

class Stop extends Error {}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 24);
const TERMINAL_STEP = ["completed", "failed", "skipped"];

export class WorkflowService {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly cancelled = new Set<string>();
  private startupReconciled = false;

  constructor(private readonly d: WorkflowDeps) {}

  private iso(): string {
    return new Date(this.d.now()).toISOString();
  }

  // ---------------------------------------------------------------- workflows
  private rowOf(id: string): Record<string, unknown> {
    const r = this.d.db.prepare("SELECT * FROM workflows WHERE id = ?").get(id);
    if (!r) throw new AppError(404, "workflow_not_found", "That workflow does not exist.");
    return r;
  }

  private view(r: Record<string, unknown>): WorkflowView {
    const graph = graphSchema.parse(JSON.parse(String(r["graph"])));
    const last = this.d.db.prepare("SELECT id, status, created_at FROM workflow_runs WHERE workflow_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(String(r["id"]));
    return {
      id: String(r["id"]),
      name: String(r["name"]),
      enabled: Number(r["enabled"]) === 1,
      archived: Number(r["archived"]) === 1,
      version: Number(r["version"]),
      graph,
      problems: this.problemsOf(graph),
      updatedAt: String(r["updated_at"]),
      lastRun: last ? { id: String(last["id"]), status: String(last["status"]), createdAt: String(last["created_at"]) } : null,
    };
  }

  /** Rules from graph.ts, plus checks that need the database (the bots must exist). */
  private problemsOf(g: Graph): Problem[] {
    const problems = validateGraph(g);
    for (const n of g.nodes) if ((n.type === "bot_task" || n.type === "integration") && !this.d.botExists(n.botId)) problems.push({ node: n.id, message: "The bot chosen for this box does not exist any more." });
    for (const n of g.nodes) if (n.type === "integration" && this.d.actions && !this.d.actions.exists(n.connector, n.action)) problems.push({ node: n.id, message: `"${n.connector}.${n.action}" is not an outside action that exists.` });
    return problems;
  }

  /** For the editor: what is wrong with a drawing, without saving it. */
  check(graph: unknown): Problem[] {
    const parsed = graphSchema.safeParse(graph);
    if (!parsed.success) return [{ message: `The drawing is not valid: ${parsed.error.issues[0]?.path.join(".") || "graph"} ${parsed.error.issues[0]?.message ?? ""}`.trim() }];
    return this.problemsOf(parsed.data);
  }

  list(includeArchived = false): WorkflowView[] {
    return this.d.db.prepare(`SELECT * FROM workflows ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY name`).all().map((r) => this.view(r));
  }

  get(id: string): WorkflowView & { versions: { version: number; note: string | null; createdAt: string }[] } {
    const v = this.view(this.rowOf(id));
    const versions = this.d.db.prepare("SELECT version, note, created_at FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC").all(id).map((x) => ({ version: Number(x["version"]), note: x["note"] === null ? null : String(x["note"]), createdAt: String(x["created_at"]) }));
    return { ...v, versions };
  }

  create(input: { name: string; graph: unknown }): WorkflowView {
    const name = input.name.trim();
    if (!name || name.length > GRAPH_LIMITS.name) throw new AppError(400, "bad_name", `Give the workflow a name (up to ${GRAPH_LIMITS.name} characters).`);
    if (this.d.db.prepare("SELECT 1 AS x FROM workflows WHERE name = ?").get(name)) throw new AppError(409, "name_taken", "A workflow with that name already exists.");
    const count = Number((this.d.db.prepare("SELECT COUNT(*) AS n FROM workflows").get() as { n: number }).n);
    if (count >= 40) throw new AppError(409, "too_many_workflows", "At most 40 workflows. Archive some you do not need.");
    const graph = graphSchema.parse(input.graph);
    const id = randomUUID();
    const now = this.iso();
    this.d.db.prepare("INSERT INTO workflows (id, name, enabled, version, graph, created_at, updated_at) VALUES (?, ?, 0, 1, ?, ?, ?)").run(id, name, JSON.stringify(graph), now, now);
    this.d.db.prepare("INSERT INTO workflow_versions (workflow_id, version, graph, note, created_at) VALUES (?, 1, ?, 'Created', ?)").run(id, JSON.stringify(graph), now);
    this.d.audit.record("workflow.created", { id, name }, { actor: "owner" });
    return this.view(this.rowOf(id));
  }

  update(id: string, patch: { name?: string; graph?: unknown; note?: string }): WorkflowView {
    const r = this.rowOf(id);
    if (Number(r["archived"]) === 1) throw new AppError(409, "workflow_archived", "Restore this workflow from the archive first.");
    const now = this.iso();
    if (patch.name !== undefined && patch.name.trim() !== String(r["name"])) {
      const name = patch.name.trim();
      if (!name || name.length > GRAPH_LIMITS.name) throw new AppError(400, "bad_name", "Give the workflow a name.");
      if (this.d.db.prepare("SELECT 1 AS x FROM workflows WHERE name = ? AND id <> ?").get(name, id)) throw new AppError(409, "name_taken", "A workflow with that name already exists.");
      this.d.db.prepare("UPDATE workflows SET name = ?, updated_at = ? WHERE id = ?").run(name, now, id);
    }
    if (patch.graph !== undefined) {
      const graph = graphSchema.parse(patch.graph);
      const text = JSON.stringify(graph);
      if (text !== String(r["graph"])) {
        const version = Number(r["version"]) + 1;
        this.d.db.prepare("INSERT INTO workflow_versions (workflow_id, version, graph, note, created_at) VALUES (?, ?, ?, ?, ?)").run(id, version, text, patch.note ?? null, now);
        // An edit that leaves problems switches the workflow off: a broken workflow must not keep starting by itself.
        const broken = this.problemsOf(graph).length > 0;
        this.d.db.prepare(`UPDATE workflows SET graph = ?, version = ?, updated_at = ?${broken ? ", enabled = 0" : ""} WHERE id = ?`).run(text, version, now, id);
        this.d.audit.record("workflow.edited", { id, version }, { actor: "owner" });
      }
    }
    return this.view(this.rowOf(id));
  }

  setEnabled(id: string, enabled: boolean): WorkflowView {
    const r = this.rowOf(id);
    const v = this.view(r);
    if (enabled) {
      if (v.archived) throw new AppError(409, "workflow_archived", "Restore this workflow from the archive first.");
      if (v.problems.length > 0) throw new AppError(409, "workflow_has_problems", `Fix the problems first: ${v.problems[0]!.message}`);
      this.d.db.prepare("UPDATE workflows SET enabled = 1, last_started_ms = ?, updated_at = ? WHERE id = ?").run(this.d.now(), this.iso(), id);
    } else this.d.db.prepare("UPDATE workflows SET enabled = 0, updated_at = ? WHERE id = ?").run(this.iso(), id);
    this.d.audit.record(enabled ? "workflow.enabled" : "workflow.disabled", { id }, { actor: "owner" });
    return this.view(this.rowOf(id));
  }

  setArchived(id: string, archived: boolean): WorkflowView {
    this.rowOf(id);
    this.d.db.prepare("UPDATE workflows SET archived = ?, enabled = 0, updated_at = ? WHERE id = ?").run(archived ? 1 : 0, this.iso(), id);
    this.d.audit.record(archived ? "workflow.archived" : "workflow.unarchived", { id }, { actor: "owner" });
    return this.view(this.rowOf(id));
  }

  duplicate(id: string): WorkflowView {
    const v = this.view(this.rowOf(id));
    let name = `Copy of ${v.name}`.slice(0, GRAPH_LIMITS.name);
    for (let i = 2; this.d.db.prepare("SELECT 1 AS x FROM workflows WHERE name = ?").get(name); i++) name = `${`Copy of ${v.name}`.slice(0, GRAPH_LIMITS.name - 5)} (${i})`;
    return this.create({ name, graph: v.graph });
  }

  // ---------------------------------------------------------------- starting runs
  private startRun(w: WorkflowView, trigger: string, input: string, requestedBy: string): RunView {
    if (w.archived) throw new AppError(409, "workflow_archived", "This workflow is archived.");
    if (w.problems.length > 0) throw new AppError(409, "workflow_has_problems", `Fix the problems first: ${w.problems[0]!.message}`);
    const dayStart = new Date(this.d.now());
    dayStart.setHours(0, 0, 0, 0);
    const since = dayStart.toISOString();
    const per = Number((this.d.db.prepare("SELECT COUNT(*) AS n FROM workflow_runs WHERE workflow_id = ? AND created_at >= ?").get(w.id, since) as { n: number }).n);
    if (per >= WORKFLOW_LIMITS.runsPerDayPerWorkflow) throw new AppError(429, "workflow_daily_limit", `This workflow already ran ${per} times today (limit ${WORKFLOW_LIMITS.runsPerDayPerWorkflow}).`);
    const total = Number((this.d.db.prepare("SELECT COUNT(*) AS n FROM workflow_runs WHERE created_at >= ?").get(since) as { n: number }).n);
    if (total >= WORKFLOW_LIMITS.runsPerDay) throw new AppError(429, "workflow_daily_limit", `Workflows already ran ${total} times today (limit ${WORKFLOW_LIMITS.runsPerDay}).`);
    const alive = Number((this.d.db.prepare("SELECT COUNT(*) AS n FROM workflow_runs WHERE status IN ('queued','running','waiting')").get() as { n: number }).n);
    if (alive >= WORKFLOW_LIMITS.alive) throw new AppError(429, "workflow_busy", `${alive} workflow runs are already working or waiting. Wait for one to finish.`);
    const text = clip(input, 4000);
    const id = randomUUID();
    this.d.db.exec("BEGIN");
    try {
      this.d.db.prepare("INSERT INTO workflow_runs (id, workflow_id, workflow_version, graph, status, trigger, input, input_hash, requested_by, created_at) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)").run(id, w.id, w.version, JSON.stringify(w.graph), trigger, text, hash(text), requestedBy, this.iso());
      const ins = this.d.db.prepare("INSERT INTO workflow_steps (run_id, node_id, status) VALUES (?, ?, 'pending')");
      for (const n of w.graph.nodes) ins.run(id, n.id);
      this.d.db.prepare("UPDATE workflows SET last_started_ms = ? WHERE id = ?").run(this.d.now(), w.id);
      this.d.db.exec("COMMIT");
    } catch (e) {
      this.d.db.exec("ROLLBACK");
      throw e;
    }
    this.d.audit.record("workflow.run_started", { id, workflow: w.id, trigger }, { actor: requestedBy });
    return this.runView(id);
  }

  /** The owner presses Run (works even if the workflow is switched off). */
  run(id: string, input: string, requestedBy = "owner"): RunView {
    return this.startRun(this.view(this.rowOf(id)), "manual", input, requestedBy);
  }

  /** A text event arrived. Only workflows that are switched ON and wait for this event name start. The same event text is not run twice within a minute. */
  onEvent(name: string, text: string): number {
    if (this.d.automationPaused()) return 0;
    let started = 0;
    for (const w of this.list()) {
      if (!w.enabled) continue;
      const t = w.graph.nodes.find((n) => n.type === "trigger");
      if (!t || t.type !== "trigger" || t.kind !== "event" || t.eventName?.toLowerCase() !== name.toLowerCase()) continue;
      const recent = this.d.db.prepare("SELECT 1 AS x FROM workflow_runs WHERE workflow_id = ? AND input_hash = ? AND trigger = 'event' AND created_at >= ?").get(w.id, hash(clip(text, 4000)), new Date(this.d.now() - WORKFLOW_LIMITS.dedupeMs).toISOString());
      if (recent) continue;
      try {
        this.startRun(w, "event", text, "event");
        started++;
      } catch {
        /* limits and problems are reported in the run list and the security log, never thrown into the event door */
      }
    }
    return started;
  }

  /** Workflows that repeat every N minutes. A missed time is never made up. */
  tickSchedules(): number {
    if (this.d.automationPaused()) return 0;
    let started = 0;
    for (const w of this.list()) {
      if (!w.enabled) continue;
      const t = w.graph.nodes.find((n) => n.type === "trigger");
      if (!t || t.type !== "trigger" || t.kind !== "interval" || !t.everyMinutes) continue;
      const last = this.d.db.prepare("SELECT last_started_ms FROM workflows WHERE id = ?").get(w.id);
      const lastMs = last?.["last_started_ms"] === null || last === undefined ? 0 : Number(last["last_started_ms"]);
      if (this.d.now() - lastMs < t.everyMinutes * 60_000) continue;
      try {
        this.startRun(w, "schedule", "", "schedule");
        started++;
      } catch {
        this.d.db.prepare("UPDATE workflows SET last_started_ms = ? WHERE id = ?").run(this.d.now(), w.id); // do not try again every tick
      }
    }
    return started;
  }

  /**
   * Outside-action boxes that were waiting for an approval: when the owner has decided it (on the Approvals page), the box finishes or fails and the run goes on.
   * Executed = its result becomes the box's output. Failed, denied or expired = the box fails with that reason. Pending = nothing happens.
   */
  resolveApprovals(): number {
    let n = 0;
    const rows = this.d.db.prepare("SELECT s.run_id, s.node_id, s.ref_id FROM workflow_steps s JOIN workflow_runs r ON r.id = s.run_id WHERE s.status = 'waiting' AND s.ref_kind = 'approval' AND r.status IN ('waiting','running','queued')").all();
    for (const r of rows) {
      const runId = String(r["run_id"]);
      const nodeId = String(r["node_id"]);
      const a = this.linkedApproval(runId, nodeId, String(r["ref_id"]));
      const st = a ? String(a["status"]) : "invalid_link";
      if (!a) this.setStep(runId, nodeId, { status: "failed", error: "The saved approval link is missing, mismatched or damaged. Review the approval history. Nothing was requested again.", finished_at: this.iso() });
      else if (st === "executed") this.setStep(runId, nodeId, { status: "completed", output: clip(String(a["result"] ?? ""), WORKFLOW_LIMITS.maxOutput), finished_at: this.iso() });
      else if (st === "failed" || st === "denied" || st === "expired") this.setStep(runId, nodeId, { status: "failed", error: clip(st === "failed" ? `The approved action failed: ${String(a["error"] ?? "")}` : `The approval was ${st}, so the action did not happen.`, 400), finished_at: this.iso() });
      else continue;
      this.d.db.prepare("UPDATE workflow_runs SET status = 'queued' WHERE id = ? AND status = 'waiting'").run(runId);
      this.d.audit.record("workflow.approval_resolved", { run: runId, node: nodeId, approval: String(r["ref_id"]), status: st });
      n++;
    }
    return n;
  }

  /** Read recorded evidence only. No gate call, payload rewrite or guessing another request. */
  private linkedApproval(runId: string, nodeId: string, approvalId: string): Record<string, unknown> | undefined {
    const run = this.d.db.prepare("SELECT graph FROM workflow_runs WHERE id = ?").get(runId);
    if (!run) return undefined;
    const node = graphSchema.parse(JSON.parse(String(run["graph"]))).nodes.find(n => n.id === nodeId);
    const binding = linkedWorkflowApproval(this.d.db, node, approvalId);
    return binding.ok ? binding.approval : undefined;
  }

  /** App startup only, after the previous executor has ended. Routine ticks must not call this. */
  reconcileApprovalsAfterRestart(): number {
    if (this.startupReconciled) return 0;
    this.startupReconciled = true;
    let n = 0;
    const rows = this.d.db.prepare("SELECT s.run_id, s.node_id, s.ref_id FROM workflow_steps s JOIN workflow_runs r ON r.id = s.run_id WHERE s.status = 'waiting' AND s.ref_kind = 'approval' AND r.status IN ('waiting','running','queued')").all();
    for (const row of rows) {
      const runId = String(row["run_id"]);
      const nodeId = String(row["node_id"]);
      const approval = this.linkedApproval(runId, nodeId, String(row["ref_id"]));
      if (approval?.["status"] !== "approved") continue;
      this.setStep(runId, nodeId, { status: "failed", output: null, error: "The app restarted after approval but before the action's outcome was recorded. Review the approval history and outside effects. The action was not sent again.", finished_at: this.iso() });
      this.d.db.prepare("UPDATE workflow_runs SET status = 'queued' WHERE id = ? AND status = 'waiting'").run(runId);
      this.d.audit.record("workflow.integration_uncertain", { run: runId, node: nodeId, approval: String(row["ref_id"]), reason: "approved_without_receipt" });
      n++;
    }
    return n + this.resolveApprovals();
  }

  // ---------------------------------------------------------------- the queue
  /** Starts queued runs (at most two at a time). Called by the clock; failures never escape. */
  tick(): number {
    let started = 0;
    try {
      if (this.d.automationPaused()) return 0;
      this.resolveApprovals();
      const room = WORKFLOW_LIMITS.concurrentRuns - this.inFlight.size;
      if (room <= 0) return 0;
      const queued = this.d.db.prepare("SELECT id FROM workflow_runs WHERE status = 'queued' ORDER BY created_at, rowid LIMIT ?").all(room);
      for (const r of queued) {
        const id = String(r["id"]);
        if (this.inFlight.has(id)) continue;
        const p = this.process(id)
          .catch(() => undefined)
          .finally(() => this.inFlight.delete(id));
        this.inFlight.set(id, p);
        started++;
      }
    } catch {
      /* never crash the clock */
    }
    return started;
  }

  /** Resolves when nothing is working (tests). */
  async idle(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      this.tick();
      if (this.inFlight.size === 0) return;
      await Promise.all([...this.inFlight.values()]);
    }
  }

  private setRun(id: string, fields: Record<string, string | null>): void {
    const keys = Object.keys(fields);
    this.d.db.prepare(`UPDATE workflow_runs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((k) => fields[k] ?? null), id);
  }

  private setStep(runId: string, nodeId: string, fields: Record<string, string | number | null>): void {
    const keys = Object.keys(fields);
    this.d.db.prepare(`UPDATE workflow_steps SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE run_id = ? AND node_id = ?`).run(...keys.map((k) => fields[k] ?? null), runId, nodeId);
  }

  private steps(runId: string): Map<string, { status: string; output: string | null; refKind: string | null; refId: string | null; attempts: number; error: string | null }> {
    return new Map(
      this.d.db
        .prepare("SELECT * FROM workflow_steps WHERE run_id = ?")
        .all(runId)
        .map((s) => [String(s["node_id"]), { status: String(s["status"]), output: s["output"] === null ? null : String(s["output"]), refKind: s["ref_kind"] === null ? null : String(s["ref_kind"]), refId: s["ref_id"] === null ? null : String(s["ref_id"]), attempts: Number(s["attempts"]), error: s["error"] === null ? null : String(s["error"]) }]),
    );
  }

  private async process(runId: string): Promise<void> {
    const row = this.d.db.prepare("SELECT * FROM workflow_runs WHERE id = ?").get(runId);
    if (!row || row["status"] !== "queued") return;
    const graph = graphSchema.parse(JSON.parse(String(row["graph"])));
    const input = String(row["input"]);
    const started = this.d.now();
    this.setRun(runId, { status: "running" });
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    try {
      for (;;) {
        if (this.cancelled.has(runId)) throw new Stop();
        if (this.d.automationPaused()) {
          this.setRun(runId, { status: "queued" }); // held by the pause switch; picked up again after it is released
          return;
        }
        if (this.d.now() - started > WORKFLOW_LIMITS.runMs) throw new AppError(504, "workflow_timeout", "This run took longer than 30 minutes and was stopped.");
        const steps = this.steps(runId);
        const ready: GraphNode[] = [];
        let skippedAny = false;
        for (const n of graph.nodes) {
          if (steps.get(n.id)!.status !== "pending") continue;
          const incoming = graph.edges.filter((e) => e.to === n.id);
          if (n.type === "trigger") {
            ready.push(n);
            continue;
          }
          if (incoming.some((e) => !TERMINAL_STEP.includes(steps.get(e.from)!.status))) continue; // something before it is not finished
          const taken = incoming.filter((e) => {
            const src = steps.get(e.from)!;
            if (src.status !== "completed") return false;
            return byId.get(e.from)!.type === "condition" ? src.output === e.when : e.when === "always";
          });
          if (taken.length === 0) {
            this.setStep(runId, n.id, { status: "skipped", finished_at: this.iso() });
            skippedAny = true;
          } else ready.push(n);
        }
        if (ready.length === 0) {
          if (skippedAny) continue;
          const now = this.steps(runId);
          if ([...now.values()].some((s) => s.status === "waiting")) {
            this.setRun(runId, { status: "waiting" });
            return;
          }
          break;
        }
        const outputs = new Map<string, string>();
        for (const [id, s] of steps) if (s.status === "completed" && s.output !== null) outputs.set(id, s.output);
        for (let i = 0; i < ready.length; i += WORKFLOW_LIMITS.parallelBoxes) {
          await Promise.all(ready.slice(i, i + WORKFLOW_LIMITS.parallelBoxes).map((n) => this.execute(runId, n, { input, outputs })));
        }
      }
      const final = this.steps(runId);
      const rejected = [...final.values()].find((s) => s.status === "failed" && /^Stopped at a checkpoint/.test(s.error ?? ""));
      const failed = [...final.entries()].find(([, s]) => s.status === "failed");
      if (rejected) this.setRun(runId, { status: "cancelled", error: rejected.error, finished_at: this.iso() });
      else if (failed) this.setRun(runId, { status: "failed", error: clip(`Box "${failed[0]}" failed: ${failed[1].error ?? ""}`, 500), finished_at: this.iso() });
      else this.setRun(runId, { status: "completed", finished_at: this.iso() });
      this.d.audit.record("workflow.run_finished", { id: runId, status: this.runView(runId).status });
    } catch (e) {
      if (e instanceof Stop) {
        this.d.db.prepare("UPDATE workflow_steps SET status = 'skipped' WHERE run_id = ? AND status IN ('pending','running','waiting')").run(runId);
        this.setRun(runId, { status: "cancelled", error: "Cancelled.", finished_at: this.iso() });
      } else {
        this.d.db.prepare("UPDATE workflow_steps SET status = 'skipped' WHERE run_id = ? AND status = 'pending'").run(runId);
        this.setRun(runId, { status: "failed", error: clip(e instanceof Error ? e.message : "The run failed.", 500), finished_at: this.iso() });
      }
      this.d.audit.record("workflow.run_finished", { id: runId, status: this.runView(runId).status });
    } finally {
      this.cancelled.delete(runId);
    }
  }

  private async execute(runId: string, node: GraphNode, scope: { input: string; outputs: Map<string, string> }): Promise<void> {
    const cur = this.steps(runId).get(node.id)!;
    this.setStep(runId, node.id, { status: "running", started_at: this.iso(), attempts: cur.attempts + 1 });
    const done = (output: string) => this.setStep(runId, node.id, { status: "completed", output: clip(output, WORKFLOW_LIMITS.maxOutput), finished_at: this.iso() });
    try {
      switch (node.type) {
        case "trigger":
          return done(scope.input);
        case "end":
          return done("");
        case "set":
          return done(renderTemplate(node.value, scope));
        case "condition": {
          const left = renderTemplate(node.left, scope);
          return done(evaluateCondition(node.op, left, renderTemplate(node.value, scope)) ? "true" : "false");
        }
        case "checkpoint": {
          this.setStep(runId, node.id, { status: "waiting", output: renderTemplate(node.message, scope) });
          this.d.audit.record("workflow.checkpoint_waiting", { run: runId, node: node.id });
          return;
        }
        case "bot_task": {
          const text = renderTemplate(node.instruction, scope);
          let last = "The task failed.";
          const maxAttempts = 1 + node.retries;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (attempt > 1 && !this.canRepeat(runId, node.id)) break; // it already asked for an outside action: never again
            const task = this.d.engine.submit(node.botId, text, { type: "user", id: runId, label: `Workflow ${runId.slice(0, 8)}` });
            this.setStep(runId, node.id, { ref_kind: "task", ref_id: task.id, attempts: attempt });
            try {
              return done(await this.awaitTask(runId, task.id));
            } catch (err) {
              if (err instanceof Stop) throw err;
              last = err instanceof AppError || err instanceof LlmError ? err.message : "The task failed.";
            }
          }
          throw new AppError(502, "task_failed", last);
        }
        case "integration": {
          if (!this.d.actions) throw new AppError(501, "no_gate", "Outside actions are not available here.");
          const args: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(node.args)) args[k] = typeof v === "string" ? renderTemplate(v, scope) : v;
          const snapshot = this.d.db.prepare("SELECT graph, workflow_version FROM workflow_runs WHERE id = ?").get(runId)!;
          const out = await this.d.actions.request(node.botId, null, { connector: node.connector, action: node.action, args }, {
            linkPending: (approvalId, connection) => {
              if (connection !== this.d.db) throw new AppError(500, "workflow_link_connection", "Approval and workflow must use the same database connection.");
              const savedNode = graphSchema.parse(JSON.parse(String(snapshot["graph"]))).nodes.find(n => n.id === node.id);
              if (JSON.stringify(savedNode) !== JSON.stringify(node)) return false;
              const changed = this.d.db.prepare("UPDATE workflow_steps SET status = 'waiting', ref_kind = 'approval', ref_id = ?, output = ? WHERE run_id = ? AND node_id = ? AND status = 'running' AND attempts = ? AND ref_kind IS NULL AND ref_id IS NULL AND EXISTS (SELECT 1 FROM workflow_runs r WHERE r.id = ? AND r.status = 'running' AND r.workflow_version = ? AND r.graph = ?)")
                .run(approvalId, `Waiting for your approval on the Approvals page: ${node.connector}.${node.action}`, runId, node.id, cur.attempts + 1, runId, Number(snapshot["workflow_version"]), String(snapshot["graph"]));
              if (Number(changed.changes) !== 1) return false;
              this.d.audit.record("workflow.approval_waiting", { run: runId, node: node.id, approval: approvalId });
              return true;
            },
          });
          if (out.status === "done") return done(out.text);
          if (out.status === "pending_approval") {
            // A write never runs by itself: wait for the owner to decide it on the Approvals page. tick() picks the answer up.
            const linked = this.steps(runId).get(node.id);
            if (linked?.refKind !== "approval" || linked.refId !== out.approvalId || !this.linkedApproval(runId, node.id, out.approvalId)) throw new AppError(409, "workflow_link_conflict", "The approval was not durably linked to this step. Review the approval history.");
            return;
          }
          throw new AppError(502, "action_refused", out.reason);
        }
        case "manager": {
          const run = this.d.manager.start(renderTemplate(node.goal, scope), {}, "workflow", { origin: { kind: "workflow", workflowRunId: runId, nodeId: node.id } });
          this.setStep(runId, node.id, { ref_kind: "manager", ref_id: run.id });
          return done(await this.awaitManager(runId, run.id));
        }
      }
    } catch (err) {
      if (err instanceof Stop) throw err;
      // A competing/notification path may already have committed the winning link. Never
      // overwrite it with a stale attempt's error (or revive a cancelled/terminal step).
      const saved = this.steps(runId).get(node.id);
      if (node.type === "integration" && saved?.refKind === "approval" && saved.refId && this.linkedApproval(runId, node.id, saved.refId)) return;
      this.setStep(runId, node.id, { status: "failed", error: clip(err instanceof AppError || err instanceof LlmError ? err.message : err instanceof Error ? err.message : "The box failed.", 400), finished_at: this.iso() });
    }
  }

  private canRepeat(runId: string, nodeId: string): boolean {
    const s = this.d.db.prepare("SELECT ref_kind, ref_id, attempts FROM workflow_steps WHERE run_id = ? AND node_id = ?").get(runId, nodeId);
    if (!s || Number(s["attempts"]) >= 3) return false;
    if (s["ref_kind"] === "task" && s["ref_id"] !== null) {
      const asked = this.d.db.prepare("SELECT COUNT(*) AS n FROM approval_requests WHERE task_id = ?").get(String(s["ref_id"])) as { n: number };
      return Number(asked.n) === 0;
    }
    return s["ref_kind"] !== "manager" && s["ref_kind"] !== "approval" && s["ref_kind"] !== "integration_uncertain"; // a Manager run or uncertain integration may already have done outside work
  }

  private async awaitTask(runId: string, taskId: string): Promise<string> {
    const poll = this.d.pollMs ?? 250;
    for (;;) {
      if (this.cancelled.has(runId)) {
        const t0 = this.d.getTask(taskId);
        if (t0) {
          try {
            this.d.engine.cancel(t0.rootId);
          } catch {
            /* already finished */
          }
        }
        throw new Stop();
      }
      const t = this.d.getTask(taskId);
      if (!t) throw new AppError(500, "task_missing", "The task disappeared.");
      if (t.status === "completed") return t.result ?? "";
      if (t.status === "failed" || t.status === "cancelled") throw new AppError(502, "task_failed", t.errorMessage ?? `${t.assigneeName} could not finish the task.`);
      await new Promise((r) => setTimeout(r, poll));
    }
  }

  private async awaitManager(runId: string, managerRunId: string): Promise<string> {
    const poll = this.d.pollMs ?? 250;
    for (;;) {
      if (this.cancelled.has(runId)) {
        try {
          this.d.manager.cancel(managerRunId);
        } catch {
          /* already finished */
        }
        throw new Stop();
      }
      const m: ManagerRunView = this.d.manager.view(managerRunId);
      if (m.status === "completed") return m.result ?? "";
      if (["failed", "cancelled", "budget_exhausted", "interrupted"].includes(m.status)) throw new AppError(502, "manager_failed", m.error ?? `The Manager run ended (${m.status}).`);
      await new Promise((r) => setTimeout(r, poll));
    }
  }

  // ---------------------------------------------------------------- people deciding, cancelling, retrying
  decide(runId: string, nodeId: string, approve: boolean, by: string): RunView {
    const s = this.d.db.prepare("SELECT status FROM workflow_steps WHERE run_id = ? AND node_id = ?").get(runId, nodeId);
    if (!s) throw new AppError(404, "step_not_found", "That step does not exist.");
    if (s["status"] !== "waiting") throw new AppError(409, "step_not_waiting", "This checkpoint is not waiting for a decision.");
    // An outside-action box is decided on the Approvals page, never here: a checkpoint button must not be a way around the approval gate.
    const ref = this.d.db.prepare("SELECT ref_kind FROM workflow_steps WHERE run_id = ? AND node_id = ?").get(runId, nodeId);
    if (ref?.["ref_kind"] === "approval") throw new AppError(409, "needs_approval", "This box is waiting for an approval request. Decide it on the Approvals page.");
    if (approve) this.setStep(runId, nodeId, { status: "completed", decided_by: by, finished_at: this.iso() });
    else this.setStep(runId, nodeId, { status: "failed", error: `Stopped at a checkpoint by ${by}.`, decided_by: by, finished_at: this.iso() });
    this.d.db.prepare("UPDATE workflow_runs SET status = 'queued' WHERE id = ? AND status = 'waiting'").run(runId);
    this.d.audit.record(approve ? "workflow.checkpoint_approved" : "workflow.checkpoint_rejected", { run: runId, node: nodeId }, { actor: by });
    return this.runView(runId);
  }

  cancel(runId: string, by = "owner"): RunView {
    const r = this.d.db.prepare("SELECT status FROM workflow_runs WHERE id = ?").get(runId);
    if (!r) throw new AppError(404, "run_not_found", "That run does not exist.");
    if (["queued", "running", "waiting"].includes(String(r["status"]))) {
      if (this.inFlight.has(runId)) this.cancelled.add(runId);
      else {
        this.d.db.prepare("UPDATE workflow_steps SET status = 'skipped' WHERE run_id = ? AND status IN ('pending','running','waiting')").run(runId);
        this.setRun(runId, { status: "cancelled", error: "Cancelled.", finished_at: this.iso() });
      }
      this.d.audit.record("workflow.run_cancelled", { id: runId }, { actor: by });
    }
    return this.runView(runId);
  }

  /** Retry one failed box (and what was skipped because of it). Refused if the box already asked for an outside action. */
  retryStep(runId: string, nodeId: string, by = "owner"): RunView {
    const run = this.d.db.prepare("SELECT status, graph FROM workflow_runs WHERE id = ?").get(runId);
    if (!run) throw new AppError(404, "run_not_found", "That run does not exist.");
    if (["queued", "running"].includes(String(run["status"]))) throw new AppError(409, "run_busy", "This run is still working.");
    const s = this.d.db.prepare("SELECT status FROM workflow_steps WHERE run_id = ? AND node_id = ?").get(runId, nodeId);
    if (!s || s["status"] !== "failed") throw new AppError(409, "step_not_failed", "Only a failed box can be retried.");
    if (!this.canRepeat(runId, nodeId)) throw new AppError(409, "cannot_repeat", "This box already asked for an outside action, has an uncertain outcome, or reached its retry limit. Repeating it could do the same thing twice. Review its recorded actions before deciding what to do next.");
    const graph = graphSchema.parse(JSON.parse(String(run["graph"])));
    // reset this box and everything downstream of it
    const down = new Set<string>([nodeId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const e of graph.edges) if (down.has(e.from) && !down.has(e.to)) (down.add(e.to), (grew = true));
    }
    // An earlier failed box must not become a way to replay a protected descendant.
    // Check the whole reset set before changing any saved state (including already-completed boxes).
    for (const id of down) {
      const affected = this.d.db.prepare("SELECT status FROM workflow_steps WHERE run_id = ? AND node_id = ?").get(runId, id);
      if (affected?.["status"] === "running" || !this.canRepeat(runId, id)) throw new AppError(409, "cannot_repeat", "Retrying this box would reset another box that is still running, already asked for an outside action, has an uncertain outcome, or reached its retry limit. Review the affected actions before deciding what to do next.");
    }
    for (const id of down) this.setStep(runId, id, { status: "pending", error: null, output: null, finished_at: null });
    this.setRun(runId, { status: "queued", error: null, finished_at: null });
    this.d.audit.record("workflow.step_retried", { run: runId, node: nodeId }, { actor: by });
    return this.runView(runId);
  }

  /**
   * After a restart: runs that were working continue from their checkpoints.
   *  - finished boxes stay finished;
   *  - a box that was running a bot task or Manager request is looked at: if that finished, its result is taken; if not, the box FAILS (it is never started a second time by itself);
   *  - a running outside-action box has an uncertain outcome, even without a saved reference: it FAILS and cannot be retried, directly or through an upstream reset;
   *  - boxes that never started are simply started.
   */
  recover(): number {
    let n = 0;
    for (const r of this.d.db.prepare("SELECT id, graph FROM workflow_runs WHERE status IN ('running','queued')").all()) {
      const runId = String(r["id"]);
      const graph = graphSchema.parse(JSON.parse(String(r["graph"])));
      for (const s of this.d.db.prepare("SELECT * FROM workflow_steps WHERE run_id = ? AND status = 'running'").all(runId)) {
        const nodeId = String(s["node_id"]);
        if (graph.nodes.some((node) => node.id === nodeId && node.type === "integration")) {
          // request() may have stored an approval or performed a read before its result/ref was saved.
          // A missing reference is not proof that nothing happened. Preserve any known reference.
          this.setStep(runId, nodeId, {
            status: "failed",
            ref_kind: s["ref_kind"] === null ? "integration_uncertain" : String(s["ref_kind"]),
            output: null,
            error: "The app restarted during an outside action. Its outcome is uncertain, so it was not requested again. Review the approval history and any outside effects before deciding what to do next. Retrying this box or an earlier box cannot repeat it.",
            finished_at: this.iso(),
          });
          this.d.audit.record("workflow.integration_uncertain", { run: runId, node: nodeId });
          continue;
        }
        let finished: { ok: boolean; text: string } | null = null;
        if (s["ref_kind"] === "task" && s["ref_id"] !== null) {
          const t = this.d.getTask(String(s["ref_id"]));
          if (t?.status === "completed") finished = { ok: true, text: t.result ?? "" };
          else finished = { ok: false, text: "The app was restarted while this was running. It was not started again, in case it had already done something. Retry it if you want." };
        } else if (s["ref_kind"] === "manager" && s["ref_id"] !== null) {
          try {
            const m = this.d.manager.view(String(s["ref_id"]));
            finished = m.status === "completed" ? { ok: true, text: m.result ?? "" } : { ok: false, text: "The app was restarted while this was running. It was not started again. Retry it if you want." };
          } catch {
            finished = { ok: false, text: "The app was restarted while this was running." };
          }
        }
        if (finished === null) this.setStep(runId, nodeId, { status: "pending" }); // had not started anything outside: safe to start
        else if (finished.ok) this.setStep(runId, nodeId, { status: "completed", output: clip(finished.text, WORKFLOW_LIMITS.maxOutput), finished_at: this.iso() });
        else this.setStep(runId, nodeId, { status: "failed", error: finished.text, finished_at: this.iso() });
      }
      this.setRun(runId, { status: "queued" });
      n++;
    }
    return n;
  }

  // ---------------------------------------------------------------- reading runs
  runView(id: string): RunView {
    const r = this.d.db.prepare("SELECT r.*, w.name AS wname FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id WHERE r.id = ?").get(id);
    if (!r) throw new AppError(404, "run_not_found", "That run does not exist.");
    const graph = graphSchema.parse(JSON.parse(String(r["graph"])));
    const steps = this.steps(id);
    return {
      id,
      workflowId: String(r["workflow_id"]),
      workflowName: String(r["wname"]),
      workflowVersion: Number(r["workflow_version"]),
      status: String(r["status"]),
      trigger: String(r["trigger"]),
      input: String(r["input"]),
      error: r["error"] === null ? null : String(r["error"]),
      createdAt: String(r["created_at"]),
      finishedAt: r["finished_at"] === null ? null : String(r["finished_at"]),
      steps: graph.nodes.map((n) => {
        const s = steps.get(n.id)!;
        const full = this.d.db.prepare("SELECT decided_by FROM workflow_steps WHERE run_id = ? AND node_id = ?").get(id, n.id);
        return { nodeId: n.id, label: n.label || n.id, type: n.type, status: s.status, output: s.output, error: s.error, attempts: s.attempts, refKind: s.refKind, refId: s.refId, decidedBy: full?.["decided_by"] === null || full === undefined ? null : String(full["decided_by"]) };
      }),
    };
  }

  listRuns(limit = 30): RunView[] {
    return this.d.db.prepare("SELECT id FROM workflow_runs ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit).map((r) => this.runView(String(r["id"])));
  }

  waitingCheckpoints(): { runId: string; workflowName: string; nodeId: string; message: string }[] {
    return this.d.db
      .prepare("SELECT s.run_id, s.node_id, s.output, w.name FROM workflow_steps s JOIN workflow_runs r ON r.id = s.run_id JOIN workflows w ON w.id = r.workflow_id WHERE s.status = 'waiting' AND s.ref_kind IS NOT 'approval' AND r.status = 'waiting' ORDER BY r.created_at")
      .all()
      .map((x) => ({ runId: String(x["run_id"]), workflowName: String(x["name"]), nodeId: String(x["node_id"]), message: String(x["output"] ?? "") }));
  }
}
