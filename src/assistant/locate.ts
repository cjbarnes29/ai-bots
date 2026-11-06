import type { DatabaseSync } from "node:sqlite";

/**
 * "Locate and open": turns a plain request ("open my latest project", "find yesterday's workflow", "locate my research agent", "show pending approvals")
 * into real records and their IDs. It reads the application's own tables and returns WHERE things are; it changes nothing and runs nothing.
 * It is rule-based on purpose (no model call, no cost, works offline, cannot be talked into anything). The text is untrusted: it is only ever used as
 * search words in a parameterised query, never executed.
 */
export type LocateKind = "project" | "workflow" | "agent" | "conversation" | "task" | "approval" | "document" | "note" | "decision" | "page";
export interface Candidate {
  kind: LocateKind;
  id: string;
  title: string;
  subtitle: string;
  /** Only a conversation: the agent it is with. */
  botId?: string;
  /** Only a page: its address. */
  to?: string;
}
export interface LocateResult {
  /** True when the request was a request to find or open something (so it should not also be sent to a model). */
  handled: boolean;
  entity: LocateKind | null;
  /** single: one clear match; multiple: the owner must choose; none: nothing matches. */
  resolution: "single" | "multiple" | "none";
  /** For a request that said open/go to and matched exactly one thing. */
  openNow: boolean;
  candidates: Candidate[];
  /** A plain sentence the owner reads. Only states what was actually found. */
  message: string;
  /** How the request was understood (shown so a wrong reading is visible). */
  understood: string;
}

type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "");
const clip = (t: string, n: number) => {
  const f = t.replace(/\s+/g, " ").trim();
  return f.length > n ? `${f.slice(0, n)}…` : f;
};
const like = (w: string) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const OPEN_VERBS = /\b(open|go to|take me to|take me|jump to|navigate to|bring up|switch to)\b/;
const FIND_VERBS = /\b(show|find|locate|where|list|display|see|view|look up|look for|search for|get|which|what)\b/;
const ENTITY_WORDS: [LocateKind, RegExp][] = [
  ["approval", /\b(approvals?|approval requests?|requests? waiting|needs? my approval|waiting for me)\b/],
  ["workflow", /\bworkflows?\b/],
  ["project", /\bprojects?\b/],
  ["agent", /\b(agents?|bots?|assistants?|coworkers?)\b/],
  ["conversation", /\b(conversations?|chats?|threads?)\b/],
  ["task", /\b(tasks?|jobs?|runs?)\b/],
  ["decision", /\bdecisions?\b/],
  ["document", /\b(documents?|docs?|files?|pdfs?|spreadsheets?|uploads?)\b/],
  ["note", /\bnotes?\b/],
];
/** Whole sections of the app, opened by name. */
const PAGES: { re: RegExp; to: string; title: string }[] = [
  { re: /\b(ai models?|models?|providers?|usage)\b/, to: "/models", title: "AI Models" },
  { re: /\b(integrations?|apps? and integrations?|connectors?|apps)\b/, to: "/integrations", title: "Apps & Integrations" },
  { re: /\bcreative( studio)?\b/, to: "/creative", title: "Creative Studio" },
  { re: /\b(knowledge( center| centre)?)\b/, to: "/knowledge", title: "Knowledge Center" },
  { re: /\b(settings?|preferences)\b/, to: "/settings", title: "Settings" },
  { re: /\b(dashboard|overview|home)\b/, to: "/", title: "Dashboard" },
  { re: /\b(inbox)\b/, to: "/inbox", title: "Inbox" },
  { re: /\b(schedules?|automation)\b/, to: "/automation", title: "Schedules" },
  { re: /\b(activity|logs?|monitor(ing)?)\b/, to: "/monitor", title: "Activity & Logs" },
];
const STOP = new Set(["about", "regarding", "related", "relating", "concerning", "containing", "mentioning", "titled", "labelled", "labeled", "tagged", "named", "using", "into", "at", "by", "as", "if", "so", "then", "them", "those", "these", "some", "new", "old", "a", "an", "the", "my", "me", "i", "to", "of", "for", "all", "any", "please", "can", "could", "you", "that", "this", "is", "are", "was", "were", "do", "does", "have", "has", "it", "in", "on", "and", "or", "with", "about", "from", "up", "named", "called", "name", "one", "ones", "again", "now", "just", "which", "what", "where", "there", "s", "latest", "last", "newest", "recent", "recently", "most", "yesterday", "today", "week", "month", "pending", "waiting", "failed", "failing", "running", "completed", "finished", "done", "open", "go", "take", "show", "find", "locate", "list", "display", "see", "view", "look", "search", "get", "jump", "navigate", "bring", "switch", "need", "needs", "approval", "approvals", "approve"]);
const ENTITY_STRIP = /\b(approvals?|workflows?|projects?|agents?|bots?|assistants?|coworkers?|conversations?|chats?|threads?|tasks?|jobs?|runs?|decisions?|documents?|docs?|files?|pdfs?|spreadsheets?|uploads?|notes?|knowledge|center|centre)\b/g;

function dayRange(text: string, now: number): { from: string; to: string; label: string } | null {
  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const DAY = 86_400_000;
  const today = startOfDay(now);
  if (/\byesterday\b/.test(text)) return { from: new Date(today - DAY).toISOString(), to: new Date(today).toISOString(), label: "yesterday" };
  if (/\btoday\b/.test(text)) return { from: new Date(today).toISOString(), to: new Date(today + DAY).toISOString(), label: "today" };
  if (/\b(last|past) week\b|\bthis week\b/.test(text)) return { from: new Date(today - 7 * DAY).toISOString(), to: new Date(today + DAY).toISOString(), label: "in the last 7 days" };
  if (/\b(last|past) month\b|\bthis month\b/.test(text)) return { from: new Date(today - 30 * DAY).toISOString(), to: new Date(today + DAY).toISOString(), label: "in the last 30 days" };
  return null;
}

interface Spec {
  /** SELECT with these aliases: id, title, sub, at (timestamp used for dates and ordering). */
  sql: string;
  /** Columns searched for the name words. */
  cols: string[];
  /** Which column orders "latest" ("created" or "updated"). */
  base: string;
  map: (r: Row) => Candidate;
  statusCol?: string;
}

const SPECS: Partial<Record<LocateKind, Spec>> = {
  project: { sql: "SELECT id, name AS title, description AS sub, created_at AS created, updated_at AS updated FROM projects WHERE deleted_at IS NULL AND archived = 0", cols: ["name", "description"], base: "projects", map: (r) => ({ kind: "project", id: s(r["id"]), title: s(r["title"]), subtitle: clip(s(r["sub"]), 80) || "Project" }) },
  workflow: { sql: "SELECT id, name AS title, enabled, created_at AS created, updated_at AS updated FROM workflows WHERE archived = 0", cols: ["name"], base: "workflows", map: (r) => ({ kind: "workflow", id: s(r["id"]), title: s(r["title"]), subtitle: Number(r["enabled"]) === 1 ? "Workflow · on" : "Workflow · off" }) },
  agent: { sql: "SELECT id, name AS title, role AS sub, status, created_at AS created, updated_at AS updated FROM bots WHERE archived = 0", cols: ["name", "role", "personality", "responsibilities"], base: "bots", map: (r) => ({ kind: "agent", id: s(r["id"]), title: s(r["title"]), subtitle: `${clip(s(r["sub"]), 60) || "Agent"} · ${s(r["status"])}` }) },
  decision: { sql: "SELECT id, title, status, created_at AS created, updated_at AS updated FROM decisions WHERE status != 'archived'", cols: ["title", "question"], base: "decisions", map: (r) => ({ kind: "decision", id: s(r["id"]), title: s(r["title"]), subtitle: `Decision · ${s(r["status"])}` }) },
  document: { sql: "SELECT id, title, filename AS sub, status, created_at AS created, updated_at AS updated FROM knowledge_docs WHERE deleted_at IS NULL AND scope != 'temporary'", cols: ["title", "filename", "tags", "category", "folder"], base: "knowledge_docs", map: (r) => ({ kind: "document", id: s(r["id"]), title: s(r["title"]), subtitle: `${s(r["sub"])} · ${s(r["status"])}` }) },
  note: { sql: "SELECT id, title, created_at AS created, updated_at AS updated FROM memory_notes WHERE scope = 'shared' AND archived = 0", cols: ["title", "tags"], base: "memory_notes", map: (r) => ({ kind: "note", id: s(r["id"]), title: s(r["title"]), subtitle: "Shared note" }) },
};

export function locate(db: DatabaseSync, input: string, now: number = Date.now()): LocateResult {
  const text = input.toLowerCase().replace(/[’']s\b/g, "").replace(/[^\p{L}\p{N}\s/-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  const no = (understood = ""): LocateResult => ({ handled: false, entity: null, resolution: "none", openNow: false, candidates: [], message: "", understood });
  if (!text) return no();
  const opens = OPEN_VERBS.test(text);
  const finds = FIND_VERBS.test(text);
  const entity = ENTITY_WORDS.find(([, re]) => re.test(text))?.[0] ?? null;
  const page = PAGES.find((p) => p.re.test(text));
  const wordCount = text.split(" ").length;
  // A request needs a navigation verb (or, for approvals, a phrase like "pending approvals") and something to find. Ordinary chat passes through untouched.
  const approvalPhrase = entity === "approval" && /\b(pending|waiting|need|needs)\b/.test(text);
  if (!(opens || finds || approvalPhrase) || (!entity && !page)) return no();
  if (wordCount > 14) return no(); // a long message is a question for the assistant, not a lookup

  const range = dayRange(text, now);
  const wantsLatest = /\b(latest|newest|most recent|last|recent)\b/.test(text) && !/\blast (week|month)\b/.test(text);
  const flags = {
    failed: /\b(failed|failing|failure|error|broken|crashed)\b/.test(text),
    running: /\b(running|working|in progress)\b/.test(text),
    pending: /\b(pending|waiting|needs? (my )?approval|unapproved)\b/.test(text),
    done: /\b(completed|finished|done|succeeded)\b/.test(text),
  };
  const name = text
    .replace(ENTITY_STRIP, " ")
    .split(" ")
    .filter((w) => w.length > 1 && !STOP.has(w) && !/^(\d+)$/.test(w))
    .join(" ");
  const words = name ? name.split(" ").slice(0, 5) : [];
  const understoodBits = [entity ?? page?.title ?? "", wantsLatest ? "latest" : "", range?.label ?? "", flags.failed ? "failed" : flags.pending ? "pending" : flags.running ? "running" : flags.done ? "completed" : "", words.length ? `matching "${words.join(" ")}"` : ""].filter(Boolean);
  const understood = understoodBits.join(" · ");

  // ---- a section of the app (no specific record asked for)
  if (!entity && page) {
    return { handled: true, entity: "page", resolution: "single", openNow: opens, candidates: [{ kind: "page", id: page.to, title: page.title, subtitle: "Section", to: page.to }], message: `${page.title} is a section of the app.`, understood: page.title };
  }

  let candidates: Candidate[] = [];
  const q = (sql: string, ...args: (string | number)[]) => db.prepare(sql).all(...args) as Row[];

  if (entity === "approval") {
    const where = ["1 = 1"];
    const args: (string | number)[] = [];
    if (flags.pending || (!flags.done && !flags.failed && !words.length)) where.push("a.status = 'pending'");
    if (flags.failed) where.push("a.status IN ('failed', 'denied', 'expired')");
    if (flags.done) where.push("a.status IN ('approved', 'executed')");
    for (const w of words) (where.push("a.summary LIKE ? ESCAPE '\\'"), args.push(like(w)));
    if (range) (where.push("a.created_at >= ? AND a.created_at < ?"), args.push(range.from, range.to));
    candidates = q(`SELECT a.id, a.summary, a.status, a.created_at, b.name AS bot FROM approval_requests a JOIN bots b ON b.id = a.bot_id WHERE ${where.join(" AND ")} ORDER BY a.created_at DESC LIMIT 12`, ...args).map((r) => ({ kind: "approval" as const, id: s(r["id"]), title: clip(s(r["summary"]), 90), subtitle: `${s(r["bot"])} · ${s(r["status"])}` }));
  } else if (entity === "task") {
    const where = ["1 = 1"];
    const args: (string | number)[] = [];
    if (flags.failed) where.push("t.status = 'failed'");
    else if (flags.running) where.push("t.status IN ('running', 'pending')");
    else if (flags.done) where.push("t.status = 'completed'");
    for (const w of words) (where.push("t.instruction LIKE ? ESCAPE '\\'"), args.push(like(w)));
    if (range) (where.push("t.created_at >= ? AND t.created_at < ?"), args.push(range.from, range.to));
    candidates = q(`SELECT t.id, t.instruction, t.status, t.error_message, t.created_at, b.name AS bot FROM tasks t JOIN bots b ON b.id = t.assignee_bot_id WHERE ${where.join(" AND ")} ORDER BY t.created_at DESC LIMIT 12`, ...args).map((r) => ({ kind: "task" as const, id: s(r["id"]), title: clip(s(r["instruction"]), 90), subtitle: `${s(r["bot"])} · ${s(r["status"])}${r["error_message"] ? ` · ${clip(s(r["error_message"]), 80)}` : ""}` }));
  } else if (entity === "conversation") {
    const where = ["1 = 1"];
    const args: (string | number)[] = [];
    for (const w of words) (where.push("(c.title LIKE ? ESCAPE '\\' OR b.name LIKE ? ESCAPE '\\')"), args.push(like(w), like(w)));
    if (range) (where.push("c.created_at >= ? AND c.created_at < ?"), args.push(range.from, range.to));
    candidates = q(`SELECT c.id, c.title, c.bot_id, b.name AS bot FROM conversations c JOIN bots b ON b.id = c.bot_id WHERE ${where.join(" AND ")} ORDER BY c.created_at DESC LIMIT 12`, ...args).map((r) => ({ kind: "conversation" as const, id: s(r["id"]), title: s(r["title"]), subtitle: `Conversation with ${s(r["bot"])}`, botId: s(r["bot_id"]) }));
  } else if (entity && SPECS[entity]) {
    const spec = SPECS[entity]!;
    const inner: string[] = [];
    const args: (string | number)[] = [];
    for (const w of words) {
      inner.push(`(${spec.cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
      for (let i = 0; i < spec.cols.length; i++) args.push(like(w));
    }
    const outer: string[] = [];
    if (range) (outer.push("((created >= ? AND created < ?) OR (updated >= ? AND updated < ?))"), args.push(range.from, range.to, range.from, range.to));
    if (flags.failed && entity === "document") outer.push("status IN ('failed', 'unsupported')");
    const order = /(last|recent)/.test(text) && !/(latest|newest)/.test(text) ? "updated" : "created";
    const rows = q(`SELECT * FROM (${spec.sql}${inner.length ? ` AND ${inner.join(" AND ")}` : ""}) ${outer.length ? `WHERE ${outer.join(" AND ")}` : ""} ORDER BY ${order} DESC LIMIT 12`, ...args);
    candidates = rows.map(spec.map);
  }

  // A document whose NAME does not match may still contain the words: fall back to the Knowledge Center's text index (real passages, never a guess).
  if (entity === "document" && candidates.length === 0 && words.length > 0) {
    const match = words.map((w) => `"${w.replace(/"/g, "")}"`).join(" OR ");
    try {
      candidates = q("SELECT d.id, d.title, d.filename, d.status FROM knowledge_docs d WHERE d.id IN (SELECT doc_id FROM knowledge_fts WHERE knowledge_fts MATCH ?) AND d.deleted_at IS NULL AND d.scope != 'temporary' AND d.status = 'ready' ORDER BY d.updated_at DESC LIMIT 12", match).map((r) => ({ kind: "document" as const, id: s(r["id"]), title: s(r["title"]), subtitle: `${s(r["filename"])} · mentions "${words.join(" ")}"` }));
    } catch {
      candidates = [];
    }
  }
  const noun = entity === "approval" ? "approval" : entity ?? "item";
  const plural = (n: number) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  if (candidates.length === 0) {
    const where = entity === "approval" ? "Nothing is waiting for your approval." : `I could not find a ${noun}${words.length ? ` matching "${words.join(" ")}"` : ""}${range ? ` from ${range.label}` : ""}.`;
    return { handled: true, entity, resolution: "none", openNow: false, candidates: [], message: where, understood };
  }
  // "latest"/"last" means exactly one: the newest. Otherwise one match is clear, several need a choice.
  if (wantsLatest && !flags.pending && candidates.length > 0) {
    const one = candidates[0]!;
    return { handled: true, entity, resolution: "single", openNow: opens, candidates: [one], message: `Your latest ${noun} is "${one.title}".${candidates.length > 1 ? ` (${plural(candidates.length)} matched; this is the newest.)` : ""}`, understood };
  }
  if (candidates.length === 1) return { handled: true, entity, resolution: "single", openNow: opens, candidates, message: `Found "${candidates[0]!.title}".`, understood };
  return { handled: true, entity, resolution: "multiple", openNow: false, candidates, message: entity === "approval" && !words.length ? `${plural(candidates.length)} ${flags.pending || !flags.failed ? "waiting for you" : "found"}. Choose one to open.` : `I found ${plural(candidates.length)}. Which one do you mean?`, understood };
}
