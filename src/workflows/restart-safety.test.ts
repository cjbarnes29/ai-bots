import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { AuditLog } from "../audit/audit.js";
import { openDatabase } from "../db/database.js";
import { graphSchema } from "./graph.js";
import { WorkflowService } from "./service.js";

const BOT = "11111111-1111-4111-8111-111111111111";
const graph = graphSchema.parse({
  nodes: [
    { id: "start", type: "trigger", kind: "manual", x: 0, y: 0 },
    { id: "before", type: "bot_task", botId: BOT, instruction: "Draft", x: 100, y: 0 },
    { id: "act", type: "integration", botId: BOT, connector: "fake", action: "write", args: {}, x: 200, y: 0 },
    { id: "end", type: "end", x: 300, y: 0 },
  ],
  edges: [
    { id: "a", from: "start", to: "before", when: "always" },
    { id: "b", from: "before", to: "act", when: "always" },
    { id: "c", from: "act", to: "end", when: "always" },
  ],
});

type SavedStep = { status: string; attempts?: number; refKind?: string; refId?: string };

describe("outside-action restart and retry safety (in-memory database and fake actions only)", () => {
  let db: DatabaseSync;
  let audit: AuditLog;
  let workflowId: string;
  let effects: number;

  const insertApproval = (id: string, status = "pending", taskId: string | null = null) => {
    db.prepare("INSERT INTO approval_requests (id, bot_id, task_id, connector, action, summary, args_json, args_hash, status, created_at, expires_at) VALUES (?, ?, ?, 'fake', 'write', 'Example', '{}', ?, 'pending', 't', 'z')").run(id, BOT, taskId, createHash("sha256").update("{}").digest("hex"));
    if (status !== "pending") db.prepare("UPDATE approval_requests SET status = 'approved' WHERE id = ?").run(id);
    if (status === "executed") {
      effects++; // a fake action, never network or a real file
      db.prepare("UPDATE approval_requests SET status = 'executed', result = 'fake receipt' WHERE id = ?").run(id);
    }
  };
  const request = vi.fn(async () => {
    insertApproval("duplicate");
    return { status: "pending_approval" as const, approvalId: "duplicate" };
  });
  const submit = vi.fn((): never => { throw new Error("Unexpected bot execution"); });
  const build = () => new WorkflowService({
    db, audit, now: () => 1_000_000,
    engine: { submit, cancel: (): never => { throw new Error("Unexpected cancel"); } },
    getTask: () => undefined,
    manager: {
      start: (): never => { throw new Error("Unexpected Manager execution"); },
      view: (): never => { throw new Error("Unexpected Manager lookup"); },
      cancel: (): never => { throw new Error("Unexpected Manager cancel"); },
    },
    botExists: () => true,
    actions: { request, exists: () => true },
    automationPaused: () => false,
  });
  const seed = (overrides: Record<string, SavedStep> = {}, runStatus = "running") => {
    db.prepare("INSERT INTO workflow_runs (id, workflow_id, workflow_version, graph, status, trigger, created_at) VALUES ('run', ?, 1, ?, ?, 'manual', 't')").run(workflowId, JSON.stringify(graph), runStatus);
    const defaults: Record<string, SavedStep> = {
      start: { status: "completed" }, before: { status: "completed" },
      act: { status: "running", attempts: 1 }, end: { status: "pending" },
    };
    for (const node of graph.nodes) {
      const s = overrides[node.id] ?? defaults[node.id]!;
      db.prepare("INSERT INTO workflow_steps (run_id, node_id, status, attempts, ref_kind, ref_id) VALUES ('run', ?, ?, ?, ?, ?)")
        .run(node.id, s.status, s.attempts ?? 0, s.refKind ?? null, s.refId ?? null);
    }
  };
  const snapshot = () => db.prepare("SELECT * FROM workflow_steps WHERE run_id = 'run' ORDER BY node_id").all();

  beforeEach(() => {
    db = openDatabase(":memory:");
    audit = new AuditLog(db, () => 1_000_000);
    effects = 0;
    request.mockClear();
    submit.mockClear();
    db.prepare("INSERT INTO bots (id, name, created_at, updated_at) VALUES (?, 'Test helper', 't', 't')").run(BOT);
    workflowId = build().create({ name: "Restart example", graph }).id;
  });
  afterEach(() => db.close());

  it.each(["pending", "approved", "executed"])("does not replay a request whose %s approval was saved before the workflow reference", async (status) => {
    insertApproval("original", status);
    seed(); // persisted gate result, missing workflow link: the actual handoff window
    const wf = build();
    expect(wf.recover()).toBe(1);
    await wf.idle();
    const run = wf.runView("run");
    expect(run.status).toBe("failed");
    expect(run.steps.find(s => s.nodeId === "act")).toMatchObject({ status: "failed", refKind: "integration_uncertain", error: expect.stringMatching(/review.*approval/i) });
    expect(run.steps.find(s => s.nodeId === "end")?.status).toBe("skipped");
    expect(request).not.toHaveBeenCalled();
    expect(db.prepare("SELECT count(*) AS n FROM approval_requests").get()?.["n"]).toBe(1);
    expect(effects).toBe(status === "executed" ? 1 : 0);
    expect(audit.countKindSince("workflow.integration_uncertain", 0)).toBe(1);
    expect(wf.recover()).toBe(0);
    await wf.idle();
    expect(request).not.toHaveBeenCalled();
    const saved = snapshot();
    expect(() => wf.retryStep("run", "act")).toThrow(/review|repeat/i);
    expect(snapshot()).toEqual(saved);
  });

  it("fails closed even when interrupted before the gate request was issued", async () => {
    seed();
    const wf = build();
    wf.recover();
    await wf.idle();
    expect(wf.runView("run").status).toBe("failed");
    expect(request).not.toHaveBeenCalled();
    expect(db.prepare("SELECT count(*) AS n FROM approval_requests").get()?.["n"]).toBe(0);
  });

  it("does not repeat an uncertain read that has no approval row", async () => {
    const readGraph = { ...graph, nodes: graph.nodes.map(n => n.type === "integration" ? { ...n, action: "read" } : n) };
    seed();
    db.prepare("UPDATE workflow_runs SET graph = ? WHERE id = 'run'").run(JSON.stringify(readGraph));
    effects = 1; // represents one pre-crash fake read
    const wf = build();
    wf.recover();
    await wf.idle();
    expect(wf.runView("run").status).toBe("failed");
    expect(request).not.toHaveBeenCalled();
    expect(effects).toBe(1);
  });

  it("uses the saved run graph even if the workflow definition was edited afterwards", async () => {
    seed();
    const changed = { ...graph, nodes: graph.nodes.map(n => n.id === "act" ? { id: "act", type: "set", value: "safe", x: 200, y: 0 } : n) };
    db.prepare("UPDATE workflows SET graph = ? WHERE id = ?").run(JSON.stringify(changed), workflowId);
    const wf = build();
    wf.recover();
    await wf.idle();
    expect(wf.runView("run").steps.find(s => s.nodeId === "act")?.status).toBe("failed");
    expect(request).not.toHaveBeenCalled();
  });

  it("preserves a linked waiting approval and continues from its receipt without requesting again", async () => {
    insertApproval("original");
    seed({ act: { status: "waiting", attempts: 1, refKind: "approval", refId: "original" } }, "waiting");
    const wf = build();
    expect(wf.recover()).toBe(0);
    await wf.idle();
    expect(wf.runView("run").status).toBe("waiting");
    db.prepare("UPDATE approval_requests SET status = 'approved' WHERE id = 'original'").run();
    effects++;
    db.prepare("UPDATE approval_requests SET status = 'executed', result = 'fake receipt' WHERE id = 'original'").run();
    await wf.idle();
    expect(wf.runView("run").status).toBe("completed");
    expect(wf.runView("run").steps.find(s => s.nodeId === "act")?.output).toBe("fake receipt");
    expect(effects).toBe(1);
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps a known approval reference when the saved integration was still running", async () => {
    insertApproval("original", "executed");
    seed({ act: { status: "running", attempts: 1, refKind: "approval", refId: "original" } });
    const wf = build();
    wf.recover();
    await wf.idle();
    expect(wf.runView("run").steps.find(s => s.nodeId === "act")).toMatchObject({ status: "failed", refKind: "approval", refId: "original" });
    expect(() => wf.retryStep("run", "act")).toThrow(/review|repeat/i);
    expect(request).not.toHaveBeenCalled();
    expect(effects).toBe(1);
  });

  it.each(["waiting", "completed", "failed"])("refuses an upstream retry that would reset a %s approval-linked descendant", (status) => {
    seed({ before: { status: "failed", attempts: 1 }, act: { status, attempts: 1, refKind: "approval", refId: "original" } }, "failed");
    const saved = snapshot();
    expect(() => build().retryStep("run", "before")).toThrow(/repeat|outside action/i);
    expect(snapshot()).toEqual(saved);
    expect(request).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses an upstream retry that would reset a recovered uncertain action", async () => {
    seed({ before: { status: "failed", attempts: 1 } });
    const wf = build();
    wf.recover();
    await wf.idle();
    const saved = snapshot();
    expect(() => wf.retryStep("run", "before")).toThrow(/repeat|outside action/i);
    expect(snapshot()).toEqual(saved);
    expect(request).not.toHaveBeenCalled();
  });

  it("refuses a retry while an affected descendant is still running", () => {
    seed({ before: { status: "failed", attempts: 1 } }, "waiting");
    const saved = snapshot();
    expect(() => build().retryStep("run", "before")).toThrow(/running|repeat/i);
    expect(snapshot()).toEqual(saved);
  });

  it.each(["task", "manager"])("an upstream retry cannot bypass an existing %s descendant's outside-work guard", (kind) => {
    insertApproval("original", "pending", kind === "task" ? "child" : null);
    // The saved step kind/ref, rather than the edited workflow definition, owns this guard.
    seed({ before: { status: "failed", attempts: 1 }, act: { status: "completed", attempts: 1, refKind: kind, refId: "child" } }, "failed");
    const saved = snapshot();
    expect(() => build().retryStep("run", "before")).toThrow(/repeat|outside action/i);
    expect(snapshot()).toEqual(saved);
  });

  it("still allows an upstream retry when its outside-action descendant never started", () => {
    seed({ before: { status: "failed", attempts: 1 }, act: { status: "skipped", attempts: 0 } }, "failed");
    expect(build().retryStep("run", "before").status).toBe("queued");
    expect(snapshot().filter(s => s["node_id"] !== "start").every(s => s["status"] === "pending")).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});
