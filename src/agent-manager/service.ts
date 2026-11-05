import { randomUUID } from "node:crypto";
import type { AgentManagerRepository } from "./repository.js";
import type { CreateBotInput, UpdateBotInput } from "./schemas.js";
import {
  AppError,
  type BotContent,
  type BotRecord,
  type BotVersionRecord,
  type Connector,
  type PermissionAuditRecord,
  type PermissionRecord,
} from "./types.js";

/**
 * What a bot's status means (the owner's decision, 2026-11-04, replacing the Phase 1 lock):
 * - "active": the bot may run (chat, tasks, teammates, workflows, schedules, the Manager, inbound messages). It needs a model first.
 * - "paused" and "disabled": the bot does not run at all. New, duplicated, imported and archived bots are always "disabled".
 * Switching a bot on never grants a permission: connectors, folders, applications and approvals stay exactly as they were.
 */
export function runRefusal(bot: Pick<BotRecord, "name" | "status" | "archived">): string | null {
  if (bot.archived) return `${bot.name} is archived. Unarchive it and switch it on to let it run.`;
  if (bot.status === "paused") return `${bot.name} is paused. Switch it on (Details tab) to let it run.`;
  if (bot.status !== "active") return `${bot.name} is switched off. Switch it on (Details tab) to let it run.`;
  return null;
}

export interface BotWithPermissions extends BotRecord {
  permissions: PermissionRecord[];
}

function contentOf(bot: BotContent): BotContent {
  return {
    name: bot.name,
    role: bot.role,
    personality: bot.personality,
    instructions: bot.instructions,
    responsibilities: bot.responsibilities,
    runtime: bot.runtime,
    model: bot.model,
    temperature: bot.temperature,
    maxOutputTokens: bot.maxOutputTokens,
  };
}

function sameContent(a: BotContent, b: BotContent): boolean {
  return JSON.stringify(contentOf(a)) === JSON.stringify(contentOf(b));
}

/** Throws if a "provider/model" choice is not allowed (unknown model, or a blocked paid model). */
export type ModelValidator = (modelRef: string) => void;

export class AgentManagerService {
  constructor(
    private readonly repo: AgentManagerRepository,
    private readonly validateModel: ModelValidator = () => {},
    /** The model a new bot gets when none is chosen (automatic routing), or null. */
    private readonly defaultModel: () => string | null = () => null,
  ) {}

  private now(): string {
    return new Date().toISOString();
  }

  private mustGet(id: string): BotRecord {
    const bot = this.repo.getBot(id);
    if (!bot) throw new AppError(404, "bot_not_found", "Bot not found");
    return bot;
  }

  private mustBeEditable(bot: BotRecord): void {
    if (bot.archived) {
      throw new AppError(409, "bot_archived", "This bot is archived. Unarchive it first.");
    }
  }

  private withPermissions(bot: BotRecord): BotWithPermissions {
    return { ...bot, permissions: this.repo.getPermissions(bot.id) };
  }

  listBots(includeArchived: boolean): BotWithPermissions[] {
    return this.repo.listBots(includeArchived).map((b) => this.withPermissions(b));
  }

  getBot(id: string): BotWithPermissions {
    return this.withPermissions(this.mustGet(id));
  }

  /** New bots are always "disabled", with every external permission OFF. */
  createBot(input: CreateBotInput): BotWithPermissions {
    if (input.model) this.validateModel(input.model);
    const content: BotContent = {
      name: input.name,
      role: input.role ?? "",
      personality: input.personality ?? "",
      instructions: input.instructions ?? "",
      responsibilities: input.responsibilities ?? [],
      runtime: input.runtime ?? "builtin",
      model: input.model ?? this.defaultModel(),
      temperature: input.temperature ?? null,
      maxOutputTokens: input.maxOutputTokens ?? null,
    };
    const id = randomUUID();
    const now = this.now();
    this.repo.transaction(() => {
      this.repo.insertBot(id, content, now);
      this.repo.insertVersion(id, 1, content, input.changeNote ?? "Created", null, now);
      this.repo.insertDefaultPermissions(id, now);
    });
    return this.getBot(id);
  }

  /** Editing content adds a version. Changing only the status, or nothing, does not. */
  updateBot(id: string, input: UpdateBotInput): BotWithPermissions {
    const bot = this.mustGet(id);
    this.mustBeEditable(bot);

    // Only a NEW model choice is checked. A model that was valid when chosen, and has since
    // become unavailable, does not block unrelated edits (the chat explains the problem instead).
    if (input.model && input.model !== bot.model) this.validateModel(input.model);

    const next: BotContent = {
      name: input.name ?? bot.name,
      role: input.role ?? bot.role,
      personality: input.personality ?? bot.personality,
      instructions: input.instructions ?? bot.instructions,
      responsibilities: input.responsibilities ?? bot.responsibilities,
      runtime: input.runtime ?? bot.runtime,
      model: input.model !== undefined ? input.model : bot.model,
      temperature: input.temperature !== undefined ? input.temperature : bot.temperature,
      maxOutputTokens: input.maxOutputTokens !== undefined ? input.maxOutputTokens : bot.maxOutputTokens,
    };

    let nextStatus = input.status ?? bot.status;
    if (nextStatus === "active" && next.model === null) {
      if (input.status === "active") {
        throw new AppError(409, "model_required", "Choose a model for this bot first (Automatic is fine), then switch it on.");
      }
      nextStatus = "disabled"; // removing the model of a running bot switches it off: it could not answer anyway
    }

    const now = this.now();
    this.repo.transaction(() => {
      if (!sameContent(bot, next)) {
        const version = bot.currentVersion + 1;
        this.repo.updateBotContent(id, next, version, now);
        this.repo.insertVersion(id, version, next, input.changeNote ?? null, null, now);
      }
      if (nextStatus !== bot.status) {
        this.repo.setStatus(id, nextStatus, now);
      }
    });
    return this.getBot(id);
  }

  /** Null when the bot may run; otherwise the plain reason it may not. Unknown bots are refused too. */
  runRefusal(id: string): string | null {
    const bot = this.repo.getBot(id);
    return bot ? runRefusal(bot) : "That bot no longer exists.";
  }

  /** Throws a clear 409 when the bot may not run. Used where a run is requested (chat, a new task). */
  assertCanRun(id: string): void {
    const bot = this.mustGet(id);
    const reason = runRefusal(bot);
    if (reason) throw new AppError(409, "bot_not_active", reason);
  }

  archiveBot(id: string): BotWithPermissions {
    const bot = this.mustGet(id);
    if (!bot.archived) {
      // An archived bot must not be left in a runnable state.
      this.repo.transaction(() => {
        const now = this.now();
        this.repo.setArchived(id, true, now);
        if (bot.status !== "disabled") this.repo.setStatus(id, "disabled", now);
      });
    }
    return this.getBot(id);
  }

  unarchiveBot(id: string): BotWithPermissions {
    const bot = this.mustGet(id);
    if (bot.archived) this.repo.setArchived(id, false, this.now());
    return this.getBot(id);
  }

  /** A copy keeps the content only. It starts disabled with every permission OFF. */
  duplicateBot(id: string): BotWithPermissions {
    const source = this.mustGet(id);
    const copyName = `${source.name} (copy)`.slice(0, 80);
    const content: BotContent = { ...contentOf(source), name: copyName };
    const newId = randomUUID();
    const now = this.now();
    this.repo.transaction(() => {
      this.repo.insertBot(newId, content, now);
      this.repo.insertVersion(
        newId,
        1,
        content,
        `Duplicated from "${source.name}" (version ${source.currentVersion})`,
        null,
        now,
      );
      this.repo.insertDefaultPermissions(newId, now);
    });
    return this.getBot(newId);
  }

  listVersions(id: string): BotVersionRecord[] {
    this.mustGet(id);
    return this.repo.listVersions(id);
  }

  getVersion(id: string, version: number): BotVersionRecord {
    this.mustGet(id);
    const record = this.repo.getVersion(id, version);
    if (!record) throw new AppError(404, "version_not_found", "Version not found");
    return record;
  }

  /**
   * Restoring copies an old version's content into a NEW version (history is never rewritten).
   * It never changes permissions or status.
   */
  restoreVersion(id: string, version: number): BotWithPermissions {
    const bot = this.mustGet(id);
    this.mustBeEditable(bot);
    const old = this.getVersion(id, version);
    const content = contentOf(old);
    if (!sameContent(bot, content)) {
      const now = this.now();
      this.repo.transaction(() => {
        const newVersion = bot.currentVersion + 1;
        this.repo.updateBotContent(id, content, newVersion, now);
        this.repo.insertVersion(id, newVersion, content, `Restored from version ${version}`, version, now);
      });
    }
    return this.getBot(id);
  }

  getPermissions(id: string): PermissionRecord[] {
    this.mustGet(id);
    return this.repo.getPermissions(id);
  }

  /** Turns a connector's READ permission on or off for one bot, and logs the change. */
  setReadPermission(id: string, connector: Connector, readEnabled: boolean): PermissionRecord[] {
    const bot = this.mustGet(id);
    this.mustBeEditable(bot);
    const current = this.repo.getPermissions(id).find((p) => p.connector === connector);
    if (!current) throw new AppError(404, "permission_not_found", "Permission not found");
    if (current.readEnabled !== readEnabled) {
      const now = this.now();
      this.repo.transaction(() => {
        this.repo.setReadEnabled(id, connector, readEnabled, now);
        this.repo.insertAudit(id, connector, "read_enabled", current.readEnabled, readEnabled, now);
      });
    }
    return this.repo.getPermissions(id);
  }

  listAudit(id: string): PermissionAuditRecord[] {
    this.mustGet(id);
    return this.repo.listAudit(id);
  }
}
