import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const MIGRATIONS = fileURLToPath(new URL("./migrations/", import.meta.url));
let dir: string | null = null;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

/** Builds a database exactly as the Phase 1 app left it, with a bot that has history and permissions. */
function makePhase1Database(path: string): void {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(readFileSync(join(MIGRATIONS, "001_init.sql"), "utf8"));
  db.exec("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  db.prepare("INSERT INTO schema_migrations VALUES ('001_init.sql', ?)").run("2026-11-03T00:00:00Z");

  const now = "2026-11-03T18:35:00.000Z";
  db.prepare(
    `INSERT INTO bots (id, name, role, personality, instructions, responsibilities, runtime, model, status, current_version, archived, created_at, updated_at)
     VALUES ('b1', 'carlo', 'Helper', 'Kind', 'Be useful', '["Answer questions"]', 'builtin', NULL, 'paused', 2, 0, ?, ?)`,
  ).run(now, now);
  const version = db.prepare(
    `INSERT INTO bot_versions (bot_id, version, name, role, personality, instructions, responsibilities, runtime, model, change_note, restored_from, created_at)
     VALUES ('b1', ?, 'carlo', 'Helper', 'Kind', ?, '["Answer questions"]', 'builtin', NULL, ?, NULL, ?)`,
  );
  version.run(1, "Be nice", "Created", now);
  version.run(2, "Be useful", "Second draft", now);
  for (const connector of ["gmail", "telegram", "browser"]) {
    db.prepare("INSERT INTO bot_permissions (bot_id, connector, read_enabled, updated_at) VALUES ('b1', ?, ?, ?)").run(
      connector,
      connector === "gmail" ? 1 : 0,
      now,
    );
  }
  db.prepare(
    "INSERT INTO permission_audit (bot_id, connector, field, old_value, new_value, created_at) VALUES ('b1', 'gmail', 'read_enabled', 0, 1, ?)",
  ).run(now);
  db.close();
}

describe("upgrading a database created by Phase 1", () => {
  it("adds the new tables and columns and keeps every existing bot, version, permission and log entry", () => {
    dir = mkdtempSync(join(tmpdir(), "awp-upgrade-"));
    const path = join(dir, "old.db");
    makePhase1Database(path);

    const db = openDatabase(path); // applies 002 and 003
    const migrations = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((r: any) => r["version"]);
    expect(migrations).toEqual(["001_init.sql", "002_llm.sql", "003_chat.sql", "004_delegation.sql", "005_automation.sql", "006_approvals_vault.sql", "007_devices.sql", "008_owner_free_models.sql", "009_inbound.sql", "010_push.sql", "011_manager.sql", "012_skills_tools.sql", "013_pc_agent.sql", "014_workflows.sql"]);

    // The bot is exactly as it was, with new settings empty (meaning "use the defaults").
    const bot = db.prepare("SELECT * FROM bots WHERE id = 'b1'").get() as any;
    expect(bot).toMatchObject({
      name: "carlo",
      role: "Helper",
      personality: "Kind",
      instructions: "Be useful",
      status: "paused",
      current_version: 2,
      archived: 0,
      model: null,
      temperature: null,
      max_output_tokens: null,
    });

    const versions = db.prepare("SELECT version, instructions, temperature, max_output_tokens FROM bot_versions ORDER BY version").all() as any[];
    expect(versions.map((v) => [v.version, v.instructions, v.temperature, v.max_output_tokens])).toEqual([
      [1, "Be nice", null, null],
      [2, "Be useful", null, null],
    ]);

    const permissions = db.prepare("SELECT connector, read_enabled, write_policy FROM bot_permissions ORDER BY connector").all() as any[];
    expect(permissions.map((p) => [p.connector, p.read_enabled, p.write_policy])).toEqual([
      ["browser", 0, "approval_required"],
      ["gmail", 1, "approval_required"],
      ["telegram", 0, "approval_required"],
    ]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM permission_audit").get() as any).n).toBe(1);

    // New safety rules apply to the old data too.
    expect(() => db.prepare("UPDATE bots SET temperature = 5 WHERE id = 'b1'").run()).toThrow();
    expect(() => db.prepare("UPDATE bots SET max_output_tokens = 99999 WHERE id = 'b1'").run()).toThrow();
    expect(() => db.prepare("UPDATE bots SET temperature = 1.0, max_output_tokens = 200 WHERE id = 'b1'").run()).not.toThrow();
    db.close();
  });

  it("is safe to open again: nothing is applied twice and nothing changes", () => {
    dir = mkdtempSync(join(tmpdir(), "awp-upgrade-"));
    const path = join(dir, "old.db");
    makePhase1Database(path);
    openDatabase(path).close();
    const again = openDatabase(path);
    expect((again.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as any).n).toBe(14);
    expect((again.prepare("SELECT COUNT(*) AS n FROM bots").get() as any).n).toBe(1);
    expect((again.prepare("SELECT COUNT(*) AS n FROM bot_versions").get() as any).n).toBe(2);
    again.close();
  });
});
