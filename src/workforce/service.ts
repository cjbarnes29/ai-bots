import type { DatabaseSync } from "node:sqlite";
import { AppError } from "../errors.js";
import { DIVISIONS, type DivisionKey, type GroupService } from "../groups/service.js";

/**
 * The workforce: ONE Central Manager (the existing Manager AI) coordinating four divisions, with three kinds of bot, and the board that shows it.
 *  - shared specialist: serves several divisions;  dedicated: belongs to exactly one;  temporary: a task agent that is archived (reversibly) when its time is up.
 * Nothing here creates a bot, a task, a group record, a project or a decision of its own. The organisation is a small document (which bot is what, in which
 * division); the board READS the real tables (bots, groups, projects, tasks, decisions, approvals) and never shows progress that is not in them.
 * Assigning a bot to a division grants it nothing; it can only add it to that division's group when groups are switched on.
 */

type Row = Record<string, unknown>;
export type BotKind = "shared" | "dedicated" | "temporary";
interface OrgBot {
  kind: BotKind;
  divisions: DivisionKey[];
  expiresAt?: string;
  purpose?: string;
}
interface OrgDoc {
  bots: Record<string, OrgBot>;
}
export const TEMP_MAX_HOURS = 168;
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export type NodeKind = "manager" | "division" | "group" | "bot" | "project" | "task" | "decision" | "approval" | "deliverable";
export type NodeStatus = "active" | "completed" | "blocked" | "failed" | "idle" | "cancelled";
export interface BoardNode {
  id: string;
  kind: NodeKind;
  refId: string;
  label: string;
  status: NodeStatus;
  lane: number;
  sub?: string;
  divisions: DivisionKey[];
  detail: Record<string, unknown>;
  link: string | null;
}
export interface BoardEdge {
  id: string;
  from: string;
  to: string;
  kind: "coordinates" | "member" | "dedicated" | "shared" | "delegation" | "assigned" | "subtask" | "origin" | "project" | "decision" | "approval";
}

export interface WorkforceDeps {
  db: DatabaseSync;
  audit: { record(kind: string, detail?: Record<string, unknown>, options?: { actor?: string; botId?: string | null }): void };
  kv: { get(key: string): string | null; set(key: string, value: string): void };
  groups: GroupService;
  archiveBot: (id: string) => unknown;
  managerSpecialists: () => string[];
  now?: () => number;
}

const LANES: Record<NodeKind, number> = { manager: 0, division: 1, group: 2, bot: 3, project: 4, decision: 4, task: 5, approval: 6, deliverable: 6 };
const CAPS = { tasks: 80, decisions: 40, projects: 40, approvals: 40 };

export class WorkforceService {
  private readonly now: () => number;
  constructor(private readonly d: WorkforceDeps) {
    this.now = d.now ?? Date.now;
  }
  private all(sql: string, ...a: (string | number | null)[]): Row[] {
    return this.d.db.prepare(sql).all(...a) as Row[];
  }
  private one(sql: string, ...a: (string | number | null)[]): Row | undefined {
    return this.d.db.prepare(sql).get(...a) as Row | undefined;
  }
  private doc(): OrgDoc {
    try {
      return { bots: (JSON.parse(this.d.kv.get("workforce.org") ?? "{}") as Partial<OrgDoc>).bots ?? {} };
    } catch {
      return { bots: {} };
    }
  }
  private save(doc: OrgDoc): void {
    this.d.kv.set("workforce.org", JSON.stringify(doc));
  }

  // ---------------------------------------------------------------- organisation
  /** Gives a bot its place: shared specialist (1-4 divisions), dedicated (exactly one) or temporary task agent (one division, a purpose and an end time). */
  assign(botId: string, input: { kind: BotKind; divisions: DivisionKey[]; expiresInHours?: number; purpose?: string }) {
    const bot = this.one("SELECT id, name, archived FROM bots WHERE id = ?", botId);
    if (!bot) throw new AppError(404, "bot_not_found", "Bot not found");
    if (Number(bot["archived"]) === 1) throw new AppError(409, "bot_archived", "This bot is archived.");
    const divisions = [...new Set(input.divisions)];
    if (divisions.length === 0 || divisions.some((x) => !DIVISIONS.some((d) => d.key === x))) throw new AppError(400, "bad_division", "Choose from the four divisions.");
    if (input.kind !== "shared" && divisions.length !== 1) throw new AppError(400, "one_division", `A ${input.kind} bot belongs to exactly one division.`);
    const entry: OrgBot = { kind: input.kind, divisions };
    if (input.kind === "temporary") {
      const hours = input.expiresInHours;
      const purpose = input.purpose?.trim() ?? "";
      if (!hours || !Number.isInteger(hours) || hours < 1 || hours > TEMP_MAX_HOURS) throw new AppError(400, "bad_expiry", `A temporary agent lasts 1 to ${TEMP_MAX_HOURS} hours.`);
      if (purpose.length < 3 || purpose.length > 200) throw new AppError(400, "purpose_required", "Say in a few words what the temporary agent is for.");
      entry.expiresAt = new Date(this.now() + hours * 3_600_000).toISOString();
      entry.purpose = purpose;
    }
    const doc = this.doc();
    const previous = doc.bots[botId]?.divisions ?? [];
    doc.bots[botId] = entry;
    this.save(doc);
    this.syncGroups(botId, previous, divisions);
    this.d.audit.record("workforce.assigned", { botId, kind: input.kind, divisions }, { actor: "owner", botId });
    return this.entryView(botId);
  }
  clear(botId: string) {
    const doc = this.doc();
    const previous = doc.bots[botId]?.divisions ?? [];
    delete doc.bots[botId];
    this.save(doc);
    this.syncGroups(botId, previous, []);
    this.d.audit.record("workforce.cleared", { botId }, { actor: "owner", botId });
    return { ok: true };
  }
  /** Keeps division groups in step when groups are on. A problem here never blocks the assignment (the organisation document is what counts). */
  private syncGroups(botId: string, before: DivisionKey[], after: DivisionKey[]): void {
    if (!this.d.groups.enabled()) return;
    for (const key of after) {
      try {
        const g = this.d.groups.ensureDivisionGroup(key);
        if (!g.members.some((m) => m.botId === botId)) this.d.groups.addMember(g.id, botId, "member");
      } catch {
        /* e.g. the group is full: the bot is still classified */
      }
    }
    for (const key of before.filter((k) => !after.includes(k))) {
      try {
        const g = this.d.groups.list({ kind: "division", division: key })[0];
        if (g && g.members.some((m) => m.botId === botId)) this.d.groups.removeMember(g.id, botId);
      } catch {
        /* the coordinator rule may refuse: left as is */
      }
    }
  }
  private entryView(botId: string) {
    const e = this.doc().bots[botId];
    return e ? { botId, kind: e.kind, divisions: e.divisions, expiresAt: e.expiresAt ?? null, purpose: e.purpose ?? null } : null;
  }

  /** Temporary agents whose time is up are removed from their division group and ARCHIVED (the Agent Manager's own reversible archive). */
  sweepTemporary(): string[] {
    const doc = this.doc();
    const gone: string[] = [];
    for (const [botId, e] of Object.entries(doc.bots)) {
      if (e.kind !== "temporary" || !e.expiresAt || Date.parse(e.expiresAt) > this.now()) continue;
      this.syncGroups(botId, e.divisions, []);
      try {
        this.d.archiveBot(botId);
      } catch {
        /* already archived */
      }
      delete doc.bots[botId];
      gone.push(botId);
      this.d.audit.record("workforce.temporary_expired", { botId, purpose: e.purpose ?? "" }, { actor: "system", botId });
    }
    if (gone.length) this.save(doc);
    return gone;
  }

  overview() {
    this.sweepTemporary();
    const doc = this.doc();
    const bots = this.all("SELECT id, name, role, status, model FROM bots WHERE archived = 0 ORDER BY name").map((b) => ({
      id: String(b["id"]),
      name: String(b["name"]),
      role: String(b["role"]),
      status: String(b["status"]),
      model: b["model"] === null ? null : String(b["model"]),
      placement: doc.bots[String(b["id"])] ?? null,
    }));
    const groupsOn = this.d.groups.enabled();
    return {
      manager: { id: "manager", name: "Central Manager", note: "The Manager AI plans, delegates to allowed bots and checks results. Bots coordinate through it and through the delegation allow-list; there is no second task or bot registry.", specialists: this.d.managerSpecialists() },
      groupsEnabled: groupsOn,
      divisions: DIVISIONS.map((div) => ({
        key: div.key,
        name: div.name,
        groupId: groupsOn ? (this.d.groups.list({ kind: "division", division: div.key })[0]?.id ?? null) : null,
        dedicated: bots.filter((b) => b.placement?.kind === "dedicated" && b.placement.divisions.includes(div.key)).map((b) => ({ id: b.id, name: b.name })),
        shared: bots.filter((b) => b.placement?.kind === "shared" && b.placement.divisions.includes(div.key)).map((b) => ({ id: b.id, name: b.name })),
        temporary: bots.filter((b) => b.placement?.kind === "temporary" && b.placement.divisions.includes(div.key)).map((b) => ({ id: b.id, name: b.name, expiresAt: b.placement!.expiresAt ?? null, purpose: b.placement!.purpose ?? null })),
      })),
      unplaced: bots.filter((b) => !b.placement).map((b) => ({ id: b.id, name: b.name, status: b.status })),
    };
  }

  // ---------------------------------------------------------------- saved layouts (cosmetic: positions and filters only)
  layouts(): Record<string, { positions: Record<string, { x: number; y: number }>; filters: Record<string, unknown>; savedAt: string }> {
    try {
      return JSON.parse(this.d.kv.get("workforce.layouts") ?? "{}");
    } catch {
      return {};
    }
  }
  saveLayout(name: string, positions: Record<string, { x: number; y: number }>, filters: Record<string, unknown> = {}) {
    const n = name.trim();
    if (n.length < 1 || n.length > 40) throw new AppError(400, "bad_name", "A layout name needs 1 to 40 characters.");
    const all = this.layouts();
    if (!all[n] && Object.keys(all).length >= 10) throw new AppError(409, "too_many_layouts", "At most 10 saved layouts. Delete one first.");
    const clean: Record<string, { x: number; y: number }> = {};
    for (const [k, v] of Object.entries(positions).slice(0, 600)) {
      if (k.length <= 120 && Number.isFinite(v.x) && Number.isFinite(v.y)) clean[k] = { x: Math.round(Math.max(-5000, Math.min(5000, v.x))), y: Math.round(Math.max(-5000, Math.min(5000, v.y))) };
    }
    all[n] = { positions: clean, filters, savedAt: new Date(this.now()).toISOString() };
    this.d.kv.set("workforce.layouts", JSON.stringify(all));
    return all[n];
  }
  deleteLayout(name: string): void {
    const all = this.layouts();
    if (!all[name]) throw new AppError(404, "layout_not_found", "Layout not found");
    delete all[name];
    this.d.kv.set("workforce.layouts", JSON.stringify(all));
  }

  // ---------------------------------------------------------------- the board (read-only view of real records)
  board() {
    this.sweepTemporary();
    const doc = this.doc();
    const nodes: BoardNode[] = [];
    const edges: BoardEdge[] = [];
    const ids = new Set<string>();
    const truncated: string[] = [];
    const add = (n: Omit<BoardNode, "lane" | "id"> & { id?: string }): string => {
      const id = n.id ?? `${n.kind}:${n.refId}`;
      if (!ids.has(id)) {
        ids.add(id);
        nodes.push({ ...n, id, lane: LANES[n.kind] });
      }
      return id;
    };
    const link = (from: string, to: string, kind: BoardEdge["kind"]) => {
      if (ids.has(from) && ids.has(to) && !edges.some((e) => e.from === from && e.to === to && e.kind === kind)) edges.push({ id: `${from}>${to}:${kind}`, from, to, kind });
    };
    const botDivs = (botId: string): DivisionKey[] => doc.bots[botId]?.divisions ?? [];

    // manager and divisions
    add({ kind: "manager", refId: "central", label: "Central Manager", status: "active", sub: "Manager AI", divisions: [], detail: {}, link: "/tasks" });
    for (const div of DIVISIONS) add({ kind: "division", refId: div.key, label: div.name, status: "idle", divisions: [div.key], detail: {}, link: null });
    for (const div of DIVISIONS) link("manager:central", `division:${div.key}`, "coordinates");

    // bots
    const bots = this.all("SELECT id, name, role, status, model FROM bots WHERE archived = 0 ORDER BY name");
    const activeBy = new Map<string, number>();
    for (const r of this.all("SELECT assignee_bot_id AS b, COUNT(*) AS n FROM tasks WHERE status IN ('pending','running') GROUP BY assignee_bot_id")) activeBy.set(String(r["b"]), Number(r["n"]));
    const failedBy = new Map<string, number>();
    for (const r of this.all("SELECT assignee_bot_id AS b, COUNT(*) AS n FROM tasks WHERE status = 'failed' AND created_at > ? GROUP BY assignee_bot_id", new Date(this.now() - 86_400_000).toISOString())) failedBy.set(String(r["b"]), Number(r["n"]));
    for (const b of bots) {
      const id = String(b["id"]);
      const placement = doc.bots[id];
      const status: NodeStatus = String(b["status"]) !== "active" ? "idle" : (failedBy.get(id) ?? 0) > 0 && (activeBy.get(id) ?? 0) === 0 ? "failed" : (activeBy.get(id) ?? 0) > 0 ? "active" : "idle";
      add({
        kind: "bot",
        refId: id,
        label: String(b["name"]),
        status,
        sub: placement ? placement.kind : String(b["role"]) || "bot",
        divisions: botDivs(id),
        detail: { role: String(b["role"]), botStatus: String(b["status"]), model: b["model"] === null ? null : String(b["model"]), activeTasks: activeBy.get(id) ?? 0, failedLast24h: failedBy.get(id) ?? 0, placement: placement ?? null },
        link: `/bots/${id}`,
      });
    }
    for (const spec of this.d.managerSpecialists()) link("manager:central", `bot:${spec}`, "coordinates");
    for (const [botId, e] of Object.entries(doc.bots)) for (const key of e.divisions) link(`division:${key}`, `bot:${botId}`, e.kind === "shared" ? "shared" : "dedicated");
    for (const r of this.all("SELECT bot_id, target_bot_id FROM bot_delegation_targets")) link(`bot:${String(r["bot_id"])}`, `bot:${String(r["target_bot_id"])}`, "delegation");

    // groups (only when switched on; division groups are folded into their division node)
    let groupsOn = false;
    try {
      groupsOn = this.d.groups.enabled();
    } catch {
      groupsOn = false;
    }
    const groupNode = new Map<string, string>();
    if (groupsOn) {
      for (const g of this.d.groups.list()) {
        if (g.kind === "division" && g.division) {
          groupNode.set(g.id, `division:${g.division}`);
          const dn = nodes.find((n) => n.id === `division:${g.division}`)!;
          dn.detail = { ...dn.detail, groupId: g.id, members: g.members.length, paused: g.paused };
          dn.link = "/groups";
          for (const m of g.members) link(`division:${g.division}`, `bot:${m.botId}`, "member");
        } else {
          const gid = add({ kind: "group", refId: g.id, label: g.name, status: g.paused ? "blocked" : "idle", sub: g.kind === "project" ? "project group" : g.participationMode.replace(/_/g, " "), divisions: [], detail: { members: g.members.length, mode: g.participationMode, paused: g.paused, projectId: g.projectId }, link: "/groups" });
          groupNode.set(g.id, gid);
          for (const m of g.members) link(gid, `bot:${m.botId}`, "member");
        }
      }
    }

    // projects
    const projects = this.all("SELECT id, name FROM projects WHERE archived = 0 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?", CAPS.projects);
    if (projects.length >= CAPS.projects) truncated.push("projects");
    for (const p of projects) add({ kind: "project", refId: String(p["id"]), label: String(p["name"]), status: "idle", divisions: [], detail: {}, link: "/projects" });

    // tasks: recent chains (roots and their sub-tasks) from the real task table
    const roots = this.all("SELECT * FROM tasks WHERE parent_id IS NULL ORDER BY created_at DESC LIMIT ?", CAPS.tasks);
    if (roots.length >= CAPS.tasks) truncated.push("tasks");
    const pendingApprovalTasks = new Set(this.all("SELECT DISTINCT task_id FROM approval_requests WHERE status = 'pending' AND task_id IS NOT NULL").map((r) => String(r["task_id"])));
    const taskStatus = (r: Row): NodeStatus => {
      const s = String(r["status"]);
      if (s === "completed") return "completed";
      if (s === "failed") return "failed";
      if (s === "cancelled") return "cancelled";
      return pendingApprovalTasks.has(String(r["id"])) ? "blocked" : "active";
    };
    const addTask = (r: Row) => {
      const id = String(r["id"]);
      const botId = String(r["assignee_bot_id"]);
      add({ kind: "task", refId: id, label: clip(String(r["instruction"]).replace(/\s+/g, " "), 42), status: taskStatus(r), sub: String(r["status"]), divisions: botDivs(botId), detail: { botId, instruction: clip(String(r["instruction"]), 400), result: r["result"] === null ? null : clip(String(r["result"]), 400), error: r["error_message"] === null ? null : String(r["error_message"]), createdAt: String(r["created_at"]), finishedAt: r["finished_at"] === null ? null : String(r["finished_at"]), origin: String(r["origin"] ?? "user"), originLabel: r["origin_label"] === null ? null : String(r["origin_label"]) }, link: `/tasks/${String(r["root_id"])}` });
      link(`task:${id}`, `bot:${botId}`, "assigned");
    };
    for (const r of roots) addTask(r);
    const rootIds = roots.map((r) => String(r["id"]));
    if (rootIds.length) {
      const subs = this.all(`SELECT * FROM tasks WHERE parent_id IS NOT NULL AND root_id IN (${rootIds.map(() => "?").join(",")}) ORDER BY created_at LIMIT 200`, ...rootIds);
      for (const r of subs) addTask(r);
      for (const r of subs) link(`task:${String(r["parent_id"])}`, `task:${String(r["id"])}`, "subtask");
    }

    // decisions (existing records)
    const decisions = this.all("SELECT * FROM decisions WHERE status <> 'archived' ORDER BY updated_at DESC LIMIT ?", CAPS.decisions);
    if (decisions.length >= CAPS.decisions) truncated.push("decisions");
    const blockedDecisions = new Set(this.all("SELECT DISTINCT decision_id FROM decision_reports WHERE kind = 'blocked'").map((r) => String(r["decision_id"])));
    for (const r of decisions) {
      const id = String(r["id"]);
      const s = String(r["status"]);
      const status: NodeStatus = s === "done" ? "completed" : s === "rejected" ? "cancelled" : blockedDecisions.has(id) ? "blocked" : "active";
      add({ kind: "decision", refId: id, label: clip(String(r["title"]), 42), status, sub: s === "open" ? "needs your choice" : s === "chosen" ? "waiting for your approval" : s.replace(/_/g, " "), divisions: [], detail: { question: clip(String(r["question"]), 300), status: s }, link: "/decisions" });
      if (r["project_id"]) link(`decision:${id}`, `project:${String(r["project_id"])}`, "project");
    }
    for (const a of this.all("SELECT decision_id, bot_id FROM decision_assignments")) link(`decision:${String(a["decision_id"])}`, `bot:${String(a["bot_id"])}`, "decision");
    for (const r of this.all("SELECT task_id AS t, decision_id AS d FROM decision_assignments WHERE task_id IS NOT NULL")) link(`decision:${String(r["d"])}`, `task:${String(r["t"])}`, "origin");

    // project links to tasks, groups to projects, task origins
    for (const it of this.all("SELECT project_id, item_kind, item_id FROM project_items WHERE item_kind = 'task'")) link(`project:${String(it["project_id"])}`, `task:${String(it["item_id"])}`, "project");
    for (const [gid, nodeId] of groupNode) {
      const g = this.d.groups.get(gid);
      if (g.projectId) link(nodeId, `project:${g.projectId}`, "project");
    }
    for (const r of roots) {
      const origin = r["origin_id"] === null ? null : String(r["origin_id"]);
      if (!origin) continue;
      if (groupNode.has(origin)) link(`task:${String(r["id"])}`, groupNode.get(origin)!, "origin");
      else link(`task:${String(r["id"])}`, `decision:${origin}`, "origin");
    }

    // approvals and deliverables (documents the owner approved)
    const approvals = this.all("SELECT * FROM approval_requests WHERE status IN ('pending','executed','failed') ORDER BY created_at DESC LIMIT ?", CAPS.approvals);
    if (approvals.length >= CAPS.approvals) truncated.push("approvals");
    for (const r of approvals) {
      const id = String(r["id"]);
      const s = String(r["status"]);
      const isDoc = String(r["connector"]) === "documents" && s === "executed";
      add({ kind: isDoc ? "deliverable" : "approval", refId: id, label: clip(String(r["summary"]), 42), status: s === "pending" ? "blocked" : s === "failed" ? "failed" : "completed", sub: isDoc ? "document" : `${String(r["connector"])}: ${String(r["action"])}`, divisions: botDivs(String(r["bot_id"])), detail: { connector: String(r["connector"]), action: String(r["action"]), status: s, result: r["result"] === null ? null : clip(String(r["result"]), 300) }, link: "/approvals" });
      link(`${isDoc ? "deliverable" : "approval"}:${id}`, `bot:${String(r["bot_id"])}`, "approval");
      if (r["task_id"]) link(`${isDoc ? "deliverable" : "approval"}:${id}`, `task:${String(r["task_id"])}`, "approval");
    }

    // a division shows the work of its bots
    const counts: Record<NodeStatus, number> = { active: 0, completed: 0, blocked: 0, failed: 0, idle: 0, cancelled: 0 };
    for (const n of nodes) if (n.kind === "task" || n.kind === "decision" || n.kind === "approval" || n.kind === "deliverable") counts[n.status]++;
    for (const div of DIVISIONS) {
      const dn = nodes.find((n) => n.id === `division:${div.key}`)!;
      const mine = nodes.filter((n) => n.kind === "task" && n.divisions.includes(div.key));
      dn.status = mine.some((n) => n.status === "failed") ? "failed" : mine.some((n) => n.status === "blocked") ? "blocked" : mine.some((n) => n.status === "active") ? "active" : "idle";
      dn.detail = { ...dn.detail, bots: nodes.filter((n) => n.kind === "bot" && n.divisions.includes(div.key)).length, tasks: mine.length };
    }
    return { nodes, edges, counts, truncated, groupsEnabled: groupsOn, generatedAt: new Date(this.now()).toISOString(), note: "Every node and line is read from the real records. Nothing here is estimated or invented." };
  }

  /** The history of one node, read from the record that owns it (nothing is copied or stored again). */
  activity(kind: NodeKind, refId: string) {
    const rows: { at: string; text: string }[] = [];
    const push = (at: unknown, text: string) => rows.push({ at: String(at), text: clip(text, 240) });
    if (kind === "bot") {
      for (const r of this.all("SELECT * FROM tasks WHERE assignee_bot_id = ? ORDER BY created_at DESC LIMIT 15", refId)) push(r["created_at"], `Task ${String(r["status"])}: ${String(r["instruction"]).replace(/\s+/g, " ")}`);
      for (const r of this.all("SELECT kind, created_at FROM audit_events WHERE bot_id = ? ORDER BY id DESC LIMIT 15", refId)) push(r["created_at"], `Audit: ${String(r["kind"])}`);
    } else if (kind === "task") {
      for (const r of this.all("SELECT kind, detail, created_at FROM task_events WHERE task_id = ? ORDER BY id DESC LIMIT 30", refId)) push(r["created_at"], `${String(r["kind"])}`);
    } else if (kind === "decision") {
      for (const r of this.all("SELECT actor, action, created_at FROM decision_revisions WHERE decision_id = ? ORDER BY id DESC LIMIT 40", refId)) push(r["created_at"], `${String(r["actor"])}: ${String(r["action"])}`);
    } else if (kind === "group" || kind === "division") {
      const gid = kind === "group" ? refId : (this.d.groups.enabled() ? this.d.groups.list({ kind: "division", division: refId as DivisionKey })[0]?.id : undefined);
      if (gid) for (const e of this.d.groups.activity(gid, 40).events) push(e.at, `${e.kind}${e.from ? ` ${e.from}` : ""}${e.to ? ` → ${e.to}` : ""}`);
    } else if (kind === "project") {
      for (const r of this.all("SELECT item_kind, item_id, added_at FROM project_items WHERE project_id = ? ORDER BY added_at DESC LIMIT 30", refId)) push(r["added_at"], `Linked ${String(r["item_kind"])}`);
    } else if (kind === "approval" || kind === "deliverable") {
      const r = this.one("SELECT status, summary, created_at, decided_at, executed_at FROM approval_requests WHERE id = ?", refId);
      if (r) {
        push(r["created_at"], `Requested: ${String(r["summary"])}`);
        if (r["decided_at"]) push(r["decided_at"], `Decided (${String(r["status"])})`);
        if (r["executed_at"]) push(r["executed_at"], "Executed");
      }
    }
    return { kind, refId, history: rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40) };
  }
}
