import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../db/database.js";
import { AuditLog } from "../audit/audit.js";
import { VerificationService } from "./service.js";
import { renderResult, manifestFor } from "../delegation/result-provenance.js";
import { createTestApp } from "../test-app.js";

const RUN = "11111111-1111-4111-8111-111111111111";
const BOT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
function base(db: DatabaseSync, mode = "plan") {
  for (const id of [BOT, OTHER]) db.prepare("INSERT INTO bots(id,name,created_at,updated_at) VALUES (?,'Synthetic helper','t','t')").run(id);
  db.prepare("INSERT INTO manager_runs(id,goal,status,mode,result,budget_calls,budget_tokens,budget_steps,created_at) VALUES (?,'Synthetic job','completed',?,'I emailed everyone. pass NOT REVIEWED',12,40000,6,'t')").run(RUN, mode);
}
function step(db: DatabaseSync, id = "s1", taskId: string | null = null, botId: string | null = BOT, status = "completed") {
  db.prepare("INSERT INTO manager_steps(run_id,step_id,title,specialist_bot_id,instruction,status,task_id) VALUES (?,?,'Synthetic step',?,'Synthetic instruction',?,?)").run(RUN, id, botId, status, taskId);
}
function task(db: DatabaseSync, status = "completed", root?: string, text = "Requested an action.") {
  const id = randomUUID(), rootId = root ?? id;
  db.prepare("INSERT INTO tasks(id,root_id,parent_id,assignee_bot_id,requested_by,instruction,depth,status,result,origin,origin_id,created_at) VALUES (?,?,?,?,'user','Synthetic',?,?,?,'user',?,'t')")
    .run(id, rootId, root ? rootId : null, BOT, root ? 1 : 0, status, text, RUN);
  db.prepare("INSERT INTO task_events(task_id,root_id,kind,detail,created_at) VALUES (?,?,'result_provenance',?,'t')")
    .run(id, rootId, manifestFor(id, rootId, "completed", renderResult([{ origin: "agent", text }])));
  return id;
}
function action(db: DatabaseSync, taskId: string, status = "executed", result = "Synthetic receipt") {
  db.prepare("INSERT INTO approval_requests(id,bot_id,task_id,connector,action,summary,args_json,args_hash,status,result,error,created_at,expires_at) VALUES (?,?,?,'telegram','send_message','Synthetic send','{}',?,?,?,?, 't','2050-01-01')")
    .run(randomUUID(), BOT, taskId, createHash("sha256").update("{}").digest("hex"), status, result, status === "failed" ? "Synthetic refusal" : null);
}
const support = () => [{ operation: "send", objects: ["message"] }];

describe("read-only Manager evidence projection", () => {
  let db: DatabaseSync;
  let svc: VerificationService;
  const probe = vi.fn(() => ({ state: "unreadable" as const, reason: "Synthetic denied folder" }));
  beforeEach(() => { db = openDatabase(":memory:"); base(db); probe.mockClear(); svc = new VerificationService({ db, audit: new AuditLog(db), probe, resultSupport: support }); });
  afterEach(() => db.close());

  it("never certifies a direct answer or its fake action claim", () => {
    db.prepare("UPDATE manager_runs SET mode='direct' WHERE id=?").run(RUN);
    expect(svc.verifyManager(RUN)).toMatchObject({ finalSummary: { status: "unverified" }, supporting: { status: "unverified", evidence: 0 }, completion: { total: 0 }, chains: [] });
    expect(probe).not.toHaveBeenCalled();
  });
  it("separates valid helper evidence from an unrelated final claim/review pass", () => {
    const id = task(db); action(db, id); step(db, "s1", id);
    const v = svc.verifyManager(RUN)!;
    expect(v).toMatchObject({ finalSummary: { status: "unverified" }, supporting: { status: "verified", evidence: 1 }, completion: { total: 1, completed: 1 }, coverageComplete: true });
    expect(v.steps[0]).toMatchObject({ binding: "valid", taskId: id });
    expect(v.chains).toHaveLength(1);
    expect(JSON.stringify(v)).not.toContain("I emailed everyone");
    expect(Number.isNaN(Date.parse(v.checkedAt))).toBe(false);
  });
  it("keeps Manager self-steps and review fallback unverified", () => {
    step(db, "self", null, null);
    expect(svc.verifyManager(RUN)).toMatchObject({ supporting: { status: "unverified" }, steps: [{ binding: "none" }], finalSummary: { status: "unverified" } });
  });
  it.each(["pending", "running", "failed", "skipped"])("keeps a %s step from confirming the supporting work", status => {
    const id = task(db); action(db, id); step(db, "s1", id, BOT, status);
    expect(svc.verifyManager(RUN)?.supporting.status).toBe("unverified");
  });
  it.each(["planning", "running", "failed", "cancelled", "budget_exhausted", "interrupted"])("keeps a %s run separate from successful helper work", status => {
    const id = task(db); action(db, id); step(db, "s1", id);
    db.prepare("UPDATE manager_runs SET status=? WHERE id=?").run(status, RUN);
    expect(svc.verifyManager(RUN)).toMatchObject({ runStatus: status, supporting: { status: "unverified" } });
  });
  it.each([["pending", "waiting"], ["approved", "waiting"], ["failed", "contradicted"], ["denied", "contradicted"], ["expired", "contradicted"]])("preserves %s approval evidence", (status, verdict) => {
    const id = task(db, "completed", undefined, status === "pending" || status === "approved" ? "Requested an action." : "I sent a message."); action(db, id, status); step(db, "s1", id);
    expect(svc.verifyManager(RUN)?.supporting.status).toBe(verdict);
  });
  it("keeps contradictions stronger than waiting and unfinished steps", () => {
    const a = task(db), b = task(db); action(db, a, "failed"); action(db, b, "pending"); step(db, "s1", a); step(db, "s2", b, BOT, "running");
    expect(svc.verifyManager(RUN)?.supporting.status).toBe("contradicted");
  });
  it("does not drop a failed chain when another chain is confirmed", () => {
    const a = task(db), b = task(db, "failed"); action(db, a); step(db, "s1", a); step(db, "s2", b);
    expect(svc.verifyManager(RUN)?.supporting.status).toBe("unverified");
  });
  it("retains the child-task lifecycle ceiling", () => {
    const id = task(db); action(db, id); task(db, "failed", id); step(db, "s1", id);
    expect(svc.verifyManager(RUN)?.supporting.status).toBe("unverified");
  });
  it.each([null, "missing", "not-a-uuid"])("does not borrow evidence for missing task reference %s", id => {
    step(db, "s1", id);
    expect(svc.verifyManager(RUN)).toMatchObject({ steps: [{ binding: "missing" }], chains: [], supporting: { status: "unverified", evidence: 0 } });
  });
  it.each(["origin", "origin_id", "assignee_bot_id", "root_id", "parent_id"])("rejects a foreign or malformed %s binding", column => {
    const id = task(db); action(db, id); step(db, "s1", id);
    const value = column === "origin" ? "schedule" : column === "assignee_bot_id" ? OTHER : column === "parent_id" ? id : OTHER;
    db.prepare(`UPDATE tasks SET ${column}=? WHERE id=?`).run(value, id);
    expect(svc.verifyManager(RUN)).toMatchObject({ steps: [{ binding: "invalid" }], chains: [], supporting: { evidence: 0, status: "unverified" } });
    expect(probe).not.toHaveBeenCalled();
  });
  it("rejects a self-step's unexpected task reference", () => {
    const id = task(db); action(db, id); step(db, "s1", id, null);
    expect(svc.verifyManager(RUN)?.steps[0]?.binding).toBe("invalid");
  });
  it("deduplicates repeated valid chains without hiding the repeated step", () => {
    const id = task(db); action(db, id); step(db, "s1", id); step(db, "s2", id);
    const v = svc.verifyManager(RUN)!;
    expect(v.chains).toHaveLength(1); expect(v.supporting.evidence).toBe(1);
    expect(v.steps[1]).toMatchObject({ duplicateOf: "s1", taskId: id, binding: "valid" });
  });
  it("explicitly bounds excessive step records", () => {
    for (let n = 0; n < 11; n++) step(db, `s${n}`, null, null);
    expect(svc.verifyManager(RUN)).toMatchObject({ completion: { total: 11, completed: 10 }, coverageComplete: false, supporting: { status: "unverified" } });
    expect(svc.verifyManager(RUN)?.steps).toHaveLength(10);
  });
  it("does not load/probe a chain exceeding total task coverage", () => {
    const id = task(db); action(db, id, "executed", "Created C:\\synthetic\\sample.txt (10 bytes).");
    for (let n = 0; n < 150; n++) task(db, "completed", id);
    step(db, "s1", id);
    expect(svc.verifyManager(RUN)).toMatchObject({ coverageComplete: false, steps: [{ binding: "limit" }], chains: [], supporting: { evidence: 0, status: "unverified" } });
    expect(probe).not.toHaveBeenCalled();
  });
  it("rechecks folder observations and never retains confirmation after a grant is revoked", () => {
    const id = task(db); action(db, id, "executed", "Created C:\\synthetic\\sample.txt (10 bytes)."); step(db, "s1", id);
    const observe = vi.fn((): { state: "ok"; size: number } | { state: "unreadable"; reason: string } => ({ state: "ok", size: 10 }));
    svc = new VerificationService({ db, audit: new AuditLog(db), probe: observe, resultSupport: support });
    expect(svc.verifyManager(RUN)?.supporting.status).toBe("verified");
    observe.mockReturnValue({ state: "unreadable", reason: "Synthetic grant revoked" });
    expect(svc.verifyManager(RUN)?.supporting.status).toBe("unverified");
    expect(observe).toHaveBeenCalledTimes(2);
  });
  it("releases its snapshot before a file probe and does not mix newly edited records into it", () => {
    const id = task(db); action(db, id, "executed", "Created C:\\synthetic\\sample.txt (10 bytes)."); step(db, "s1", id);
    svc = new VerificationService({ db, audit: new AuditLog(db), resultSupport: support, probe: () => {
      expect(db.isTransaction).toBe(false);
      db.prepare("UPDATE manager_runs SET status='failed' WHERE id=?").run(RUN);
      return { state: "ok", size: 10 };
    } });
    expect(svc.verifyManager(RUN)?.runStatus).toBe("completed");
    expect(svc.verifyManager(RUN)?.runStatus).toBe("failed");
  });
  it("does not write task/run/action/audit data and composes with an outer transaction", () => {
    const id = task(db); action(db, id); step(db, "s1", id);
    const dump = () => ["manager_runs", "manager_steps", "tasks", "task_events", "approval_requests", "audit_events"].map(t => JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all()));
    const before = dump(); db.exec("BEGIN"); svc.verifyManager(RUN); expect(db.isTransaction).toBe(true); db.exec("ROLLBACK");
    expect(dump()).toEqual(before); expect(svc.verifyManager(OTHER)).toBeUndefined();
  });
});

it("retains origin-bound helper evidence after reopening a synthetic database", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "awp-manager-check-"));
  let db: DatabaseSync | undefined;
  try {
    const file = path.join(scratch, "synthetic.db"); db = openDatabase(file); base(db);
    const id = task(db); action(db, id); step(db, "s1", id); db.close(); db = openDatabase(file);
    const svc = new VerificationService({ db, audit: new AuditLog(db), probe: () => { throw new Error("No file expected"); }, resultSupport: support });
    expect(svc.verifyManager(RUN)).toMatchObject({ supporting: { status: "verified", evidence: 1 }, finalSummary: { status: "unverified" } });
    expect(db.prepare("PRAGMA integrity_check").get()?.["integrity_check"]).toBe("ok");
  } finally {
    db?.close(); const target = path.resolve(scratch);
    if (!target.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(target).startsWith("awp-manager-check-")) throw new Error("Unsafe scratch cleanup target");
    rmSync(target, { recursive: true, force: true });
  }
});

it("serves the check through existing local/remote access and validates IDs without provider calls", async () => {
  const t = await createTestApp({ remoteHosts: ["workforce.example"] });
  try {
    const run = t.app.manager.start("Synthetic direct answer"); await t.app.manager.idle();
    const calls = t.provider.calls.length;
    expect((await t.call("GET", `/api/manager/runs/${run.id}/verification`)).body.verification.finalSummary.status).toBe("unverified");
    expect((await t.call("GET", `/api/manager/runs/${OTHER}/verification`)).status).toBe(404);
    expect((await t.call("GET", "/api/manager/runs/not-a-uuid/verification")).status).toBe(400);
    const remote = await t.app.inject({ method: "GET", url: `/api/manager/runs/${run.id}/verification`, headers: { host: "workforce.example", "x-forwarded-proto": "https" } });
    expect(remote.statusCode).toBe(401); expect(t.provider.calls).toHaveLength(calls);
  } finally { await t.app.close(); }
});
