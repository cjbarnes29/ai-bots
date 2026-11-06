import type { DatabaseSync } from "node:sqlite";
import { AppError } from "../errors.js";

/**
 * The project hub: ONE read-only view over what already exists. It adds no table and writes nothing.
 * A project's conversations, tasks, workflows and notes are the owner's links (project_items). Everything else is DERIVED from them:
 *   - agents      = the bots of its linked conversations and of its task chains, plus bots that raised one of its decisions;
 *   - approvals   = approval requests made by the project's task chains;
 *   - decisions   = decisions filed under the project;
 *   - outputs     = files created through approvals by the project's task chains.
 * Nothing here grants a permission: an agent being listed gives it no access to anything.
 */
export interface HubDeps {
  db: DatabaseSync;
}

type Row = Record<string, unknown>;
const s = (v: unknown): string => String(v ?? "");
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);
const FILE_ACTIONS = "((a.connector = 'documents' AND a.action LIKE 'create!_%' ESCAPE '!') OR (a.connector = 'pc' AND a.action = 'write_file'))";

export interface HubAgent {
  botId: string;
  name: string;
  archived: boolean;
  roles: string[];
  tasks: number;
  conversations: number;
  lastAt: string | null;
}
export interface Hub {
  project: { id: string; name: string; description: string; archived: boolean };
  conversations: { id: string; botId: string; botName: string; title: string; createdAt: string; lastAt: string }[];
  tasks: { id: string; rootId: string; botId: string; botName: string; instruction: string; status: string; errorMessage: string | null; createdAt: string; finishedAt: string | null }[];
  agents: HubAgent[];
  workflows: { id: string; name: string; lastRun: { id: string; status: string; error: string | null; at: string } | null }[];
  decisions: { id: string; title: string; status: string; updatedAt: string }[];
  approvals: { id: string; botId: string; botName: string; taskId: string | null; connector: string; action: string; summary: string; status: string; createdAt: string }[];
  outputs: { approvalId: string; connector: string; action: string; path: string | null; status: string; botName: string; taskId: string | null; at: string }[];
  notes: { id: string; title: string }[];
  /** What needs the owner now, in one list, so progress can be understood without visiting several sections. */
  attention: { kind: "approval" | "failed_task" | "decision" | "failed_run"; id: string; text: string }[];
  progress: { total: number; completed: number; running: number; pending: number; failed: number };
}

export type RelatedKind = "conversation" | "task" | "approval" | "decision" | "workflow" | "bot";
export interface Related {
  kind: RelatedKind;
  id: string;
  project: { id: string; name: string } | null;
  bot: { id: string; name: string } | null;
  conversation: { id: string; botId: string; title: string } | null;
  task: { id: string; rootId: string; status: string; error: string | null } | null;
  approval: { id: string; status: string; summary: string } | null;
  workflow: { id: string; name: string } | null;
  decision: { id: string; title: string } | null;
}

export class HubService {
  constructor(private readonly d: HubDeps) {}

  private all(sql: string, ...p: (string | number)[]): Row[] {
    return this.d.db.prepare(sql).all(...p) as Row[];
  }
  private one(sql: string, ...p: (string | number)[]): Row | undefined {
    return this.d.db.prepare(sql).get(...p) as Row | undefined;
  }

  hub(projectId: string): Hub {
    const p = this.one("SELECT id, name, description, archived FROM projects WHERE id = ? AND deleted_at IS NULL", projectId);
    if (!p) throw new AppError(404, "project_not_found", "Project not found");
    const linked = (kind: string) => this.all("SELECT item_id FROM project_items WHERE project_id = ? AND item_kind = ?", projectId, kind).map((r) => s(r["item_id"]));

    const conversations = linked("conversation").flatMap((id) => {
      const c = this.one(
        "SELECT c.id, c.bot_id, c.title, c.created_at, b.name AS bot_name, (SELECT MAX(m.created_at) FROM chat_messages m WHERE m.conversation_id = c.id) AS last_at FROM conversations c JOIN bots b ON b.id = c.bot_id WHERE c.id = ?",
        id,
      );
      return c ? [{ id: s(c["id"]), botId: s(c["bot_id"]), botName: s(c["bot_name"]), title: s(c["title"]), createdAt: s(c["created_at"]), lastAt: s(c["last_at"] ?? c["created_at"]) }] : [];
    });

    const roots = linked("task");
    const tasks = roots.flatMap((root) =>
      this.all(
        "SELECT t.id, t.root_id, t.assignee_bot_id, t.instruction, t.status, t.error_message, t.created_at, t.finished_at, b.name AS bot_name FROM tasks t JOIN bots b ON b.id = t.assignee_bot_id WHERE t.root_id = ? ORDER BY t.created_at",
        root,
      ).map((t) => ({
        id: s(t["id"]),
        rootId: s(t["root_id"]),
        botId: s(t["assignee_bot_id"]),
        botName: s(t["bot_name"]),
        instruction: clip(s(t["instruction"]), 200),
        status: s(t["status"]),
        errorMessage: t["error_message"] ? clip(s(t["error_message"]), 300) : null,
        createdAt: s(t["created_at"]),
        finishedAt: t["finished_at"] ? s(t["finished_at"]) : null,
      })),
    );
    const taskIds = tasks.map((t) => t.id);

    const decisions = this.all("SELECT id, title, status, updated_at FROM decisions WHERE project_id = ? ORDER BY updated_at DESC", projectId).map((r) => ({ id: s(r["id"]), title: s(r["title"]), status: s(r["status"]), updatedAt: s(r["updated_at"]) }));

    const inList = taskIds.map(() => "?").join(",");
    const approvals = taskIds.length
      ? this.all(
          `SELECT a.id, a.bot_id, a.task_id, a.connector, a.action, a.summary, a.status, a.created_at, b.name AS bot_name FROM approval_requests a JOIN bots b ON b.id = a.bot_id WHERE a.task_id IN (${inList}) ORDER BY a.created_at DESC LIMIT 100`,
          ...taskIds,
        ).map((a) => ({ id: s(a["id"]), botId: s(a["bot_id"]), botName: s(a["bot_name"]), taskId: a["task_id"] ? s(a["task_id"]) : null, connector: s(a["connector"]), action: s(a["action"]), summary: clip(s(a["summary"]), 200), status: s(a["status"]), createdAt: s(a["created_at"]) }))
      : [];
    const outputs = taskIds.length
      ? this.all(
          `SELECT a.id, a.connector, a.action, a.args_json, a.status, a.task_id, a.created_at, b.name AS bot_name FROM approval_requests a JOIN bots b ON b.id = a.bot_id WHERE a.task_id IN (${inList}) AND ${FILE_ACTIONS} ORDER BY a.created_at DESC LIMIT 100`,
          ...taskIds,
        ).map((a) => {
          let path: string | null = null;
          try {
            const j = JSON.parse(s(a["args_json"])) as { path?: unknown; name?: unknown };
            path = typeof j.path === "string" ? j.path : typeof j.name === "string" ? j.name : null;
          } catch {
            path = null;
          }
          return { approvalId: s(a["id"]), connector: s(a["connector"]), action: s(a["action"]), path, status: s(a["status"]), botName: s(a["bot_name"]), taskId: a["task_id"] ? s(a["task_id"]) : null, at: s(a["created_at"]) };
        })
      : [];

    const workflows = linked("workflow").flatMap((id) => {
      const w = this.one("SELECT id, name FROM workflows WHERE id = ?", id);
      if (!w) return [];
      const r = this.one("SELECT id, status, error, created_at FROM workflow_runs WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1", id);
      return [{ id: s(w["id"]), name: s(w["name"]), lastRun: r ? { id: s(r["id"]), status: s(r["status"]), error: r["error"] ? clip(s(r["error"]), 300) : null, at: s(r["created_at"]) } : null }];
    });

    const notes = linked("note").flatMap((id) => {
      const n = this.one("SELECT id, title FROM memory_notes WHERE id = ?", id);
      return n ? [{ id: s(n["id"]), title: s(n["title"]) }] : [];
    });

    // Agents: derived, never stored.
    const agents = new Map<string, HubAgent>();
    const touch = (botId: string, name: string, archived: boolean, role: string, at: string | null, kind: "tasks" | "conversations" | null) => {
      const a = agents.get(botId) ?? { botId, name, archived, roles: [], tasks: 0, conversations: 0, lastAt: null };
      if (!a.roles.includes(role)) a.roles.push(role);
      if (kind) a[kind] += 1;
      if (at && (!a.lastAt || at > a.lastAt)) a.lastAt = at;
      agents.set(botId, a);
    };
    const archivedOf = (botId: string) => Number(this.one("SELECT archived FROM bots WHERE id = ?", botId)?.["archived"] ?? 0) === 1;
    for (const c of conversations) touch(c.botId, c.botName, archivedOf(c.botId), "chats in this project", c.lastAt, "conversations");
    for (const t of tasks) touch(t.botId, t.botName, archivedOf(t.botId), "works on its tasks", t.finishedAt ?? t.createdAt, "tasks");
    for (const dRow of this.all("SELECT DISTINCT d.raised_by_bot_id AS bid, b.name AS name, b.archived AS archived FROM decisions d JOIN bots b ON b.id = d.raised_by_bot_id WHERE d.project_id = ? AND d.raised_by_bot_id IS NOT NULL", projectId)) {
      touch(s(dRow["bid"]), s(dRow["name"]), Number(dRow["archived"]) === 1, "raised a decision", null, null);
    }

    const attention: Hub["attention"] = [
      ...approvals.filter((a) => a.status === "pending").map((a) => ({ kind: "approval" as const, id: a.id, text: `${a.botName} is waiting for your approval: ${a.summary}` })),
      ...tasks.filter((t) => t.status === "failed").map((t) => ({ kind: "failed_task" as const, id: t.id, text: `${t.botName}'s task failed${t.errorMessage ? `: ${t.errorMessage}` : ""}` })),
      ...decisions.filter((x) => x.status === "open" || x.status === "chosen").map((x) => ({ kind: "decision" as const, id: x.id, text: `Decision waiting for you: ${x.title}` })),
      ...workflows.filter((w) => w.lastRun?.status === "failed").map((w) => ({ kind: "failed_run" as const, id: w.lastRun!.id, text: `Workflow "${w.name}" failed${w.lastRun!.error ? `: ${w.lastRun!.error}` : ""}` })),
    ];
    const count = (st: string) => tasks.filter((t) => t.status === st).length;
    return {
      project: { id: s(p["id"]), name: s(p["name"]), description: s(p["description"]), archived: Number(p["archived"]) === 1 },
      conversations,
      tasks,
      agents: [...agents.values()].sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? "")),
      workflows,
      decisions,
      approvals,
      outputs,
      notes,
      attention,
      progress: { total: tasks.length, completed: count("completed"), running: count("running"), pending: count("pending"), failed: count("failed") },
    };
  }

  /** "What is this connected to?" for one thing. Read-only. Unknown ids answer 404, never an empty guess. */
  related(kind: RelatedKind, id: string): Related {
    const out: Related = { kind, id, project: null, bot: null, conversation: null, task: null, approval: null, workflow: null, decision: null };
    const projectFor = (itemKind: string, itemId: string) => {
      const r = this.one("SELECT p.id, p.name FROM project_items i JOIN projects p ON p.id = i.project_id WHERE i.item_kind = ? AND i.item_id = ? AND p.deleted_at IS NULL", itemKind, itemId);
      return r ? { id: s(r["id"]), name: s(r["name"]) } : null;
    };
    const botOf = (botId: string | null) => {
      if (!botId) return null;
      const b = this.one("SELECT id, name FROM bots WHERE id = ?", botId);
      return b ? { id: s(b["id"]), name: s(b["name"]) } : null;
    };
    const missing = () => new AppError(404, "not_found", "That item does not exist.");
    const taskInfo = (t: Row) => ({ id: s(t["id"]), rootId: s(t["root_id"]), status: s(t["status"]), error: t["error_message"] ? clip(s(t["error_message"]), 300) : null });
    switch (kind) {
      case "conversation": {
        const c = this.one("SELECT id, bot_id, title FROM conversations WHERE id = ?", id);
        if (!c) throw missing();
        out.conversation = { id, botId: s(c["bot_id"]), title: s(c["title"]) };
        out.bot = botOf(s(c["bot_id"]));
        out.project = projectFor("conversation", id);
        break;
      }
      case "task": {
        const t = this.one("SELECT id, root_id, assignee_bot_id, status, error_message FROM tasks WHERE id = ?", id);
        if (!t) throw missing();
        out.task = taskInfo(t);
        out.bot = botOf(s(t["assignee_bot_id"]));
        out.project = projectFor("task", s(t["root_id"]));
        break;
      }
      case "approval": {
        const a = this.one("SELECT id, bot_id, task_id, status, summary FROM approval_requests WHERE id = ?", id);
        if (!a) throw missing();
        out.approval = { id, status: s(a["status"]), summary: clip(s(a["summary"]), 200) };
        out.bot = botOf(s(a["bot_id"]));
        if (a["task_id"]) {
          const t = this.one("SELECT id, root_id, status, error_message FROM tasks WHERE id = ?", s(a["task_id"]));
          if (t) {
            out.task = taskInfo(t);
            out.project = projectFor("task", s(t["root_id"]));
          }
        }
        break;
      }
      case "decision": {
        const x = this.one("SELECT id, title, project_id, raised_by_bot_id FROM decisions WHERE id = ?", id);
        if (!x) throw missing();
        out.decision = { id, title: s(x["title"]) };
        out.bot = botOf(x["raised_by_bot_id"] ? s(x["raised_by_bot_id"]) : null);
        if (x["project_id"]) {
          const p = this.one("SELECT id, name FROM projects WHERE id = ? AND deleted_at IS NULL", s(x["project_id"]));
          if (p) out.project = { id: s(p["id"]), name: s(p["name"]) };
        }
        break;
      }
      case "workflow": {
        const w = this.one("SELECT id, name FROM workflows WHERE id = ?", id);
        if (!w) throw missing();
        out.workflow = { id, name: s(w["name"]) };
        out.project = projectFor("workflow", id);
        break;
      }
      case "bot": {
        const b = botOf(id);
        if (!b) throw missing();
        out.bot = b;
        break;
      }
    }
    return out;
  }

  /** Projects an agent takes part in (derived the same way as the hub's agent list). */
  projectsOfBot(botId: string): { id: string; name: string; via: string[] }[] {
    const found = new Map<string, { id: string; name: string; via: Set<string> }>();
    const add = (r: Row, via: string) => {
      const cur = found.get(s(r["id"])) ?? { id: s(r["id"]), name: s(r["name"]), via: new Set<string>() };
      cur.via.add(via);
      found.set(cur.id, cur);
    };
    for (const r of this.all("SELECT DISTINCT p.id, p.name FROM project_items i JOIN conversations c ON c.id = i.item_id JOIN projects p ON p.id = i.project_id WHERE i.item_kind = 'conversation' AND c.bot_id = ? AND p.deleted_at IS NULL AND p.archived = 0", botId)) add(r, "conversation");
    for (const r of this.all("SELECT DISTINCT p.id, p.name FROM project_items i JOIN tasks t ON t.root_id = i.item_id JOIN projects p ON p.id = i.project_id WHERE i.item_kind = 'task' AND t.assignee_bot_id = ? AND p.deleted_at IS NULL AND p.archived = 0", botId)) add(r, "task");
    for (const r of this.all("SELECT DISTINCT p.id, p.name FROM decisions d JOIN projects p ON p.id = d.project_id WHERE d.raised_by_bot_id = ? AND p.deleted_at IS NULL AND p.archived = 0", botId)) add(r, "decision");
    return [...found.values()].map((x) => ({ id: x.id, name: x.name, via: [...x.via] }));
  }
}
