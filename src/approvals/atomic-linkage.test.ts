import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { BotRecord } from "../agent-manager/types.js";
import { AuditLog } from "../audit/audit.js";
import { ConnectorRegistry, type ConnectorDefinition } from "../connectors/types.js";
import { openDatabase } from "../db/database.js";
import { VaultService } from "../vault/service.js";
import { WorkflowService, type WorkflowDeps } from "../workflows/service.js";
import { ApprovalRepository } from "./repository.js";
import { ActionGate, GATE_LIMITS, type PendingApprovalLink } from "./service.js";

const BOT = "11111111-1111-4111-8111-111111111111";
// Use an existing connector ID, with this test's in-memory implementation only. No real Telegram code.
const FAKE_CONNECTOR = "telegram";
const graph = {
  nodes: [{ id: "start", type: "trigger", kind: "manual", x: 0, y: 0 },
    { id: "act", type: "integration", botId: BOT, connector: FAKE_CONNECTOR, action: "write", args: { text: "Example" }, x: 100, y: 0 },
    { id: "end", type: "end", x: 200, y: 0 }],
  edges: [{ id: "a", from: "start", to: "act", when: "always" }, { id: "b", from: "act", to: "end", when: "always" }],
};

describe("atomic approval linkage (synthetic scratch SQLite, fake effects only)", () => {
  let dir: string;
  let file: string;
  let db: DatabaseSync;
  let repo: ApprovalRepository;
  let audit: AuditLog;
  let gate: ActionGate;
  let wf: WorkflowService;
  let clock: number;
  let writes: number;
  let reads: number;
  let requests: number;
  let held: string | null;
  let blocked: string | null;
  let allowRead: boolean;
  let slow: Promise<void> | null;
  let release: (() => void) | undefined;
  let notifyFails: boolean;
  let notify: { id: string; links: number }[];
  let actions: NonNullable<WorkflowDeps["actions"]>;

  const fake: ConnectorDefinition = {
    id: FAKE_CONNECTOR, label: "Fake service", authorize: () => blocked,
    actions: {
      write: { kind: "write", description: "Fake write", args: z.strictObject({ text: z.string() }), summarize: () => "Create example", timeoutMs: 40,
        execute: async () => { writes++; if (slow) await slow; return "FAKE RECEIPT"; } },
      read: { kind: "read", description: "Fake read", args: z.strictObject({}), summarize: () => "Read example", execute: async () => { reads++; return "FAKE DATA"; } },
    },
  };
  const bot = { id: BOT, name: "Example helper", archived: false } as BotRecord;
  const buildWorkflow = (connection = db, log = audit) => new WorkflowService({
    db: connection, audit: log, now: () => clock, actions,
    engine: { submit: (): never => { throw new Error("Unexpected task"); }, cancel: (): never => { throw new Error("Unexpected cancel"); } },
    getTask: () => undefined,
    manager: { start: (): never => { throw new Error("Unexpected Manager"); }, view: (): never => { throw new Error("Unexpected Manager"); }, cancel: (): never => { throw new Error("Unexpected Manager"); } },
    botExists: () => true, automationPaused: () => held !== null,
  });
  const build = () => {
    repo = new ApprovalRepository(db);
    audit = new AuditLog(db, () => clock);
    gate = new ActionGate({ repo, audit, registry: new ConnectorRegistry([fake]), vault: new VaultService(db, Buffer.alloc(32), audit), getBot: () => bot, now: () => clock, readEnabled: () => allowRead, startGuard: () => held,
      onPending: id => {
        // A separate read connection must see BOTH records: notifications cannot precede commit.
        const reader = new DatabaseSync(file, { readOnly: true });
        try {
          expect(reader.prepare("SELECT count(*) AS n FROM approval_requests WHERE id = ?").get(id)?.["n"]).toBe(1);
          notify.push({ id, links: Number(reader.prepare("SELECT count(*) AS n FROM workflow_steps WHERE ref_kind = 'approval' AND ref_id = ?").get(id)?.["n"]) });
        } finally { reader.close(); }
        if (notifyFails) throw new Error("Fake notification unavailable");
      },
    });
    actions = { request: (...args) => { requests++; return gate.request(...args); }, exists: (connector, action) => connector === FAKE_CONNECTOR && (action === "write" || action === "read") };
    wf = buildWorkflow();
    wf.recover();
    wf.reconcileApprovalsAfterRestart();
  };
  const reopen = () => { vi.restoreAllMocks(); db.close(); db = openDatabase(file); build(); };
  const count = () => Number(db.prepare("SELECT count(*) AS n FROM approval_requests").get()?.["n"]);
  const records = () => db.prepare("SELECT * FROM approval_requests ORDER BY id").all();
  const request = (link?: PendingApprovalLink) => gate.request(BOT, null, { connector: FAKE_CONNECTOR, action: "write", args: { text: "Example" } }, link);
  const start = async () => {
    const w = wf.create({ name: "Example workflow", graph });
    const run = wf.run(w.id, "example", "owner");
    await wf.idle();
    return run.id;
  };
  const linked = (id: string) => wf.runView(id).steps.find(s => s.nodeId === "act")!;
  const approvalId = (id: string) => linked(id).refId!;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "awp-atomic-"));
    file = join(dir, "synthetic.db");
    db = openDatabase(file);
    clock = Date.UTC(2026, 5, 15, 12);
    writes = reads = requests = 0;
    held = blocked = null;
    allowRead = notifyFails = false;
    slow = null;
    release = undefined;
    notify = [];
    fake.actions["write"]!.timeoutMs = 10_000;
    db.prepare("INSERT INTO bots (id, name, created_at, updated_at) VALUES (?, 'Example helper', 't', 't')").run(BOT);
    build();
  });
  afterEach(() => {
    release?.();
    vi.restoreAllMocks();
    db.close();
    // Delete only the synthetic directory this test created, never owner data or a computed parent.
    const target = resolve(dir);
    if (!target.startsWith(resolve(tmpdir()) + sep) || !basename(target).startsWith("awp-atomic-")) throw new Error("Unexpected scratch directory");
    rmSync(target, { recursive: true, force: true });
  });

  it("commits one approval and exact waiting link before notification; repeated ticks request nothing", async () => {
    const id = await start();
    const original = approvalId(id);
    expect(linked(id)).toMatchObject({ status: "waiting", refKind: "approval" });
    expect(notify).toEqual([{ id: original, links: 1 }]);
    expect(count()).toBe(1);
    expect(writes).toBe(0);
    await Promise.all([wf.idle(), wf.idle(), wf.idle()]);
    expect(requests).toBe(1);
    const saved = records();
    // Crash image: link committed, but the caller had not yet persisted the run's waiting status.
    db.prepare("UPDATE workflow_runs SET status = 'running' WHERE id = ?").run(id);
    reopen();
    await wf.idle();
    expect(approvalId(id)).toBe(original);
    expect(wf.runView(id).status).toBe("waiting");
    expect(records()).toEqual(saved);
    expect(requests).toBe(1);
  });

  it.each(["before_insert", "after_insert", "after_link"])("rolls back both records and audits on %s failure, including after reopen", async fault => {
    const insert = repo.insert.bind(repo);
    if (fault !== "after_link") vi.spyOn(repo, "insert").mockImplementation(a => {
      if (fault === "before_insert") throw new Error("Fault before insert");
      insert(a); throw new Error("Fault after insert");
    });
    else {
      const record = audit.record.bind(audit);
      vi.spyOn(audit, "record").mockImplementation((kind, detail, options) => {
        if (kind === "approval.requested") throw new Error("Fault after link");
        record(kind, detail, options);
      });
    }
    const id = await start();
    expect(count()).toBe(0);
    expect(linked(id)).toMatchObject({ status: "failed", refId: null });
    expect(notify).toHaveLength(0);
    expect(audit.countKindSince("workflow.approval_waiting", 0)).toBe(0);
    expect(audit.countKindSince("approval.requested", 0)).toBe(0);
    reopen(); await wf.idle();
    expect(count()).toBe(0);
    expect(approvalId(id)).toBeNull();
    expect(writes).toBe(0);
  });

  it("retains the winning binding when a stale competing link attempt rolls back", async () => {
    const original = actions.request;
    actions.request = async (botId, taskId, req, link) => {
      await original(botId, taskId, req, link); // winning committed binding
      return original(botId, taskId, req, link); // stale CAS: must roll back and preserve winner
    };
    const id = await start();
    expect(count()).toBe(1);
    expect(linked(id)).toMatchObject({ status: "waiting", refKind: "approval" });
    expect(wf.runView(id).status).toBe("waiting");
    expect(notify).toHaveLength(1);
    expect(writes).toBe(0);
    expect(audit.countKindSince("approval.requested", 0)).toBe(1);
    expect(audit.countKindSince("workflow.approval_waiting", 0)).toBe(1);
  });

  it("reconnects after a postcommit/pre-return exception rather than overwriting the saved wait", async () => {
    const original = actions.request;
    actions.request = async (...args) => { await original(...args); throw new Error("Fault after commit before return"); };
    const id = await start();
    const originalId = approvalId(id);
    expect(wf.runView(id).status).toBe("waiting");
    reopen(); await wf.idle();
    expect(approvalId(id)).toBe(originalId);
    expect(count()).toBe(1);
    expect(requests).toBe(1);
    expect(writes).toBe(0);
  });

  it("notification failure cannot roll back or duplicate the committed binding", async () => {
    notifyFails = true;
    const id = await start();
    expect(linked(id).status).toBe("waiting");
    expect(notify[0]?.links).toBe(1);
    reopen(); await wf.idle();
    expect(count()).toBe(1);
    expect(requests).toBe(1);
    expect(writes).toBe(0);
  });

  it("uses a durable executed receipt after reopen without executing again", async () => {
    const id = await start();
    const aid = approvalId(id);
    expect((await gate.approve(aid)).status).toBe("executed");
    expect(writes).toBe(1);
    reopen(); await wf.idle();
    expect(wf.runView(id).status).toBe("completed");
    expect(linked(id).output).toBe("FAKE RECEIPT");
    expect(writes).toBe(1);
    await expect(gate.approve(aid)).rejects.toMatchObject({ code: "approval_not_pending" });
    expect(() => wf.retryStep(id, "act")).toThrow();
    expect(count()).toBe(1);
  });

  it("cold-start approved-without-receipt fails uncertain and never reapproves or resends", async () => {
    const id = await start();
    const aid = approvalId(id);
    expect(repo.claimApproval(aid, new Date(clock).toISOString(), "owner")).toBe(true);
    const original = repo.get(aid);
    db.prepare("UPDATE workflow_runs SET status = 'running' WHERE id = ?").run(id);
    reopen(); await wf.idle();
    expect(wf.runView(id).status).toBe("failed");
    expect(linked(id)).toMatchObject({ refId: aid, error: expect.stringMatching(/outcome.*recorded/) });
    expect(repo.get(aid)).toEqual(original);
    expect(() => wf.retryStep(id, "act")).toThrow(/uncertain|outside action/);
    await expect(gate.approve(aid)).rejects.toMatchObject({ code: "approval_not_pending" });
    expect(writes).toBe(0);
    expect(requests).toBe(1);
  });

  it("routine ticks keep waiting while a live owner-approved fake action is running", async () => {
    const id = await start();
    slow = new Promise<void>(resolve => { release = resolve; });
    const deciding = gate.approve(approvalId(id));
    await wf.idle();
    expect(wf.runView(id).status).toBe("waiting");
    expect(wf.reconcileApprovalsAfterRestart()).toBe(0); // startup pass cannot run twice
    release!(); await deciding;
    await wf.idle();
    expect(wf.runView(id).status).toBe("completed");
    expect(writes).toBe(1);
  });

  it.each(["denied", "expired", "failed"])("reconnects a %s request without a new request or repeat effect", async status => {
    const id = await start();
    const aid = approvalId(id);
    if (status === "denied") gate.deny(aid, "No");
    else if (status === "expired") { clock += GATE_LIMITS.expiryMs + 1; gate.get(aid); }
    else {
      fake.actions["write"]!.timeoutMs = 15;
      slow = new Promise<void>(resolve => { release = resolve; });
      expect((await gate.approve(aid)).status).toBe("failed"); // fake effect followed by timeout
      release!();
    }
    const original = repo.get(aid);
    reopen(); await wf.idle();
    expect(wf.runView(id).status).toBe("failed");
    expect(repo.get(aid)).toEqual(original);
    expect(requests).toBe(1);
    expect(writes).toBe(status === "failed" ? 1 : 0);
    expect(() => wf.retryStep(id, "act")).toThrow();
  });

  it.each(["missing", "wrong_bot", "wrong_action", "bad_hash"])("fails closed for a %s binding", async fault => {
    const id = await start();
    if (fault === "wrong_bot") db.prepare("INSERT INTO bots (id, name, created_at, updated_at) VALUES ('other', 'Other', 't', 't')").run();
    if (fault !== "missing") {
      const a = repo.get(approvalId(id))!;
      repo.insert({ ...a, id: "bad", botId: fault === "wrong_bot" ? "other" : BOT, action: fault === "wrong_action" ? "other" : a.action, argsHash: fault === "bad_hash" ? "broken" : a.argsHash });
    }
    db.prepare("UPDATE workflow_steps SET ref_id = ? WHERE run_id = ? AND node_id = 'act'").run(fault === "missing" ? "missing" : "bad", id);
    reopen(); await wf.idle();
    expect(wf.runView(id).status).toBe("failed");
    expect(linked(id).error).toMatch(/missing, mismatched or damaged/);
    expect(requests).toBe(1);
    expect(writes).toBe(0);
  });

  it("Guardian hold and revoked authorization still control owner-approved execution", async () => {
    const id = await start();
    const aid = approvalId(id);
    held = "Paused by fake Guardian";
    await expect(gate.approve(aid)).rejects.toMatchObject({ code: "guardian_paused" });
    expect(repo.get(aid)?.status).toBe("pending");
    held = null; blocked = "Permission revoked";
    expect((await gate.approve(aid)).status).toBe("failed");
    await wf.idle();
    expect(wf.runView(id).status).toBe("failed");
    expect(writes).toBe(0);
  });

  it("cancellation and subsequent workflow edits cannot revive a terminal run", async () => {
    const id = await start();
    const aid = approvalId(id);
    wf.cancel(id);
    await gate.approve(aid); // independent, explicit owner decision still belongs to the gate
    reopen(); await wf.idle();
    expect(wf.runView(id).status).toBe("cancelled");
    expect(writes).toBe(1);
    expect(requests).toBe(1);
  });

  it("unlinked bot requests and permission-gated reads keep their existing behavior", async () => {
    const link = { linkPending: vi.fn(() => true) };
    expect((await gate.request(BOT, null, { connector: FAKE_CONNECTOR, action: "read", args: {} }, link)).status).toBe("denied");
    allowRead = true;
    expect(await gate.request(BOT, null, { connector: FAKE_CONNECTOR, action: "read", args: {} }, link)).toEqual({ status: "done", text: "FAKE DATA" });
    expect(link.linkPending).not.toHaveBeenCalled();
    expect(reads).toBe(1);
    expect(count()).toBe(0);
    const out = await request();
    expect(out.status).toBe("pending_approval");
    expect(notify[0]?.links).toBe(0); // ordinary bot request, no workflow
    if (out.status === "pending_approval") await gate.approve(out.approvalId);
    expect(writes).toBe(1);
  });

  it.each(["false", "promise", "rejected_promise", "throw"])("rejects and rolls back a %s linker result", async fault => {
    const link = { linkPending: () => {
      if (fault === "throw") throw new Error("Linker fault");
      if (fault === "rejected_promise") return Promise.reject(new Error("Async linker fault"));
      return fault === "promise" ? Promise.resolve(true) : false;
    } } as unknown as PendingApprovalLink;
    await expect(request(link)).rejects.toThrow();
    expect(count()).toBe(0);
    expect(notify).toHaveLength(0);
    expect(writes).toBe(0);
  });

  it("rejects async transaction work and preserves an existing outer transaction", () => {
    expect(() => repo.transaction(() => Promise.resolve(true))).toThrow(/synchronous/);
    expect(() => repo.transaction(() => Promise.reject(new Error("Async transaction fault")))).toThrow(/synchronous/);
    db.exec("BEGIN");
    try {
      expect(() => repo.transaction(() => true)).toThrow();
      db.exec("COMMIT"); // inner BEGIN rejection must not roll back this caller
    } catch (err) { db.exec("ROLLBACK"); throw err; }
  });

  it("SQLite write contention does not create a half-binding or run an effect", () => {
    const competitor = new DatabaseSync(file);
    competitor.exec("BEGIN IMMEDIATE");
    try { expect(() => repo.transaction(() => { throw new Error("Should not enter"); })).toThrow(); }
    finally { competitor.exec("ROLLBACK"); competitor.close(); }
    expect(count()).toBe(0);
    expect(notify).toHaveLength(0);
    expect(writes).toBe(0);
    expect(repo.transaction(connection => connection === db)).toBe(true);
  });

  it("a commit failure rolls back the request, step link and audits before any notification", async () => {
    const w = wf.create({ name: "Commit fault", graph });
    const run = wf.run(w.id, "example", "owner");
    const exec = db.exec.bind(db);
    vi.spyOn(db, "exec").mockImplementation(sql => {
      if (sql === "COMMIT") throw new Error("Fake commit failure");
      exec(sql);
    });
    await wf.idle();
    expect(count()).toBe(0);
    expect(linked(run.id)).toMatchObject({ status: "failed", refId: null });
    expect(audit.countKindSince("approval.requested", 0)).toBe(0);
    expect(audit.countKindSince("workflow.approval_waiting", 0)).toBe(0);
    expect(notify).toHaveLength(0);
    reopen(); await wf.idle();
    expect(count()).toBe(0);
    expect(writes).toBe(0);
  });

  it("link callbacks receive the actual approval connection and cannot silently accept another one", async () => {
    const other = new DatabaseSync(file);
    const link = { linkPending: (_id: string, connection: DatabaseSync) => connection === other };
    try { await expect(request(link)).rejects.toMatchObject({ code: "workflow_link_conflict" }); }
    finally { other.close(); }
    expect(count()).toBe(0);
  });

  it("linked write quotas remain enforced without calling the linker on refusal", async () => {
    for (let i = 0; i < GATE_LIMITS.maxPendingPerBot; i++) expect((await request()).status).toBe("pending_approval");
    const link = { linkPending: vi.fn(() => true) };
    expect((await request(link)).status).toBe("denied");
    expect(link.linkPending).not.toHaveBeenCalled();
    expect(count()).toBe(GATE_LIMITS.maxPendingPerBot);
    expect(writes).toBe(0);
  });
});
