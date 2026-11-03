import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import { localDay } from "../llm/limits.js";

/**
 * The monitoring overview: one read-only page of facts for the Home/Monitor screen, on the PC and on the phone.
 * It only reads. Nothing here changes anything, and no secret value is ever included.
 */
export interface MonitorDeps {
  db: DatabaseSync;
  now: () => number;
  aiPaused: () => boolean;
  outsidePaused: () => boolean;
  automationPaused: () => boolean;
  remoteEnabled: boolean;
}

export type ActivityLevel = "info" | "warn" | "error";
export interface ActivityItem {
  at: string;
  kind: "task" | "approval" | "automation" | "security";
  level: ActivityLevel;
  summary: string;
  /** A dashboard address to open for details. */
  link: string | null;
}

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}...` : one;
};

const count = (db: DatabaseSync, sql: string, ...params: (string | number)[]): number => Number((db.prepare(sql).get(...params) as { n: number }).n);

/** Security-log events worth showing in a human feed (the full list stays on the Approvals page). */
const SECURITY_KINDS = new Set(["remote.action", "device.paired", "device.revoked", "device.pairing_cancelled", "vault.set", "vault.delete", "external.paused", "external.resumed", "gmail.connected", "approval.expired", "model.blocked"]);

export function buildOverview(d: MonitorDeps) {
  const { db } = d;
  const nowMs = d.now();
  const since = new Date(nowMs - 86_400_000).toISOString();
  const today = localDay(nowMs);

  const tasks = {
    running: count(db, "SELECT COUNT(*) AS n FROM tasks WHERE status IN ('pending','running')"),
    completed24h: count(db, "SELECT COUNT(*) AS n FROM tasks WHERE status = 'completed' AND created_at >= ?", since),
    failed24h: count(db, "SELECT COUNT(*) AS n FROM tasks WHERE status = 'failed' AND created_at >= ?", since),
  };
  const approvals = {
    pending: count(db, "SELECT COUNT(*) AS n FROM approval_requests WHERE status = 'pending'"),
    executed24h: count(db, "SELECT COUNT(*) AS n FROM approval_requests WHERE status = 'executed' AND created_at >= ?", since),
    denied24h: count(db, "SELECT COUNT(*) AS n FROM approval_requests WHERE status IN ('denied','expired') AND created_at >= ?", since),
    failed24h: count(db, "SELECT COUNT(*) AS n FROM approval_requests WHERE status = 'failed' AND created_at >= ?", since),
  };
  const aiRow = db
    .prepare("SELECT COUNT(*) AS calls, COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens, COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS errors, COALESCE(SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END), 0) AS blocked FROM llm_usage WHERE day = ?")
    .get(today) as Record<string, number>;
  const ai = { callsToday: Number(aiRow["calls"]), tokensToday: Number(aiRow["tokens"]), errorsToday: Number(aiRow["errors"]), blockedToday: Number(aiRow["blocked"]), paused: d.aiPaused() };
  const automation = {
    schedulesOn: count(db, "SELECT COUNT(*) AS n FROM schedules WHERE enabled = 1"),
    triggersOn: count(db, "SELECT COUNT(*) AS n FROM triggers WHERE enabled = 1"),
    switchedOffByFailures: count(db, "SELECT (SELECT COUNT(*) FROM schedules WHERE enabled = 0 AND consecutive_failures >= 3) + (SELECT COUNT(*) FROM triggers WHERE enabled = 0 AND consecutive_failures >= 3) AS n"),
    runsToday: count(db, "SELECT COUNT(*) AS n FROM automation_runs WHERE day = ? AND status = 'started'", today),
    paused: d.automationPaused(),
  };
  const bots = {
    total: count(db, "SELECT COUNT(*) AS n FROM bots WHERE archived = 0"),
    active: count(db, "SELECT COUNT(*) AS n FROM bots WHERE archived = 0 AND status = 'active'"),
    archived: count(db, "SELECT COUNT(*) AS n FROM bots WHERE archived = 1"),
  };
  const devices = {
    remoteEnabled: d.remoteEnabled,
    paired: count(db, "SELECT COUNT(*) AS n FROM devices WHERE revoked_at IS NULL"),
  };

  // Things that need a person to look. Shown at the top.
  const attention: { level: ActivityLevel; text: string; link: string | null }[] = [];
  if (approvals.pending > 0) attention.push({ level: "warn", text: `${approvals.pending} action${approvals.pending === 1 ? " is" : "s are"} waiting for your approval`, link: "/approvals" });
  if (d.aiPaused()) attention.push({ level: "warn", text: "All AI calls are paused", link: "/settings" });
  if (d.outsidePaused()) attention.push({ level: "warn", text: "All outside actions are paused", link: "/approvals" });
  if (d.automationPaused()) attention.push({ level: "warn", text: "Automation is paused", link: "/automation" });
  if (tasks.failed24h > 0) attention.push({ level: "error", text: `${tasks.failed24h} task${tasks.failed24h === 1 ? "" : "s"} failed in the last 24 hours`, link: "/tasks" });
  if (approvals.failed24h > 0) attention.push({ level: "error", text: `${approvals.failed24h} approved action${approvals.failed24h === 1 ? "" : "s"} failed in the last 24 hours`, link: "/approvals" });
  if (automation.switchedOffByFailures > 0) attention.push({ level: "error", text: `${automation.switchedOffByFailures} schedule/trigger switched itself off after repeated failures`, link: "/automation" });
  if (ai.errorsToday > 0) attention.push({ level: "warn", text: `${ai.errorsToday} AI call${ai.errorsToday === 1 ? "" : "s"} failed today`, link: "/usage" });

  // One mixed feed, newest first.
  const feed: ActivityItem[] = [];
  for (const r of db.prepare("SELECT t.id, t.status, t.instruction, t.error_message, t.created_at, t.finished_at, b.name AS bot FROM tasks t JOIN bots b ON b.id = t.assignee_bot_id ORDER BY COALESCE(t.finished_at, t.created_at) DESC LIMIT 30").all()) {
    const status = String(r["status"]);
    feed.push({
      at: String(r["finished_at"] ?? r["created_at"]),
      kind: "task",
      level: status === "failed" ? "error" : "info",
      summary: `${String(r["bot"])}: ${status === "pending" || status === "running" ? "working on" : status} "${clip(String(r["instruction"]), 80)}"${status === "failed" && r["error_message"] ? ` (${clip(String(r["error_message"]), 80)})` : ""}`,
      link: `/tasks/${String(r["id"])}`,
    });
  }
  for (const r of db.prepare("SELECT a.id, a.status, a.summary, a.error, a.created_at, a.decided_at, a.decided_by, b.name AS bot FROM approval_requests a JOIN bots b ON b.id = a.bot_id ORDER BY COALESCE(a.decided_at, a.created_at) DESC LIMIT 30").all()) {
    const status = String(r["status"]);
    feed.push({
      at: String(r["decided_at"] ?? r["created_at"]),
      kind: "approval",
      level: status === "failed" ? "error" : status === "pending" ? "warn" : "info",
      summary: `${String(r["bot"])} asked: ${clip(String(r["summary"]), 90)}: ${status === "pending" ? "waiting for you" : status}${r["decided_by"] ? ` (by ${String(r["decided_by"])})` : ""}`,
      link: "/approvals",
    });
  }
  for (const r of db.prepare("SELECT created_at, source, source_name, status, reason FROM automation_runs WHERE status IN ('failed','skipped') ORDER BY id DESC LIMIT 15").all()) {
    feed.push({ at: String(r["created_at"]), kind: "automation", level: r["status"] === "failed" ? "error" : "info", summary: `${String(r["source"])} "${clip(String(r["source_name"]), 50)}" ${String(r["status"])}${r["reason"] ? `: ${clip(String(r["reason"]), 80)}` : ""}`, link: "/automation" });
  }
  for (const r of db.prepare("SELECT created_at, kind, actor, detail FROM audit_events ORDER BY id DESC LIMIT 80").all()) {
    const kind = String(r["kind"]);
    if (!SECURITY_KINDS.has(kind)) continue;
    let detail: Record<string, unknown> = {};
    try {
      detail = JSON.parse(String(r["detail"])) as Record<string, unknown>;
    } catch {
      /* keep empty */
    }
    const what = kind === "remote.action" ? `${String(detail["method"])} ${String(detail["route"])}` : typeof detail["name"] === "string" ? clip(detail["name"], 40) : "";
    feed.push({ at: String(r["created_at"]), kind: "security", level: kind === "device.pairing_cancelled" ? "warn" : "info", summary: `${kind}${what ? ` ${what}` : ""} (${String(r["actor"])})`, link: null });
  }
  feed.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return { generatedAt: new Date(nowMs).toISOString(), bots, tasks, approvals, ai, automation, devices, attention, activity: feed.slice(0, 40) };
}

export async function registerMonitorRoutes(app: FastifyInstance, deps: MonitorDeps): Promise<void> {
  app.get("/api/monitor/overview", async () => buildOverview(deps));
}
