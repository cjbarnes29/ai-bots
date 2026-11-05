import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { BotRecord } from "../agent-manager/types.js";
import type { TaskRecord } from "../delegation/repository.js";
import { looksSecret } from "../desktop/redact.js";
import { AppError } from "../errors.js";
import type { OutputContract } from "../llm/service.js";
import type { ProjectService, ProjectView } from "../projects/service.js";
import { extractJson, MAX_RESPONDERS, optionsMessages, pickRelevant, reviewMessages, type Scored } from "./relevance.js";
import { z } from "zod";

/**
 * Decisions (the "chalkboard"): the owner asks something, the bots whose responsibilities fit offer OPTIONS, the owner edits and chooses, and approving
 * turns the choice into a project and real tasks that the bots report back on.
 *
 * Rules this service keeps (and migration 019 enforces again in the database):
 *  - Only the OWNER chooses, approves or rejects. No method here takes a bot as the actor for those acts, and nothing a bot writes (options, views,
 *    reports) can reach them. A bot cannot approve its own proposal.
 *  - A model's answer is a DRAFT held in memory. It becomes a decision only when the owner creates one from it, once.
 *  - Approving grants nothing: no permission, folder, program or secret. Tasks run through the normal task engine, so the Guardian, free-only limits,
 *    delegation limits and the approval gate for every outside action all apply as for any task.
 *  - A task is started at most once per assignment (claim, then start), and a report is written at most once per task and kind.
 *  - Disagreement is bounded: reasons are required, two rounds at most, the owner triggers each round, and bots never decide among themselves.
 */
export const DECISION_LIMITS = { question: 4000, title: 120, options: 12, draftTtlMs: 3_600_000, maxDrafts: 20, maxRounds: 2, instructionChars: 3500 };

type Row = Record<string, unknown>;
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

const optionInput = z.strictObject({ title: z.string().trim().min(1).max(120), details: z.string().trim().max(4000).default(""), pros: z.string().trim().max(1000).default(""), cons: z.string().trim().max(1000).default("") });
export type OptionInput = z.infer<typeof optionInput>;
const modelOptions = z.object({ options: z.array(z.looseObject({ title: z.string(), details: z.string().optional(), pros: z.string().optional(), cons: z.string().optional() })).min(1).max(6) });
const modelViews = z.object({ views: z.array(z.looseObject({ option: z.number().int(), stance: z.string(), reasoning: z.string(), prefer: z.number().int().optional(), replyTo: z.number().int().optional() })).max(12) });

const OPTIONS_CONTRACT: OutputContract = { name: "a JSON object with 1 to 6 options", check: (t) => (modelOptions.safeParse(extractJson(t)).success ? null : "no readable list of options") };
const VIEWS_CONTRACT: OutputContract = { name: "a JSON object with views", check: (t) => (modelViews.safeParse(extractJson(t)).success ? null : "no readable list of views") };

export interface DraftBot {
  botId: string;
  botName: string;
  reason: string;
  options: OptionInput[];
  problem: string | null;
}
export interface Draft {
  draftId: string;
  question: string;
  projectId: string | null;
  bots: DraftBot[];
  notice: string | null;
  saved: false;
}

export interface DecisionDeps {
  db: DatabaseSync;
  audit: { record(kind: string, detail?: Record<string, unknown>, options?: { actor?: string; botId?: string | null }): void };
  /** Active, non-archived bots. */
  bots: () => BotRecord[];
  getBot: (id: string) => BotRecord;
  complete: (input: { botId: string; conversationId: null; modelRef: string; contract?: OutputContract; messages: { role: "system" | "user" | "assistant"; content: string }[]; temperature: number; maxOutputTokens: number }) => Promise<{ text: string }>;
  engine: { submit(botId: string, instruction: string, origin: { type: "user"; id: string; label: string }): TaskRecord };
  projects: ProjectService;
  now?: () => number;
}

export class DecisionService {
  private readonly now: () => number;
  private readonly drafts = new Map<string, { draft: Draft; at: number }>();
  constructor(private readonly d: DecisionDeps) {
    this.now = d.now ?? Date.now;
  }
  private iso(): string {
    return new Date(this.now()).toISOString();
  }
  private all(sql: string, ...a: (string | number | null)[]): Row[] {
    return this.d.db.prepare(sql).all(...a) as Row[];
  }
  private one(sql: string, ...a: (string | number | null)[]): Row | undefined {
    return this.d.db.prepare(sql).get(...a) as Row | undefined;
  }

  // ================================================================== 1. the owner asks; relevant bots offer options (drafts only)
  /** Asks the bots whose responsibilities fit. Spends at most one model call per bot (free-only rules and limits apply). Saves nothing. */
  async inquire(input: { question: string; projectId?: string | null; botIds?: string[] }): Promise<Draft> {
    const question = input.question.trim();
    if (question.length < 8) throw new AppError(400, "question_too_short", "Write the question in a sentence or two.");
    if (question.length > DECISION_LIMITS.question) throw new AppError(413, "question_too_long", `Keep the question under ${DECISION_LIMITS.question} characters.`);
    if (looksSecret(question)) throw new AppError(400, "question_has_secret", "The question contains something that looks like a key or password. Remove it; it would be sent to a model.");
    if (input.projectId) this.d.projects.get(input.projectId);

    const eligible = this.d.bots().filter((b) => !b.archived && b.status === "active" && !!b.model);
    let chosen: Scored[];
    if (input.botIds?.length) {
      const ids = [...new Set(input.botIds)].slice(0, MAX_RESPONDERS);
      chosen = ids.map((id) => {
        const b = eligible.find((x) => x.id === id);
        if (!b) throw new AppError(409, "bot_not_available", "A bot you asked for is switched off, archived or has no model.");
        return { id: b.id, name: b.name, score: 100, reason: "you asked for it", mentioned: true };
      });
    } else {
      chosen = pickRelevant(
        question,
        eligible.map((b) => ({ id: b.id, name: b.name, role: b.role, responsibilities: b.responsibilities, activeWork: this.activeWork(b.id) })),
      );
    }
    const draft: Draft = { draftId: randomUUID(), question, projectId: input.projectId ?? null, bots: [], notice: null, saved: false };
    if (chosen.length === 0) {
      draft.notice = "No bot's role or responsibilities match this question, so nobody answered. Mention a bot with @Name, pick bots yourself, or write the options by hand.";
    }
    for (const c of chosen) {
      const bot = this.d.getBot(c.id);
      const entry: DraftBot = { botId: bot.id, botName: bot.name, reason: c.reason, options: [], problem: null };
      try {
        const out = await this.d.complete({ botId: bot.id, conversationId: null, modelRef: bot.model!, messages: optionsMessages(bot, question), contract: OPTIONS_CONTRACT, temperature: 0.5, maxOutputTokens: Math.min(bot.maxOutputTokens ?? 1500, 1500) });
        const parsed = modelOptions.safeParse(extractJson(out.text));
        if (!parsed.success) entry.problem = "The answer was not in a usable form.";
        else {
          for (const o of parsed.data.options) {
            const clean = optionInput.safeParse({ title: clip(o.title.trim(), 120), details: clip(o.details?.trim() ?? "", 4000), pros: clip(o.pros?.trim() ?? "", 1000), cons: clip(o.cons?.trim() ?? "", 1000) });
            if (!clean.success) continue;
            if (looksSecret(`${clean.data.title} ${clean.data.details} ${clean.data.pros} ${clean.data.cons}`)) continue;
            entry.options.push(clean.data);
            if (entry.options.length === 4) break;
          }
          if (entry.options.length === 0) entry.problem = "The answer had no usable options.";
        }
      } catch (e) {
        entry.problem = e instanceof AppError || e instanceof Error ? clip(e.message, 200) : "The bot could not answer.";
      }
      draft.bots.push(entry);
    }
    this.rememberDraft(draft);
    return draft;
  }

  private rememberDraft(draft: Draft): void {
    const t = this.now();
    for (const [id, v] of this.drafts) if (t - v.at > DECISION_LIMITS.draftTtlMs) this.drafts.delete(id);
    while (this.drafts.size >= DECISION_LIMITS.maxDrafts) this.drafts.delete(this.drafts.keys().next().value as string);
    this.drafts.set(draft.draftId, { draft, at: t });
  }

  private activeWork(botId: string): string[] {
    return this.all("SELECT instruction FROM tasks WHERE assignee_bot_id = ? AND status IN ('pending','running') ORDER BY created_at DESC LIMIT 3", botId).map((r) => clip(String(r["instruction"]), 300));
  }

  // ================================================================== 2. put it on the chalkboard (the owner's act)
  /** Creates a decision from a draft. The draft is used up: pressing twice cannot create two decisions. Which bots proposed what comes from the draft, not from the caller. */
  createFromDraft(draftId: string, opts: { title?: string; projectId?: string | null } = {}): string {
    const held = this.drafts.get(draftId);
    if (!held || this.now() - held.at > DECISION_LIMITS.draftTtlMs) throw new AppError(404, "draft_not_found", "That set of answers has expired or was already put on the chalkboard.");
    this.drafts.delete(draftId);
    const { draft } = held;
    const usable = draft.bots.filter((b) => b.options.length > 0);
    if (usable.length === 0) throw new AppError(409, "draft_empty", "No bot gave usable options. Write the options by hand instead.");
    const id = this.insertDecision({ title: opts.title ?? clip(draft.question, 80), question: draft.question, projectId: opts.projectId ?? draft.projectId });
    const at = this.iso();
    this.d.db.exec("BEGIN");
    try {
      let pos = 0;
      for (const b of usable.slice(0, 5)) this.d.db.prepare("INSERT INTO decision_participants (decision_id, bot_id, reason, added_by, added_at) VALUES (?, ?, ?, 'system', ?)").run(id, b.botId, clip(b.reason, 500), at);
      for (const b of usable.slice(0, 5)) {
        for (const o of b.options) {
          if (pos >= DECISION_LIMITS.options) break;
          this.d.db.prepare("INSERT INTO decision_options (id, decision_id, position, title, details, pros, cons, proposed_by_bot_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), id, ++pos, o.title, o.details, o.pros, o.cons, b.botId, at, at);
        }
      }
      this.d.db.exec("COMMIT");
    } catch (e) {
      this.d.db.exec("ROLLBACK");
      this.d.db.prepare("UPDATE decisions SET status = 'archived', updated_at = ? WHERE id = ?").run(this.iso(), id);
      throw e;
    }
    this.d.audit.record("decision.created", { id, from: "bots" }, { actor: "owner" });
    return id;
  }

  /** The owner writes a decision and its options by hand (no bot involved). */
  createManual(input: { title: string; question?: string; options: OptionInput[]; projectId?: string | null }): string {
    const options = z.array(optionInput).min(2).max(DECISION_LIMITS.options).parse(input.options);
    const at = this.iso();
    // One transaction: a decision never exists with some of its options missing.
    const id = this.inTransaction(() => {
      const newId = this.insertDecision({ title: input.title, question: input.question ?? "", projectId: input.projectId ?? null });
      options.forEach((o, i) => this.d.db.prepare("INSERT INTO decision_options (id, decision_id, position, title, details, pros, cons, edited_by_owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)").run(randomUUID(), newId, i + 1, o.title, o.details, o.pros, o.cons, at, at));
      return newId;
    });
    this.d.audit.record("decision.created", { id, from: "owner" }, { actor: "owner" });
    return id;
  }

  private insertDecision(i: { title: string; question: string; projectId: string | null }): string {
    const title = i.title.trim();
    if (title.length < 1 || title.length > DECISION_LIMITS.title) throw new AppError(400, "bad_title", `The title needs 1 to ${DECISION_LIMITS.title} characters.`);
    if (i.question.length > DECISION_LIMITS.question) throw new AppError(413, "question_too_long", "The question is too long.");
    if (i.projectId) this.d.projects.get(i.projectId);
    const id = randomUUID();
    const at = this.iso();
    this.d.db.prepare("INSERT INTO decisions (id, project_id, title, question, source_kind, created_at, updated_at) VALUES (?, ?, ?, ?, 'manual', ?, ?)").run(id, i.projectId, title, i.question.trim(), at, at);
    return id;
  }

  // ================================================================== 3. reading
  list(filter: { status?: string; projectId?: string } = {}) {
    const where: string[] = ["1=1"];
    const args: string[] = [];
    if (filter.status) (where.push("d.status = ?"), args.push(filter.status));
    else where.push("d.status <> 'archived'");
    if (filter.projectId) (where.push("d.project_id = ?"), args.push(filter.projectId));
    return this.all(
      `SELECT d.*, (SELECT COUNT(*) FROM decision_options o WHERE o.decision_id = d.id AND o.removed_at IS NULL) AS options,
              (SELECT COUNT(*) FROM decision_assignments a WHERE a.decision_id = d.id) AS assignments,
              (SELECT COUNT(*) FROM decision_reports r WHERE r.decision_id = d.id AND r.kind = 'done') AS done
       FROM decisions d WHERE ${where.join(" AND ")} ORDER BY d.updated_at DESC LIMIT 200`,
      ...args,
    ).map((r) => ({ ...this.summary(r), options: Number(r["options"]), assignments: Number(r["assignments"]), done: Number(r["done"]) }));
  }

  private summary(r: Row) {
    return {
      id: String(r["id"]),
      projectId: r["project_id"] === null ? null : String(r["project_id"]),
      title: String(r["title"]),
      question: String(r["question"]),
      status: String(r["status"]),
      chosenOptionId: r["chosen_option_id"] === null ? null : String(r["chosen_option_id"]),
      ownerNote: String(r["owner_note"]),
      approvedAt: r["approved_at"] === null ? null : String(r["approved_at"]),
      createdAt: String(r["created_at"]),
      updatedAt: String(r["updated_at"]),
    };
  }

  /** Everything about one decision: options (with each bot's views and where bots disagree), participants, assignments with progress, reports and the full history. */
  get(id: string) {
    const r = this.one("SELECT * FROM decisions WHERE id = ?", id);
    if (!r) throw new AppError(404, "decision_not_found", "Decision not found");
    const name = (botId: string | null) => (botId ? String(this.one("SELECT name FROM bots WHERE id = ?", botId)?.["name"] ?? "?") : "You");
    const views = this.all("SELECT * FROM decision_views WHERE decision_id = ? ORDER BY id", id).map((v) => ({
      id: Number(v["id"]),
      optionId: String(v["option_id"]),
      botId: String(v["bot_id"]),
      botName: name(String(v["bot_id"])),
      stance: String(v["stance"]),
      reasoning: String(v["reasoning"]),
      alternativeOptionId: v["alternative_option_id"] === null ? null : String(v["alternative_option_id"]),
      replyToViewId: v["reply_to_view_id"] === null ? null : Number(v["reply_to_view_id"]),
      round: Number(v["round"]),
    }));
    const options = this.all("SELECT * FROM decision_options WHERE decision_id = ? AND removed_at IS NULL ORDER BY position", id).map((o) => {
      const mine = views.filter((v) => v.optionId === String(o["id"]));
      const against = mine.filter((v) => v.stance === "oppose" || v.stance === "concern" || v.stance === "alternative");
      return {
        id: String(o["id"]),
        position: Number(o["position"]),
        title: String(o["title"]),
        details: String(o["details"]),
        pros: String(o["pros"]),
        cons: String(o["cons"]),
        proposedBy: o["proposed_by_bot_id"] === null ? null : { botId: String(o["proposed_by_bot_id"]), botName: name(String(o["proposed_by_bot_id"])) },
        editedByOwner: Number(o["edited_by_owner"]) === 1,
        views: mine,
        /** True when at least one bot supports it and at least one raised a concern, opposed it or preferred another: the owner should read both sides. */
        disagreement: mine.some((v) => v.stance === "support") && against.length > 0,
      };
    });
    return {
      ...this.summary(r),
      project: r["project_id"] ? ((): ProjectView | null => { try { return this.d.projects.get(String(r["project_id"])); } catch { return null; } })() : null,
      options,
      participants: this.all("SELECT * FROM decision_participants WHERE decision_id = ? ORDER BY rowid", id).map((p) => ({ botId: String(p["bot_id"]), botName: name(String(p["bot_id"])), reason: String(p["reason"]), addedBy: String(p["added_by"]) })),
      assignments: this.all("SELECT * FROM decision_assignments WHERE decision_id = ?", id).map((a) => ({
        botId: String(a["bot_id"]),
        botName: name(String(a["bot_id"])),
        duty: String(a["duty"]),
        startState: String(a["start_state"]),
        taskId: a["task_id"] === null ? null : String(a["task_id"]),
        stuck: String(a["start_state"]) === "starting",
      })),
      reports: this.all("SELECT * FROM decision_reports WHERE decision_id = ? ORDER BY id", id).map((p) => ({ id: Number(p["id"]), botId: String(p["bot_id"]), botName: name(String(p["bot_id"])), kind: String(p["kind"]), message: String(p["message"]), taskId: p["task_id"] === null ? null : String(p["task_id"]), createdAt: String(p["created_at"]) })),
      history: this.all("SELECT * FROM decision_revisions WHERE decision_id = ? ORDER BY id", id).map((h) => ({ id: Number(h["id"]), actor: String(h["actor"]), botId: h["bot_id"] === null ? null : String(h["bot_id"]), action: String(h["action"]), detail: JSON.parse(String(h["detail"])) as Record<string, unknown>, at: String(h["created_at"]) })),
    };
  }

  /** Runs the steps as one unit: all of them happen or none does. (A statement that fails inside it undoes the whole unit.) */
  private inTransaction<T>(fn: () => T): T {
    this.d.db.exec("BEGIN");
    try {
      const out = fn();
      this.d.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.d.db.exec("ROLLBACK");
      throw e;
    }
  }

  private requireStatus(id: string, ...allowed: string[]): Row {
    const r = this.one("SELECT * FROM decisions WHERE id = ?", id);
    if (!r) throw new AppError(404, "decision_not_found", "Decision not found");
    if (!allowed.includes(String(r["status"]))) throw new AppError(409, "wrong_state", `This decision is ${String(r["status"])}; that is not possible now.`);
    return r;
  }

  // ================================================================== 4. the owner edits, chooses, rejects (owner acts)
  setTitleOrNote(id: string, patch: { title?: string; ownerNote?: string }): void {
    const r = this.requireStatus(id, "open", "chosen", "rejected");
    const title = patch.title === undefined ? String(r["title"]) : patch.title.trim();
    if (title.length < 1 || title.length > DECISION_LIMITS.title) throw new AppError(400, "bad_title", `The title needs 1 to ${DECISION_LIMITS.title} characters.`);
    const note = patch.ownerNote === undefined ? String(r["owner_note"]) : patch.ownerNote.trim();
    if (note.length > 4000) throw new AppError(400, "bad_note", "The note is too long.");
    this.d.db.prepare("UPDATE decisions SET title = ?, owner_note = ?, updated_at = ? WHERE id = ?").run(title, note, this.iso(), id);
  }

  addOption(id: string, input: OptionInput): string {
    this.requireStatus(id, "open", "chosen");
    const o = optionInput.parse(input);
    const next = Number(this.one("SELECT COALESCE(MAX(position), 0) + 1 AS n FROM decision_options WHERE decision_id = ?", id)!["n"]);
    if (next > DECISION_LIMITS.options) throw new AppError(409, "too_many_options", `A decision can have at most ${DECISION_LIMITS.options} options.`);
    const oid = randomUUID();
    const at = this.iso();
    this.d.db.prepare("INSERT INTO decision_options (id, decision_id, position, title, details, pros, cons, edited_by_owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)").run(oid, id, next, o.title, o.details, o.pros, o.cons, at, at);
    return oid;
  }

  editOption(id: string, optionId: string, patch: Partial<OptionInput>): void {
    this.requireStatus(id, "open", "chosen");
    const cur = this.one("SELECT * FROM decision_options WHERE id = ? AND decision_id = ? AND removed_at IS NULL", optionId, id);
    if (!cur) throw new AppError(404, "option_not_found", "Option not found");
    const o = optionInput.parse({ title: patch.title ?? cur["title"], details: patch.details ?? cur["details"], pros: patch.pros ?? cur["pros"], cons: patch.cons ?? cur["cons"] });
    this.d.db.prepare("UPDATE decision_options SET title = ?, details = ?, pros = ?, cons = ?, edited_by_owner = 1, updated_at = ? WHERE id = ?").run(o.title, o.details, o.pros, o.cons, this.iso(), optionId);
  }

  removeOption(id: string, optionId: string): void {
    const r = this.requireStatus(id, "open", "chosen");
    if (String(r["chosen_option_id"]) === optionId) throw new AppError(409, "option_is_chosen", "Clear your choice first, then remove the option.");
    const remaining = Number(this.one("SELECT COUNT(*) AS n FROM decision_options WHERE decision_id = ? AND removed_at IS NULL", id)!["n"]);
    if (remaining <= 2) throw new AppError(409, "too_few_options", "A decision needs at least two options.");
    const res = this.d.db.prepare("UPDATE decision_options SET removed_at = ?, edited_by_owner = 1, updated_at = ? WHERE id = ? AND decision_id = ? AND removed_at IS NULL").run(this.iso(), this.iso(), optionId, id);
    if (Number(res.changes) === 0) throw new AppError(404, "option_not_found", "Option not found");
  }

  /** The owner picks an option (or clears the choice with null). Never done by a bot: there is no path from a bot to here. */
  choose(id: string, optionId: string | null, note?: string): void {
    this.requireStatus(id, "open", "chosen");
    const at = this.iso();
    if (optionId === null) {
      this.d.db.prepare("UPDATE decisions SET chosen_option_id = NULL, chosen_by = NULL, status = 'open', updated_at = ? WHERE id = ?").run(at, id);
      return;
    }
    const ok = this.one("SELECT 1 FROM decision_options WHERE id = ? AND decision_id = ? AND removed_at IS NULL", optionId, id);
    if (!ok) throw new AppError(404, "option_not_found", "Option not found");
    this.d.db.prepare("UPDATE decisions SET chosen_option_id = ?, chosen_by = 'owner', status = 'chosen', owner_note = COALESCE(?, owner_note), updated_at = ? WHERE id = ?").run(optionId, note?.trim() ?? null, at, id);
    this.d.audit.record("decision.chosen", { id, optionId }, { actor: "owner" });
  }

  reject(id: string, note = ""): void {
    this.requireStatus(id, "open", "chosen");
    this.d.db.prepare("UPDATE decisions SET status = 'rejected', owner_note = ?, updated_at = ? WHERE id = ?").run(note.trim(), this.iso(), id);
    this.d.audit.record("decision.rejected", { id }, { actor: "owner" });
  }
  reopen(id: string): void {
    this.requireStatus(id, "rejected");
    this.d.db.prepare("UPDATE decisions SET status = 'open', chosen_option_id = NULL, chosen_by = NULL, updated_at = ? WHERE id = ?").run(this.iso(), id);
  }
  archive(id: string): void {
    const r = this.one("SELECT status FROM decisions WHERE id = ?", id);
    if (!r) throw new AppError(404, "decision_not_found", "Decision not found");
    if (String(r["status"]) !== "archived") this.d.db.prepare("UPDATE decisions SET status = 'archived', updated_at = ? WHERE id = ?").run(this.iso(), id);
  }

  addParticipant(id: string, botId: string): void {
    this.requireStatus(id, "open", "chosen", "approved", "in_progress");
    const bot = this.d.getBot(botId);
    if (bot.archived) throw new AppError(409, "bot_not_available", "That bot is archived.");
    if (this.one("SELECT 1 FROM decision_participants WHERE decision_id = ? AND bot_id = ?", id, botId)) return;
    try {
      this.d.db.prepare("INSERT INTO decision_participants (decision_id, bot_id, reason, added_by, added_at) VALUES (?, ?, 'added by you', 'owner', ?)").run(id, botId, this.iso());
    } catch (e) {
      if (/At most 5/.test((e as Error).message)) throw new AppError(409, "too_many_bots", "At most 5 bots can take part in one decision.");
      throw e;
    }
  }

  // ================================================================== 5. constructive disagreement (owner-triggered rounds)
  /**
   * Each participating bot gives a reasoned view of every option from its own role. The owner starts each round (two at most), so bots never argue on
   * their own. Views can support, raise a concern, oppose, or prefer another option; they never change the decision. Bad or unreasoned answers are dropped.
   */
  async reviewRound(id: string): Promise<{ round: number; added: number; skipped: string[] }> {
    const r = this.requireStatus(id, "open", "chosen");
    const done = Number(this.one("SELECT COALESCE(MAX(round), 0) AS n FROM decision_views WHERE decision_id = ?", id)!["n"]);
    if (done >= DECISION_LIMITS.maxRounds) throw new AppError(409, "rounds_done", "Both review rounds have been done. The owner decides now.");
    const round = done + 1;
    const options = this.all("SELECT * FROM decision_options WHERE decision_id = ? AND removed_at IS NULL ORDER BY position", id);
    const byN = new Map(options.map((o, i) => [i + 1, o]));
    const nOf = new Map(options.map((o, i) => [String(o["id"]), i + 1]));
    const name = (botId: string | null) => (botId ? String(this.one("SELECT name FROM bots WHERE id = ?", botId)?.["name"] ?? "?") : "the owner");
    const forPrompt = options.map((o, i) => ({ n: i + 1, title: String(o["title"]), details: clip(String(o["details"]), 600), by: name(o["proposed_by_bot_id"] === null ? null : String(o["proposed_by_bot_id"])) }));
    const prior = this.all("SELECT * FROM decision_views WHERE decision_id = ? ORDER BY id", id).map((v) => ({ id: Number(v["id"]), by: name(String(v["bot_id"])), optionN: nOf.get(String(v["option_id"])) ?? 0, stance: String(v["stance"]), reasoning: clip(String(v["reasoning"]), 400) }));

    const viewAuthor = new Map(this.all("SELECT id, bot_id FROM decision_views WHERE decision_id = ?", id).map((v) => [Number(v["id"]), String(v["bot_id"])]));
    let added = 0;
    const skipped: string[] = [];
    for (const p of this.all("SELECT bot_id FROM decision_participants WHERE decision_id = ? ORDER BY rowid", id)) {
      const bot = this.d.getBot(String(p["bot_id"]));
      if (bot.archived || bot.status !== "active" || !bot.model) {
        skipped.push(`${bot.name}: switched off or no model`);
        continue;
      }
      try {
        const out = await this.d.complete({ botId: bot.id, conversationId: null, modelRef: bot.model, messages: reviewMessages(bot, String(r["question"]), forPrompt, round, round > 1 ? prior : []), contract: VIEWS_CONTRACT, temperature: 0.4, maxOutputTokens: Math.min(bot.maxOutputTokens ?? 1500, 1500) });
        const parsed = modelViews.safeParse(extractJson(out.text));
        if (!parsed.success) {
          skipped.push(`${bot.name}: answer not usable`);
          continue;
        }
        const seen = new Set<number>();
        for (const v of parsed.data.views) {
          const opt = byN.get(v.option);
          const stance = v.stance.trim().toLowerCase();
          const reasoning = v.reasoning.trim();
          if (!opt || seen.has(v.option) || !["support", "concern", "oppose", "alternative"].includes(stance) || reasoning.length < 20 || looksSecret(reasoning)) continue;
          let alt: string | null = null;
          if (stance === "alternative") {
            const a = v.prefer === undefined ? undefined : byN.get(v.prefer);
            if (!a || String(a["id"]) === String(opt["id"])) continue; // an alternative must name a different, existing option
            alt = String(a["id"]);
          }
          // Answers a colleague's view only if that view exists, is another bot's and belongs to this decision.
          const replyTo = v.replyTo && viewAuthor.has(v.replyTo) && viewAuthor.get(v.replyTo) !== bot.id ? v.replyTo : null;
          try {
            this.d.db.prepare("INSERT INTO decision_views (decision_id, option_id, bot_id, stance, reasoning, alternative_option_id, reply_to_view_id, round, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, String(opt["id"]), bot.id, stance, clip(reasoning, 2000), alt, replyTo, round, this.iso());
            seen.add(v.option);
            added++;
          } catch {
            /* a rule of the database refused it (for example replying to its own view): that one view is dropped */
          }
        }
      } catch (e) {
        skipped.push(`${bot.name}: ${clip((e as Error).message, 120)}`);
      }
    }
    this.d.audit.record("decision.review_round", { id, round, added }, { actor: "owner" });
    return { round, added, skipped };
  }

  // ================================================================== 6. approval: the owner turns the choice into a project and tasks
  /**
   * The owner approves the chosen option. Approving twice is refused (compare-and-set on the status), a project is created or linked, the work is
   * assigned, and each assigned bot's task is started ONCE through the normal task engine. Nothing is granted by approving: the tasks run under the same
   * permission, Guardian, limit and approval rules as any other task.
   */
  approve(id: string, input: { assignments?: { botId: string; duty: string }[]; projectId?: string | null; newProjectName?: string } = {}) {
    const r = this.requireStatus(id, "chosen");
    const optionId = String(r["chosen_option_id"]);
    const opt = this.one("SELECT * FROM decision_options WHERE id = ?", optionId)!;

    // Who does what: the owner's list, or by default the bots that proposed the chosen option.
    const plan = (input.assignments?.length ? input.assignments : opt["proposed_by_bot_id"] ? [{ botId: String(opt["proposed_by_bot_id"]), duty: `Carry out the chosen option: ${String(opt["title"])}.` }] : []).map((a) => ({ botId: a.botId, duty: a.duty.trim() }));
    const seen = new Set<string>();
    for (const a of plan) {
      if (a.duty.length < 1 || a.duty.length > 1000) throw new AppError(400, "bad_duty", "Each duty needs 1 to 1000 characters.");
      if (seen.has(a.botId)) throw new AppError(400, "duplicate_assignee", "A bot can be assigned once per decision.");
      seen.add(a.botId);
      const bot = this.d.getBot(a.botId);
      if (bot.archived) throw new AppError(409, "bot_not_available", `${bot.name} is archived.`);
    }
    if (input.projectId) this.d.projects.get(input.projectId);
    if (plan.length > 5) throw new AppError(400, "too_many_bots", "At most 5 bots can be assigned.");

    const at = this.iso();
    // One unit: the approval, the participants and the assignments happen together or not at all (a crash or a refused assignment cannot leave an approved decision with half its work).
    // Compare-and-set: only the call that finds the decision still "chosen" approves it. A second click, a retry or a second window gets a 409.
    this.inTransaction(() => {
      const res = this.d.db.prepare("UPDATE decisions SET status = 'approved', approved_by = 'owner', approved_at = ?, updated_at = ? WHERE id = ? AND status = 'chosen' AND chosen_option_id = ?").run(at, at, id, optionId);
      if (Number(res.changes) !== 1) throw new AppError(409, "already_approved", "This decision was already approved.");
      for (const a of plan) {
        this.addParticipant(id, a.botId);
        this.d.db.prepare("INSERT INTO decision_assignments (decision_id, bot_id, duty, created_at) VALUES (?, ?, ?, ?)").run(id, a.botId, a.duty, at);
      }
    });
    this.d.audit.record("decision.approved", { id, optionId, assignees: plan.length }, { actor: "owner" });

    // The project (linked or created). A failure here never undoes the approval; the owner can link a project afterwards.
    let projectId = input.projectId ?? (r["project_id"] ? String(r["project_id"]) : null);
    if (!projectId) {
      try {
        projectId = this.d.projects.create({ name: this.freeProjectName(input.newProjectName?.trim() || String(r["title"])), description: clip(String(r["question"]), 900), instructions: this.briefOf(String(r["title"]), opt, "") }).id;
      } catch {
        projectId = null;
      }
    }
    if (projectId) this.d.db.prepare("UPDATE decisions SET project_id = ?, updated_at = ? WHERE id = ?").run(projectId, this.iso(), id);

    const started = plan.map((a) => this.start(id, a.botId));
    return { decision: this.get(id), started };
  }

  /** Adds one more assignment to an approved decision (the owner's recovery and extension path), then starts that bot's task once. */
  assign(id: string, botId: string, duty: string): { botId: string; result: "started" | "not_started" | "already"; taskId?: string; reason?: string } {
    this.requireStatus(id, "approved", "in_progress");
    const text = duty.trim();
    if (text.length < 1 || text.length > 1000) throw new AppError(400, "bad_duty", "A duty needs 1 to 1000 characters.");
    if (this.d.getBot(botId).archived) throw new AppError(409, "bot_not_available", "That bot is archived.");
    if (this.one("SELECT 1 FROM decision_assignments WHERE decision_id = ? AND bot_id = ?", id, botId)) throw new AppError(409, "already_assigned", "That bot is already assigned to this decision.");
    this.inTransaction(() => {
      this.addParticipant(id, botId);
      this.d.db.prepare("INSERT INTO decision_assignments (decision_id, bot_id, duty, created_at) VALUES (?, ?, ?, ?)").run(id, botId, text, this.iso());
    });
    this.d.audit.record("decision.assigned", { id, botId }, { actor: "owner" });
    return this.start(id, botId);
  }

  private freeProjectName(base: string): string {
    const name = clip(base.trim(), 70) || "Decision";
    for (let i = 1; i < 50; i++) {
      const candidate = i === 1 ? name : `${name} (${i})`;
      if (!this.one("SELECT 1 FROM projects WHERE deleted_at IS NULL AND lower(name) = lower(?)", candidate)) return candidate;
    }
    return `${name} ${randomUUID().slice(0, 4)}`;
  }

  private briefOf(title: string, opt: Row, duty: string): string {
    return clip(`Decision approved by the owner: ${title}\nChosen option: ${String(opt["title"])}\n${String(opt["details"])}${duty ? `\n\nYour duty: ${duty}` : ""}`, DECISION_LIMITS.instructionChars);
  }

  /**
   * Starts the task for one assignment, once. Claim (not_started -> starting), create the task, record it (starting -> started). If the task cannot be
   * created the claim is released and the reason is returned, so the owner can fix it and press Start again. If the program dies in between, the claim
   * stays and a second task can never be created; `repair` then adopts the task that exists or releases the claim.
   */
  start(id: string, botId: string): { botId: string; result: "started" | "not_started" | "already"; taskId?: string; reason?: string } {
    const d = this.one("SELECT * FROM decisions WHERE id = ?", id);
    if (!d) throw new AppError(404, "decision_not_found", "Decision not found");
    const a = this.one("SELECT * FROM decision_assignments WHERE decision_id = ? AND bot_id = ?", id, botId);
    if (!a) throw new AppError(404, "assignment_not_found", "That bot is not assigned to this decision.");
    // Pressing Start again after it already started (even after the work finished) is harmless: it says so and creates nothing.
    if (String(a["start_state"]) !== "not_started") return { botId, result: "already", ...(a["task_id"] ? { taskId: String(a["task_id"]) } : {}) };
    if (!["approved", "in_progress"].includes(String(d["status"]))) throw new AppError(409, "wrong_state", "Work starts only for an approved decision.");
    const claim = this.d.db.prepare("UPDATE decision_assignments SET start_state = 'starting' WHERE decision_id = ? AND bot_id = ? AND start_state = 'not_started'").run(id, botId);
    if (Number(claim.changes) !== 1) return { botId, result: "already", ...(a["task_id"] ? { taskId: String(a["task_id"]) } : {}) };
    const opt = this.one("SELECT * FROM decision_options WHERE id = ?", String(d["chosen_option_id"]))!;
    try {
      const task = this.d.engine.submit(botId, this.briefOf(String(d["title"]), opt, String(a["duty"])), { type: "user", id, label: `Decision: ${clip(String(d["title"]), 60)}` });
      this.d.db.prepare("UPDATE decision_assignments SET start_state = 'started', task_id = ? WHERE decision_id = ? AND bot_id = ? AND start_state = 'starting'").run(task.id, id, botId);
      this.d.db.prepare("INSERT INTO decision_revisions (decision_id, actor, action, bot_id, detail, created_at) VALUES (?, 'system', 'started', ?, ?, ?)").run(id, botId, JSON.stringify({ task: task.id }), this.iso());
      this.d.db.prepare("UPDATE decisions SET status = 'in_progress', updated_at = ? WHERE id = ? AND status = 'approved'").run(this.iso(), id);
      return { botId, result: "started", taskId: task.id };
    } catch (e) {
      this.d.db.prepare("UPDATE decision_assignments SET start_state = 'not_started' WHERE decision_id = ? AND bot_id = ? AND start_state = 'starting'").run(id, botId);
      const reason = e instanceof Error ? clip(e.message, 300) : "The task could not be started.";
      this.d.db.prepare("INSERT INTO decision_revisions (decision_id, actor, action, bot_id, detail, created_at) VALUES (?, 'system', 'note', ?, ?, ?)").run(id, botId, JSON.stringify({ start_failed: reason }), this.iso());
      return { botId, result: "not_started", reason };
    }
  }

  /** For an assignment stuck in "starting" (the program stopped half way): adopt the task if one was created for it, otherwise release the claim. */
  repair(id: string, botId: string): { result: "adopted" | "released" | "nothing_to_repair"; taskId?: string } {
    const a = this.one("SELECT * FROM decision_assignments WHERE decision_id = ? AND bot_id = ?", id, botId);
    if (!a) throw new AppError(404, "assignment_not_found", "That bot is not assigned to this decision.");
    if (String(a["start_state"]) !== "starting") return { result: "nothing_to_repair" };
    const existing = this.one("SELECT id FROM tasks WHERE assignee_bot_id = ? AND origin_id = ? AND parent_id IS NULL ORDER BY created_at LIMIT 1", botId, id);
    if (existing) {
      this.d.db.prepare("UPDATE decision_assignments SET start_state = 'started', task_id = ? WHERE decision_id = ? AND bot_id = ? AND start_state = 'starting'").run(String(existing["id"]), id, botId);
      this.d.db.prepare("UPDATE decisions SET status = 'in_progress', updated_at = ? WHERE id = ? AND status = 'approved'").run(this.iso(), id);
      return { result: "adopted", taskId: String(existing["id"]) };
    }
    this.d.db.prepare("UPDATE decision_assignments SET start_state = 'not_started' WHERE decision_id = ? AND bot_id = ? AND start_state = 'starting'").run(id, botId);
    return { result: "released" };
  }

  // ================================================================== 7. reporting back (from real tasks only)
  /** Called when a task chain ends. If it is the task of an assignment, that bot's report is written ONCE (done or blocked), from the task's own result. */
  onRootFinished(task: TaskRecord): void {
    const a = this.one("SELECT decision_id, bot_id FROM decision_assignments WHERE task_id = ?", task.id);
    if (!a || (task.status !== "completed" && task.status !== "failed")) return;
    const id = String(a["decision_id"]);
    const kind = task.status === "completed" ? "done" : "blocked";
    const message = clip(task.status === "completed" ? task.result?.trim() || "(The task finished without a written result.)" : `The task did not finish: ${task.errorMessage ?? "unknown reason"}`, 8000);
    try {
      this.d.db.prepare("INSERT INTO decision_reports (decision_id, bot_id, kind, message, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, String(a["bot_id"]), kind, message, task.id, this.iso());
    } catch {
      return; // already reported for this task and kind (or a rule of the database refused): nothing is written twice
    }
    const open = Number(this.one("SELECT COUNT(*) AS n FROM decision_assignments a WHERE a.decision_id = ? AND NOT EXISTS (SELECT 1 FROM decision_reports r WHERE r.decision_id = a.decision_id AND r.bot_id = a.bot_id AND r.kind = 'done')", id)!["n"]);
    if (open === 0) this.d.db.prepare("UPDATE decisions SET status = 'done', updated_at = ? WHERE id = ? AND status IN ('approved','in_progress')").run(this.iso(), id);
  }
}
