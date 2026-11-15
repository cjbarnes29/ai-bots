import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { graphSchema, validateGraph, type Graph } from "../workflows/graph.js";
import { linkedWorkflowApproval } from "../workflows/approval-binding.js";
import { observeActions } from "./action-observations.js";
import { combine, type ActionFact, type Check, type FileProbe, type Verification } from "./verify.js";
import type { ChainVerification } from "./service.js";

type Row = Record<string, unknown>;
const uuid = z.string().uuid();
const GRAPH_BYTES = 2 * 1024 * 1024;
const MAX_STEPS = 25, MAX_TASKS = 375;
export interface WorkflowVerification {
  runId: string;
  workflowId: string;
  workflowVersion: number;
  runStatus: string;
  checkedAt: string;
  coverageComplete: boolean;
  completion: { total: number; pending: number; running: number; waiting: number; completed: number; failed: number; skipped: number };
  outputAssessment: { status: "unverified"; summary: string };
  supporting: Verification;
  steps: { nodeId: string; type: string; label: string; status: string; binding: "structural" | "valid" | "unbound" | "missing" | "invalid" | "ambiguous" | "unchecked" | "uncertain" | "limit"; reason: string; sourceKind?: "task" | "approval" | "manager"; sourceId?: string }[];
  sources: { kind: "task" | "approval"; id: string; verification: Verification }[];
  unlinkedAttempts: { total: number; ids: string[]; truncated: boolean };
}

// Workflow checks expose outcomes, not copied model excerpts, action arguments/results, paths or error dumps.
const SAFE_DETAIL: Record<Check["kind"], string> = {
  result_present: "A completed task has no result text.", provenance_unchecked: "The task's authored result could not be fully checked.",
  action_executed: "An approved action has a recorded execution.", action_failed: "A recorded action failed.", action_waiting: "An outside action is waiting for approval or execution.",
  action_denied: "An outside action was denied or expired and did not execute.", action_effect_unknown: "The action's specific effect is unclassified.",
  file_exists: "A reported file exists with the recorded size at check time.", file_missing: "A reported file is missing at check time.",
  file_size_differs: "A reported file's size differs at check time.", file_unchecked: "A reported file could not be checked with current folder access.",
  claim_supported: "A task claim has matching action-type evidence; target, content and delivery were not checked.",
  claim_unsupported: "A task claim lacks matching recorded action-type evidence.", claim_unchecked: "A task claim could not be matched to a known action type.",
};
const SUMMARY: Record<Verification["status"], string> = {
  verified: "Recorded step evidence is confirmed within its stated scope; this does not verify workflow output, targets, content or delivery.",
  unverified: "Recorded step evidence is incomplete or unverified. Workflow output is not independently verified.",
  waiting: "An owner decision or outside action is still waiting. Workflow output is not confirmed.",
  contradicted: "Recorded evidence contains a failure or contradiction. Do not rely on this workflow result.",
  not_applicable: "Only structural steps were recorded; they provide no outside-effect evidence.",
};
function publicEvidence(v: Verification): Verification {
  return { status: v.status, summary: SUMMARY[v.status], evidence: v.evidence, checks: v.checks.map(c => ({ kind: c.kind, outcome: c.outcome, detail: SAFE_DETAIL[c.kind] })) };
}

/** All inputs come from host records. Read-only; no action/Manager/model service is available here. */
export function checkWorkflow<T>(db: DatabaseSync, id: string, readChain: (id: string) => T, checkChain: (snapshot: T) => ChainVerification, approvalFact: (row: Row) => ActionFact, probe: FileProbe): WorkflowVerification | undefined {
  let run: Row | undefined, graph: Graph | undefined;
  let coverageComplete = true, uncertain = false, executable = false, checkpointWaiting = false, taskCount = 0;
  const steps: WorkflowVerification["steps"] = [], snapshots = new Map<string, T>(), approvals = new Map<string, ActionFact>();
  const uncertainApprovals = new Set<string>();
  const completion: WorkflowVerification["completion"] = { total: 0, pending: 0, running: 0, waiting: 0, completed: 0, failed: 0, skipped: 0 };
  let unlinkedAttempts: WorkflowVerification["unlinkedAttempts"] = { total: 0, ids: [], truncated: false };
  db.exec("SAVEPOINT workflow_verification_read");
  try {
    run = db.prepare("SELECT workflow_id,workflow_version,status,CASE WHEN length(CAST(graph AS BLOB))<=? THEN graph ELSE NULL END AS graph FROM workflow_runs WHERE id=?").get(GRAPH_BYTES, id);
    if (run) {
      try { const candidate = graphSchema.parse(JSON.parse(String(run["graph"]))); if (validateGraph(candidate).length === 0) graph = candidate; } catch { /* damaged/oversized snapshot stays unverified */ }
      if (!graph) coverageComplete = false;
      const rows = db.prepare("SELECT node_id,status,ref_kind,ref_id FROM workflow_steps WHERE run_id=? ORDER BY rowid LIMIT 26").all(id);
      for (const row of db.prepare("SELECT status,COUNT(*) AS n FROM workflow_steps WHERE run_id=? GROUP BY status").all(id)) {
        const status = String(row["status"]), n = Number(row["n"]); completion.total += n;
        if (status in completion && status !== "total") completion[status as Exclude<keyof typeof completion, "total">] = n;
        else coverageComplete = false;
      }
      if (rows.length > MAX_STEPS || (graph && (rows.length !== graph.nodes.length || graph.nodes.some(n => !rows.some(r => r["node_id"] === n.id))))) coverageComplete = false;
      const referencedTasks = new Set<string>();
      for (const row of rows.slice(0, MAX_STEPS)) {
        const node = graph?.nodes.find(n => n.id === row["node_id"]);
        const step: WorkflowVerification["steps"][number] = { nodeId: String(row["node_id"]).slice(0, 24), type: node?.type ?? "unknown", label: node?.label ?? "", status: String(row["status"]), binding: "invalid", reason: "The saved graph or step reference is invalid; no evidence was included." };
        const ref = typeof row["ref_id"] === "string" && uuid.safeParse(row["ref_id"]).success ? String(row["ref_id"]) : undefined;
        if (!node) { coverageComplete = false; uncertain = true; }
        else if (["trigger", "end", "set", "condition", "checkpoint"].includes(node.type)) {
          if (row["ref_kind"] === null && row["ref_id"] === null) { step.binding = "structural"; step.reason = "Structural step only; it supplies no outside-effect evidence."; }
          else uncertain = true;
          if (node.type === "checkpoint" && step.status === "waiting") checkpointWaiting = true;
        } else {
          executable = true;
          if (step.status !== "completed") uncertain = true;
          if (row["ref_kind"] === "integration_uncertain") { step.binding = "uncertain"; step.reason = "The outside action's outcome is uncertain after interruption. Nothing was requested again."; uncertain = true; }
          else if (node.type === "bot_task" && row["ref_kind"] === "task" && ref) {
            const task = db.prepare("SELECT id,root_id,parent_id,assignee_bot_id,origin,origin_id FROM tasks WHERE id=?").get(ref);
            if (!task) { step.binding = "missing"; step.reason = "The linked task record is missing."; uncertain = true; }
            else if (task["root_id"] !== ref || task["parent_id"] !== null || task["assignee_bot_id"] !== node.botId || task["origin"] !== "user" || task["origin_id"] !== id) uncertain = true;
            else {
              step.sourceKind = "task"; step.sourceId = ref; step.binding = "valid"; step.reason = "Run-bound specialist task chain; output quality is not checked.";
              if (referencedTasks.has(ref)) { step.binding = "ambiguous"; step.reason = "Several boxes reference the same task; evidence counts once and the node association is unverified."; uncertain = true; }
              referencedTasks.add(ref);
              if (!snapshots.has(ref)) {
                const n = Number(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE root_id=?").get(ref)?.["n"]);
                if (n < 1 || taskCount + n > MAX_TASKS) { step.binding = "limit"; step.reason = "The task coverage limit was reached; this chain was not checked."; coverageComplete = false; uncertain = true; }
                else { taskCount += n; snapshots.set(ref, readChain(ref)); }
              }
            }
          } else if (node.type === "integration" && row["ref_kind"] === "approval" && ref) {
            const binding = linkedWorkflowApproval(db, node, ref);
            if (!binding.ok) { step.reason = "The approval is missing, mismatched, damaged or shared; its evidence was excluded."; uncertain = true; }
            else {
              step.binding = "valid"; step.sourceKind = "approval"; step.sourceId = ref;
              step.reason = "Exact approval record linked; target, content and delivery are not independently checked.";
              approvals.set(ref, approvalFact(binding.approval));
              if (step.status === "failed" && binding.approval["status"] === "approved") {
                step.binding = "uncertain"; step.reason = "An approved action has no recorded outcome after interruption. Reconcile it; do not resend."; uncertainApprovals.add(ref); uncertain = true;
              }
            }
          } else if (node.type === "manager" && row["ref_kind"] === "manager" && ref) {
            const manager = db.prepare("SELECT id,requested_by FROM manager_runs WHERE id=?").get(ref);
            if (manager?.["requested_by"] === "workflow") { step.binding = "unbound"; step.sourceKind = "manager"; step.sourceId = ref; step.reason = "This Manager record has no exact workflow-run/node backlink. No helper evidence was inherited."; }
            else { step.binding = manager ? "invalid" : "missing"; step.reason = "The Manager reference is missing or does not identify a workflow start."; }
            uncertain = true;
          } else if (row["ref_id"] === null && row["ref_kind"] === null) {
            step.binding = "unchecked"; step.reason = node.type === "integration" ? "No durable step receipt exists; completed text does not prove an outside read or write." : "No linked execution record exists for this box."; uncertain = true;
          } else uncertain = true;
        }
        if (["invalid", "missing", "ambiguous", "unbound", "limit"].includes(step.binding)) coverageComplete = false;
        steps.push(step);
      }
      const unlinked = "FROM tasks t WHERE t.id=t.root_id AND t.parent_id IS NULL AND t.origin='user' AND t.origin_id=? AND NOT EXISTS (SELECT 1 FROM workflow_steps s WHERE s.run_id=? AND s.ref_kind='task' AND s.ref_id=t.id)";
      const total = Number(db.prepare(`SELECT COUNT(*) AS n ${unlinked}`).get(id, id)?.["n"]);
      const ids = db.prepare(`SELECT t.id ${unlinked} ORDER BY t.created_at,t.id LIMIT 25`).all(id, id).map(r => String(r["id"])).filter(value => uuid.safeParse(value).success);
      unlinkedAttempts = { total, ids, truncated: total > ids.length };
      if (total) uncertain = true;
    }
    db.exec("RELEASE workflow_verification_read");
  } catch (error) { db.exec("ROLLBACK TO workflow_verification_read"); db.exec("RELEASE workflow_verification_read"); throw error; }
  if (!run) return undefined;
  const sources: WorkflowVerification["sources"] = [];
  for (const [taskId, snapshot] of snapshots) {
    const v = checkChain(snapshot);
    if (v.incompleteTasks.length || v.status === "not_applicable" || v.checks.some(c => c.kind === "file_unchecked")) uncertain = true;
    sources.push({ kind: "task", id: taskId, verification: publicEvidence(v) });
  }
  for (const [approvalId, action] of approvals) {
    if (uncertainApprovals.has(approvalId)) { sources.push({ kind: "approval", id: approvalId, verification: { status: "unverified", summary: "Approved action outcome is uncertain; no replay was attempted.", evidence: 0, checks: [] } }); continue; }
    const observed = observeActions([action], probe);
    const status: Verification["status"] = observed.checks.some(c => c.outcome === "fail") ? "contradicted" : action.status === "pending" || action.status === "approved" ? "waiting" : action.status === "executed" && !observed.unknown && !!action.result?.trim() && !observed.checks.some(c => c.kind === "file_unchecked") ? "verified" : "unverified";
    sources.push({ kind: "approval", id: approvalId, verification: publicEvidence({ status, summary: "", evidence: observed.evidence, checks: observed.checks }) });
  }
  const supporting = combine(sources.map(s => s.verification));
  if (checkpointWaiting && supporting.status !== "contradicted") supporting.status = "waiting";
  if (supporting.status !== "contradicted" && supporting.status !== "waiting") {
    if (uncertain || !coverageComplete || run["status"] !== "completed" || executable && supporting.status === "not_applicable") supporting.status = "unverified";
  }
  supporting.summary = SUMMARY[supporting.status];
  return { runId: id, workflowId: String(run["workflow_id"]), workflowVersion: Number(run["workflow_version"]), runStatus: String(run["status"]), checkedAt: new Date().toISOString(), coverageComplete, completion,
    outputAssessment: { status: "unverified", summary: "Workflow output is not independently verified. Recorded steps do not prove answer quality, exact targets/content or delivery." }, supporting, steps, sources, unlinkedAttempts };
}
