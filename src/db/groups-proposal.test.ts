import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { backupDatabase } from "../backup/backup.js";
import { openDatabase } from "./database.js";

/**
 * Tests of the group-chat migration 017_groups, revision 2. Approved by the owner on 2026-11-04 (board P-19 / D-047) and copied UNCHANGED from
 * docs/proposals/017_groups.sql to src/db/migrations/017_groups.sql (the first tests prove the copy is byte-identical). They run ONLY on throw-away
 * databases (in memory or in a temporary folder). `openAt016` builds a database exactly as the runner leaves it after 016, so the 017 step can be
 * tested on its own; `applyLikeRunner` repeats exactly what src/db/database.ts does for one migration file (BEGIN, exec, record, COMMIT / ROLLBACK).
 */
const PROPOSAL = fileURLToPath(new URL("../../docs/proposals/017_groups.sql", import.meta.url));
const ROLLBACK = fileURLToPath(new URL("../../docs/proposals/017_groups_rollback.sql", import.meta.url));
const ROLLBACK_DATA = fileURLToPath(new URL("../../docs/proposals/017_groups_rollback_with_data.sql", import.meta.url));
const MIGRATIONS = fileURLToPath(new URL("./migrations/", import.meta.url));
const MIGRATION_017 = join(MIGRATIONS, "017_groups.sql");
const SRC = fileURLToPath(new URL("../", import.meta.url));
const sql = readFileSync(MIGRATION_017, "utf8");
const rollback = readFileSync(ROLLBACK, "utf8");
const rollbackData = readFileSync(ROLLBACK_DATA, "utf8");
const NEW = ["bot_groups", "group_members", "group_messages", "group_messages_fts", "group_message_mentions", "group_memory", "group_events"];
const T = "2026-11-04T00:00:00Z";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function applyLikeRunner(db: DatabaseSync, text: string, version = "017_groups.sql"): void {
  db.exec("BEGIN");
  try {
    db.exec(text);
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw new Error(`Migration ${version} failed: ${(err as Error).message}`);
  }
}
/** A database at version 016 (before groups), built exactly as the runner builds it. */
function openAt016(path = ":memory:"): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql") && f < "017").sort()) applyLikeRunner(db, readFileSync(join(MIGRATIONS, f), "utf8"), f);
  return db;
}
const objects = (db: DatabaseSync) =>
  db.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all().map((r) => `${String(r["type"])}:${String(r["name"])}`);
const isNew = (name: string) => NEW.some((n) => name === n || name.startsWith(n + "_")) || /^(idx_|uq_|trg_)(bot_groups|group_)/.test(name);
/** Objects added by the later migration 018_inbox (empty tables), which the real runner also applies to a 016 database. */
const isNewOrLater = (name: string) => isNew(name) || /^(idx_|uq_|trg_)?(inbox_|projects|project_items|decision)/.test(name);
/** A checksum of every row of every pre-existing table, so "nothing else changed" is proven, not assumed. */
function fingerprint(db: DatabaseSync): string {
  const h = createHash("sha256");
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => String(r["name"]));
  for (const name of names) {
    if (isNewOrLater(name) || name === "schema_migrations" || /_fts(_|$)/.test(name)) continue;
    h.update(name).update(JSON.stringify(db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()));
  }
  return h.digest("hex");
}
function seed(db: DatabaseSync): void {
  db.exec(`INSERT INTO bots (id, name, status, created_at, updated_at) VALUES ('b1','Researcher','active','${T}','${T}'),('b2','Writer','disabled','${T}','${T}'),('b3','Outsider','disabled','${T}','${T}'),('b4','Watcher','disabled','${T}','${T}')`);
  db.exec(`INSERT INTO bot_permissions (bot_id, connector, read_enabled, write_policy, updated_at) VALUES ('b1','gmail',1,'approval_required','${T}')`);
  db.exec(`INSERT INTO conversations (id, bot_id, title, created_at) VALUES ('c1','b1','Chat','${T}')`);
  db.exec(`INSERT INTO tasks (id, root_id, assignee_bot_id, requested_by, instruction, depth, status, created_at) VALUES ('t1','t1','b1','user','Do it',0,'completed','${T}')`);
  db.exec(`INSERT INTO memory_notes (id, scope, bot_id, title, content, source, created_at, updated_at) VALUES ('m1','bot','b1','Note','Private','owner','${T}','${T}')`);
  db.exec(`INSERT INTO approval_requests (id, bot_id, connector, action, summary, args_json, args_hash, status, created_at, expires_at) VALUES ('ap1','b1','memory','remember','x','{}','h','executed','${T}','${T}')`);
}
/** A database with the proposal applied and a group g1 with members b1 (member), b2 (reviewer), b4 (observer); g2 empty. */
function withGroups(): DatabaseSync {
  const db = openAt016();
  seed(db);
  applyLikeRunner(db, sql);
  db.exec(`INSERT INTO bot_groups (id, name, created_at, updated_at) VALUES ('g1','Team','${T}','${T}'),('g2','Other','${T}','${T}')`);
  db.exec(`INSERT INTO group_members (group_id, bot_id, role, added_at) VALUES ('g1','b1','member','${T}'),('g1','b2','reviewer','${T}'),('g1','b4','observer','${T}')`);
  return db;
}
const refuses = (db: DatabaseSync, stmt: string, why: RegExp) => expect(() => db.exec(stmt), stmt).toThrow(why);
const msg = (db: DatabaseSync, group: string, sender: string | null, extra: Record<string, string | number> = {}) => {
  const cols = { group_id: `'${group}'`, sender_kind: sender ? "'bot'" : "'user'", sender_bot_id: sender ? `'${sender}'` : "NULL", content: "'hello'", created_at: `'${T}'`, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, typeof v === "number" ? String(v) : `'${v}'`])) };
  db.exec(`INSERT INTO group_messages (${Object.keys(cols).join(",")}) VALUES (${Object.values(cols).join(",")})`);
  return Number(db.prepare("SELECT last_insert_rowid() AS id").get()!["id"]);
};

describe("0. revision 2 is the applied migration, and groups stay switched off", () => {
  it("src/db/migrations/017_groups.sql is a byte-identical copy of the approved revision 2, and a fresh app database has 017 applied (018 is the latest)", () => {
    expect(readFileSync(MIGRATION_017).equals(readFileSync(PROPOSAL))).toBe(true);
    expect(createHash("sha256").update(readFileSync(MIGRATION_017)).digest("hex")).toBe("d45d6dca7099d9de9a6ed0e958f3bffefa693963457350f48c95d6b10b915397");
    expect(sql).toMatch(/^-- PROPOSAL ONLY \(revision 2, 2026-11-04/);
    expect(readdirSync(MIGRATIONS).filter((f) => /group/.test(f))).toEqual(["017_groups.sql"]);
    expect(readdirSync(MIGRATIONS).sort().at(-1)).toBe("019_decisions.sql");
    expect(openDatabase(":memory:").prepare("SELECT version FROM schema_migrations WHERE version = '017_groups.sql'").get()?.["version"]).toBe("017_groups.sql");
  });
  it("the real runner applies 017 to a 016 database that holds data and changes nothing that existed", () => {
    const dir = mkdtempSync(join(tmpdir(), "awp-mig-"));
    dirs.push(dir);
    const file = join(dir, "data", "app.db");
    const old = openAt016(file);
    seed(old);
    const before = fingerprint(old);
    const beforeObjects = objects(old);
    old.close();
    const db = openDatabase(file); // the real runner (src/db/database.ts)
    expect(db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get()?.["version"]).toBe("019_decisions.sql");
    expect(fingerprint(db)).toBe(before);
    expect(beforeObjects.every((o) => objects(db).includes(o))).toBe(true);
    expect(objects(db).filter((o) => !beforeObjects.includes(o)).every((o) => isNewOrLater(o.split(":")[1]!))).toBe(true);
    expect(db.prepare("PRAGMA integrity_check").get()?.["integrity_check"]).toBe("ok");
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    for (const t of NEW.filter((t) => t !== "group_messages_fts")) expect(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()!["n"]).toBe(0);
    db.close();
  });
  it("no application code reads or writes the group tables yet (group messaging stays off until its service is built and tested)", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) files.push(p);
      }
    };
    walk(SRC);
    const users = files.filter((f) => /\b(bot_groups|group_members|group_messages|group_message_mentions|group_memory|group_events)\b/.test(readFileSync(f, "utf8")));
    expect(users.map((f) => relative(SRC, f))).toEqual([]);
  });
});

describe("1. foreign keys, constraints, indexes, data integrity", () => {
  it("is purely additive: every pre-existing row and definition is unchanged", () => {
    const db = openAt016();
    seed(db);
    const before = fingerprint(db);
    const beforeObjects = objects(db);
    applyLikeRunner(db, sql);
    expect(fingerprint(db)).toBe(before);
    expect(beforeObjects.every((o) => objects(db).includes(o))).toBe(true);
    expect(objects(db).filter((o) => !beforeObjects.includes(o)).every((o) => isNewOrLater(o.split(":")[1]!))).toBe(true);
  });
  it("has the planned columns and indexes, and the database enforces foreign keys and value rules", () => {
    const db = withGroups();
    const cols = (t: string) => db.prepare(`PRAGMA table_info(${t})`).all().map((r) => String(r["name"]));
    expect(cols("group_members")).toEqual(["group_id", "bot_id", "role", "added_at", "removed_at"]);
    expect(cols("group_messages")).toEqual(["id", "group_id", "sender_kind", "sender_bot_id", "visibility", "recipient_bot_id", "reply_to", "kind", "content", "attachments", "task_id", "provider_id", "model_id", "redacted_at", "created_at"]);
    for (const i of ["uq_group_members_active", "idx_group_members_bot", "idx_group_messages_group", "idx_group_messages_recipient", "idx_group_mentions_bot", "idx_group_events_task"]) expect(objects(db)).toContain(`index:${i}`);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    refuses(db, `INSERT INTO group_members (group_id, bot_id, added_at) VALUES ('g1','ghost','${T}')`, /FOREIGN KEY/);
    refuses(db, `INSERT INTO group_members (group_id, bot_id, added_at) VALUES ('nogroup','b3','${T}')`, /FOREIGN KEY/);
    refuses(db, `INSERT INTO bot_groups (id, name, participation_mode, created_at, updated_at) VALUES ('g9','X','everyone','${T}','${T}')`, /CHECK/);
    refuses(db, `INSERT INTO bot_groups (id, name, max_rounds, created_at, updated_at) VALUES ('g9','X',500,'${T}','${T}')`, /CHECK/);
    refuses(db, `INSERT INTO group_messages (group_id, sender_kind, content, attachments, created_at) VALUES ('g1','user','x','not json','${T}')`, /CHECK/);
    refuses(db, `INSERT INTO group_events (group_id, kind, created_at) VALUES ('g1','mystery','${T}')`, /CHECK/);
    refuses(db, `INSERT INTO group_events (group_id, kind, detail, created_at) VALUES ('g1','assign','[1]','${T}')`, /CHECK/);
    refuses(db, `INSERT INTO group_memory (id, group_id, title, content, source, created_at, updated_at) VALUES ('n1','g1','T','x','bot','${T}','${T}')`, /CHECK/); // a bot note needs the owner's approval
    db.exec(`INSERT INTO group_memory (id, group_id, title, content, source, approval_id, created_at, updated_at) VALUES ('n1','g1','T','x','bot','ap1','${T}','${T}')`);
    refuses(db, `INSERT INTO group_memory (id, group_id, title, content, source, approval_id, created_at, updated_at) VALUES ('n2','g1','T','x','bot','no-such-approval','${T}','${T}')`, /FOREIGN KEY/);
  });
  it("keeps the search index in step with the messages by itself, including when the owner blanks one", () => {
    const db = withGroups();
    const id = msg(db, "g1", "b1", { content: "quarterly budget figures" });
    const find = (w: string) => db.prepare("SELECT rowid FROM group_messages_fts WHERE group_messages_fts MATCH ?").all(w).map((r) => Number(r["rowid"]));
    expect(find("budget")).toEqual([id]);
    db.exec(`UPDATE group_messages SET content='[removed by the owner]', attachments='[]', redacted_at='${T}' WHERE id=${id}`);
    expect(find("budget")).toEqual([]);
    expect(db.prepare("INSERT INTO group_messages_fts (group_messages_fts) VALUES ('integrity-check')").run()).toBeTruthy();
  });
});

describe("2. group ownership and member-only access (what the schema can carry)", () => {
  it("records group, membership period and visibility so the service can show a bot only its groups' messages and its own direct messages", () => {
    const db = withGroups();
    msg(db, "g1", "b1");
    msg(db, "g1", "b1", { visibility: "direct", recipient_bot_id: "b2" });
    const visibleTo = (bot: string) =>
      db.prepare(`SELECT COUNT(*) AS n FROM group_messages msg JOIN group_members m ON m.group_id = msg.group_id AND m.bot_id = ? AND m.removed_at IS NULL
                  WHERE msg.visibility = 'group' OR msg.recipient_bot_id = ? OR msg.sender_bot_id = ?`).get(bot, bot, bot)!["n"];
    expect(visibleTo("b2")).toBe(2);
    expect(visibleTo("b4")).toBe(1); // the observer does not see b1's direct message to b2
    expect(visibleTo("b3")).toBe(0); // not a member: nothing
    refuses(db, `INSERT INTO group_messages (group_id, sender_kind, sender_bot_id, visibility, content, created_at) VALUES ('g1','bot','b1','direct','x','${T}')`, /CHECK/);
    refuses(db, `INSERT INTO group_messages (group_id, sender_kind, sender_bot_id, visibility, recipient_bot_id, content, created_at) VALUES ('g1','bot','b1','direct','b3','x','${T}')`, /active member/);
  });
});

describe("3. duplicate membership and invalid roles", () => {
  it("allows one active membership per bot and group, keeps history, and refuses unknown roles", () => {
    const db = withGroups();
    refuses(db, `INSERT INTO group_members (group_id, bot_id, added_at) VALUES ('g1','b1','2026-11-05T00:00:00Z')`, /UNIQUE/);
    refuses(db, `INSERT INTO group_members (group_id, bot_id, role, added_at) VALUES ('g1','b3','admin','${T}')`, /CHECK/);
    refuses(db, `INSERT INTO group_members (group_id, bot_id, added_at, removed_at) VALUES ('g1','b3','2026-11-05','2026-01-01')`, /CHECK/);
    db.exec(`UPDATE group_members SET removed_at='2026-11-05' WHERE group_id='g1' AND bot_id='b1'`);
    db.exec(`INSERT INTO group_members (group_id, bot_id, added_at) VALUES ('g1','b1','2026-11-06')`); // back again, as a new row
    expect(db.prepare("SELECT COUNT(*) AS n FROM group_members WHERE group_id='g1' AND bot_id='b1'").get()!["n"]).toBe(2);
    refuses(db, `UPDATE group_members SET removed_at=NULL WHERE group_id='g1' AND bot_id='b1' AND added_at='${T}'`, /stays removed/);
    refuses(db, `UPDATE group_members SET group_id='g2' WHERE bot_id='b2'`, /cannot be moved/);
    db.exec(`INSERT INTO group_members (group_id, bot_id, added_at) VALUES ('g2','b1','${T}')`); // the same bot in another group is fine
  });
  it("the coordinator is always an active, non-observer member", () => {
    const db = withGroups();
    refuses(db, `INSERT INTO bot_groups (id, name, coordinator_bot_id, created_at, updated_at) VALUES ('g9','X','b1','${T}','${T}')`, /member first/);
    refuses(db, `UPDATE bot_groups SET coordinator_bot_id='b3' WHERE id='g1'`, /active member/);
    refuses(db, `UPDATE bot_groups SET coordinator_bot_id='b4' WHERE id='g1'`, /not an observer/);
    db.exec(`UPDATE bot_groups SET coordinator_bot_id='b1' WHERE id='g1'`);
    refuses(db, `UPDATE group_members SET removed_at='2026-11-05' WHERE group_id='g1' AND bot_id='b1'`, /another coordinator/);
    refuses(db, `UPDATE group_members SET role='observer' WHERE group_id='g1' AND bot_id='b1'`, /another coordinator/);
    db.exec(`UPDATE bot_groups SET coordinator_bot_id=NULL WHERE id='g1'`);
    db.exec(`UPDATE group_members SET removed_at='2026-11-05' WHERE group_id='g1' AND bot_id='b1'`);
  });
});

describe("4. sender membership", () => {
  it("only active members post; observers, outsiders and removed bots cannot; mentions and replies stay inside the group", () => {
    const db = withGroups();
    const first = msg(db, "g1", "b1");
    refuses(db, `INSERT INTO group_messages (group_id, sender_kind, sender_bot_id, content, created_at) VALUES ('g1','bot','b3','x','${T}')`, /Only active members/);
    refuses(db, `INSERT INTO group_messages (group_id, sender_kind, sender_bot_id, content, created_at) VALUES ('g1','bot','b4','x','${T}')`, /not observers/);
    refuses(db, `INSERT INTO group_messages (group_id, sender_kind, content, created_at) VALUES ('g1','bot','x','${T}')`, /CHECK|Only active members/); // refused by whichever guard fires first
    refuses(db, `INSERT INTO group_messages (group_id, sender_kind, sender_bot_id, content, created_at) VALUES ('g1','user','b1','x','${T}')`, /CHECK/);
    db.exec(`UPDATE group_members SET removed_at='2026-11-05' WHERE group_id='g1' AND bot_id='b2'`);
    refuses(db, `INSERT INTO group_messages (group_id, sender_kind, sender_bot_id, content, created_at) VALUES ('g1','bot','b2','x','${T}')`, /Only active members/);
    db.exec(`INSERT INTO group_message_mentions (message_id, bot_id) VALUES (${first}, 'b4')`); // observers can be mentioned (asked to read)
    refuses(db, `INSERT INTO group_message_mentions (message_id, bot_id) VALUES (${first}, 'b3')`, /active member/);
    refuses(db, `INSERT INTO group_message_mentions (message_id, bot_id) VALUES (${first}, 'b4')`, /UNIQUE|PRIMARY/);
    const other = msg(db, "g2", null);
    refuses(db, `INSERT INTO group_messages (group_id, sender_kind, content, reply_to, created_at) VALUES ('g1','user','x',${other},'${T}')`, /same group/);
    refuses(db, `INSERT INTO group_events (group_id, kind, message_id, created_at) VALUES ('g1','assign',${other},'${T}')`, /same group/);
    refuses(db, `INSERT INTO group_events (group_id, kind, from_bot_id, to_bot_id, created_at) VALUES ('g1','assign','b1','b3','${T}')`, /belong/);
    db.exec(`INSERT INTO group_events (group_id, kind, from_bot_id, to_bot_id, task_id, message_id, created_at) VALUES ('g1','assign','b1','b2','t1',${first},'${T}')`); // b2 was removed but belonged: history allowed
    db.exec(`INSERT INTO group_events (group_id, kind, from_bot_id, created_at) VALUES ('g1','escalate','b1','${T}')`); // to the Manager AI: no bot
  });
});

describe("5. deletion and retention", () => {
  it("keeps groups, memberships, messages, mentions, notes and events; only the owner's one-time blanking of a message is possible", () => {
    const db = withGroups();
    const id = msg(db, "g1", "b1", { content: "my password is hunter2" });
    db.exec(`INSERT INTO group_message_mentions (message_id, bot_id) VALUES (${id}, 'b2')`);
    db.exec(`INSERT INTO group_events (group_id, kind, created_at) VALUES ('g1','paused','${T}')`);
    db.exec(`INSERT INTO group_memory (id, group_id, title, content, source, created_at, updated_at) VALUES ('n1','g1','T','x','owner','${T}','${T}')`);
    refuses(db, "DELETE FROM bot_groups WHERE id='g2'", /archived, never deleted/);
    refuses(db, "DELETE FROM group_members", /history is kept/);
    refuses(db, `DELETE FROM group_messages WHERE id=${id}`, /kept/);
    refuses(db, "DELETE FROM group_message_mentions", /kept conversation/);
    refuses(db, "DELETE FROM group_memory", /archived/);
    refuses(db, "DELETE FROM group_events", /append-only/);
    refuses(db, "UPDATE group_events SET kind='resumed'", /append-only/);
    refuses(db, `UPDATE group_messages SET content='rewritten' WHERE id=${id}`, /cannot be rewritten/);
    refuses(db, `UPDATE group_messages SET kind='summary' WHERE id=${id}`, /cannot be rewritten/);
    db.exec(`UPDATE group_messages SET content='[removed by the owner]', attachments='[]', redacted_at='${T}' WHERE id=${id}`);
    refuses(db, `UPDATE group_messages SET content='[removed by the owner]', redacted_at='2027-01-01' WHERE id=${id}`, /cannot be rewritten/);
    db.exec("UPDATE bot_groups SET archived=1 WHERE id='g2'");
    expect(db.prepare("SELECT COUNT(*) AS n FROM group_messages").get()!["n"]).toBe(1);
    // existing tables keep their own behaviour: the proposal adds no trigger to them
    db.exec("DELETE FROM bot_permissions WHERE bot_id='b1'");
  });
});

describe("6. rollback and group data", () => {
  it("the SAFE rollback refuses while any group data exists, and changes nothing", () => {
    const db = withGroups();
    const before = objects(db);
    db.exec("BEGIN");
    expect(() => db.exec(rollback)).toThrow(/group_rows_must_be_zero/);
    db.exec("ROLLBACK");
    expect(objects(db)).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM group_members").get()!["n"]).toBe(3);
  });
  it("the SAFE rollback on an unused migration restores the exact earlier database", () => {
    const db = openAt016();
    seed(db);
    const beforeObjects = objects(db);
    const before = fingerprint(db);
    applyLikeRunner(db, sql);
    db.exec("BEGIN");
    db.exec(rollback);
    db.exec("COMMIT");
    expect(objects(db)).toEqual(beforeObjects);
    expect(fingerprint(db)).toBe(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version='017_groups.sql'").get()!["n"]).toBe(0);
  });
  it("only the explicit with-data rollback removes group data, and nothing outside the group tables", () => {
    const db = withGroups();
    msg(db, "g1", "b1");
    const before = fingerprint(db);
    db.exec("BEGIN");
    db.exec(rollbackData);
    db.exec("COMMIT");
    expect(objects(db).some((o) => isNew(o.split(":")[1]!))).toBe(false);
    expect(fingerprint(db)).toBe(before);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

describe("7. backup integrity and restore reliability", () => {
  function fileDb() {
    const dir = mkdtempSync(join(tmpdir(), "awp-mig-"));
    dirs.push(dir);
    const file = join(dir, "data", "app.db");
    const db = openAt016(file);
    seed(db);
    return { dir, file, db };
  }
  it("`npm run backup` (VACUUM INTO) makes an intact copy while the app is running", () => {
    const { dir, file, db } = fileDb();
    const before = fingerprint(db);
    const b = backupDatabase(file, join(dir, "backups"));
    db.close();
    const copy = new DatabaseSync(join(b.folder, "app.db"));
    expect(String(copy.prepare("PRAGMA integrity_check").get()?.["integrity_check"])).toBe("ok");
    expect(fingerprint(copy)).toBe(before);
    copy.close();
  });
  it("restoring app.db while a newer -wal file is left behind corrupts it; the documented procedure (delete -wal and -shm first) restores exactly", () => {
    const { dir, file, db } = fileDb();
    const before = fingerprint(db);
    const b = backupDatabase(file, join(dir, "backups"));
    db.close();
    // the app runs again, the migration is applied and data changes; the process is then killed (WAL not checkpointed)
    const live = openDatabase(file); // the real runner applies 017
    live.exec(`UPDATE bots SET name='changed after the backup' WHERE id='b1'`);
    copyFileSync(file + "-wal", join(dir, "stale-wal"));
    live.close();
    copyFileSync(join(dir, "stale-wal"), file + "-wal");
    // WRONG: copy the backup over app.db only
    copyFileSync(join(b.folder, "app.db"), file);
    expect(() => {
      const r = new DatabaseSync(file);
      try {
        r.prepare("SELECT COUNT(*) FROM bots").get();
        if (String(r.prepare("PRAGMA integrity_check").get()?.["integrity_check"]) !== "ok") throw new Error("not ok");
      } finally {
        r.close();
      }
    }).toThrow();
    // RIGHT: delete the -wal and -shm files, then copy the backup
    for (const f of [file + "-wal", file + "-shm"]) if (existsSync(f)) unlinkSync(f);
    copyFileSync(join(b.folder, "app.db"), file);
    const restored = new DatabaseSync(file);
    expect(String(restored.prepare("PRAGMA integrity_check").get()?.["integrity_check"])).toBe("ok");
    expect(fingerprint(restored)).toBe(before);
    expect(objects(restored).some((o) => isNew(o.split(":")[1]!))).toBe(false);
    restored.close();
  });
});

describe("8. idempotency and partial failure (the runner's own transaction)", () => {
  it("a failure part-way through rolls everything back; the runner reports it and nothing is half-built", () => {
    const db = openAt016();
    seed(db);
    const beforeObjects = objects(db);
    const before = fingerprint(db);
    // fail AFTER most objects (including triggers and the FTS table) were created
    expect(() => applyLikeRunner(db, sql + "\nINSERT INTO no_such_table VALUES (1);")).toThrow(/Migration 017_groups.sql failed/);
    expect(objects(db)).toEqual(beforeObjects);
    expect(fingerprint(db)).toBe(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE version='017_groups.sql'").get()!["n"]).toBe(0);
  });
  it("a second application fails loudly and changes nothing (the runner never re-applies a recorded version anyway)", () => {
    const db = openAt016();
    applyLikeRunner(db, sql);
    const after = objects(db);
    expect(() => applyLikeRunner(db, sql, "017_groups_again.sql")).toThrow(/already exists/);
    expect(objects(db)).toEqual(after);
  });
  it("applies cleanly on top of a database that already holds data from every earlier migration", () => {
    const db = openAt016();
    seed(db);
    applyLikeRunner(db, sql);
    expect(db.prepare("PRAGMA integrity_check").get()?.["integrity_check"]).toBe("ok");
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

describe("9. compatibility with existing bots, tasks, permissions", () => {
  it("existing operations on bots, tasks, permissions and memory behave exactly as before after the migration", () => {
    const db = withGroups();
    db.exec(`UPDATE bots SET status='paused', archived=1 WHERE id='b1'`); // archiving a member bot still works
    db.exec(`INSERT INTO tasks (id, root_id, assignee_bot_id, requested_by, instruction, depth, status, created_at) VALUES ('t2','t2','b2','user','x',0,'pending','${T}')`);
    db.exec(`UPDATE tasks SET status='cancelled' WHERE id='t2'`);
    db.exec(`UPDATE bot_permissions SET read_enabled=0 WHERE bot_id='b1'`);
    db.exec(`INSERT INTO memory_notes (id, scope, title, content, source, created_at, updated_at) VALUES ('m2','shared','S','x','owner','${T}','${T}')`);
    msg(db, "g1", "b2", { task_id: "t2" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
