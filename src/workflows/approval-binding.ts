import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { GraphNode } from "./graph.js";

export type ApprovalBinding = { ok: true; approval: Record<string, unknown> } | { ok: false; reason: "mismatch" | "damaged" | "ambiguous" };

/** Shared D-088 read-only validation. Caller supplies a node from the saved run graph, never the editable workflow. */
export function linkedWorkflowApproval(db: DatabaseSync, node: GraphNode | undefined, approvalId: string): ApprovalBinding {
  const approval = db.prepare("SELECT * FROM approval_requests WHERE id = ?").get(approvalId);
  if (!node || node.type !== "integration" || !approval || approval["task_id"] !== null || approval["bot_id"] !== node.botId || approval["connector"] !== node.connector || approval["action"] !== node.action) return { ok: false, reason: "mismatch" };
  if (createHash("sha256").update(String(approval["args_json"])).digest("hex") !== approval["args_hash"]) return { ok: false, reason: "damaged" };
  try { JSON.parse(String(approval["args_json"])); } catch { return { ok: false, reason: "damaged" }; }
  const links = db.prepare("SELECT COUNT(*) AS n FROM workflow_steps WHERE ref_kind = 'approval' AND ref_id = ?").get(approvalId);
  return Number(links?.["n"]) === 1 ? { ok: true, approval } : { ok: false, reason: "ambiguous" };
}
