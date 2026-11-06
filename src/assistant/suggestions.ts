import type { DatabaseSync } from "node:sqlite";

/**
 * Proactive suggestions, computed from the application's real records (no model call, nothing guessed). Each one says what was seen, and points at where to
 * look or at a request the owner can make. A suggestion changes nothing by itself.
 */
export interface Suggestion {
  id: string;
  kind: "attention" | "problem" | "improvement" | "automation";
  severity: "high" | "normal" | "low";
  text: string;
  /** Where to look. */
  to?: string;
  /** A sentence the owner can send to the assistant to act on it. */
  ask?: string;
}

type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "");
const one = (db: DatabaseSync, sql: string, ...a: (string | number)[]) => db.prepare(sql).get(...a) as Row | undefined;
const all = (db: DatabaseSync, sql: string, ...a: (string | number)[]) => db.prepare(sql).all(...a) as Row[];
const n = (r: Row | undefined, k = "n") => Number(r?.[k] ?? 0);

export function suggest(db: DatabaseSync, now: number = Date.now()): Suggestion[] {
  const out: Suggestion[] = [];
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const twoWeeks = new Date(now - 14 * 86_400_000).toISOString();

  const pending = n(one(db, "SELECT COUNT(*) AS n FROM approval_requests WHERE status = 'pending'"));
  if (pending > 0) out.push({ id: "approvals-pending", kind: "attention", severity: "high", text: `${pending} request${pending === 1 ? " is" : "s are"} waiting for your approval.`, to: "/approvals", ask: "show pending approvals" });

  const failed = all(db, "SELECT id, substr(instruction, 1, 60) AS t FROM tasks WHERE status = 'failed' AND finished_at >= ? ORDER BY finished_at DESC LIMIT 3", dayAgo);
  const failedN = n(one(db, "SELECT COUNT(*) AS n FROM tasks WHERE status = 'failed' AND finished_at >= ?", dayAgo));
  if (failedN > 0) out.push({ id: "tasks-failed", kind: "problem", severity: "high", text: `${failedN} task${failedN === 1 ? "" : "s"} failed in the last 24 hours, for example "${s(failed[0]?.["t"])}".`, to: `/tasks/${s(failed[0]?.["id"])}`, ask: "open my last failed task" });

  const wfFailed = n(one(db, "SELECT COUNT(DISTINCT workflow_id) AS n FROM workflow_runs WHERE status = 'failed' AND created_at >= ?", dayAgo));
  if (wfFailed > 0) out.push({ id: "workflows-failed", kind: "problem", severity: "normal", text: `${wfFailed} workflow${wfFailed === 1 ? "" : "s"} had a failed run in the last 24 hours.`, to: "/workflows" });

  for (const b of all(db, "SELECT id, name FROM bots WHERE status = 'active' AND archived = 0 AND model IS NULL LIMIT 3")) {
    out.push({ id: `agent-nomodel-${s(b["id"])}`, kind: "problem", severity: "normal", text: `The agent "${s(b["name"])}" is switched on but has no model, so it cannot answer.`, to: `/bots/${s(b["id"])}` });
  }

  const bare = all(db, "SELECT id, name FROM projects WHERE deleted_at IS NULL AND archived = 0 AND trim(description) = '' ORDER BY updated_at DESC LIMIT 2");
  for (const p of bare) out.push({ id: `project-nodesc-${s(p["id"])}`, kind: "improvement", severity: "low", text: `The project "${s(p["name"])}" has no description. I can draft one for you to review.`, ask: `improve description of project ${s(p["name"])}` });

  const failedDocs = n(one(db, "SELECT COUNT(*) AS n FROM knowledge_docs WHERE deleted_at IS NULL AND scope != 'temporary' AND status = 'failed'"));
  if (failedDocs > 0) out.push({ id: "docs-failed", kind: "problem", severity: "normal", text: `${failedDocs} document${failedDocs === 1 ? "" : "s"} in the Knowledge Center could not be read. You can look at the reason and reprocess them.`, to: "/knowledge?status=failed" });
  const dup = n(one(db, "SELECT COUNT(*) AS n FROM (SELECT sha256 FROM knowledge_docs WHERE deleted_at IS NULL AND scope != 'temporary' GROUP BY sha256 HAVING COUNT(*) > 1)"));
  if (dup > 0) out.push({ id: "docs-duplicates", kind: "improvement", severity: "low", text: `${dup} document${dup === 1 ? " has" : "s have"} an identical copy in the Knowledge Center.`, to: "/knowledge?duplicates=1" });
  const untagged = n(one(db, "SELECT COUNT(*) AS n FROM knowledge_docs WHERE deleted_at IS NULL AND scope != 'temporary' AND status = 'ready' AND tags = '[]'"));
  if (untagged > 2) out.push({ id: "docs-untagged", kind: "improvement", severity: "low", text: `${untagged} documents have no tags, which makes them harder to find.`, to: "/knowledge" });
  if (n(one(db, "SELECT COUNT(*) AS n FROM knowledge_docs WHERE deleted_at IS NULL AND scope != 'temporary'")) === 0) out.push({ id: "docs-none", kind: "improvement", severity: "low", text: "The Knowledge Center has no documents yet. Upload some and ask me questions about them.", to: "/knowledge" });

  // The same request given to an agent three or more times in two weeks: a workflow or a schedule could do it.
  const repeated = all(db, "SELECT substr(instruction, 1, 80) AS t, COUNT(*) AS c FROM tasks WHERE requested_by = 'user' AND created_at >= ? GROUP BY lower(substr(instruction, 1, 80)) HAVING COUNT(*) >= 3 ORDER BY c DESC LIMIT 1", twoWeeks);
  if (repeated[0]) out.push({ id: "automation-repeat", kind: "automation", severity: "low", text: `You gave an agent the same task ${s(repeated[0]["c"])} times: "${s(repeated[0]["t"])}". A workflow or schedule could do it for you.`, to: `/assistant?workflow=${encodeURIComponent(s(repeated[0]["t"]))}` });

  const order = { high: 0, normal: 1, low: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** A plain summary of what is going on, from real counts. */
export function overview(db: DatabaseSync, now: number = Date.now()): { message: string; links: { label: string; to: string }[] } {
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const c = (sql: string, ...a: (string | number)[]) => n(one(db, sql, ...a));
  const running = c("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('running', 'pending')");
  const failed = c("SELECT COUNT(*) AS n FROM tasks WHERE status = 'failed' AND finished_at >= ?", dayAgo);
  const done = c("SELECT COUNT(*) AS n FROM tasks WHERE status = 'completed' AND finished_at >= ?", dayAgo);
  const pending = c("SELECT COUNT(*) AS n FROM approval_requests WHERE status = 'pending'");
  const agents = c("SELECT COUNT(*) AS n FROM bots WHERE archived = 0 AND status = 'active'");
  const projects = c("SELECT COUNT(*) AS n FROM projects WHERE deleted_at IS NULL AND archived = 0");
  const workflows = c("SELECT COUNT(*) AS n FROM workflows WHERE archived = 0");
  const docs = c("SELECT COUNT(*) AS n FROM knowledge_docs WHERE deleted_at IS NULL AND scope != 'temporary' AND status = 'ready'");
  const models = c("SELECT COUNT(*) AS n FROM llm_models WHERE enabled = 1");
  const providers = c("SELECT COUNT(*) AS n FROM llm_providers WHERE enabled = 1");
  return {
    message: `Right now: ${running} task${running === 1 ? "" : "s"} running or waiting, ${done} finished and ${failed} failed in the last 24 hours, ${pending} approval${pending === 1 ? "" : "s"} waiting for you. You have ${agents} active agent${agents === 1 ? "" : "s"}, ${projects} project${projects === 1 ? "" : "s"}, ${workflows} workflow${workflows === 1 ? "" : "s"}, ${docs} readable document${docs === 1 ? "" : "s"}, and ${models} model${models === 1 ? "" : "s"} switched on across ${providers} provider${providers === 1 ? "" : "s"}.`,
    links: [
      { label: "Dashboard", to: "/" },
      { label: "Approvals", to: "/approvals" },
      { label: "AI Models", to: "/models" },
    ],
  };
}
