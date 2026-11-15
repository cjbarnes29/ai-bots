import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../db/database.js";
import { AuditLog } from "../audit/audit.js";
import { VerificationService } from "./service.js";
import { graphSchema, type Graph } from "../workflows/graph.js";
import { renderResult, manifestFor } from "../delegation/result-provenance.js";
import { createTestApp } from "../test-app.js";

const RUN = "11111111-1111-4111-8111-111111111111", BOT = "22222222-2222-4222-8222-222222222222", OTHER = "33333333-3333-4333-8333-333333333333", WF = "44444444-4444-4444-8444-444444444444";
const act = (id = "act") => ({ id, type: "integration", label: "Outside step", botId: BOT, connector: "telegram", action: "send_message", args: { text: "PRIVATE_ARGS" }, x: 100, y: 0 });
const bot = (id = "bot") => ({ id, type: "bot_task", botId: BOT, instruction: "PRIVATE_INSTRUCTION", x: 100, y: 0 });
const manager = { id: "manager", type: "manager", goal: "PRIVATE_GOAL", x: 100, y: 0 };
function drawing(...nodes: unknown[]): Graph {
  const all = [{ id: "start", type: "trigger", kind: "manual", x: 0, y: 0 }, ...nodes, { id: "end", type: "end", x: 300, y: 0 }];
  const parsed = graphSchema.shape.nodes.parse(all);
  return graphSchema.parse({ nodes: parsed, edges: parsed.slice(1).map((_, i) => ({ id: `e${i}`, from: parsed[i]!.id, to: parsed[i + 1]!.id, when: "always" })) });
}
function seed(db: DatabaseSync, graph: Graph = drawing(act())) {
  for (const id of [BOT, OTHER]) db.prepare("INSERT INTO bots(id,name,created_at,updated_at) VALUES (?,'Synthetic helper','t','t')").run(id);
  db.prepare("INSERT INTO workflows(id,name,version,graph,created_at,updated_at) VALUES (?,'Synthetic workflow',1,?,'t','t')").run(WF, JSON.stringify(graph));
  db.prepare("INSERT INTO workflow_runs(id,workflow_id,workflow_version,graph,status,trigger,input,created_at) VALUES (?,?,1,?,'completed','manual','PRIVATE_INPUT','t')").run(RUN, WF, JSON.stringify(graph));
  for (const node of graph.nodes) db.prepare("INSERT INTO workflow_steps(run_id,node_id,status,output) VALUES (?,?,'completed','PRIVATE_STEP_OUTPUT')").run(RUN, node.id);
}
function link(db: DatabaseSync, node: string, kind: string, id: string) { db.prepare("UPDATE workflow_steps SET ref_kind=?,ref_id=? WHERE run_id=? AND node_id=?").run(kind, id, RUN, node); }
function approval(db: DatabaseSync, opts: { node?: string; status?: string; result?: string | null; connector?: string; action?: string; botId?: string; taskId?: string | null; args?: string; hash?: string } = {}) {
  const id = randomUUID(), args = opts.args ?? '{"text":"PRIVATE_ARGS"}';
  db.prepare("INSERT INTO approval_requests(id,bot_id,task_id,connector,action,summary,args_json,args_hash,status,result,error,created_at,expires_at) VALUES (?,?,?,?,?,'PRIVATE_SUMMARY',?,?,?,?, 'PRIVATE_ERROR','t','2050-01-01')")
    .run(id, opts.botId ?? BOT, opts.taskId ?? null, opts.connector ?? "telegram", opts.action ?? "send_message", args, opts.hash ?? createHash("sha256").update(args).digest("hex"), opts.status ?? "executed", opts.result === undefined ? "PRIVATE_RECEIPT" : opts.result);
  link(db, opts.node ?? "act", "approval", id); return id;
}
function task(db: DatabaseSync, opts: { root?: string; status?: string; origin?: string; originId?: string; botId?: string } = {}) {
  const id = randomUUID(), root = opts.root ?? id, text = "Requested an action.";
  db.prepare("INSERT INTO tasks(id,root_id,parent_id,assignee_bot_id,requested_by,instruction,depth,status,result,origin,origin_id,created_at) VALUES (?,?,?,?,'user','PRIVATE_TASK',?,?,?, ?,?,'t')")
    .run(id, root, opts.root ?? null, opts.botId ?? BOT, opts.root ? 1 : 0, opts.status ?? "completed", text, opts.origin ?? "user", opts.originId ?? RUN);
  db.prepare("INSERT INTO task_events(task_id,root_id,kind,detail,created_at) VALUES (?,?,'result_provenance',?,'t')").run(id, root, manifestFor(id, root, "completed", renderResult([{ origin: "agent", text }])));
  return id;
}
function taskAction(db: DatabaseSync, id: string, result = "PRIVATE_RECEIPT") { approval(db, { node: "unused", taskId: id, result }); }
const support = () => [{ operation: "send", objects: ["message"] }];
const dump = (db: DatabaseSync) => ["workflow_runs", "workflow_steps", "tasks", "task_events", "approval_requests", "audit_events"].map(t => JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all()));

describe("workflow evidence from synthetic host records only", () => {
  let db: DatabaseSync, svc: VerificationService;
  const probe = vi.fn((): { state: "ok"; size: number } | { state: "missing" } | { state: "unreadable"; reason: string } => ({ state: "ok", size: 10 }));
  beforeEach(() => { db = openDatabase(":memory:"); probe.mockClear(); probe.mockReturnValue({ state: "ok", size: 10 }); svc = new VerificationService({ db, audit: new AuditLog(db), resultSupport: support, probe }); });
  afterEach(() => db.close());

  it("separates a valid action record from unverified workflow output, without leaking raw data", () => {
    seed(db); const id = approval(db); const v = svc.verifyWorkflow(RUN)!;
    expect(v).toMatchObject({ workflowId: WF, workflowVersion: 1, coverageComplete: true, supporting: { status: "verified", evidence: 1 }, outputAssessment: { status: "unverified" }, completion: { total: 3, completed: 3 } });
    expect(v.steps[1]).toMatchObject({ binding: "valid", sourceKind: "approval", sourceId: id });
    expect(JSON.stringify(v)).not.toContain("PRIVATE_"); expect(probe).not.toHaveBeenCalled();
  });
  it.each([["pending", "waiting"], ["approved", "waiting"], ["failed", "contradicted"], ["denied", "unverified"], ["expired", "unverified"]])("reports %s without an owner decision or replay", (status, verdict) => {
    seed(db); approval(db, { status }); const before = dump(db);
    expect(svc.verifyWorkflow(RUN)?.supporting.status).toBe(verdict); expect(dump(db)).toEqual(before);
  });
  it.each([null, "", "   "])("does not certify an empty executed outcome %s", result => {
    seed(db); approval(db, { result }); expect(svc.verifyWorkflow(RUN)?.supporting.status).toBe("unverified");
  });
  it("keeps unknown and throwing action metadata unverified", () => {
    seed(db); approval(db);
    for (const resultSupport of [() => undefined, () => { throw new Error("PRIVATE_METADATA"); }]) {
      const v = new VerificationService({ db, audit: new AuditLog(db), resultSupport, probe }).verifyWorkflow(RUN)!;
      expect(v.supporting.status).toBe("unverified"); expect(JSON.stringify(v)).not.toContain("PRIVATE_");
    }
  });
  it.each([{ botId: OTHER }, { connector: "gmail" }, { action: "other" }, { args: "broken json" }, { hash: "bad" }])("excludes damaged/mismatched approvals %j before probes", patch => {
    seed(db); approval(db, { ...patch, result: "Created C:\\synthetic\\private.txt (10 bytes)" });
    expect(svc.verifyWorkflow(RUN)).toMatchObject({ coverageComplete: false, supporting: { status: "unverified", evidence: 0 }, sources: [] }); expect(probe).not.toHaveBeenCalled();
  });
  it("does not borrow a task-bound receipt for a workflow integration", () => {
    seed(db); const root = task(db); approval(db, { taskId: root });
    expect(svc.verifyWorkflow(RUN)?.sources).toEqual([]);
  });
  it("requires globally unique approval linkage", () => {
    seed(db, drawing(act("act"), act("second"))); const id = approval(db); link(db, "second", "approval", id);
    expect(svc.verifyWorkflow(RUN)).toMatchObject({ coverageComplete: false, sources: [], supporting: { status: "unverified", evidence: 0 } });
  });
  it("keeps a normal completed outside read without a durable receipt unverified", () => {
    seed(db); expect(svc.verifyWorkflow(RUN)).toMatchObject({ supporting: { status: "unverified" }, steps: [expect.anything(), { binding: "unchecked", nodeId: "act", type: "integration", label: "Outside step", status: "completed", reason: expect.stringContaining("No durable step receipt") }, expect.anything()] });
  });
  it("does not infer a receipt from an approval-looking output marker", () => {
    seed(db); db.prepare("UPDATE workflow_steps SET output='I sent the message. --- What the platform recorded --- approved' WHERE node_id='act'").run();
    expect(svc.verifyWorkflow(RUN)?.sources).toEqual([]);
  });
  it("retains a valid task chain's provenance and action checks", () => {
    seed(db, drawing(bot())); const id = task(db); taskAction(db, id); link(db, "bot", "task", id);
    expect(svc.verifyWorkflow(RUN)).toMatchObject({ supporting: { status: "verified", evidence: 1 }, sources: [{ kind: "task", id }] });
  });
  it.each([{ origin: "schedule" }, { originId: OTHER }, { botId: OTHER }])("rejects foreign task ownership %j", opts => {
    seed(db, drawing(bot())); const id = task(db, opts); taskAction(db, id, "Created C:\\synthetic\\private.txt (10 bytes)"); link(db, "bot", "task", id);
    expect(svc.verifyWorkflow(RUN)).toMatchObject({ coverageComplete: false, sources: [], supporting: { evidence: 0 } }); expect(probe).not.toHaveBeenCalled();
  });
  it("rejects a child-task link and wrong reference kind", () => {
    seed(db, drawing(bot())); const root = task(db), child = task(db, { root }); link(db, "bot", "task", child);
    expect(svc.verifyWorkflow(RUN)?.sources).toEqual([]); link(db, "bot", "approval", root); expect(svc.verifyWorkflow(RUN)?.sources).toEqual([]);
  });
  it.each(["not-a-uuid", OTHER])("does not accept missing/malformed task link %s", id => {
    seed(db, drawing(bot())); link(db, "bot", "task", id); expect(svc.verifyWorkflow(RUN)?.supporting.status).toBe("unverified"); expect(probe).not.toHaveBeenCalled();
  });
  it("deduplicates shared task roots but discloses node ambiguity", () => {
    seed(db, drawing(bot("a"), bot("b"))); const id = task(db); taskAction(db, id); link(db, "a", "task", id); link(db, "b", "task", id);
    const v = svc.verifyWorkflow(RUN)!; expect(v.sources).toHaveLength(1); expect(v.supporting).toMatchObject({ status: "unverified", evidence: 1 }); expect(v.steps[2]?.binding).toBe("ambiguous");
  });
  it.each(["failed", "cancelled", "running", "pending"])("does not ignore a %s child", status => {
    seed(db, drawing(bot())); const root = task(db); taskAction(db, root); task(db, { root, status }); link(db, "bot", "task", root);
    expect(svc.verifyWorkflow(RUN)?.supporting.status).toBe("unverified");
  });
  it("does not ignore an entirely failed chain next to a successful one", () => {
    seed(db, drawing(bot("a"), bot("b"))); const a = task(db), b = task(db, { status: "failed" }); taskAction(db, a); link(db, "a", "task", a); link(db, "b", "task", b);
    expect(svc.verifyWorkflow(RUN)?.supporting.status).toBe("unverified");
  });
  it("finds unlinked earlier attempts without counting their evidence", () => {
    seed(db, drawing(bot())); const a = task(db), old = task(db, { status: "failed" }); taskAction(db, a); link(db, "bot", "task", a);
    expect(svc.verifyWorkflow(RUN)).toMatchObject({ supporting: { status: "unverified", evidence: 1 }, unlinkedAttempts: { total: 1, ids: [old], truncated: false } });
  });
  it("bounds the earlier-attempt list", () => {
    seed(db); for (let n = 0; n < 26; n++) task(db);
    expect(svc.verifyWorkflow(RUN)).toMatchObject({ unlinkedAttempts: { total: 26, truncated: true } }); expect(svc.verifyWorkflow(RUN)?.unlinkedAttempts.ids).toHaveLength(25);
  });
  it.each(["workflow", "owner"])("does not inherit a Manager's evidence from requester %s", by => {
    seed(db, drawing(manager)); const id = randomUUID();
    db.prepare("INSERT INTO manager_runs(id,goal,status,mode,result,budget_calls,budget_tokens,budget_steps,requested_by,created_at) VALUES (?,'PRIVATE_GOAL','completed','direct','PRIVATE_OUTPUT',12,40000,6,?,'t')").run(id, by);
    link(db, "manager", "manager", id);
    expect(svc.verifyWorkflow(RUN)).toMatchObject({ supporting: { status: "unverified", evidence: 0 }, sources: [] });
    expect(svc.verifyWorkflow(RUN)?.steps[1]?.binding).toBe(by === "workflow" ? "unbound" : "invalid");
  });
  it("makes missing Manager records explicit", () => { seed(db, drawing(manager)); link(db, "manager", "manager", OTHER); expect(svc.verifyWorkflow(RUN)?.steps[1]?.binding).toBe("missing"); });
  it("keeps structural-only runs neutral and checkpoints separate from outside approvals", () => {
    seed(db, drawing({ id: "hold", type: "checkpoint", message: "PRIVATE_PROMPT", x: 100, y: 0 }));
    expect(svc.verifyWorkflow(RUN)?.supporting).toMatchObject({ status: "not_applicable", evidence: 0 });
    db.prepare("UPDATE workflow_steps SET status='waiting' WHERE node_id='hold'").run();
    expect(svc.verifyWorkflow(RUN)?.supporting).toMatchObject({ status: "waiting", evidence: 0 });
  });
  it("keeps a correctly skipped executable branch visible and unverified", () => {
    const g = drawing({ id: "if", type: "condition", left: "{{input}}", op: "not_empty", value: "", x: 100, y: 0 }, bot("a"), bot("b"));
    g.edges = [{ id: "e0", from: "start", to: "if", when: "always" }, { id: "e1", from: "if", to: "a", when: "true" }, { id: "e2", from: "if", to: "b", when: "false" }, { id: "e3", from: "a", to: "end", when: "always" }, { id: "e4", from: "b", to: "end", when: "always" }];
    seed(db, g); const id = task(db); taskAction(db, id); link(db, "a", "task", id); db.prepare("UPDATE workflow_steps SET status='skipped' WHERE node_id='b'").run();
    expect(svc.verifyWorkflow(RUN)).toMatchObject({ coverageComplete: true, supporting: { status: "unverified" }, completion: { skipped: 1 } });
  });
  it("retains uncertain restart markers without probing or replaying", () => {
    seed(db); db.prepare("UPDATE workflow_steps SET status='failed',ref_kind='integration_uncertain' WHERE node_id='act'").run();
    const before = dump(db); expect(svc.verifyWorkflow(RUN)?.steps[1]?.binding).toBe("uncertain"); expect(dump(db)).toEqual(before); expect(probe).not.toHaveBeenCalled();
  });
  it("treats a cold-start approved/no-outcome failure as uncertain, not another approval prompt", () => {
    seed(db); approval(db, { status: "approved", result: null }); db.prepare("UPDATE workflow_steps SET status='failed' WHERE node_id='act'").run();
    expect(svc.verifyWorkflow(RUN)).toMatchObject({ supporting: { status: "unverified", evidence: 0 }, sources: [{ verification: { status: "unverified" } }] });
  });
  it.each(["queued", "running", "waiting", "failed", "cancelled"])("keeps %s run lifecycle separate", status => {
    seed(db); approval(db); db.prepare("UPDATE workflow_runs SET status=? WHERE id=?").run(status, RUN); expect(svc.verifyWorkflow(RUN)?.supporting.status).toBe("unverified");
  });
  it("keeps stronger contradictory evidence over waiting and incomplete records", () => {
    seed(db, drawing(act(), act("two"))); approval(db, { status: "failed" }); approval(db, { node: "two", status: "pending" });
    expect(svc.verifyWorkflow(RUN)?.supporting.status).toBe("contradicted");
  });
  it("uses the run's saved graph/version after editing the current workflow", () => {
    seed(db); approval(db); db.prepare("UPDATE workflows SET version=2,graph=? WHERE id=?").run(JSON.stringify(drawing(bot())), WF);
    expect(svc.verifyWorkflow(RUN)).toMatchObject({ workflowVersion: 1, supporting: { status: "verified" } });
  });
  it.each(["broken", JSON.stringify({ nodes: [], edges: [] }), "x".repeat(2 * 1024 * 1024 + 1)])("does not probe receipts under a damaged/oversized graph", graph => {
    seed(db); approval(db, { result: "Created C:\\synthetic\\private.txt (10 bytes)" }); db.prepare("UPDATE workflow_runs SET graph=? WHERE id=?").run(graph, RUN);
    expect(svc.verifyWorkflow(RUN)).toMatchObject({ coverageComplete: false, sources: [], supporting: { status: "unverified" } }); expect(probe).not.toHaveBeenCalled();
  });
  it("rejects a graph cycle without recursive checking of evidence", () => {
    const g = drawing(act()); g.edges.push({ id: "loop", from: "act", to: "act", when: "always" }); seed(db, g); approval(db);
    expect(svc.verifyWorkflow(RUN)).toMatchObject({ coverageComplete: false, sources: [] });
  });
  it("discloses missing and excessive step rows", () => {
    seed(db); db.prepare("DELETE FROM workflow_steps WHERE node_id='end'").run(); expect(svc.verifyWorkflow(RUN)?.coverageComplete).toBe(false);
    for (let n = 0; n < 26; n++) db.prepare("INSERT INTO workflow_steps(run_id,node_id,status) VALUES (?,?,'completed')").run(RUN, `extra${n}`);
    const v = svc.verifyWorkflow(RUN)!; expect(v.coverageComplete).toBe(false); expect(v.steps).toHaveLength(25); expect(v.completion.total).toBe(28);
  });
  it("refuses to load an excessive task chain before any file probe", () => {
    seed(db, drawing(bot())); const root = task(db); taskAction(db, root, "Created C:\\synthetic\\private.txt (10 bytes)"); link(db, "bot", "task", root);
    for (let n = 0; n < 375; n++) task(db, { root });
    expect(svc.verifyWorkflow(RUN)).toMatchObject({ coverageComplete: false, sources: [], supporting: { evidence: 0 } }); expect(probe).not.toHaveBeenCalled();
  });
  it("accepts exactly the task-member coverage ceiling", () => {
    seed(db, drawing(bot())); const root = task(db); link(db, "bot", "task", root); for (let n = 0; n < 374; n++) task(db, { root });
    expect(svc.verifyWorkflow(RUN)).toMatchObject({ coverageComplete: true, sources: [{ kind: "task", id: root }] });
  });
  it.each([["missing", "contradicted"], ["unreadable", "unverified"], ["changed", "contradicted"]])("uses the gated file observation for %s files", (state, expected) => {
    seed(db); approval(db, { result: "Created C:\\synthetic\\private.txt (10 bytes)" });
    probe.mockReturnValue(state === "missing" ? { state: "missing" } : state === "changed" ? { state: "ok", size: 11 } : { state: "unreadable", reason: "PRIVATE_DENIAL" });
    const v = svc.verifyWorkflow(RUN)!; expect(v.supporting.status).toBe(expected); expect(probe).toHaveBeenCalledOnce(); expect(JSON.stringify(v)).not.toContain("PRIVATE_"); expect(JSON.stringify(v)).not.toContain("private.txt");
  });
  it("rechecks a revoked grant rather than retaining file confirmation", () => {
    seed(db); approval(db, { result: "Created C:\\synthetic\\private.txt (10 bytes)" }); expect(svc.verifyWorkflow(RUN)?.supporting.status).toBe("verified");
    probe.mockReturnValue({ state: "unreadable", reason: "PRIVATE_DENIAL" }); expect(svc.verifyWorkflow(RUN)?.supporting.status).toBe("unverified"); expect(probe).toHaveBeenCalledTimes(2);
  });
  it("caps inherited task evidence when its reported file is unreadable", () => {
    seed(db, drawing(bot())); const id = task(db); taskAction(db, id, "Created C:\\synthetic\\private.txt (10 bytes)"); link(db, "bot", "task", id);
    probe.mockReturnValue({ state: "unreadable", reason: "PRIVATE_DENIAL" });
    const v = svc.verifyWorkflow(RUN)!;
    expect(v.supporting.status).toBe("unverified"); expect(v.sources).toHaveLength(1); expect(JSON.stringify(v)).not.toContain("PRIVATE_");
  });
  it("releases the snapshot before file observations and does not mix later lifecycle edits", () => {
    seed(db); approval(db, { result: "Created C:\\synthetic\\private.txt (10 bytes)" });
    probe.mockImplementationOnce(() => { expect(db.isTransaction).toBe(false); db.prepare("UPDATE workflow_runs SET status='failed' WHERE id=?").run(RUN); return { state: "ok", size: 10 }; });
    expect(svc.verifyWorkflow(RUN)?.runStatus).toBe("completed"); expect(svc.verifyWorkflow(RUN)?.runStatus).toBe("failed");
  });
  it("makes no record/audit writes and preserves a caller transaction", () => {
    seed(db); approval(db); const before = dump(db); db.exec("BEGIN"); svc.verifyWorkflow(RUN); expect(db.isTransaction).toBe(true); db.exec("ROLLBACK"); expect(dump(db)).toEqual(before);
    db.exec("PRAGMA query_only=ON"); expect(svc.verifyWorkflow(RUN)?.supporting.status).toBe("verified"); expect(dump(db)).toEqual(before); expect(svc.verifyWorkflow(OTHER)).toBeUndefined();
  });
});

it("retains linked workflow evidence after synthetic scratch reopen", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "awp-workflow-check-")); let db: DatabaseSync | undefined;
  try {
    const file = path.join(scratch, "synthetic.db"); db = openDatabase(file); seed(db); approval(db); db.close(); db = openDatabase(file);
    const svc = new VerificationService({ db, audit: new AuditLog(db), resultSupport: support, probe: () => { throw new Error("No file expected"); } });
    expect(svc.verifyWorkflow(RUN)).toMatchObject({ supporting: { status: "verified" }, outputAssessment: { status: "unverified" } }); expect(db.prepare("PRAGMA integrity_check").get()?.["integrity_check"]).toBe("ok");
  } finally { db?.close(); const target = path.resolve(scratch); if (!target.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(target).startsWith("awp-workflow-check-")) throw new Error("Unsafe scratch cleanup"); rmSync(target, { recursive: true, force: true }); }
});

it("serves a read-only workflow check with UUID/missing-run validation and existing remote access", async () => {
  const t = await createTestApp({ remoteHosts: ["workforce.example"] });
  try {
    const wf = t.app.workflows.create({ name: "Synthetic", graph: drawing() }); const run = t.app.workflows.run(wf.id, "Synthetic");
    const calls = t.provider.calls.length;
    expect((await t.call("GET", `/api/workflows/runs/${run.id}/verification`)).status).toBe(200);
    expect((await t.call("GET", `/api/workflows/runs/${OTHER}/verification`)).status).toBe(404);
    expect((await t.call("GET", "/api/workflows/runs/not-a-uuid/verification")).status).toBe(400);
    expect((await t.app.inject({ method: "GET", url: `/api/workflows/runs/${run.id}/verification`, headers: { host: "workforce.example", "x-forwarded-proto": "https" } })).statusCode).toBe(401);
    expect(t.provider.calls).toHaveLength(calls);
  } finally { await t.app.close(); }
});
