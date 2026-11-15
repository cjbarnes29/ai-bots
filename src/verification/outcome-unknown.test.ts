import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { GATE_LIMITS } from "../approvals/service.js";
import { AuditLog } from "../audit/audit.js";
import { openDatabase } from "../db/database.js";
import { manifestFor, renderResult } from "../delegation/result-provenance.js";
import { VerificationService } from "./service.js";

/** D-125: an approved action with no recorded outcome shows as "outcome unknown", never as waiting or confirmed. Synthetic in-memory records only. */
const BOT = "11111111-1111-4111-8111-111111111111";
const ROOT = "22222222-2222-4222-8222-222222222222";
const ACTION = "33333333-3333-4333-8333-333333333333";
const WAIT = GATE_LIMITS.uncertainAfterMs;
const NOW = Date.parse("2026-11-15T12:00:00.000Z");
const fakeSupport = (connector: string, action: string) => (connector === "telegram" && action === "send_message" ? [{ operation: "send", objects: ["message"] }] : undefined);

describe("verification of an approved action with no recorded outcome", () => {
  let db: DatabaseSync;
  let audit: AuditLog;
  let svc: VerificationService;
  let now: number;

  function seed(text = "I sent the message to Sam.") {
    db.prepare("INSERT INTO bots (id, name, created_at, updated_at) VALUES (?, 'Synthetic helper', 't', 't')").run(BOT);
    db.prepare("INSERT INTO tasks (id, root_id, parent_id, assignee_bot_id, requested_by, instruction, depth, status, result, created_at, finished_at) VALUES (?, ?, NULL, ?, 'user', 'Synthetic task', 0, 'completed', ?, 't', 't')").run(ROOT, ROOT, BOT, text);
    db.prepare("INSERT INTO task_events (task_id,root_id,kind,detail,created_at) VALUES (?,?,'result_provenance',?,'t')").run(ROOT, ROOT, manifestFor(ROOT, ROOT, "completed", renderResult([{ origin: "agent", text }])));
  }
  function action(over: { status?: string; decidedMsAgo?: number; result?: string | null; error?: string | null; executedAt?: string | null } = {}) {
    const args = "{}";
    const decided = new Date(now - (over.decidedMsAgo ?? WAIT + 1000)).toISOString();
    db.prepare("INSERT INTO approval_requests (id, bot_id, task_id, connector, action, summary, args_json, args_hash, status, result, error, created_at, expires_at, decided_at, decided_by, executed_at) VALUES (?, ?, ?, 'telegram', 'send_message', 'Send hello', ?, ?, ?, ?, ?, 't', '2050-01-01', ?, 'owner', ?)")
      .run(ACTION, BOT, ROOT, args, createHash("sha256").update(args).digest("hex"), over.status ?? "approved", over.result ?? null, over.error ?? null, over.status === "pending" ? null : decided, over.executedAt ?? null);
  }
  const reconcile = (outcome: string, id = ACTION) => audit.record("approval.reconciled", { id, outcome, at: "t" }, { actor: "owner" });
  const chain = () => svc.verifyChain(ROOT)!;
  const kinds = () => chain().checks.map((c) => c.kind);

  beforeEach(() => {
    db = openDatabase(":memory:");
    now = NOW;
    audit = new AuditLog(db, () => now);
    svc = new VerificationService({ db, audit, probe: () => { throw new Error("No file probe expected"); }, resultSupport: fakeSupport, now: () => now });
  });
  afterEach(() => db.close());

  it("old approved action with no outcome: 'outcome unknown', unverified, no evidence, not 'waiting for approval'", () => {
    seed(); action();
    const v = chain();
    expect(v.status).toBe("unverified");
    expect(v.evidence).toBe(0);
    expect(kinds()).toContain("action_outcome_unknown");
    expect(kinds()).not.toContain("action_waiting");
    const one = svc.verifyTask(ROOT)!; // the single-task summary (a chain summary is combined from its tasks)
    expect(one.summary).toContain("no recorded outcome");
    expect(one.summary).not.toContain("waiting for your approval");
    expect(one.status).toBe("unverified");
    expect(v.checks.find((c) => c.kind === "action_outcome_unknown")!.detail).toContain("may or may not have happened and was not sent again");
  });
  it("a claim of sending is neither confirmed nor contradicted by an action with no recorded outcome", () => {
    seed(); action();
    expect(kinds()).not.toContain("claim_supported");
    expect(kinds()).not.toContain("claim_unsupported");
    expect(kinds()).toContain("claim_unchecked");
    expect(chain().checks.find((c) => c.kind === "claim_unchecked")!.detail).toContain("neither confirmed nor contradicted");
    expect(chain().status).toBe("unverified");
  });
  it("a claim that nothing in the record could match is still contradicted, as before", () => {
    seed("I deleted the file."); action();
    expect(kinds()).toContain("claim_unsupported");
    expect(chain().status).toBe("contradicted");
  });
  it("inside the margin it is still reported as waiting, exactly as before", () => {
    seed("Prepared the message for Sam."); action({ decidedMsAgo: WAIT - 1000 });
    expect(kinds()).toContain("action_waiting");
    expect(kinds()).not.toContain("action_outcome_unknown");
    expect(chain().status).toBe("waiting");
  });
  it("a pending request is unchanged: waiting", () => {
    seed("Prepared the message for Sam."); action({ status: "pending" });
    expect(chain().status).toBe("waiting");
  });
  it("an executed request is unchanged: it still confirms", () => {
    seed(); action({ status: "executed", result: "FAKE RECEIPT", executedAt: "2026-11-15T11:00:00Z" });
    expect(kinds()).toContain("action_executed");
    expect(kinds()).not.toContain("action_outcome_unknown");
    expect(chain().evidence).toBe(1);
  });
  it("a failed request is unchanged: contradicted", () => {
    seed(); action({ status: "failed", error: "FAKE FAILURE", executedAt: "2026-11-15T11:00:00Z" });
    expect(chain().status).toBe("contradicted");
    expect(kinds()).not.toContain("action_outcome_unknown");
  });
  it("the owner's statement is shown as theirs and never becomes evidence or confirmation", () => {
    seed(); action(); reconcile("did_happen");
    const v = chain();
    expect(v.evidence).toBe(0);
    expect(v.status).toBe("unverified");
    expect(v.checks.find((c) => c.kind === "action_outcome_unknown")!.detail).toContain("You recorded that it did happen; that is your statement and is not checked by the platform.");
    expect(kinds()).not.toContain("claim_supported");
  });
  it("'did not happen' and 'cannot tell' are worded plainly", () => {
    seed(); action(); reconcile("did_not_happen");
    expect(chain().checks.find((c) => c.kind === "action_outcome_unknown")!.detail).toContain("You recorded that it did not happen.");
    reconcile("cannot_tell");
    const detail = chain().checks.find((c) => c.kind === "action_outcome_unknown")!.detail;
    expect(detail).not.toContain("You recorded");
  });
  it("another request's recorded answer does not apply", () => {
    seed(); action(); reconcile("did_happen", "44444444-4444-4444-8444-444444444444");
    expect(chain().checks.find((c) => c.kind === "action_outcome_unknown")!.detail).not.toContain("You recorded");
  });
  it("changes nothing in the records", () => {
    seed(); action();
    const before = JSON.stringify(db.prepare("SELECT * FROM approval_requests").all());
    chain();
    expect(JSON.stringify(db.prepare("SELECT * FROM approval_requests").all())).toBe(before);
  });
});
