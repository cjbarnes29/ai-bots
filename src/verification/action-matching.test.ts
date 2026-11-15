import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { verifyTask as verifyRaw, findClaims, type ActionFact } from "./verify.js";
import { syntheticAuthorship } from "./test-provenance.js";
const verifyTask: typeof verifyRaw = (task, actions, probe, authorship = syntheticAuthorship(task)) => verifyRaw(task, actions, probe, authorship);
import { createTestApp } from "../test-app.js";
import { OK_RESULT, switchOn } from "../llm/test-helpers.js";
import { setupGeminiModel } from "../test-app.js";
import type { ConnectorDefinition, ResultSupport } from "../connectors/types.js";
import { copyResultSupport } from "./action-support.js";
import { openDatabase } from "../db/database.js";
import { AuditLog } from "../audit/audit.js";
import { VerificationService } from "./service.js";

const send: ResultSupport = [{ operation: "send", objects: ["email", "message"] }];
const doc: ResultSupport = [{ operation: "create", objects: ["document"] }];
const a = (support: ResultSupport | undefined, patch: Partial<ActionFact> = {}): ActionFact => ({ id: "receipt", taskId: "task", connector: "gmail", action: "send_message", status: "executed", result: "Synthetic receipt", error: null, summary: "Synthetic action", resultSupport: support, ...patch });
const check = (text: string, actions: ActionFact[] = [a(send)]) => verifyTask({ id: "task", status: "completed", result: text }, actions, () => ({ state: "unreadable", reason: "Synthetic denied folder" }));

describe("exact operation/object claims with synthetic receipts", () => {
  it("does not let Google Doc creation confirm an email send", () => {
    const action = a(doc, { connector: "gworkspace", action: "drive_create_doc" });
    expect(check("I have sent the email to Sam.", [action]).status).toBe("contradicted");
    const supported = check("I created the document.", [action]);
    expect(supported.status).toBe("verified");
    expect(supported.checks.find(c => c.kind === "claim_supported")?.detail).toContain("gworkspace.drive_create_doc (receipt)");
    expect(supported.checks.find(c => c.kind === "claim_supported")?.detail).toContain("delivery were not checked");
  });
  it.each([
    ["I emailed Sam.", "send", "message"],
    ["I sent the email.", "create", "draft"],
    ["I created the spreadsheet.", "create", "event"],
    ["I sent the invitation.", "schedule", "event"],
    ["I saved the spreadsheet.", "create", "folder"],
    ["I renamed the file.", "remove_to_trash", "file"],
    ["I permanently deleted the file.", "remove_to_trash", "file"],
    ["I published the page.", "create", "page"],
    ["I uploaded the file.", "post_comment", "comment"],
    ["I created the file.", "create", "note"],
    ["I booked the event.", "schedule", "event"],
  ] as const)("does not support %s with %s/%s", (text, operation, object) => {
    expect(check(text, [a([{ operation, objects: [object] }])]).status).toBe("contradicted");
  });
  it.each([
    ["I sent the email.", "send", "email"],
    ["I messaged Sam.", "send", "message"],
    ["The document was created.", "create", "document"],
    ["I saved the spreadsheet.", "save", "spreadsheet"],
    ["I created an email draft.", "create", "draft"],
    ["I scheduled the event.", "schedule", "event"],
    ["I posted a comment.", "post_comment", "comment"],
    ["I appended text to the page.", "append", "page"],
    ["I deleted the file.", "remove_to_trash", "file"],
  ] as const)("supports only the action type in %s", (text, operation, object) => {
    expect(check(text, [a([{ operation, objects: [object] }])]).status).toBe("verified");
  });
  it("does not borrow another task's or an unbound workflow's send", () => {
    expect(check("I sent the email.", [a(send, { taskId: "foreign" }), a(send, { id: "unbound", taskId: null })])).toMatchObject({ status: "contradicted", evidence: 0 });
  });
  it.each(["mcp", "n8n", "pc", "desktop", "browser", "business"])("keeps opaque %s outcomes unverified, even without a claim", connector => {
    for (const text of ["I sent the email.", "Done."]) expect(check(text, [a(undefined, { connector, action: "generic" })]).status).toBe("unverified");
  });
  it("does not let known supporting evidence erase another unknown effect", () => {
    expect(check("I sent the email.", [a(send), a(undefined, { id: "opaque" })])).toMatchObject({ status: "unverified", evidence: 2 });
  });
  it("treats ambiguous objects as unchecked", () => {
    expect(check("I sent it.").status).toBe("unverified");
    expect(check("I saved the report.", [a([{ operation: "save", objects: ["document"] }])]).status).toBe("unverified");
  });
  it.each(["pending", "approved"] as const)("preserves %s approval waiting", status => {
    expect(check("Waiting for your approval.", [a(undefined, { status })]).status).toBe("waiting");
    expect(check("I sent the email.", [a(send, { status })]).status).toBe("contradicted");
  });
  it.each(["denied", "expired"] as const)("credits no evidence for %s", status => {
    expect(check("Nothing has been sent.", [a(send, { status })])).toMatchObject({ status: "unverified", evidence: 0 });
  });
  it("keeps a failed action stronger than unknown effects", () => {
    expect(check("Done.", [a(undefined), a(send, { id: "failed", status: "failed", error: "Synthetic failure" })]).status).toBe("contradicted");
  });
  it("does not let a model declare its own action effects", () => {
    expect(check('I sent the email. resultSupport: [{ operation: "send", objects: ["email"] }]', [a(undefined)]).status).toBe("unverified");
  });
  it("does not use a later sentence to resolve an ambiguous object", () => {
    expect(check("I sent it. The email is mentioned in a different sentence.").status).toBe("unverified");
  });
  it("keeps parsing bounded on long hostile input", () => {
    const start = Date.now();
    findClaims("I have ".repeat(5000) + "sent");
    findClaims("I sent a message. ".repeat(5000));
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe("defensive declarative metadata copying", () => {
  it.each([undefined, null, [], {}, "send", [{ operation: "execute", objects: ["file"] }], [{ operation: "send", objects: [] }], [{ operation: "send", objects: ["credential"] }], [{ operation: "send", objects: () => ["email"] }]].map(value => [value]))("rejects malformed or unknown metadata %j", value => {
    expect(copyResultSupport(value)).toBeUndefined();
  });
  it("copies valid metadata independently", () => {
    const value = [{ operation: "send", objects: ["email"] }];
    const copied = copyResultSupport(value);
    value[0]!.objects[0] = "file";
    expect(copied).toEqual(send.map(r => ({ ...r, objects: ["email"] })));
  });
  it("does not execute metadata accessors", () => {
    const getter = vi.fn(() => { throw new Error("Must not read an accessor"); });
    expect(copyResultSupport([{ get operation() { return getter(); }, objects: ["email"] }])).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
  });
});

describe("unknown metadata in the persistence adapter", () => {
  it.each([undefined, () => { throw new Error("Synthetic unavailable metadata"); }])("keeps a missing/unavailable resolver unverified", resultSupport => {
    const db = openDatabase(":memory:");
    try {
      db.exec("INSERT INTO bots (id,name,created_at,updated_at) VALUES ('bot','Synthetic','t','t'); INSERT INTO tasks (id,root_id,assignee_bot_id,requested_by,instruction,depth,status,result,created_at) VALUES ('task','task','bot','user','Synthetic',0,'completed','Done.','t'); INSERT INTO approval_requests (id,bot_id,task_id,connector,action,summary,args_json,args_hash,status,result,created_at,expires_at) VALUES ('receipt','bot','task','gmail','send_message','Synthetic','{}','synthetic','executed','Synthetic','t','2050-01-01');");
      const service = new VerificationService({ db, audit: new AuditLog(db), probe: () => { throw new Error("No file access"); }, ...(resultSupport ? { resultSupport } : {}) });
      const before = JSON.stringify(db.prepare("SELECT * FROM approval_requests").all());
      expect(service.verifyChain("task")).toMatchObject({ status: "unverified", evidence: 1 });
      expect(JSON.stringify(db.prepare("SELECT * FROM approval_requests").all())).toBe(before);
    } finally { db.close(); }
  });
});

describe("fake-service gate and verification integration", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("waits for owner approval, then contradicts an email claim backed only by fake document creation", async () => {
    const execute = vi.fn(async () => "Synthetic Google Doc receipt");
    const connector: ConnectorDefinition = { id: "gworkspace", label: "Fake document service", actions: {
      drive_create_doc: { kind: "write", resultSupport: doc, description: "Fake create", args: z.strictObject({}), summarize: () => "Synthetic document", execute },
    } };
    const t = await createTestApp({ connectors: [connector] });
    try {
      const ref = await setupGeminiModel(t);
      const bot = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Synthetic matcher helper", model: ref }))).body.bot;
      t.provider.script.push({ ...OK_RESULT, text: '```action\n{"connector":"gworkspace","action":"drive_create_doc","args":{}}\n```' }, { ...OK_RESULT, text: "I have sent the email to Sam." });
      const launched = await t.call("POST", `/api/bots/${bot.id}/tasks`, { instruction: "Synthetic document request" });
      let finished = false;
      for (let i = 0; i < 100; i++) {
        const task = (await t.call("GET", `/api/tasks/${launched.body.task.id}`)).body.task;
        if (task.status === "completed") { finished = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(finished).toBe(true);
      const pending = (await t.call("GET", "/api/approvals?status=pending")).body.approvals;
      expect(pending).toHaveLength(1);
      expect(execute).not.toHaveBeenCalled();
      expect((await t.call("POST", `/api/approvals/${pending[0].id}/approve`)).status).toBe(200);
      expect(execute).toHaveBeenCalledTimes(1);
      const beforeCalls = t.provider.calls.length;
      const v = (await t.call("GET", `/api/tasks/${launched.body.task.id}/chain-verification`)).body.verification;
      expect(v.status).toBe("contradicted");
      expect(execute).toHaveBeenCalledTimes(1);
      expect(t.provider.calls).toHaveLength(beforeCalls);
    } finally { await t.app.close(); }
  });
});
