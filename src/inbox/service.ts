import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { BotRecord } from "../agent-manager/types.js";
import type { ChatRepository } from "../chat/repository.js";
import { AppError } from "../errors.js";

/**
 * The owner's inbox. Bots appear in it ONLY because something real happened (a task finished or failed, an approval is waiting, a schedule
 * or workflow run failed). The caller names the event; this service looks it up (verifySource), builds the message text from the event itself,
 * and writes it once. There is no way to post free text as a bot, no HTTP route that does, and no simulated activity.
 *
 * Tables: migration 018 (inbox_*). Chat messages stay in chat_messages (append-only); reading, pinning, muting, archiving, hiding and renaming are
 * stored beside them and never rewrite a message. "Delete" hides a conversation; its messages are kept.
 */
export const KINDS = ["task_result", "task_failed", "approval_needed", "automation_failed", "clarification", "report", "note"] as const;
export type InboxKind = (typeof KINDS)[number];
export const SOURCE_KINDS = ["task", "approval", "schedule", "workflow_run", "trigger", "bot_action"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type Importance = "normal" | "important";
export type Notify = "all" | "important" | "none";

/** Which real source each kind may come from. clarification/report/note have no producer yet, so nothing can create them (see verifySource). */
const ALLOWED: Record<InboxKind, SourceKind[]> = {
  task_result: ["task"],
  task_failed: ["task"],
  approval_needed: ["approval"],
  automation_failed: ["schedule", "trigger"],
  clarification: ["bot_action"],
  report: ["bot_action"],
  note: ["bot_action"],
};
const IMPORTANT: Record<InboxKind, Importance> = {
  task_result: "normal",
  task_failed: "important",
  approval_needed: "important",
  automation_failed: "important",
  clarification: "important",
  report: "normal",
  note: "normal",
};

export const DEFAULT_PREFS = { notify: "important" as Notify, maxPerHour: 6 };
export const INBOX_LIMITS = { maxText: 6000, listMax: 100, titleMax: 120 };

/** What the app confirms about a real event. `ok: false` means the event does not exist or does not match, so nothing is written. */
export type SourceCheck = { ok: true; title: string; body: string } | { ok: false; reason: string };
export type VerifySource = (botId: string, kind: InboxKind, source: { kind: SourceKind; id: string }) => SourceCheck;

export interface InboxDeps {
  db: DatabaseSync;
  chat: ChatRepository;
  getBot: (id: string) => BotRecord;
  verifySource: VerifySource;
  audit: { record(kind: string, detail?: Record<string, unknown>, options?: { actor?: string; botId?: string | null }): void };
  now?: () => number;
  /** Called when a new message should alert the owner (per the preferences and the mute switch). Carries no message text. Not wired to phone alerts yet. */
  notifier?: (n: { botId: string; conversationId: string; kind: InboxKind; importance: Importance }) => void;
}

export type PostResult =
  | { status: "posted"; messageId: number; conversationId: string; notify: boolean }
  | { status: "duplicate"; messageId: number; conversationId: string }
  | { status: "held_back"; reason: string }
  | { status: "rejected"; reason: string };

export interface InboxItem {
  conversationId: string;
  botId: string;
  botName: string;
  title: string;
  originalTitle: string;
  pinned: boolean;
  muted: boolean;
  archived: boolean;
  unread: number;
  lastMessage: { id: number; role: string; preview: string; createdAt: string } | null;
  lastActivityAt: string;
  /** Id of the newest message; breaks ties between conversations active in the same moment. */
  lastId: number;
}

export type InboxView = "all" | "unread" | "pinned" | "archived";
type Row = Record<string, unknown>;

const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export class InboxService {
  private readonly now: () => number;
  constructor(private readonly d: InboxDeps) {
    this.now = d.now ?? Date.now;
  }
  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  // ------------------------------------------------------------------ preferences
  getPrefs(botId: string | null): { notify: Notify; maxPerHour: number; own: boolean } {
    const row = (id: string | null) =>
      (id === null
        ? this.d.db.prepare("SELECT notify, max_per_hour FROM inbox_preferences WHERE bot_id IS NULL").get()
        : this.d.db.prepare("SELECT notify, max_per_hour FROM inbox_preferences WHERE bot_id = ?").get(id)) as Row | undefined;
    const own = botId === null ? undefined : row(botId);
    const r = own ?? row(null);
    return r ? { notify: String(r["notify"]) as Notify, maxPerHour: Number(r["max_per_hour"]), own: !!own } : { ...DEFAULT_PREFS, own: false };
  }

  setPrefs(botId: string | null, input: { notify?: Notify; maxPerHour?: number }): { notify: Notify; maxPerHour: number } {
    if (botId !== null) this.d.getBot(botId);
    if (input.notify !== undefined && !["all", "important", "none"].includes(input.notify)) throw new AppError(400, "bad_notify", "Choose all, important or none.");
    if (input.maxPerHour !== undefined && (!Number.isInteger(input.maxPerHour) || input.maxPerHour < 1 || input.maxPerHour > 60)) {
      throw new AppError(400, "bad_cap", "Messages per hour must be a whole number from 1 to 60.");
    }
    const cur = this.getPrefs(botId);
    const next = { notify: input.notify ?? cur.notify, maxPerHour: input.maxPerHour ?? cur.maxPerHour };
    const exists = botId === null ? this.d.db.prepare("SELECT 1 FROM inbox_preferences WHERE bot_id IS NULL").get() : this.d.db.prepare("SELECT 1 FROM inbox_preferences WHERE bot_id = ?").get(botId);
    if (exists) {
      (botId === null ? this.d.db.prepare("UPDATE inbox_preferences SET notify = ?, max_per_hour = ?, updated_at = ? WHERE bot_id IS NULL") : this.d.db.prepare("UPDATE inbox_preferences SET notify = ?, max_per_hour = ?, updated_at = ? WHERE bot_id = ?")).run(
        ...([next.notify, next.maxPerHour, this.iso(), ...(botId === null ? [] : [botId])] as (string | number)[]),
      );
    } else {
      this.d.db.prepare("INSERT INTO inbox_preferences (bot_id, notify, max_per_hour, updated_at) VALUES (?, ?, ?, ?)").run(botId, next.notify, next.maxPerHour, this.iso());
    }
    this.d.audit.record("inbox.preferences", { botId, ...next }, { actor: "owner" });
    return next;
  }

  // ------------------------------------------------------------------ bot messages (real events only)
  /**
   * A bot reports a real event. Idempotent: the same event and kind is written once (a retry, a restart or a double callback returns "duplicate").
   * Capped: more than the bot's hourly limit is not written but recorded as held back, so nothing is lost silently and nothing floods the inbox.
   */
  postFromEvent(botId: string, kind: InboxKind, source: { kind: SourceKind; id: string }): PostResult {
    if (!(KINDS as readonly string[]).includes(kind)) return { status: "rejected", reason: "Unknown message kind." };
    if (!ALLOWED[kind].includes(source.kind)) return { status: "rejected", reason: `A ${kind} message cannot come from a ${source.kind}.` };
    if (!source.id || source.id.length > 80) return { status: "rejected", reason: "Missing event id." };
    let bot: BotRecord;
    try {
      bot = this.d.getBot(botId);
    } catch {
      return { status: "rejected", reason: "No such bot." };
    }
    if (bot.archived) return { status: "rejected", reason: "The bot is archived." };

    const dup = this.d.db.prepare("SELECT message_id, conversation_id, bot_id FROM inbox_message_meta WHERE source_kind = ? AND source_id = ? AND kind = ?").get(source.kind, source.id, kind) as Row | undefined;
    if (dup && String(dup["bot_id"]) !== botId) return { status: "rejected", reason: "That event was reported by a different bot." };
    if (dup) return { status: "duplicate", messageId: Number(dup["message_id"]), conversationId: String(dup["conversation_id"]) };

    const check = this.d.verifySource(botId, kind, source);
    if (!check.ok) return { status: "rejected", reason: check.reason };

    const prefs = this.getPrefs(botId);
    const hourAgo = new Date(this.now() - 3_600_000).toISOString();
    const sent = Number((this.d.db.prepare("SELECT COUNT(*) AS n FROM inbox_message_meta WHERE bot_id = ? AND initiated = 1 AND created_at > ?").get(botId, hourAgo) as Row)["n"]);
    if (sent >= prefs.maxPerHour) {
      const already = this.d.db.prepare("SELECT 1 FROM inbox_held_back WHERE bot_id = ? AND source_kind = ? AND source_id = ? AND kind = ?").get(botId, source.kind, source.id, kind);
      if (!already) {
        this.d.db.prepare("INSERT INTO inbox_held_back (bot_id, source_kind, source_id, kind, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(botId, source.kind, source.id, kind, `Hourly limit of ${prefs.maxPerHour} reached`, this.iso());
        this.d.audit.record("inbox.held_back", { kind, source: source.kind }, { botId });
      }
      return { status: "held_back", reason: `${bot.name} reached its limit of ${prefs.maxPerHour} messages per hour.` };
    }

    const importance = IMPORTANT[kind];
    const text = clip(`${check.title}\n\n${check.body}`.trim(), INBOX_LIMITS.maxText);
    const at = this.iso();
    const out = this.d.chat.transaction(() => {
      // Re-check inside the transaction so two callers at once still write one message.
      const again = this.d.db.prepare("SELECT message_id, conversation_id FROM inbox_message_meta WHERE source_kind = ? AND source_id = ? AND kind = ?").get(source.kind, source.id, kind) as Row | undefined;
      if (again) return { dup: true as const, messageId: Number(again["message_id"]), conversationId: String(again["conversation_id"]) };
      let conversationId = this.updatesConversationOf(botId);
      if (!conversationId) {
        conversationId = randomUUID();
        this.d.chat.createConversation(conversationId, botId, clip(`Updates from ${bot.name}`, INBOX_LIMITS.titleMax), at);
      }
      const messageId = this.d.chat.insertMessage({ conversationId, role: "assistant", content: text, botVersion: bot.currentVersion, createdAt: at });
      this.d.db
        .prepare("INSERT INTO inbox_message_meta (message_id, conversation_id, bot_id, initiated, kind, importance, source_kind, source_id, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)")
        .run(messageId, conversationId, botId, kind, importance, source.kind, source.id, at);
      // A new real event brings a hidden conversation back; archived and muted stay as the owner set them.
      this.d.db.prepare("UPDATE inbox_conversation_state SET hidden_at = NULL, updated_at = ? WHERE conversation_id = ? AND hidden_at IS NOT NULL").run(at, conversationId);
      return { dup: false as const, messageId, conversationId };
    });
    if (out.dup) return { status: "duplicate", messageId: out.messageId, conversationId: out.conversationId };
    const state = this.stateOf(out.conversationId);
    const notify = !state.muted && (prefs.notify === "all" || (prefs.notify === "important" && importance === "important"));
    if (notify) {
      try {
        this.d.notifier?.({ botId, conversationId: out.conversationId, kind, importance });
      } catch {
        /* an alert problem never loses the message */
      }
    }
    this.d.audit.record("inbox.message", { kind, source: source.kind, sourceId: source.id, conversationId: out.conversationId }, { botId });
    return { status: "posted", messageId: out.messageId, conversationId: out.conversationId, notify };
  }

  /** The bot's own "Updates from ..." conversation: the one its earlier bot-first messages went to. */
  private updatesConversationOf(botId: string): string | null {
    const r = this.d.db.prepare("SELECT conversation_id FROM inbox_message_meta WHERE bot_id = ? AND initiated = 1 ORDER BY message_id DESC LIMIT 1").get(botId) as Row | undefined;
    return r ? String(r["conversation_id"]) : null;
  }

  // ------------------------------------------------------------------ the owner's view
  list(opts: { view?: InboxView; botId?: string; q?: string } = {}): { items: InboxItem[]; unreadTotal: number; heldBack: number } {
    const view = opts.view ?? "all";
    const where: string[] = ["s.hidden_at IS NULL"];
    const args: (string | number)[] = [];
    if (view === "archived") where.push("COALESCE(s.archived, 0) = 1");
    else where.push("COALESCE(s.archived, 0) = 0");
    if (view === "pinned") where.push("COALESCE(s.pinned, 0) = 1");
    if (opts.botId) {
      where.push("c.bot_id = ?");
      args.push(opts.botId);
    }
    if (opts.q?.trim()) {
      where.push("(COALESCE(s.title_override, c.title) LIKE ? ESCAPE '\\' OR b.name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM chat_messages mm WHERE mm.conversation_id = c.id AND mm.content LIKE ? ESCAPE '\\'))");
      args.push(like(opts.q.trim()), like(opts.q.trim()), like(opts.q.trim()));
    }
    const rows = this.d.db
      .prepare(
        `SELECT c.id, c.bot_id, c.title, b.name AS bot_name, s.title_override, COALESCE(s.pinned,0) AS pinned, COALESCE(s.muted,0) AS muted, COALESCE(s.archived,0) AS archived,
           COALESCE(s.last_read_message_id,0) AS last_read,
           (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id AND m.role = 'assistant' AND EXISTS (SELECT 1 FROM inbox_message_meta x WHERE x.message_id = m.id AND x.initiated = 1) AND m.id > COALESCE(s.last_read_message_id,0)) AS unread,
           (SELECT m.id FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_id
         FROM conversations c JOIN bots b ON b.id = c.bot_id
         LEFT JOIN inbox_conversation_state s ON s.conversation_id = c.id
         WHERE ${where.join(" AND ")}`,
      )
      .all(...args) as Row[];
    let items = rows.map((r): InboxItem => {
      const last = r["last_id"] === null ? null : this.d.chat.getMessage(Number(r["last_id"])) ?? null;
      return {
        conversationId: String(r["id"]),
        botId: String(r["bot_id"]),
        botName: String(r["bot_name"]),
        title: r["title_override"] ? String(r["title_override"]) : String(r["title"]),
        originalTitle: String(r["title"]),
        pinned: Number(r["pinned"]) === 1,
        muted: Number(r["muted"]) === 1,
        archived: Number(r["archived"]) === 1,
        unread: Number(r["unread"]),
        lastMessage: last ? { id: last.id, role: last.role, preview: clip(last.content.replace(/\s+/g, " "), 140), createdAt: last.createdAt } : null,
        lastActivityAt: last?.createdAt ?? "",
        lastId: last?.id ?? 0,
      };
    });
    if (view === "unread") items = items.filter((i) => i.unread > 0);
    items.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastActivityAt.localeCompare(a.lastActivityAt) || b.lastId - a.lastId);
    items = items.slice(0, INBOX_LIMITS.listMax);
    const unreadTotal = Number(
      (this.d.db
        .prepare(
          `SELECT COALESCE(SUM((SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id AND m.role = 'assistant' AND EXISTS (SELECT 1 FROM inbox_message_meta x WHERE x.message_id = m.id AND x.initiated = 1) AND m.id > COALESCE(s.last_read_message_id,0))),0) AS n
           FROM conversations c LEFT JOIN inbox_conversation_state s ON s.conversation_id = c.id
           WHERE s.hidden_at IS NULL AND COALESCE(s.archived,0) = 0 AND COALESCE(s.muted,0) = 0`,
        )
        .get() as Row)["n"],
    );
    const heldBack = Number((this.d.db.prepare("SELECT COUNT(*) AS n FROM inbox_held_back").get() as Row)["n"]);
    return { items, unreadTotal, heldBack };
  }

  /** The messages of a conversation, each with why it exists (kind, importance, source) when a bot wrote it first. Does not mark anything read. */
  messages(conversationId: string): { conversationId: string; botId: string; title: string; messages: (ReturnType<ChatRepository["listMessages"]>[number] & { sender: "owner" | "bot"; botId: string; initiated: boolean; kind: string | null; importance: string | null; source: { kind: string; id: string } | null })[] } {
    const conv = this.requireConversation(conversationId);
    const metas = new Map((this.d.db.prepare("SELECT message_id, initiated, kind, importance, source_kind, source_id FROM inbox_message_meta WHERE conversation_id = ?").all(conversationId) as Row[]).map((r) => [Number(r["message_id"]), r]));
    const st = this.stateOf(conversationId);
    return {
      conversationId,
      botId: conv.botId,
      title: st.title ?? conv.title,
      messages: this.d.chat.listMessages(conversationId).map((m) => {
        const meta = metas.get(m.id);
        return { ...m, sender: m.role === "user" ? ("owner" as const) : ("bot" as const), botId: conv.botId, initiated: !!meta && Number(meta["initiated"]) === 1, kind: meta ? String(meta["kind"]) : null, importance: meta ? String(meta["importance"]) : null, source: meta ? { kind: String(meta["source_kind"]), id: String(meta["source_id"]) } : null };
      }),
    };
  }

  private requireConversation(id: string) {
    const c = this.d.chat.getConversation(id);
    if (!c) throw new AppError(404, "conversation_not_found", "Conversation not found");
    return c;
  }

  private stateOf(conversationId: string): { title: string | null; pinned: boolean; muted: boolean; archived: boolean; hidden: boolean; lastRead: number } {
    const r = this.d.db.prepare("SELECT title_override, pinned, muted, archived, hidden_at, last_read_message_id FROM inbox_conversation_state WHERE conversation_id = ?").get(conversationId) as Row | undefined;
    return { title: r?.["title_override"] ? String(r["title_override"]) : null, pinned: Number(r?.["pinned"] ?? 0) === 1, muted: Number(r?.["muted"] ?? 0) === 1, archived: Number(r?.["archived"] ?? 0) === 1, hidden: !!r?.["hidden_at"], lastRead: Number(r?.["last_read_message_id"] ?? 0) };
  }

  private patchState(conversationId: string, fields: Record<string, string | number | null>): void {
    this.requireConversation(conversationId);
    const at = this.iso();
    this.d.db.prepare("INSERT INTO inbox_conversation_state (conversation_id, updated_at) VALUES (?, ?) ON CONFLICT(conversation_id) DO NOTHING").run(conversationId, at);
    const cols = Object.keys(fields);
    this.d.db.prepare(`UPDATE inbox_conversation_state SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE conversation_id = ?`).run(...cols.map((c) => fields[c] as string | number | null), at, conversationId);
  }

  setPinned(id: string, on: boolean): void {
    this.patchState(id, { pinned: on ? 1 : 0 });
  }
  setMuted(id: string, on: boolean): void {
    this.patchState(id, { muted: on ? 1 : 0 });
  }
  setArchived(id: string, on: boolean): void {
    this.patchState(id, { archived: on ? 1 : 0 });
  }
  /** "Delete": hides the conversation from every list. Every message is kept. */
  hide(id: string): void {
    this.patchState(id, { hidden_at: this.iso() });
    this.d.audit.record("inbox.hidden", { conversationId: id }, { actor: "owner" });
  }
  restore(id: string): void {
    this.patchState(id, { hidden_at: null });
  }
  rename(id: string, title: string): string {
    const t = title.trim();
    if (t.length < 1 || t.length > INBOX_LIMITS.titleMax) throw new AppError(400, "bad_title", `A name needs 1 to ${INBOX_LIMITS.titleMax} characters.`);
    this.patchState(id, { title_override: t });
    return t;
  }
  /** Marks everything up to the newest message as read. */
  markRead(id: string): void {
    const last = this.d.chat.lastMessages(id, 1)[0];
    this.requireConversation(id);
    this.patchState(id, { last_read_message_id: last?.id ?? 0 });
  }

  /** Why held-back messages exist, for the owner to see that nothing was silently lost. */
  heldBack(limit = 50): { botId: string; kind: string; sourceKind: string; sourceId: string; reason: string; createdAt: string }[] {
    return (this.d.db.prepare("SELECT bot_id, kind, source_kind, source_id, reason, created_at FROM inbox_held_back ORDER BY id DESC LIMIT ?").all(limit) as Row[]).map((r) => ({ botId: String(r["bot_id"]), kind: String(r["kind"]), sourceKind: String(r["source_kind"]), sourceId: String(r["source_id"]), reason: String(r["reason"]), createdAt: String(r["created_at"]) }));
  }
}
