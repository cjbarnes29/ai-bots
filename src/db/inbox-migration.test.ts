import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./database.js";

/**
 * Migration 018_inbox (revision 2). Approved by the owner on 2026-11-05 (board P-21). The file in src/db/migrations is an unchanged copy of
 * docs/proposals/018_inbox_rev2.sql, and the review in docs/MIGRATION-018-REVIEW.md describes exactly these seven tables.
 * No application code uses these tables yet: the service that does must keep the guarantees tested here and add its own tests.
 */
const PROPOSAL = fileURLToPath(new URL("../../docs/proposals/018_inbox_rev2.sql", import.meta.url));
const MIGRATION = fileURLToPath(new URL("./migrations/018_inbox.sql", import.meta.url));
const T = "2026-11-05T00:00:00Z";
const NEW = ["inbox_conversation_state", "inbox_message_meta", "inbox_preferences", "inbox_held_back", "projects", "project_items", "inbox_group_state"];

function seeded() {
  const db = openDatabase(":memory:");
  db.exec(`INSERT INTO bots (id, name, status, created_at, updated_at) VALUES ('b1','Researcher','active','${T}','${T}')`);
  db.exec(`INSERT INTO conversations (id, bot_id, title, created_at) VALUES ('c1','b1','Chat','${T}')`);
  db.exec(`INSERT INTO chat_messages (conversation_id, role, content, bot_version, created_at) VALUES ('c1','assistant','one',1,'${T}'),('c1','assistant','two',1,'${T}')`);
  return db;
}
const fails = (fn: () => unknown, re: RegExp) => expect(fn).toThrow(re);

describe("migration 018_inbox", () => {
  it("is an unchanged copy of the approved proposal and is recorded by the runner", () => {
    expect(readFileSync(MIGRATION, "utf8")).toBe(readFileSync(PROPOSAL, "utf8"));
    const db = openDatabase(":memory:");
    expect(db.prepare("SELECT version FROM schema_migrations WHERE version = '018_inbox.sql'").get()).toBeTruthy();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    for (const n of NEW) expect(tables).toContain(n);
  });

  it("creates only empty new tables and leaves the chat tables append-only and undeletable", () => {
    const db = seeded();
    for (const n of NEW) expect((db.prepare(`SELECT COUNT(*) AS n FROM ${n}`).get() as { n: number }).n).toBe(0);
    fails(() => db.exec("UPDATE chat_messages SET content = 'x'"), /append-only/);
    fails(() => db.exec("DELETE FROM conversations"), /cannot be deleted/);
  });

  it("one inbox message per real event and kind; unknown conversations and messages are refused", () => {
    const db = seeded();
    const meta = db.prepare("INSERT INTO inbox_message_meta (message_id, conversation_id, bot_id, initiated, kind, source_kind, source_id, created_at) VALUES (?, ?, 'b1', 1, ?, 'task', ?, ?)");
    meta.run(1, "c1", "task_result", "t1", T);
    fails(() => meta.run(2, "c1", "task_result", "t1", T), /UNIQUE/);
    meta.run(2, "c1", "task_failed", "t1", T);
    fails(() => meta.run(99, "c1", "report", "t2", T), /FOREIGN KEY/);
    fails(() => meta.run(1, "nope", "report", "t3", T), /FOREIGN KEY|UNIQUE/);
    fails(() => meta.run(1, "c1", "invented", "t4", T), /CHECK/);
  });

  it("stores unread, pin, mute, archive, hide and a rename without touching the original title", () => {
    const db = seeded();
    db.prepare("INSERT INTO inbox_conversation_state (conversation_id, title_override, pinned, muted, archived, hidden_at, last_read_message_id, updated_at) VALUES ('c1','Renamed',1,1,1,?,1,?)").run(T, T);
    const unread = db.prepare("SELECT COUNT(*) AS n FROM chat_messages m JOIN inbox_conversation_state s ON s.conversation_id = m.conversation_id WHERE m.id > s.last_read_message_id AND m.role = 'assistant'").get() as { n: number };
    expect(unread.n).toBe(1);
    expect((db.prepare("SELECT title FROM conversations WHERE id = 'c1'").get() as { title: string }).title).toBe("Chat");
    fails(() => db.prepare("UPDATE inbox_conversation_state SET pinned = 2").run(), /CHECK/);
  });

  it("notification preferences: one default row, one row per bot, hourly cap 1 to 60", () => {
    const db = seeded();
    const p = db.prepare("INSERT INTO inbox_preferences (bot_id, notify, max_per_hour, updated_at) VALUES (?, ?, ?, ?)");
    p.run(null, "important", 6, T);
    p.run("b1", "none", 3, T);
    fails(() => p.run(null, "all", 6, T), /UNIQUE/);
    fails(() => p.run("b1", "all", 6, T), /UNIQUE/);
    fails(() => db.prepare("INSERT INTO inbox_preferences (bot_id, notify, max_per_hour, updated_at) VALUES (NULL,'all',0,?)").run(T), /UNIQUE|CHECK/);
    fails(() => db.prepare("DELETE FROM inbox_preferences WHERE 0").run() && p.run("b1", "loud", 6, T), /CHECK|UNIQUE/);
    const plan = db.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM inbox_message_meta WHERE bot_id = 'b1' AND created_at > ?").all(T).map((r) => String((r as { detail: string }).detail)).join(" ");
    expect(plan).toMatch(/idx_inbox_meta_bot_time/);
  });

  it("projects: an item belongs to at most one project, names are limited, and the foreign keys hold", () => {
    const db = seeded();
    const proj = db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)");
    proj.run("p1", "Business", T, T);
    proj.run("p2", "Other", T, T);
    fails(() => proj.run("p3", "", T, T), /CHECK/);
    fails(() => proj.run("p4", "x".repeat(81), T, T), /CHECK/);
    const item = db.prepare("INSERT INTO project_items (project_id, item_kind, item_id, added_at) VALUES (?, ?, ?, ?)");
    item.run("p1", "conversation", "c1", T);
    fails(() => item.run("p2", "conversation", "c1", T), /UNIQUE/);
    fails(() => item.run("nope", "workflow", "w1", T), /FOREIGN KEY/);
    fails(() => item.run("p1", "bot", "b1", T), /CHECK/);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("group inbox state needs a real group", () => {
    const db = seeded();
    fails(() => db.prepare("INSERT INTO inbox_group_state (group_id, updated_at) VALUES ('nope', ?)").run(T), /FOREIGN KEY/);
    db.prepare("INSERT INTO bot_groups (id, name, created_at, updated_at) VALUES ('g1','Team',?,?)").run(T, T);
    db.prepare("INSERT INTO inbox_group_state (group_id, pinned, updated_at) VALUES ('g1',1,?)").run(T);
  });
});
