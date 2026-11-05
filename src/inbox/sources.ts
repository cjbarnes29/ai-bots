import type { DatabaseSync } from "node:sqlite";
import type { ApprovalRecord } from "../approvals/repository.js";
import type { TaskRecord } from "../delegation/repository.js";
import type { SourceCheck, VerifySource } from "./service.js";

type Row = Record<string, unknown>;
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const firstLine = (t: string) => clip((t.split("\n")[0] ?? "").trim(), 100);
const no = (reason: string): SourceCheck => ({ ok: false, reason });

/**
 * Looks up the REAL event behind an inbox message and builds the message from it. A message is refused when the event does not exist, belongs to
 * another bot, or is not in the state the message claims (a "finished" message needs a completed task). The text comes from the event itself, never
 * from the caller, so a bot cannot make up what it "reported".
 *
 * Not supported yet, on purpose (no verified producer exists): clarification / report / note messages ("bot_action"), and failed workflow runs
 * (a run has no single bot to attribute it to).
 */
export function makeVerifySource(deps: { db: DatabaseSync; getTask: (id: string) => TaskRecord | undefined; getApproval: (id: string) => ApprovalRecord | undefined }): VerifySource {
  return (botId, kind, source) => {
    switch (source.kind) {
      case "task": {
        const t = deps.getTask(source.id);
        if (!t || t.assigneeBotId !== botId) return no("No such task for this bot.");
        if (t.parentId !== null) return no("Only a task that was started from outside is reported (not a teammate sub-task).");
        if (kind === "task_result") {
          if (t.status !== "completed") return no("The task has not finished successfully.");
          return { ok: true, title: `Finished: ${firstLine(t.instruction)}`, body: t.result?.trim() || "(The task finished without a written result.)" };
        }
        if (kind === "task_failed") {
          if (t.status !== "failed") return no("The task did not fail.");
          return { ok: true, title: `This task did not finish: ${firstLine(t.instruction)}`, body: `What went wrong: ${t.errorMessage ?? "unknown"}` };
        }
        return no("That kind of message cannot come from a task.");
      }
      case "approval": {
        const a = deps.getApproval(source.id);
        if (!a || a.botId !== botId) return no("No such approval request for this bot.");
        if (a.status !== "pending") return no("That request is no longer waiting.");
        // Only the summary the approvals page already shows. Never the raw arguments.
        return { ok: true, title: "I need your approval before I can do this", body: `${a.summary}\n\nOpen Approvals to approve or reject it. Nothing happens until you decide.` };
      }
      case "schedule":
      case "trigger": {
        // The id is "<schedule or trigger id>:<id of the task that failed>", so each failure episode is its own event.
        const [rawId, taskId] = source.id.split(":");
        if (!rawId || !taskId) return no("Missing the failed run.");
        const row = (source.kind === "schedule"
          ? deps.db.prepare("SELECT name, bot_id, enabled, disabled_reason FROM schedules WHERE id = ?").get(rawId)
          : deps.db.prepare("SELECT name, bot_id, enabled, disabled_reason FROM triggers WHERE id = ?").get(rawId)) as Row | undefined;
        const t = deps.getTask(taskId);
        if (!row || String(row["bot_id"]) !== botId) return no("No such automation for this bot.");
        if (!t || t.status !== "failed" || t.originId !== rawId) return no("That run did not fail.");
        if (Number(row["enabled"]) === 1 || !row["disabled_reason"]) return no("The automation is still running.");
        return { ok: true, title: `${source.kind === "schedule" ? "Schedule" : "Trigger"} "${String(row["name"])}" was switched off`, body: String(row["disabled_reason"]) };
      }
      default:
        return no("There is no verified source for that kind of message yet.");
    }
  };
}
