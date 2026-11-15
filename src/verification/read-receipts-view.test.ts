import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { AuditLog } from "../audit/audit.js";
import { openDatabase } from "../db/database.js";
import { manifestFor, renderResult } from "../delegation/result-provenance.js";
import { registerVerificationRoutes } from "./routes.js";
import { VerificationService } from "./service.js";

/** Read receipts shown with a task chain (D-114): informational only, never a verdict, hashes and counts only. Synthetic in-memory records. */
const BOT = "11111111-1111-4111-8111-111111111111";
const ROOT = "22222222-2222-4222-8222-222222222222";
const CHILD = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const H = "a".repeat(64);

function seed(db: DatabaseSync) {
  db.prepare("INSERT INTO bots (id, name, created_at, updated_at) VALUES (?, 'Synthetic helper', 't', 't')").run(BOT);
  const insert = db.prepare("INSERT INTO tasks (id, root_id, parent_id, assignee_bot_id, requested_by, instruction, depth, status, result, created_at, finished_at) VALUES (?, ?, ?, ?, 'user', 'Synthetic task', ?, 'completed', ?, 't', 't')");
  insert.run(ROOT, ROOT, null, BOT, 0, "Read some messages.");
  insert.run(CHILD, ROOT, ROOT, BOT, 1, "Child read.");
  insert.run(OTHER, OTHER, null, BOT, 0, "Unrelated.");
  for (const [id, root] of [[ROOT, ROOT], [CHILD, ROOT], [OTHER, OTHER]]) db.prepare("INSERT INTO task_events (task_id,root_id,kind,detail,created_at) VALUES (?,?,'result_provenance',?,'t')").run(id!, root!, manifestFor(id!, root!, "completed", renderResult([{ origin: "agent", text: "Synthetic." }])));
}
const read = (audit: AuditLog, taskId: string | null, extra: Record<string, unknown> = {}) =>
  audit.record("external.read", { action: "telegram.read_messages", summary: "PRIVATE_SUMMARY", ok: true, taskId, connector: "telegram", actionName: "read_messages", argsHash: H, resultChars: 12, resultHash: H, ...extra }, { botId: BOT, actor: "bot" });

describe("read receipts beside a task chain check", () => {
  let db: DatabaseSync;
  let audit: AuditLog;
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    db = openDatabase(":memory:");
    audit = new AuditLog(db);
    seed(db);
    app = Fastify();
    await registerVerificationRoutes(app, new VerificationService({ db, audit, probe: () => { throw new Error("No file probe expected"); } }));
  });
  afterEach(async () => { await app.close(); db.close(); });
  const get = async () => (await app.inject({ method: "GET", url: `/api/tasks/${ROOT}/chain-verification` })).json().verification;

  it("lists reads for the chain's own tasks only, with no content, summary or hashes", async () => {
    read(audit, ROOT); read(audit, CHILD); read(audit, OTHER);
    const v = await get();
    expect(v.readReceipts).toHaveLength(2);
    expect(v.readReceipts.map((r: any) => r.taskId).sort()).toEqual([CHILD, ROOT].sort());
    expect(v.readReceipts[0]).toEqual(expect.objectContaining({ connector: "telegram", actionName: "read_messages", resultChars: 12 }));
    expect(JSON.stringify(v.readReceipts)).not.toContain("PRIVATE_SUMMARY");
    expect(JSON.stringify(v.readReceipts)).not.toContain(H);
  });
  it("never changes the verdict", async () => {
    const before = await get();
    read(audit, ROOT);
    const after = await get();
    const strip = ({ readReceipts: _r, ...rest }: any) => rest;
    expect(strip(after)).toEqual(strip(before));
    expect(before.readReceipts).toEqual([]);
  });
  it("ignores failed reads, older reads without a task id and incomplete events", async () => {
    read(audit, ROOT, { ok: false });
    read(audit, null);
    audit.record("external.read", { action: "telegram.read_messages", summary: "old", ok: true }, { botId: BOT, actor: "bot" });
    audit.record("external.read", { action: "telegram.read_messages", ok: true, taskId: ROOT }, { botId: BOT, actor: "bot" });
    expect((await get()).readReceipts).toEqual([]);
  });
  it("is bounded", async () => {
    for (let i = 0; i < 30; i++) read(audit, ROOT);
    expect((await get()).readReceipts).toHaveLength(20);
  });
  it("is absent-safe when the audit object has no receipt reader", async () => {
    const bare = Fastify();
    await registerVerificationRoutes(bare, new VerificationService({ db, audit: { record: () => undefined, latest: () => null }, probe: () => { throw new Error("none"); } }));
    const v = (await bare.inject({ method: "GET", url: `/api/tasks/${ROOT}/chain-verification` })).json().verification;
    expect(v.readReceipts).toEqual([]);
    await bare.close();
  });
});
