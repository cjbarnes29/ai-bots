import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z, ZodError } from "zod";
import { AppError } from "../errors.js";
import type { DatabaseSync } from "node:sqlite";
import type { BotRecord } from "../agent-manager/types.js";
import { AuditLog } from "../audit/audit.js";
import { ConnectorRegistry, type ConnectorDefinition } from "../connectors/types.js";
import { openDatabase } from "../db/database.js";
import { VaultService } from "../vault/service.js";
import { ApprovalRepository } from "./repository.js";
import { registerApprovalRoutes } from "./routes.js";
import { ActionGate, GATE_LIMITS } from "./service.js";

/** Uncertain approvals (D-125): approved, no recorded outcome. Synthetic in-memory SQLite and a fake connector only; nothing real is contacted. */
const BOT = "11111111-1111-4111-8111-111111111111";
const WAIT = GATE_LIMITS.uncertainAfterMs;

describe("outcome-unknown approvals", () => {
  let db: DatabaseSync;
  let repo: ApprovalRepository;
  let audit: AuditLog;
  let gate: ActionGate;
  let clock: number;
  let writes: number;
  let hold: Promise<void> | null;

  const connector: ConnectorDefinition = {
    id: "telegram",
    label: "Fake service",
    actions: {
      boom: { kind: "write", description: "Fake failing write", args: z.strictObject({ text: z.string() }), summarize: () => "Fail on purpose", execute: async () => { throw new Error("FAKE FAILURE"); } },
      write: { kind: "write", description: "Fake write", args: z.strictObject({ text: z.string() }), summarize: () => "Send an example", timeoutMs: 600_000, execute: async () => { writes++; if (hold) await hold; return "FAKE RECEIPT"; } },
    },
  };
  const build = () => new ActionGate({
    repo,
    registry: new ConnectorRegistry([connector]),
    audit,
    vault: new VaultService(db, Buffer.alloc(32, 7), audit, () => [], () => clock),
    getBot: (id) => ({ id, name: "Example helper", archived: false }) as BotRecord,
    readEnabled: () => false,
    now: () => clock,
  });
  /** A pending request that has been approved by the database claim only, as a crash right after "approved" would leave it. */
  async function strand(text = "hello"): Promise<string> {
    const out = await gate.request(BOT, null, { connector: "telegram", action: "write", args: { text } });
    if (out.status !== "pending_approval") throw new Error("expected a pending approval");
    expect(repo.claimApproval(out.approvalId, new Date(clock).toISOString(), "owner")).toBe(true);
    return out.approvalId;
  }
  const row = (id: string) => JSON.stringify(db.prepare("SELECT * FROM approval_requests WHERE id = ?").get(id));

  beforeEach(() => {
    clock = new Date(2026, 10, 15, 12, 0, 0).getTime();
    writes = 0;
    hold = null;
    db = openDatabase(":memory:");
    const now = new Date(clock).toISOString();
    db.prepare("INSERT INTO bots (id, name, created_at, updated_at) VALUES (?, 'Example helper', ?, ?)").run(BOT, now, now);
    repo = new ApprovalRepository(db);
    audit = new AuditLog(db, () => clock);
    gate = build();
  });
  afterEach(() => db.close());

  describe("detection (read-only)", () => {
    it("lists an approved request with no outcome only after the margin, inclusive at exactly the margin", async () => {
      const id = await strand();
      expect(gate.uncertain()).toEqual([]);
      clock += WAIT - 1;
      expect(gate.uncertain()).toEqual([]);
      clock += 1;
      expect(gate.uncertain().map((a) => a.id)).toEqual([id]);
      expect(gate.uncertain()[0]).toMatchObject({ status: "approved", result: null, error: null, executedAt: null, reconciliation: null });
    });
    it("never lists pending, denied, failed, executed or expired requests", async () => {
      const pending = await gate.request(BOT, null, { connector: "telegram", action: "write", args: { text: "p" } });
      const denied = await gate.request(BOT, null, { connector: "telegram", action: "write", args: { text: "d" } });
      const done = await gate.request(BOT, null, { connector: "telegram", action: "write", args: { text: "e" } });
      if (pending.status !== "pending_approval" || denied.status !== "pending_approval" || done.status !== "pending_approval") throw new Error("expected pending");
      gate.deny(denied.approvalId, null);
      await gate.approve(done.approvalId);
      const failed = await gate.request(BOT, null, { connector: "telegram", action: "boom", args: { text: "f" } });
      if (failed.status !== "pending_approval") throw new Error("expected pending");
      await gate.approve(failed.approvalId);
      clock += GATE_LIMITS.expiryMs + WAIT;
      expect(gate.uncertain()).toEqual([]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM approval_requests WHERE status = 'failed'").get()?.["n"]).toBe(1);
    });
    it("does not list a request this process is executing right now, even long after the margin", async () => {
      let release!: () => void;
      hold = new Promise<void>((r) => { release = r; });
      const out = await gate.request(BOT, null, { connector: "telegram", action: "write", args: { text: "slow" } });
      if (out.status !== "pending_approval") throw new Error("expected pending");
      const running = gate.approve(out.approvalId);
      await Promise.resolve();
      clock += WAIT * 10;
      expect(gate.uncertain()).toEqual([]);
      release();
      expect((await running).status).toBe("executed");
      expect(gate.uncertain()).toEqual([]);
    });
    it("lists it again after a restart (a new gate has nothing in flight)", async () => {
      const id = await strand();
      clock += WAIT;
      expect(build().uncertain().map((a) => a.id)).toEqual([id]);
    });
    it("is bounded", async () => {
      for (let i = 0; i < GATE_LIMITS.maxUncertainListed + 10; i++) {
        const out = await gate.request(BOT, null, { connector: "telegram", action: "write", args: { text: `t${i}` } });
        if (out.status === "pending_approval") repo.claimApproval(out.approvalId, new Date(clock).toISOString(), "owner");
        else break;
        clock += 1;
      }
      clock += WAIT;
      expect(gate.uncertain().length).toBeLessThanOrEqual(GATE_LIMITS.maxUncertainListed);
    });
    it("changes nothing and sends nothing", async () => {
      const id = await strand();
      clock += WAIT;
      const before = row(id);
      gate.uncertain();
      expect(row(id)).toBe(before);
      expect(writes).toBe(0);
    });
  });

  describe("recording what happened (owner act)", () => {
    it("writes one audit event with the outcome, never edits the request and never runs it", async () => {
      const id = await strand("PRIVATE_ARGS_TEXT");
      clock += WAIT;
      const before = row(id);
      const out = gate.reconcile(id, "did_happen", "I saw the message in my chat");
      expect(out.reconciliation).toMatchObject({ outcome: "did_happen" });
      expect(row(id)).toBe(before);
      expect(writes).toBe(0);
      const events = audit.recent(["approval.reconciled"], 10);
      expect(events).toHaveLength(1);
      expect(events[0]!.detail).toMatchObject({ id, outcome: "did_happen", note: "I saw the message in my chat" });
      expect(JSON.stringify(events[0])).not.toContain("PRIVATE_ARGS_TEXT");
      expect(gate.uncertain()[0]!.reconciliation).toMatchObject({ outcome: "did_happen" });
    });
    it("refuses anything that is not currently uncertain", async () => {
      expect(() => gate.reconcile("22222222-2222-4222-8222-222222222222", "did_happen", null)).toThrow(/not waiting/);
      const id = await strand();
      expect(() => gate.reconcile(id, "did_happen", null)).toThrow(/not waiting/); // inside the margin
      const done = await gate.request(BOT, null, { connector: "telegram", action: "write", args: { text: "x" } });
      if (done.status !== "pending_approval") throw new Error("expected pending");
      await gate.approve(done.approvalId);
      clock += WAIT;
      expect(() => gate.reconcile(done.approvalId, "did_happen", null)).toThrow(/not waiting/); // executed
    });
    it("a definite answer is final; 'cannot tell' can later be replaced by a definite one", async () => {
      const id = await strand();
      clock += WAIT;
      gate.reconcile(id, "cannot_tell", null);
      expect(gate.reconcile(id, "did_not_happen", null).reconciliation?.outcome).toBe("did_not_happen");
      expect(() => gate.reconcile(id, "did_happen", null)).toThrow(/already recorded/);
      expect(gate.uncertain()[0]!.reconciliation?.outcome).toBe("did_not_happen");
      expect(audit.recent(["approval.reconciled"], 10)).toHaveLength(2);
    });
    it("clips a long note and keeps any secret out of the log", async () => {
      const id = await strand();
      clock += WAIT;
      gate.reconcile(id, "cannot_tell", `${"n".repeat(400)} AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKE12345`);
      const note = String(audit.recent(["approval.reconciled"], 1)[0]!.detail["note"]);
      expect(note.length).toBeLessThanOrEqual(201);
      expect(note).not.toContain("AIzaSy");
    });
    it("an answer for one request never leaks onto another", async () => {
      const a = await strand("a");
      const b = await strand("b");
      clock += WAIT;
      gate.reconcile(a, "did_happen", null);
      const list = gate.uncertain();
      expect(list.find((x) => x.id === a)!.reconciliation?.outcome).toBe("did_happen");
      expect(list.find((x) => x.id === b)!.reconciliation).toBeNull();
    });
  });

  describe("routes", () => {
    it("lists, validates and records through the API", async () => {
      const a = Fastify();
      // The same error mapping as the real app (src/app.ts).
      a.setErrorHandler((err: unknown, _req, reply) => {
        if (err instanceof ZodError) return reply.code(400).send({ error: "validation_error" });
        if (err instanceof AppError) return reply.code(err.status).send({ error: err.code, message: err.message });
        return reply.code(500).send({ error: "internal_error" });
      });
      await registerApprovalRoutes(a, gate, audit);
      const id = await strand();
      clock += WAIT;
      const list = await a.inject({ method: "GET", url: "/api/approvals/uncertain" });
      expect(list.statusCode).toBe(200);
      expect(list.json().approvals.map((x: any) => x.id)).toEqual([id]);
      expect((await a.inject({ method: "POST", url: `/api/approvals/${id}/reconcile`, payload: { outcome: "maybe" } })).statusCode).toBe(400);
      expect((await a.inject({ method: "POST", url: `/api/approvals/${id}/reconcile`, payload: { outcome: "did_happen", extra: 1 } })).statusCode).toBe(400);
      const ok = await a.inject({ method: "POST", url: `/api/approvals/${id}/reconcile`, payload: { outcome: "did_not_happen" } });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().approval.reconciliation.outcome).toBe("did_not_happen");
      expect((await a.inject({ method: "POST", url: `/api/approvals/${id}/reconcile`, payload: { outcome: "did_happen" } })).statusCode).toBe(409);
      expect(writes).toBe(0);
      await a.close();
    });
  });
});
