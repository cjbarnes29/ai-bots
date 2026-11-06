import type { DatabaseSync } from "node:sqlite";

/**
 * Global search: ONE read-only look across what already exists. It searches names and titles only (a project's name and description, an agent's name and role,
 * a conversation's title, a task's instruction, a workflow's name, a decision's title, an approval's summary, a shared note's title, a schedule's name).
 * It never reads chat message text, memory note bodies, secrets or file contents, and it skips archived and deleted things. It returns where to go, never an action.
 */
export type SearchKind = "project" | "agent" | "conversation" | "task" | "workflow" | "decision" | "approval" | "note" | "schedule";
export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  /** Only for a conversation: the agent it is with (the dashboard opens it in that agent's chat). */
  botId?: string;
}
export const SEARCH_LIMITS = { minChars: 2, maxChars: 80, perKind: 5 };

type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "");
const clip = (t: string, n: number) => {
  const flat = t.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
};
/** LIKE wildcards in what the owner typed are plain characters. */
const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function searchAll(db: DatabaseSync, raw: string): { query: string; hits: SearchHit[]; tooShort: boolean } {
  const query = raw.trim().slice(0, SEARCH_LIMITS.maxChars);
  if (query.length < SEARCH_LIMITS.minChars) return { query, hits: [], tooShort: true };
  const like = likeOf(query);
  const n = SEARCH_LIMITS.perKind;
  const run = (sql: string, ...extra: string[]) => db.prepare(sql).all(...extra, n) as Row[];
  const hits: SearchHit[] = [];
  const add = (kind: SearchKind, rows: Row[], map: (r: Row) => Omit<SearchHit, "kind">) => rows.forEach((r) => hits.push({ kind, ...map(r) }));

  add("project", run("SELECT id, name, description FROM projects WHERE deleted_at IS NULL AND archived = 0 AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT ?", like, like), (r) => ({ id: s(r["id"]), title: s(r["name"]), subtitle: clip(s(r["description"]), 80) || "Project" }));
  add("agent", run("SELECT id, name, role FROM bots WHERE archived = 0 AND (name LIKE ? ESCAPE '\\' OR role LIKE ? ESCAPE '\\') ORDER BY name LIMIT ?", like, like), (r) => ({ id: s(r["id"]), title: s(r["name"]), subtitle: clip(s(r["role"]), 80) || "Agent" }));
  add("conversation", run("SELECT c.id, c.title, c.bot_id, b.name AS bot_name FROM conversations c JOIN bots b ON b.id = c.bot_id WHERE c.title LIKE ? ESCAPE '\\' ORDER BY c.created_at DESC LIMIT ?", like), (r) => ({ id: s(r["id"]), title: s(r["title"]), subtitle: `Conversation with ${s(r["bot_name"])}`, botId: s(r["bot_id"]) }));
  add("task", run("SELECT t.id, t.instruction, t.status, b.name AS bot_name FROM tasks t JOIN bots b ON b.id = t.assignee_bot_id WHERE t.instruction LIKE ? ESCAPE '\\' ORDER BY t.created_at DESC LIMIT ?", like), (r) => ({ id: s(r["id"]), title: clip(s(r["instruction"]), 80), subtitle: `Task for ${s(r["bot_name"])} · ${s(r["status"])}` }));
  add("workflow", run("SELECT id, name FROM workflows WHERE archived = 0 AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?", like), (r) => ({ id: s(r["id"]), title: s(r["name"]), subtitle: "Workflow" }));
  add("decision", run("SELECT id, title, status FROM decisions WHERE status != 'archived' AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?", like), (r) => ({ id: s(r["id"]), title: s(r["title"]), subtitle: `Decision · ${s(r["status"])}` }));
  add("approval", run("SELECT a.id, a.summary, a.status, b.name AS bot_name FROM approval_requests a JOIN bots b ON b.id = a.bot_id WHERE a.summary LIKE ? ESCAPE '\\' ORDER BY a.created_at DESC LIMIT ?", like), (r) => ({ id: s(r["id"]), title: clip(s(r["summary"]), 80), subtitle: `Approval · ${s(r["bot_name"])} · ${s(r["status"])}` }));
  add("note", run("SELECT id, title FROM memory_notes WHERE scope = 'shared' AND archived = 0 AND title LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?", like), (r) => ({ id: s(r["id"]), title: s(r["title"]), subtitle: "Shared note" }));
  add("schedule", run("SELECT id, name FROM schedules WHERE name LIKE ? ESCAPE '\\' ORDER BY name LIMIT ?", like), (r) => ({ id: s(r["id"]), title: s(r["name"]), subtitle: "Schedule" }));
  return { query, hits, tooShort: false };
}
