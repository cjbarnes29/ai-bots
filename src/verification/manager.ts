import type { DatabaseSync } from "node:sqlite";
import { combine, type Verification } from "./verify.js";
import type { ChainVerification } from "./service.js";

export interface ManagerVerification {
  runId: string;
  runStatus: string;
  checkedAt: string;
  completion: { total: number; completed: number; pending: number; running: number; failed: number; skipped: number };
  coverageComplete: boolean;
  finalSummary: { status: "unverified"; summary: string };
  supporting: Verification;
  steps: { id: string; status: string; binding: "valid" | "none" | "missing" | "invalid" | "limit"; reason: string; taskId?: string; duplicateOf?: string }[];
  chains: { taskId: string; verification: ChainVerification }[];
}

/** Host records only. The Manager's own text/review can never supply independent evidence. */
export function checkManager<T>(db: DatabaseSync, id: string, readChain: (rootId: string) => T, checkChain: (snapshot: T) => ChainVerification): ManagerVerification | undefined {
  let run: Record<string, unknown> | undefined;
  const steps: ManagerVerification["steps"] = [];
  const snapshots = new Map<string, T>();
  const firstStep = new Map<string, string>();
  const completion: ManagerVerification["completion"] = { total: 0, completed: 0, pending: 0, running: 0, failed: 0, skipped: 0 };
  let coverageComplete = true, tasks = 0;
  // SAVEPOINT also composes with an existing caller transaction; never rolls that transaction back.
  db.exec("SAVEPOINT manager_verification_read");
  try {
    run = db.prepare("SELECT id,status,mode FROM manager_runs WHERE id=?").get(id);
    if (run) {
      const rows = db.prepare("SELECT step_id,status,specialist_bot_id,task_id FROM manager_steps WHERE run_id=? ORDER BY rowid LIMIT 11").all(id);
      if (rows.length > 10) coverageComplete = false;
      completion.total = Number(db.prepare("SELECT COUNT(*) AS n FROM manager_steps WHERE run_id=?").get(id)?.["n"]);
      for (const row of rows.slice(0, 10)) {
        const step: ManagerVerification["steps"][number] = { id: String(row["step_id"]), status: String(row["status"]), binding: "none", reason: "The Manager wrote this step; its text is not independently verified." };
        if (step.status in completion && step.status !== "total") completion[step.status as Exclude<keyof typeof completion, "total">]++;
        else coverageComplete = false;
        if (row["specialist_bot_id"] !== null) {
          const taskId = row["task_id"];
          const task = typeof taskId === "string" ? db.prepare("SELECT id,root_id,parent_id,assignee_bot_id,origin,origin_id FROM tasks WHERE id=?").get(taskId) : undefined;
          if (!task) { step.binding = "missing"; step.reason = "The specialist task record is missing."; }
          else if (task["root_id"] !== taskId || task["parent_id"] !== null || task["assignee_bot_id"] !== row["specialist_bot_id"] || task["origin"] !== "user" || task["origin_id"] !== id) {
            step.binding = "invalid"; step.reason = "The task does not match this run and specialist; its evidence was excluded.";
          } else if (snapshots.has(taskId as string)) {
            step.binding = "valid"; step.taskId = taskId as string; step.duplicateOf = firstStep.get(taskId as string)!;
            step.reason = "Shared task evidence is counted once.";
          } else {
            const count = Number(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE root_id=?").get(taskId!)?.["n"]);
            if (count < 1 || tasks + count > 150) { step.binding = "limit"; step.reason = "The task coverage limit was reached; this chain was not checked."; coverageComplete = false; }
            else {
              tasks += count; snapshots.set(taskId as string, readChain(taskId as string)); firstStep.set(taskId as string, step.id);
              step.binding = "valid"; step.taskId = taskId as string; step.reason = "Linked specialist task chain checked separately from the Manager's summary.";
            }
          }
        } else if (row["task_id"] !== null) { step.binding = "invalid"; step.reason = "A Manager-written step has an unexpected task reference; its evidence was excluded."; }
        steps.push(step);
      }
    }
    db.exec("RELEASE manager_verification_read");
  } catch (error) {
    db.exec("ROLLBACK TO manager_verification_read"); db.exec("RELEASE manager_verification_read"); throw error;
  }
  if (!run) return undefined;
  // File observations occur AFTER the short database snapshot, through the existing injected FolderGate probe.
  const chains = [...snapshots].map(([taskId, snapshot]) => ({ taskId, verification: checkChain(snapshot) }));
  const supporting = combine(chains.map(c => c.verification));
  const incompleteChains = chains.some(c => c.verification.incompleteTasks.length > 0 || c.verification.status === "not_applicable");
  const uncheckedFiles = supporting.checks.some(c => c.kind === "file_unchecked");
  const incomplete = run["status"] !== "completed" || !coverageComplete || incompleteChains || uncheckedFiles || steps.some(s => s.status !== "completed" || s.binding !== "valid");
  if ((incomplete || supporting.status === "not_applicable") && supporting.status !== "contradicted" && supporting.status !== "waiting") supporting.status = "unverified";
  const warnings = [run["status"] !== "completed" ? "The Manager run did not complete successfully." : "", !coverageComplete ? "Coverage is incomplete; some records could not be checked." : "", incompleteChains ? "Some helper tasks did not complete successfully." : "", uncheckedFiles ? "Some reported files could not be checked with current folder permission." : "", steps.some(s => s.status !== "completed" || s.binding !== "valid") ? "Some steps are unfinished, missing valid task evidence, or written by the Manager." : ""].filter(Boolean);
  if (chains.length === 0) supporting.summary = "No linked helper evidence was checked. The Manager's own words are not independent evidence.";
  else if (warnings.length) supporting.summary = supporting.status === "waiting" || supporting.status === "contradicted" ? `${supporting.summary} ${warnings.join(" ")}` : warnings.join(" ");
  return { runId: id, runStatus: String(run["status"]), checkedAt: new Date().toISOString(), completion, coverageComplete,
    finalSummary: { status: "unverified", summary: "Not independently verified. Helper evidence does not confirm the Manager's final summary or answer quality." }, supporting, steps, chains };
}
