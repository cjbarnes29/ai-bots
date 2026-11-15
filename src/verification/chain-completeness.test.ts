import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../db/database.js";
import { AuditLog } from "../audit/audit.js";
import Fastify from "fastify";
import { registerVerificationRoutes } from "./routes.js";
import { VerificationService } from "./service.js";
import type { FileProbe, TaskFact } from "./verify.js";
import { manifestFor, renderResult } from "../delegation/result-provenance.js";

const BOT = "11111111-1111-4111-8111-111111111111";
const ROOT = "22222222-2222-4222-8222-222222222222";
const CHILD = "33333333-3333-4333-8333-333333333333";
const UNKNOWN = "44444444-4444-4444-8444-444444444444";
const fakeSupport = (connector: string, action: string) => connector === "telegram" && action === "send_message" ? [{ operation: "send", objects: ["message"] }] : undefined;

function seed(db: DatabaseSync, childStatus: TaskFact["status"] = "failed", actionStatus = "executed") {
  db.prepare("INSERT INTO bots (id, name, created_at, updated_at) VALUES (?, 'Synthetic helper', 't', 't')").run(BOT);
  const insert = db.prepare("INSERT INTO tasks (id, root_id, parent_id, assignee_bot_id, requested_by, instruction, depth, status, result, created_at, finished_at) VALUES (?, ?, ?, ?, 'user', 'Synthetic task', ?, ?, ?, 't', 't')");
  insert.run(ROOT, ROOT, null, BOT, 0, "completed", "Requested an action.");
  insert.run(CHILD, ROOT, ROOT, BOT, 1, childStatus, "Synthetic answer.");
  for (const [id, text] of [[ROOT, "Requested an action."], [CHILD, "Synthetic answer."]]) {
    db.prepare("INSERT INTO task_events (task_id,root_id,kind,detail,created_at) VALUES (?,?,'result_provenance',?,'t')").run(id!, ROOT, manifestFor(id!, ROOT, "completed", renderResult([{ origin: "agent", text: text! }])));
  }
  const args = "{}";
  db.prepare("INSERT INTO approval_requests (id, bot_id, task_id, connector, action, summary, args_json, args_hash, status, result, error, created_at, expires_at) VALUES ('synthetic-action', ?, ?, 'telegram', 'send_message', 'Synthetic send', ?, ?, ?, ?, ?, 't', '2050-01-01')")
    .run(BOT, ROOT, args, createHash("sha256").update(args).digest("hex"), actionStatus, actionStatus === "executed" ? "Synthetic receipt" : null, actionStatus === "failed" ? "Synthetic failure" : null);
}

function childAction(db: DatabaseSync) {
  db.prepare("INSERT INTO approval_requests (id, bot_id, task_id, connector, action, summary, args_json, args_hash, status, result, created_at, expires_at) SELECT 'synthetic-child-action', bot_id, ?, connector, action, summary, args_json, args_hash, status, result, created_at, expires_at FROM approval_requests WHERE id = 'synthetic-action'").run(CHILD);
}

describe("chain completeness over synthetic in-memory records", () => {
  let db: DatabaseSync;
  let service: VerificationService;
  let audit: AuditLog;
  let probe: ReturnType<typeof vi.fn<FileProbe>>;
  beforeEach(() => {
    db = openDatabase(":memory:");
    audit = new AuditLog(db);
    probe = vi.fn<FileProbe>(() => ({ state: "unreadable", reason: "Synthetic folder denied" }));
    service = new VerificationService({ db, audit, probe, resultSupport: fakeSupport });
  });
  afterEach(() => db.close());

  it.each(["failed", "cancelled", "pending", "running"] as const)("does not confirm a chain with a %s child", status => {
    seed(db, status);
    const v = service.verifyChain(ROOT)!;
    expect(v.status).toBe("unverified");
    expect(v.evidence).toBe(1); // recorded evidence remains visible, but cannot override lifecycle
    expect(v.completion).toEqual({ total: 2, completed: 1, pending: 0, running: 0, failed: 0, cancelled: 0, [status]: 1 });
    expect(v.incompleteTasks).toEqual([{ id: CHILD, status }]);
    expect(v.summary).toContain(`1 ${status}`);
    expect(v.summary).not.toContain("All 1 step(s) are confirmed");
    expect(probe).not.toHaveBeenCalled();
    expect(service.verifyTask(ROOT)?.status).toBe("verified"); // one-task contract is unchanged
  });

  it("keeps a completed text-only member unverified", () => {
    seed(db, "completed");
    expect(service.verifyChain(ROOT)).toMatchObject({ status: "unverified", tasks: 2, completion: { total: 2, completed: 2 }, incompleteTasks: [] });
  });

  it("preserves an all-completed confirmed chain", () => {
    seed(db, "completed");
    childAction(db);
    expect(service.verifyChain(ROOT)).toMatchObject({ status: "verified", tasks: 2, evidence: 2, completion: { total: 2, completed: 2 }, incompleteTasks: [] });
  });

  it("preserves a stronger contradiction and adds incomplete-state warning", () => {
    seed(db, "failed", "failed");
    const v = service.verifyChain(ROOT)!;
    expect(v.status).toBe("contradicted");
    expect(v.summary).toContain("Synthetic failure");
    expect(v.summary).toContain("1 failed");
  });

  it("preserves waiting for approval and discloses the unfinished child", () => {
    seed(db, "running", "pending");
    const v = service.verifyChain(ROOT)!;
    expect(v.status).toBe("waiting");
    expect(v.summary).toContain("waiting for your approval");
    expect(v.summary).toContain("1 running");
  });

  it("keeps an entirely non-completed chain not_applicable, with all lifecycle details", () => {
    seed(db, "cancelled");
    db.prepare("UPDATE tasks SET status = 'failed' WHERE id = ?").run(ROOT);
    const v = service.verifyChain(ROOT)!;
    expect(v.status).toBe("not_applicable");
    expect(v.evidence).toBe(0);
    expect(v.completion).toEqual({ total: 2, completed: 0, pending: 0, running: 0, failed: 1, cancelled: 1 });
    expect(v.incompleteTasks).toHaveLength(2);
    expect(v.summary).toContain("2 of 2");
  });

  it("returns undefined for an unknown chain", () => {
    expect(service.verifyChain(UNKNOWN)).toBeUndefined();
  });

  it("recomputes when a child completes and audits a changed verdict only once", () => {
    seed(db, "running");
    childAction(db);
    const count = () => db.prepare("SELECT count(*) AS n FROM audit_events WHERE kind = 'task.verification'").get()?.["n"];
    expect(service.record(ROOT)).toBe("unverified");
    expect(count()).toBe(1);
    expect(service.record(ROOT)).toBe("unverified");
    expect(count()).toBe(1);
    db.prepare("UPDATE tasks SET status = 'completed' WHERE id = ?").run(CHILD);
    expect(service.record(ROOT)).toBe("verified");
    expect(count()).toBe(2);
    expect(service.verifyChain(ROOT)).toMatchObject({ status: "verified", incompleteTasks: [], completion: { completed: 2 } });
    expect(service.countsByBot().get(BOT)).toEqual({ verified: 1, contradicted: 0 });
  });

  it("excludes incomplete chains from agent confirmation counts", () => {
    seed(db);
    expect(service.countsByBot().get(BOT)).toEqual({ verified: 0, contradicted: 0 });
  });

  it("retains the denied file check and never counts it as confirmed evidence", () => {
    seed(db);
    // Action/result are immutable in normal requests; fixture outcome text may be updated by execution.
    db.prepare("UPDATE approval_requests SET result = 'Created C:\\synthetic\\sample.txt (10 bytes).' WHERE id = 'synthetic-action'").run();
    const v = service.verifyChain(ROOT)!;
    expect(probe).toHaveBeenCalledExactlyOnceWith("C:\\synthetic\\sample.txt");
    expect(v.checks).toContainEqual(expect.objectContaining({ kind: "file_unchecked", outcome: "note" }));
    expect(v.checks.some(c => c.kind === "file_exists")).toBe(false);
    expect(v.status).toBe("unverified");
    expect(v.evidence).toBe(1);
  });
});

describe("chain verification API with synthetic records and no providers", () => {
  it("returns lifecycle counts and a clear warning, with no action or model work", async () => {
    const db = openDatabase(":memory:");
    const app = Fastify();
    try {
      seed(db);
      const svc = new VerificationService({ db, audit: new AuditLog(db), resultSupport: fakeSupport, probe: () => { throw new Error("No file probe expected"); } });
      await registerVerificationRoutes(app, svc);
      const before = JSON.stringify(db.prepare("SELECT * FROM approval_requests").all());
      const response = await app.inject({ method: "GET", url: `/api/tasks/${ROOT}/chain-verification` });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.verification).toMatchObject({ status: "unverified", tasks: 2, evidence: 1, completion: { failed: 1, completed: 1 }, incompleteTasks: [{ id: CHILD, status: "failed" }] });
      expect(body.verification.summary).toContain("1 failed");
      expect(JSON.stringify(db.prepare("SELECT * FROM approval_requests").all())).toBe(before);
      // No provider, connector, gate or listener is installed in this route-only fixture.
    } finally { await app.close(); db.close(); }
  });
});
