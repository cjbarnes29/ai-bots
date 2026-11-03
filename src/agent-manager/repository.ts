import type { DatabaseSync } from "node:sqlite";
import {
  CONNECTORS,
  type BotContent,
  type BotRecord,
  type BotStatus,
  type BotVersionRecord,
  type Connector,
  type PermissionAuditRecord,
  type PermissionRecord,
  type Runtime,
} from "./types.js";

type Row = Record<string, unknown>;

function parseResponsibilities(json: unknown): string[] {
  const parsed: unknown = JSON.parse(String(json));
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

function toBot(r: Row): BotRecord {
  return {
    id: String(r["id"]),
    name: String(r["name"]),
    role: String(r["role"]),
    personality: String(r["personality"]),
    instructions: String(r["instructions"]),
    responsibilities: parseResponsibilities(r["responsibilities"]),
    runtime: String(r["runtime"]) as Runtime,
    model: r["model"] === null ? null : String(r["model"]),
    temperature: r["temperature"] === null || r["temperature"] === undefined ? null : Number(r["temperature"]),
    maxOutputTokens:
      r["max_output_tokens"] === null || r["max_output_tokens"] === undefined ? null : Number(r["max_output_tokens"]),
    status: String(r["status"]) as BotStatus,
    currentVersion: Number(r["current_version"]),
    archived: Number(r["archived"]) === 1,
    createdAt: String(r["created_at"]),
    updatedAt: String(r["updated_at"]),
  };
}

function toVersion(r: Row): BotVersionRecord {
  return {
    version: Number(r["version"]),
    name: String(r["name"]),
    role: String(r["role"]),
    personality: String(r["personality"]),
    instructions: String(r["instructions"]),
    responsibilities: parseResponsibilities(r["responsibilities"]),
    runtime: String(r["runtime"]) as Runtime,
    model: r["model"] === null ? null : String(r["model"]),
    temperature: r["temperature"] === null || r["temperature"] === undefined ? null : Number(r["temperature"]),
    maxOutputTokens:
      r["max_output_tokens"] === null || r["max_output_tokens"] === undefined ? null : Number(r["max_output_tokens"]),
    changeNote: r["change_note"] === null ? null : String(r["change_note"]),
    restoredFrom: r["restored_from"] === null ? null : Number(r["restored_from"]),
    createdAt: String(r["created_at"]),
  };
}

function toPermission(r: Row): PermissionRecord {
  return {
    connector: String(r["connector"]) as Connector,
    readEnabled: Number(r["read_enabled"]) === 1,
    writePolicy: "approval_required",
    updatedAt: String(r["updated_at"]),
  };
}

function toAudit(r: Row): PermissionAuditRecord {
  return {
    id: Number(r["id"]),
    connector: String(r["connector"]) as Connector,
    field: String(r["field"]),
    oldValue: Number(r["old_value"]) === 1,
    newValue: Number(r["new_value"]) === 1,
    actor: String(r["actor"]),
    createdAt: String(r["created_at"]),
  };
}

/** All SQL for the Agent Manager lives here. It contains no business rules. */
export class AgentManagerRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** Runs `fn` as one all-or-nothing database transaction. */
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  insertBot(id: string, c: BotContent, now: string): void {
    this.db
      .prepare(
        `INSERT INTO bots
           (id, name, role, personality, instructions, responsibilities, runtime, model,
            temperature, max_output_tokens,
            status, current_version, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'disabled', 1, 0, ?, ?)`,
      )
      .run(
        id,
        c.name,
        c.role,
        c.personality,
        c.instructions,
        JSON.stringify(c.responsibilities),
        c.runtime,
        c.model,
        c.temperature,
        c.maxOutputTokens,
        now,
        now,
      );
  }

  getBot(id: string): BotRecord | undefined {
    const row = this.db.prepare("SELECT * FROM bots WHERE id = ?").get(id);
    return row ? toBot(row) : undefined;
  }

  listBots(includeArchived: boolean): BotRecord[] {
    const sql = includeArchived
      ? "SELECT * FROM bots ORDER BY created_at, id"
      : "SELECT * FROM bots WHERE archived = 0 ORDER BY created_at, id";
    return this.db.prepare(sql).all().map(toBot);
  }

  updateBotContent(id: string, c: BotContent, version: number, now: string): void {
    this.db
      .prepare(
        `UPDATE bots SET name = ?, role = ?, personality = ?, instructions = ?,
           responsibilities = ?, runtime = ?, model = ?, temperature = ?, max_output_tokens = ?,
           current_version = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        c.name,
        c.role,
        c.personality,
        c.instructions,
        JSON.stringify(c.responsibilities),
        c.runtime,
        c.model,
        c.temperature,
        c.maxOutputTokens,
        version,
        now,
        id,
      );
  }

  setStatus(id: string, status: BotStatus, now: string): void {
    this.db.prepare("UPDATE bots SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
  }

  setArchived(id: string, archived: boolean, now: string): void {
    this.db
      .prepare("UPDATE bots SET archived = ?, updated_at = ? WHERE id = ?")
      .run(archived ? 1 : 0, now, id);
  }

  insertVersion(
    botId: string,
    version: number,
    c: BotContent,
    changeNote: string | null,
    restoredFrom: number | null,
    now: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO bot_versions
           (bot_id, version, name, role, personality, instructions, responsibilities,
            runtime, model, temperature, max_output_tokens, change_note, restored_from, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        botId,
        version,
        c.name,
        c.role,
        c.personality,
        c.instructions,
        JSON.stringify(c.responsibilities),
        c.runtime,
        c.model,
        c.temperature,
        c.maxOutputTokens,
        changeNote,
        restoredFrom,
        now,
      );
  }

  listVersions(botId: string): BotVersionRecord[] {
    return this.db
      .prepare("SELECT * FROM bot_versions WHERE bot_id = ? ORDER BY version DESC")
      .all(botId)
      .map(toVersion);
  }

  getVersion(botId: string, version: number): BotVersionRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM bot_versions WHERE bot_id = ? AND version = ?")
      .get(botId, version);
    return row ? toVersion(row) : undefined;
  }

  /** Creates the permission rows for a new bot. Reading starts OFF for every connector. */
  insertDefaultPermissions(botId: string, now: string): void {
    const stmt = this.db.prepare(
      "INSERT INTO bot_permissions (bot_id, connector, read_enabled, updated_at) VALUES (?, ?, 0, ?)",
    );
    for (const connector of CONNECTORS) {
      stmt.run(botId, connector, now);
    }
  }

  getPermissions(botId: string): PermissionRecord[] {
    return this.db
      .prepare("SELECT * FROM bot_permissions WHERE bot_id = ? ORDER BY connector")
      .all(botId)
      .map(toPermission);
  }

  setReadEnabled(botId: string, connector: Connector, value: boolean, now: string): void {
    this.db
      .prepare(
        "UPDATE bot_permissions SET read_enabled = ?, updated_at = ? WHERE bot_id = ? AND connector = ?",
      )
      .run(value ? 1 : 0, now, botId, connector);
  }

  insertAudit(
    botId: string,
    connector: Connector,
    field: string,
    oldValue: boolean,
    newValue: boolean,
    now: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO permission_audit (bot_id, connector, field, old_value, new_value, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(botId, connector, field, oldValue ? 1 : 0, newValue ? 1 : 0, now);
  }

  listAudit(botId: string): PermissionAuditRecord[] {
    return this.db
      .prepare("SELECT * FROM permission_audit WHERE bot_id = ? ORDER BY id DESC")
      .all(botId)
      .map(toAudit);
  }
}
