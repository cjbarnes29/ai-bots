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

/** Phase 1 has no way to run a bot, so a bot can never be set to "active". */
const ACTIVATION_AVAILABLE = false;

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
      model: input.model ?? null,
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

    if (input.status === "active" && !ACTIVATION_AVAILABLE) {
      throw new AppError(
        409,
        "activation_not_available",
        "Bots cannot be activated yet. Running bots arrives in Phase 2.",
      );
    }

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

    const now = this.now();
    this.repo.transaction(() => {
      if (!sameContent(bot, next)) {
        const version = bot.currentVersion + 1;
        this.repo.updateBotContent(id, next, version, now);
        this.repo.insertVersion(id, version, next, input.changeNote ?? null, null, now);
      }
      if (input.status !== undefined && input.status !== bot.status) {
        this.repo.setStatus(id, input.status, now);
      }
    });
    return this.getBot(id);
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
