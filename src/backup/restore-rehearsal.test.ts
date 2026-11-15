import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { AuditLog } from "../audit/audit.js";
import { openDatabase } from "../db/database.js";
import { VaultService } from "../vault/service.js";
import { WorkflowService } from "../workflows/service.js";
import { backupDatabase } from "./backup.js";

const BOT = "11111111-1111-4111-8111-111111111111";
const CHILD = "22222222-2222-4222-8222-222222222222";
const SAMPLE_NAME = "REHEARSAL_SAMPLE";
const SAMPLE_VALUE = "synthetic-only-recovery-sample";
const syntheticKey = () => Buffer.alloc(32, 11); // fixture bytes, never an owner key
const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const graph = {
  nodes: [{ id: "start", type: "trigger", kind: "manual", x: 0, y: 0 },
    { id: "act", type: "integration", botId: BOT, connector: "telegram", action: "write", args: { text: "synthetic" }, x: 100, y: 0 },
    { id: "end", type: "end", x: 200, y: 0 }],
  edges: [{ id: "a", from: "start", to: "act", when: "always" }, { id: "b", from: "act", to: "end", when: "always" }],
};

/** Logical content, not byte identity of VACUUM-compacted pages. Never print key/row contents. */
function fingerprint(db: DatabaseSync): string {
  const schema = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  const tables = db.prepare("SELECT name FROM pragma_table_list WHERE schema = 'main' AND type IN ('table','virtual') AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const content = tables.map(t => {
    const name = String(t["name"]);
    const rows = db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all().map(row => JSON.stringify(row, (_key, value: unknown) => value instanceof Uint8Array ? Buffer.from(value).toString("base64") : typeof value === "bigint" ? value.toString() : value)).sort();
    return { name, rows };
  });
  return digest(JSON.stringify({ schema, content }));
}

function integrity(db: DatabaseSync): void {
  expect(db.prepare("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
  expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
}

function relationships(db: DatabaseSync): void {
  expect(db.prepare("SELECT child.id, child.root_id, parent.id AS parent, b.name FROM tasks child JOIN tasks parent ON parent.id = child.parent_id JOIN bots b ON b.id = child.assignee_bot_id WHERE child.id = 'child'").get())
    .toMatchObject({ id: "child", root_id: "root", parent: "root", name: "Synthetic child" });
  expect(db.prepare("SELECT p.name, c.id, b.name AS helper FROM project_items pi JOIN projects p ON p.id = pi.project_id JOIN conversations c ON c.id = pi.item_id JOIN bots b ON b.id = c.bot_id WHERE pi.item_kind = 'conversation'").get())
    .toMatchObject({ name: "Synthetic project", id: "conversation", helper: "Synthetic helper" });
  expect(db.prepare("SELECT content FROM chat_messages WHERE conversation_id = 'conversation'").get()?.["content"]).toBe("مرحبا — synthetic café");
  expect(db.prepare("SELECT a.id, a.status, s.status AS step, r.status AS run, v.version FROM workflow_steps s JOIN approval_requests a ON a.id = s.ref_id JOIN workflow_runs r ON r.id = s.run_id JOIN workflow_versions v ON v.workflow_id = r.workflow_id AND v.version = r.workflow_version WHERE s.ref_kind = 'approval'").get())
    .toEqual({ id: "approval", status: "pending", step: "waiting", run: "waiting", version: 1 });
  expect(db.prepare("SELECT note_id FROM memory_fts WHERE memory_fts MATCH 'rehearsal'").all()).toEqual([{ note_id: "note" }]);
  expect(db.prepare("SELECT read_enabled, write_policy FROM bot_permissions WHERE bot_id = ?").get(BOT)).toEqual({ read_enabled: 0, write_policy: "approval_required" });
  expect(db.prepare("SELECT COUNT(*) AS n FROM task_events").get()?.["n"]).toBe(2);
}

describe("backup/restore rehearsal (synthetic scratch data only, no live DB/vault)", () => {
  let root: string;
  let source: string;
  let db: DatabaseSync;
  let serial: number;
  const opened = new Set<DatabaseSync>();
  const track = (connection: DatabaseSync) => { opened.add(connection); return connection; };
  const close = (connection: DatabaseSync) => { connection.close(); opened.delete(connection); };
  const vault = (connection: DatabaseSync, key = syntheticKey()) => new VaultService(connection, key, new AuditLog(connection), () => [{ name: SAMPLE_NAME, description: "Synthetic fixture" }]);
  const backup = () => backupDatabase(source, join(root, "backups"), new Date(2026, 0, 2, 3, 4, 5));
  const restore = (folder: string) => {
    const destination = join(root, `restore-${serial++}`);
    mkdirSync(destination);
    copyFileSync(join(folder, "app.db"), join(destination, "app.db"), constants.COPYFILE_EXCL);
    if (existsSync(join(folder, "vault.key"))) copyFileSync(join(folder, "vault.key"), join(destination, "vault.key"), constants.COPYFILE_EXCL);
    return destination;
  };
  const addSyntheticVault = () => {
    writeFileSync(join(root, "source 'quoted'", "vault.key"), syntheticKey(), { flag: "wx" });
    vault(db).set(SAMPLE_NAME, SAMPLE_VALUE);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "awp-restore-"));
    source = join(root, "source 'quoted'", "app.db");
    db = track(openDatabase(source));
    db.exec("PRAGMA wal_autocheckpoint = 0");
    serial = 0;
    for (const [id, name] of [[BOT, "Synthetic helper"], [CHILD, "Synthetic child"]]) db.prepare("INSERT INTO bots (id, name, created_at, updated_at) VALUES (?, ?, 't', 't')").run(id!, name!);
    db.prepare("INSERT INTO bot_versions (bot_id, version, name, role, personality, instructions, responsibilities, runtime, model, created_at) SELECT id, current_version, name, role, personality, instructions, responsibilities, runtime, model, created_at FROM bots").run();
    db.prepare("INSERT INTO bot_permissions (bot_id, connector, updated_at) VALUES (?, 'telegram', 't')").run(BOT);
    db.prepare("INSERT INTO projects (id, name, created_at, updated_at) VALUES ('project', 'Synthetic project', 't', 't')").run();
    db.prepare("INSERT INTO conversations (id, bot_id, title, created_at) VALUES ('conversation', ?, 'Synthetic chat', 't')").run(BOT);
    db.prepare("INSERT INTO chat_messages (conversation_id, role, content, bot_version, created_at) VALUES ('conversation', 'user', ?, 1, 't')").run("مرحبا — synthetic café");
    db.prepare("INSERT INTO tasks (id, root_id, assignee_bot_id, requested_by, instruction, depth, status, result, created_at) VALUES ('root', 'root', ?, 'user', 'Synthetic task', 0, 'completed', 'Synthetic result', 't')").run(BOT);
    db.prepare("INSERT INTO tasks (id, root_id, parent_id, assignee_bot_id, requested_by, instruction, depth, status, result, created_at) VALUES ('child', 'root', 'root', ?, ?, 'Synthetic child task', 1, 'completed', 'Synthetic child result', 't')").run(CHILD, BOT);
    for (const id of ["root", "child"]) db.prepare("INSERT INTO task_events (task_id, root_id, kind, detail, created_at) VALUES (?, 'root', 'completed', '{}', 't')").run(id);
    const savedGraph = JSON.stringify(graph);
    db.prepare("INSERT INTO workflows (id, name, version, graph, created_at, updated_at) VALUES ('workflow', 'Synthetic workflow', 1, ?, 't', 't')").run(savedGraph);
    db.prepare("INSERT INTO workflow_versions (workflow_id, version, graph, created_at) VALUES ('workflow', 1, ?, 't')").run(savedGraph);
    db.prepare("INSERT INTO workflow_runs (id, workflow_id, workflow_version, graph, status, trigger, created_at) VALUES ('run', 'workflow', 1, ?, 'waiting', 'manual', 't')").run(savedGraph);
    const args = JSON.stringify({ text: "synthetic" });
    db.prepare("INSERT INTO approval_requests (id, bot_id, connector, action, summary, args_json, args_hash, status, created_at, expires_at) VALUES ('approval', ?, 'telegram', 'write', 'Synthetic request', ?, ?, 'pending', 't', '2050-01-01T00:00:00.000Z')").run(BOT, args, digest(args));
    db.prepare("INSERT INTO workflow_steps (run_id, node_id, status) VALUES ('run', 'start', 'completed'), ('run', 'end', 'pending')").run();
    db.prepare("INSERT INTO workflow_steps (run_id, node_id, status, ref_kind, ref_id, attempts) VALUES ('run', 'act', 'waiting', 'approval', 'approval', 1)").run();
    db.prepare("INSERT INTO memory_notes (id, scope, title, content, source, created_at, updated_at) VALUES ('note', 'shared', 'Synthetic note', 'searchable recovery rehearsal', 'owner', 't', 't')").run();
    db.prepare("INSERT INTO memory_fts (title, content, tags, note_id) VALUES ('Synthetic note', 'searchable recovery rehearsal', '[]', 'note')").run();
    for (const [kind, id] of [["conversation", "conversation"], ["task", "root"], ["workflow", "workflow"], ["note", "note"]]) db.prepare("INSERT INTO project_items (project_id, item_kind, item_id, added_at) VALUES ('project', ?, ?, 't')").run(kind!, id!);
    new AuditLog(db).record("rehearsal.seeded", { synthetic: true });
  });
  afterEach(() => {
    for (const connection of [...opened]) close(connection);
    const target = resolve(root);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith("awp-restore-")) throw new Error("Unexpected synthetic scratch directory");
    rmSync(target, { recursive: true, force: true });
  });

  it("restores a live-WAL snapshot with schema, logical rows, relationships, search and permissions intact", () => {
    addSyntheticVault();
    const original = fingerprint(db);
    expect(statSync(source + "-wal").size).toBeGreaterThan(0);
    const result = backup();
    expect(result.files).toEqual(["app.db", "vault.key"]);
    expect(fingerprint(db)).toBe(original);
    const destination = restore(result.folder);
    const restored = track(new DatabaseSync(join(destination, "app.db"), { readOnly: true }));
    integrity(restored);
    relationships(restored);
    expect(fingerprint(restored)).toBe(original);
    expect(existsSync(join(destination, "app.db-wal"))).toBe(false);
    expect(readFileSync(join(destination, "vault.key")).equals(syntheticKey())).toBe(true);
  });

  it("excludes an uncommitted writer transaction without committing or rolling it back", () => {
    const committed = fingerprint(db);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT INTO bots (id, name, created_at, updated_at) VALUES ('uncommitted', 'Never backed up', 't', 't')").run();
      const result = backup();
      const destination = restore(result.folder);
      const restored = track(new DatabaseSync(join(destination, "app.db"), { readOnly: true }));
      integrity(restored);
      expect(fingerprint(restored)).toBe(committed);
      expect(db.prepare("SELECT count(*) AS n FROM bots WHERE id = 'uncommitted'").get()?.["n"]).toBe(1);
      expect(restored.prepare("SELECT count(*) AS n FROM bots WHERE id = 'uncommitted'").get()?.["n"]).toBe(0);
    } finally { db.exec("ROLLBACK"); }
    expect(fingerprint(db)).toBe(committed);
  });

  it("restores the backup point, independently of later source and restored-copy edits", () => {
    const original = fingerprint(db);
    const result = backup();
    const backupBytes = digest(readFileSync(join(result.folder, "app.db")));
    db.prepare("INSERT INTO bots (id, name, created_at, updated_at) VALUES ('later', 'Later synthetic row', 't', 't')").run();
    const destination = restore(result.folder);
    const restored = track(openDatabase(join(destination, "app.db")));
    integrity(restored); relationships(restored);
    expect(fingerprint(restored)).toBe(original);
    restored.prepare("UPDATE projects SET name = 'Restored-copy change' WHERE id = 'project'").run();
    expect(db.prepare("SELECT name FROM projects WHERE id = 'project'").get()?.["name"]).toBe("Synthetic project");
    expect(restored.prepare("SELECT count(*) AS n FROM bots WHERE id = 'later'").get()?.["n"]).toBe(0);
    expect(digest(readFileSync(join(result.folder, "app.db")))).toBe(backupBytes);
  });

  it("recovers the synthetic encrypted sample only with the matching synthetic key", () => {
    addSyntheticVault();
    const original = fingerprint(db);
    const result = backup();
    const destination = restore(result.folder);
    const restored = track(openDatabase(join(destination, "app.db")));
    integrity(restored);
    expect(fingerprint(restored)).toBe(original);
    expect(vault(restored, readFileSync(join(destination, "vault.key"))).getStored(SAMPLE_NAME) === SAMPLE_VALUE).toBe(true);
    const rowsBefore = digest(JSON.stringify(restored.prepare("SELECT * FROM vault_secrets").all()));
    expect(vault(restored, Buffer.alloc(32, 12)).getStored(SAMPLE_NAME)).toBeNull();
    expect(new AuditLog(restored).countKindSince("vault.unreadable", 0)).toBe(1);
    expect(digest(JSON.stringify(restored.prepare("SELECT * FROM vault_secrets").all()))).toBe(rowsBefore);
    expect(fingerprint(db)).toBe(original);
  });

  it("supports a keyless synthetic database with no encrypted entries", () => {
    const result = backup();
    expect(result.files).toEqual(["app.db"]);
    const destination = restore(result.folder);
    const restored = track(new DatabaseSync(join(destination, "app.db"), { readOnly: true }));
    integrity(restored); relationships(restored);
    expect(restored.prepare("SELECT count(*) AS n FROM vault_secrets").get()?.["n"]).toBe(0);
    expect(existsSync(join(destination, "vault.key"))).toBe(false);
  });

  it("retains pending approval identity after opening and reconciling a restored scratch database", () => {
    const destination = restore(backup().folder);
    const restored = track(openDatabase(join(destination, "app.db")));
    const request = vi.fn((): never => { throw new Error("Restore must not request an action"); });
    const wf = new WorkflowService({ db: restored, audit: new AuditLog(restored), now: () => Date.UTC(2026, 5, 15),
      actions: { request, exists: () => true },
      engine: { submit: (): never => { throw new Error("Restore must not start tasks"); }, cancel: (): never => { throw new Error("Unexpected cancel"); } },
      getTask: () => undefined,
      manager: { start: (): never => { throw new Error("Restore must not start Manager"); }, view: (): never => { throw new Error("Unexpected view"); }, cancel: (): never => { throw new Error("Unexpected cancel"); } },
      botExists: () => true, automationPaused: () => true,
    });
    expect(wf.recover()).toBe(0);
    expect(wf.reconcileApprovalsAfterRestart()).toBe(0);
    expect(wf.runView("run")).toMatchObject({ status: "waiting", steps: expect.arrayContaining([expect.objectContaining({ nodeId: "act", status: "waiting", refKind: "approval", refId: "approval" })]) });
    expect(request).not.toHaveBeenCalled();
    expect(restored.prepare("SELECT status FROM approval_requests WHERE id = 'approval'").get()?.["status"]).toBe("pending");
  });

  it("preserves append-only and approval-content constraints on the restored copy", () => {
    const destination = restore(backup().folder);
    const restored = track(openDatabase(join(destination, "app.db")));
    const original = fingerprint(restored);
    expect(() => restored.prepare("DELETE FROM task_events").run()).toThrow(/append-only/);
    expect(() => restored.prepare("UPDATE approval_requests SET args_json = '{}' WHERE id = 'approval'").run()).toThrow(/cannot be edited/);
    expect(() => restored.prepare("UPDATE workflow_versions SET graph = '{}' WHERE workflow_id = 'workflow'").run()).toThrow(/permanent/);
    expect(fingerprint(restored)).toBe(original);
    integrity(restored);
  });

  it("refuses backup collisions and restores into fresh targets without overwriting", () => {
    const result = backup();
    const original = digest(readFileSync(join(result.folder, "app.db")));
    expect(() => backup()).toThrow(/already exists/);
    expect(digest(readFileSync(join(result.folder, "app.db")))).toBe(original);
    const destination = restore(result.folder);
    const target = join(destination, "app.db");
    const copied = digest(readFileSync(target));
    expect(() => copyFileSync(join(result.folder, "app.db"), target, constants.COPYFILE_EXCL)).toThrow();
    expect(digest(readFileSync(target))).toBe(copied);
    expect(() => copyFileSync(join(root, "missing.db"), join(root, "never-created.db"), constants.COPYFILE_EXCL)).toThrow();
    expect(existsSync(join(root, "never-created.db"))).toBe(false);
  });

  it("rejects a damaged candidate and distinguishes integrity from having the required data", () => {
    const result = backup();
    const damaged = restore(result.folder);
    writeFileSync(join(damaged, "app.db"), "synthetic damaged database");
    expect(() => {
      const candidate = track(new DatabaseSync(join(damaged, "app.db"), { readOnly: true }));
      integrity(candidate);
    }).toThrow();
    const empty = track(new DatabaseSync(join(root, "empty.db")));
    integrity(empty); // an empty database can pass integrity_check: this alone is insufficient
    expect(() => relationships(empty)).toThrow();
    expect(fingerprint(empty)).not.toBe(fingerprint(db));
    expect(digest(readFileSync(join(result.folder, "app.db")))).not.toBe(digest(readFileSync(join(damaged, "app.db"))));
  });
});
