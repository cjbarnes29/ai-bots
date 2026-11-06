import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";

/** Migration 020 (Knowledge Center, chat attachments, assistant action log) only ADDS tables; a database with data keeps every row. */
const MIGRATIONS = fileURLToPath(new URL("./migrations/", import.meta.url));
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const NEW_TABLES = ["knowledge_collections", "knowledge_docs", "knowledge_text", "knowledge_chunks", "knowledge_fts", "chat_attachments", "chat_message_sources", "assistant_actions"];

describe("migration 020_knowledge", () => {
  it("is applied to a database that held data through 019, changes nothing that existed, and is safe to open again", () => {
    const dir = mkdtempSync(join(tmpdir(), "awp-020-"));
    dirs.push(dir);
    mkdirSync(join(dir, "data"));
    const file = join(dir, "data", "app.db");
    const old = new DatabaseSync(file);
    old.exec("PRAGMA foreign_keys = ON");
    old.exec("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql") && x <= "019_decisions.sql").sort()) {
      old.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
      old.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, 'x')").run(f);
    }
    old.exec("INSERT INTO bots (id, name, role, created_at, updated_at) VALUES ('b1', 'Old bot', 'kept', 'x', 'x')");
    old.exec("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p1', 'Old project', 'x', 'x')");
    const tables = (d: DatabaseSync) => (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name);
    const before = tables(old);
    expect(NEW_TABLES.some((t) => before.includes(t))).toBe(false);
    old.close();

    const db = openDatabase(file); // the real runner applies 020
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = '020_knowledge.sql'").get()).toBeTruthy();
    const after = tables(db);
    expect(before.every((t) => after.includes(t))).toBe(true); // nothing removed
    expect(NEW_TABLES.every((t) => after.includes(t))).toBe(true);
    expect(db.prepare("SELECT name, role FROM bots WHERE id = 'b1'").get()).toEqual({ name: "Old bot", role: "kept" });
    expect(db.prepare("SELECT name FROM projects WHERE id = 'p1'").get()).toEqual({ name: "Old project" });
    expect(db.prepare("PRAGMA integrity_check").get()?.["integrity_check"]).toBe("ok");
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    for (const t of NEW_TABLES.filter((x) => x !== "knowledge_fts")) expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).toEqual({ n: 0 });
    db.close();
    const again = openDatabase(file);
    expect(again.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version = '020_knowledge.sql'").get()).toEqual({ n: 1 });
    again.close();
  });

  it("enforces its own rules: a project document needs a project, scopes and statuses are limited", () => {
    const db = openDatabase(":memory:");
    const ins = (scope: string, status: string, project: string | null) =>
      db.prepare("INSERT INTO knowledge_docs (id, title, filename, mime, ext, size, sha256, status, scope, project_id, created_at, updated_at) VALUES (?, 't', 'f.txt', 'text/plain', 'txt', 1, 'h', ?, ?, ?, 'x', 'x')").run(Math.random().toString(36), status, scope, project);
    expect(() => ins("project", "ready", null)).toThrow();
    expect(() => ins("secret", "ready", null)).toThrow();
    expect(() => ins("global", "weird", null)).toThrow();
    expect(() => ins("global", "ready", null)).not.toThrow();
    expect(() => db.prepare("INSERT INTO assistant_actions (id, kind, level, status, target_kind, target_id, summary, created_at) VALUES ('a', 'k', 'root', 'applied', 't', 'i', 's', 'x')").run()).toThrow();
  });
});
