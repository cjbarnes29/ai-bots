import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { AuditLog } from "../audit/audit.js";
import { AppError } from "../errors.js";
import { redactSecrets } from "../llm/secrets.js";
import type { CompleteInput, CompleteOutput } from "../llm/service.js";
import type { ToolInfo } from "../tools/registry.js";

/**
 * The Skill Library (Stage 3). A skill is a named, reusable block of instructions (plus the tools it needs) that you can give to bots.
 *
 *  - Create, edit (every edit is a permanent new version), duplicate, archive, restore an old version, export, import, test, assign.
 *  - A skill is TEXT. It cannot run anything and cannot give a bot a tool: tool access is separate and stays with you.
 *  - Skills never hold secrets: anything that looks like a key, token or private key is refused.
 *  - Imported skills arrive switched OFF and unassigned, so you read them before they can reach any bot.
 *  - If a skill needs a tool that is not available, the bot is told so and must not claim it used that tool.
 */
export const SKILL_LIMITS = { maxSkills: 60, maxPerBot: 10, name: 60, description: 300, instructions: 6000, tools: 10, tags: 8, promptChars: 4000, testInput: 2000 };
export const EXPORT_FORMAT = "awp-skill@1";

const EXTRA_SECRET_PATTERNS = [/ya29\.[0-9A-Za-z_-]{20,}/, /GOCSPX-[0-9A-Za-z_-]{10,}/, /gh[pousr]_[0-9A-Za-z]{30,}/, /github_pat_[0-9A-Za-z_]{30,}/, /xox[abprs]-[0-9A-Za-z-]{10,}/, /AKIA[0-9A-Z]{16}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/];

export function containsSecret(text: string): boolean {
  return redactSecrets(text) !== text || EXTRA_SECRET_PATTERNS.some((p) => p.test(text));
}

const text = (max: number) => z.string().trim().max(max);
export const skillContentSchema = z.strictObject({
  name: text(SKILL_LIMITS.name).min(1),
  description: text(SKILL_LIMITS.description).default(""),
  instructions: text(SKILL_LIMITS.instructions).min(1),
  requiredTools: z.array(z.string().regex(/^[a-z0-9-]{2,40}$/)).max(SKILL_LIMITS.tools).default([]),
  tags: z.array(z.string().trim().min(1).max(30)).max(SKILL_LIMITS.tags).default([]),
});
export type SkillContent = z.infer<typeof skillContentSchema>;
// Not "partial()" of the content schema: that would apply the defaults (empty tags and tools) to fields the caller left out and wipe them.
export const skillUpdateSchema = z.strictObject({
  name: skillContentSchema.shape.name.optional(),
  description: text(SKILL_LIMITS.description).optional(),
  instructions: skillContentSchema.shape.instructions.optional(),
  requiredTools: z.array(z.string().regex(/^[a-z0-9-]{2,40}$/)).max(SKILL_LIMITS.tools).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(SKILL_LIMITS.tags).optional(),
  changeNote: text(200).optional(),
  enabled: z.boolean().optional(),
});
export const skillImportSchema = z.strictObject({
  format: z.literal(EXPORT_FORMAT),
  name: skillContentSchema.shape.name,
  description: skillContentSchema.shape.description,
  instructions: skillContentSchema.shape.instructions,
  requiredTools: skillContentSchema.shape.requiredTools,
  tags: skillContentSchema.shape.tags,
});

export interface SkillView extends SkillContent {
  id: string;
  enabled: boolean;
  archived: boolean;
  imported: boolean;
  version: number;
  updatedAt: string;
  /** Required tools that are not available right now, with the reason. */
  missingTools: { id: string; name: string; reason: string }[];
  assignedBots: string[];
}
export interface SkillVersionView extends SkillContent {
  version: number;
  changeNote: string | null;
  restoredFrom: number | null;
  createdAt: string;
}

export interface SkillDeps {
  db: DatabaseSync;
  audit: AuditLog;
  now: () => number;
  tools: () => Promise<ToolInfo[]>;
  toolIds: () => string[];
  complete: (input: CompleteInput) => Promise<CompleteOutput>;
  botExists: (id: string) => boolean;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}...` : s);

export class SkillService {
  constructor(private readonly d: SkillDeps) {}

  private iso(): string {
    return new Date(this.d.now()).toISOString();
  }

  private checkContent(c: SkillContent): void {
    if ([c.name, c.description, c.instructions, ...c.tags].some(containsSecret)) {
      throw new AppError(400, "skill_has_secret", "A skill must not contain keys, tokens or passwords. Remove them (secrets belong in the vault).");
    }
    const known = new Set(this.d.toolIds());
    const unknown = c.requiredTools.filter((t) => !known.has(t));
    if (unknown.length > 0) throw new AppError(400, "unknown_tool", `Unknown tool: ${unknown.join(", ")}.`);
  }

  private row(id: string): Record<string, unknown> {
    const r = this.d.db.prepare("SELECT * FROM skills WHERE id = ?").get(id);
    if (!r) throw new AppError(404, "skill_not_found", "That skill does not exist.");
    return r;
  }

  private versionRow(id: string, version: number): Record<string, unknown> {
    const v = this.d.db.prepare("SELECT * FROM skill_versions WHERE skill_id = ? AND version = ?").get(id, version);
    if (!v) throw new AppError(404, "version_not_found", "That version does not exist.");
    return v;
  }

  private contentOf(v: Record<string, unknown>): SkillContent {
    return {
      name: String(v["name"]),
      description: String(v["description"]),
      instructions: String(v["instructions"]),
      requiredTools: JSON.parse(String(v["required_tools"])) as string[],
      tags: JSON.parse(String(v["tags"])) as string[],
    };
  }

  private async toView(r: Record<string, unknown>, tools: ToolInfo[]): Promise<SkillView> {
    const id = String(r["id"]);
    const content = this.contentOf(this.versionRow(id, Number(r["current_version"])));
    const byId = new Map(tools.map((t) => [t.id, t]));
    return {
      ...content,
      id,
      enabled: Number(r["enabled"]) === 1,
      archived: Number(r["archived"]) === 1,
      imported: Number(r["imported"]) === 1,
      version: Number(r["current_version"]),
      updatedAt: String(r["updated_at"]),
      missingTools: content.requiredTools
        .map((t) => byId.get(t))
        .filter((t): t is ToolInfo => t !== undefined && t.status !== "available")
        .map((t) => ({ id: t.id, name: t.name, reason: t.detail })),
      assignedBots: this.d.db.prepare("SELECT bot_id FROM bot_skills WHERE skill_id = ?").all(id).map((x) => String(x["bot_id"])),
    };
  }

  async list(includeArchived = false): Promise<SkillView[]> {
    const tools = await this.d.tools();
    const rows = this.d.db.prepare(`SELECT * FROM skills ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY name`).all();
    return Promise.all(rows.map((r) => this.toView(r, tools)));
  }

  async get(id: string): Promise<SkillView & { versions: SkillVersionView[] }> {
    const r = this.row(id);
    const view = await this.toView(r, await this.d.tools());
    const versions = this.d.db
      .prepare("SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY version DESC")
      .all(id)
      .map((v): SkillVersionView => ({ ...this.contentOf(v), version: Number(v["version"]), changeNote: v["change_note"] === null ? null : String(v["change_note"]), restoredFrom: v["restored_from"] === null ? null : Number(v["restored_from"]), createdAt: String(v["created_at"]) }));
    return { ...view, versions };
  }

  private insertVersion(id: string, version: number, c: SkillContent, note: string | null, restoredFrom: number | null): void {
    this.d.db
      .prepare("INSERT INTO skill_versions (skill_id, version, name, description, instructions, required_tools, tags, change_note, restored_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, version, c.name, c.description, c.instructions, JSON.stringify(c.requiredTools), JSON.stringify(c.tags), note, restoredFrom, this.iso());
  }

  private uniqueName(name: string): string {
    const base = name.slice(0, SKILL_LIMITS.name);
    const taken = (n: string) => this.d.db.prepare("SELECT 1 AS x FROM skills WHERE name = ?").get(n) !== undefined;
    if (!taken(base)) return base;
    for (let i = 2; i < 100; i++) {
      const candidate = `${base.slice(0, SKILL_LIMITS.name - 5)} (${i})`;
      if (!taken(candidate)) return candidate;
    }
    throw new AppError(409, "name_taken", "A skill with that name already exists.");
  }

  async create(input: unknown, options: { imported?: boolean } = {}): Promise<SkillView> {
    const c = skillContentSchema.parse(input);
    this.checkContent(c);
    const count = Number((this.d.db.prepare("SELECT COUNT(*) AS n FROM skills").get() as { n: number }).n);
    if (count >= SKILL_LIMITS.maxSkills) throw new AppError(409, "too_many_skills", `At most ${SKILL_LIMITS.maxSkills} skills. Archive some you do not need.`);
    if (this.d.db.prepare("SELECT 1 AS x FROM skills WHERE name = ?").get(c.name)) throw new AppError(409, "name_taken", "A skill with that name already exists.");
    const id = randomUUID();
    const now = this.iso();
    this.d.db.prepare("INSERT INTO skills (id, name, enabled, imported, current_version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)").run(id, c.name, options.imported ? 0 : 1, options.imported ? 1 : 0, now, now);
    this.insertVersion(id, 1, c, options.imported ? "Imported" : "Created", null);
    this.d.audit.record(options.imported ? "skill.imported" : "skill.created", { id, name: c.name }, { actor: "owner" });
    return this.toView(this.row(id), await this.d.tools());
  }

  async update(id: string, input: unknown): Promise<SkillView> {
    const patch = skillUpdateSchema.parse(input);
    const r = this.row(id);
    if (Number(r["archived"]) === 1) throw new AppError(409, "skill_archived", "Restore this skill from the archive first.");
    const current = this.contentOf(this.versionRow(id, Number(r["current_version"])));
    const next: SkillContent = {
      name: patch.name ?? current.name,
      description: patch.description ?? current.description,
      instructions: patch.instructions ?? current.instructions,
      requiredTools: patch.requiredTools ?? current.requiredTools,
      tags: patch.tags ?? current.tags,
    };
    const changed = JSON.stringify(next) !== JSON.stringify(current);
    if (changed) {
      this.checkContent(next);
      if (next.name !== current.name && this.d.db.prepare("SELECT 1 AS x FROM skills WHERE name = ? AND id <> ?").get(next.name, id)) throw new AppError(409, "name_taken", "A skill with that name already exists.");
      const version = Number(r["current_version"]) + 1;
      this.insertVersion(id, version, next, patch.changeNote ?? null, null);
      this.d.db.prepare("UPDATE skills SET name = ?, current_version = ?, updated_at = ? WHERE id = ?").run(next.name, version, this.iso(), id);
      this.d.audit.record("skill.edited", { id, version }, { actor: "owner" });
    }
    if (patch.enabled !== undefined && patch.enabled !== (Number(r["enabled"]) === 1)) {
      this.d.db.prepare("UPDATE skills SET enabled = ?, updated_at = ? WHERE id = ?").run(patch.enabled ? 1 : 0, this.iso(), id);
      this.d.audit.record(patch.enabled ? "skill.enabled" : "skill.disabled", { id }, { actor: "owner" });
    }
    return this.toView(this.row(id), await this.d.tools());
  }

  async restoreVersion(id: string, version: number): Promise<SkillView> {
    const r = this.row(id);
    const old = this.contentOf(this.versionRow(id, version));
    this.checkContent(old);
    if (this.d.db.prepare("SELECT 1 AS x FROM skills WHERE name = ? AND id <> ?").get(old.name, id)) throw new AppError(409, "name_taken", "Another skill now uses that name.");
    const next = Number(r["current_version"]) + 1;
    this.insertVersion(id, next, old, `Restored version ${version}`, version);
    this.d.db.prepare("UPDATE skills SET name = ?, current_version = ?, updated_at = ? WHERE id = ?").run(old.name, next, this.iso(), id);
    this.d.audit.record("skill.restored", { id, from: version }, { actor: "owner" });
    return this.toView(this.row(id), await this.d.tools());
  }

  async duplicate(id: string): Promise<SkillView> {
    const c = this.contentOf(this.versionRow(id, Number(this.row(id)["current_version"])));
    return this.create({ ...c, name: this.uniqueName(`Copy of ${c.name}`) });
  }

  async setArchived(id: string, archived: boolean): Promise<SkillView> {
    this.row(id);
    this.d.db.prepare("UPDATE skills SET archived = ?, updated_at = ? WHERE id = ?").run(archived ? 1 : 0, this.iso(), id);
    if (archived) this.d.db.prepare("DELETE FROM bot_skills WHERE skill_id = ?").run(id);
    this.d.audit.record(archived ? "skill.archived" : "skill.unarchived", { id }, { actor: "owner" });
    return this.toView(this.row(id), await this.d.tools());
  }

  exportSkill(id: string): z.infer<typeof skillImportSchema> {
    const c = this.contentOf(this.versionRow(id, Number(this.row(id)["current_version"])));
    return { format: EXPORT_FORMAT, ...c };
  }

  /** Imported skills are OFF and given to nobody until you read them and switch them on. */
  async importSkill(raw: unknown): Promise<SkillView> {
    const parsed = skillImportSchema.safeParse(raw);
    if (!parsed.success) throw new AppError(400, "bad_skill_file", `This is not a valid skill file (expected format ${EXPORT_FORMAT}).`);
    const { format: _format, ...content } = parsed.data;
    void _format;
    return this.create({ ...content, name: this.uniqueName(content.name) }, { imported: true });
  }

  // ---------------- giving skills to bots ----------------
  assignedTo(botId: string): string[] {
    return this.d.db.prepare("SELECT skill_id FROM bot_skills WHERE bot_id = ?").all(botId).map((r) => String(r["skill_id"]));
  }

  setBotSkills(botId: string, skillIds: string[]): string[] {
    if (!this.d.botExists(botId)) throw new AppError(404, "bot_not_found", "Bot not found");
    const unique = [...new Set(skillIds)];
    if (unique.length > SKILL_LIMITS.maxPerBot) throw new AppError(400, "too_many_skills_for_bot", `A bot can have at most ${SKILL_LIMITS.maxPerBot} skills (they all add to its prompt).`);
    for (const id of unique) {
      const r = this.row(id);
      if (Number(r["archived"]) === 1) throw new AppError(409, "skill_archived", "An archived skill cannot be given to a bot.");
    }
    this.d.db.exec("BEGIN");
    try {
      this.d.db.prepare("DELETE FROM bot_skills WHERE bot_id = ?").run(botId);
      const ins = this.d.db.prepare("INSERT INTO bot_skills (bot_id, skill_id, assigned_at) VALUES (?, ?, ?)");
      for (const id of unique) ins.run(botId, id, this.iso());
      this.d.db.exec("COMMIT");
    } catch (e) {
      this.d.db.exec("ROLLBACK");
      throw e;
    }
    this.d.audit.record("bot.skills_changed", { skills: unique.length }, { actor: "owner", botId });
    return unique;
  }

  toolsOf(botId: string): string[] {
    return this.d.db.prepare("SELECT tool_id FROM bot_tools WHERE bot_id = ?").all(botId).map((r) => String(r["tool_id"]));
  }

  async setBotTools(botId: string, toolIds: string[]): Promise<string[]> {
    if (!this.d.botExists(botId)) throw new AppError(404, "bot_not_found", "Bot not found");
    const tools = await this.d.tools();
    const unique = [...new Set(toolIds)];
    for (const id of unique) {
      const t = tools.find((x) => x.id === id);
      if (!t) throw new AppError(400, "unknown_tool", `Unknown tool: ${id}.`);
      if (!t.requiresAssignment) throw new AppError(400, "not_assignable", `${t.name} is controlled by the bot's Permissions tab, not by tool access.`);
      if (t.status === "unavailable") throw new AppError(409, "tool_unavailable", `${t.name} is not available, so it cannot be given to a bot. ${t.detail}`);
    }
    this.d.db.exec("BEGIN");
    try {
      this.d.db.prepare("DELETE FROM bot_tools WHERE bot_id = ?").run(botId);
      const ins = this.d.db.prepare("INSERT INTO bot_tools (bot_id, tool_id, assigned_at) VALUES (?, ?, ?)");
      for (const id of unique) ins.run(botId, id, this.iso());
      this.d.db.exec("COMMIT");
    } catch (e) {
      this.d.db.exec("ROLLBACK");
      throw e;
    }
    this.d.audit.record("bot.tools_changed", { tools: unique }, { actor: "owner", botId });
    return unique;
  }

  /** Text added to a bot's instructions: its enabled, assigned skills, kept short. Empty when it has none. */
  async promptFor(botId: string): Promise<string> {
    const rows = this.d.db
      .prepare("SELECT s.id FROM skills s JOIN bot_skills b ON b.skill_id = s.id WHERE b.bot_id = ? AND s.enabled = 1 AND s.archived = 0 ORDER BY s.name")
      .all(botId);
    if (rows.length === 0) return "";
    const tools = await this.d.tools();
    const parts: string[] = [];
    let total = 0;
    for (const r of rows) {
      const view = await this.toView(this.row(String(r["id"])), tools);
      const note = view.missingTools.length > 0 ? `\n(This skill needs ${view.missingTools.map((m) => m.name).join(", ")}, which is NOT available. Do the parts you can in text and say plainly what you could not do. Never claim you used it.)` : "";
      const piece = `### ${view.name}\n${view.instructions}${note}`;
      if (total + piece.length > SKILL_LIMITS.promptChars) break;
      total += piece.length;
      parts.push(piece);
    }
    return parts.length === 0 ? "" : `Skills you have (follow them when they apply):\n${parts.join("\n\n")}`;
  }

  /** Tries a skill on a sample input with one limited, free-only model call. Reports honestly if tools it needs are missing. */
  async test(id: string, input: string, modelRef = "auto/general"): Promise<{ output: string; missingTools: SkillView["missingTools"]; modelCalls: 1; tokens: number; note: string | null }> {
    const view = await this.toView(this.row(id), await this.d.tools());
    const sample = input.trim();
    if (!sample) throw new AppError(400, "empty_test_input", "Type a sample request to try the skill on.");
    if (sample.length > SKILL_LIMITS.testInput) throw new AppError(413, "test_input_too_long", `Keep the sample under ${SKILL_LIMITS.testInput} characters.`);
    const out = await this.d.complete({
      botId: null,
      conversationId: null,
      modelRef,
      messages: [
        { role: "system", content: `You are testing a skill. Follow it exactly.\n\n### ${view.name}\n${view.instructions}\n\nYou have no tools. If the skill needs something you cannot do, say so plainly instead of pretending.` },
        { role: "user", content: sample },
      ],
      temperature: 0.3,
      maxOutputTokens: 800,
    });
    const note = view.missingTools.length > 0 ? `This skill needs ${view.missingTools.map((m) => m.name).join(", ")}, which is not available, so this test ran as text only.` : null;
    return { output: clip(out.text, 4000), missingTools: view.missingTools, modelCalls: 1, tokens: out.inputTokens + out.outputTokens, note };
  }
}
