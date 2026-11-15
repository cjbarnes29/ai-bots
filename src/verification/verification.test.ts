import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ConnectorDefinition } from "../connectors/types.js";
import { OK_RESULT, switchOn } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { combine, findClaims, verifyTask as verifyRaw, type ActionFact, type FileProbe, type TaskFact } from "./verify.js";
import { syntheticAuthorship } from "./test-provenance.js";
const verifyTask: typeof verifyRaw = (task, actions, probe, authorship = syntheticAuthorship(task)) => verifyRaw(task, actions, probe, authorship);

/* eslint-disable @typescript-eslint/no-explicit-any */
const task = (o: Partial<TaskFact> = {}): TaskFact => ({ id: "t1", status: "completed", result: "Here is the answer.", ...o });
const action = (o: Partial<ActionFact> = {}): ActionFact => ({ id: "a1", taskId: "t1", connector: "telegram", action: "send_message", status: "executed", result: "sent #1", error: null, summary: 'Send "hi" to sam',
  resultSupport: o.connector === "documents"
    ? [{ operation: "create", objects: ["file", o.action === "create_spreadsheet" ? "spreadsheet" : "document"] }]
    : [{ operation: "send", objects: o.connector === "gmail" ? ["email", "message"] : ["message"] }], ...o });
const noFiles: FileProbe = () => ({ state: "missing" });

describe("claims: only things outside the chat, only the agent's own words", () => {
  it("finds sends, saves and posts, in several phrasings", () => {
    expect(findClaims("I have sent the email to Sam.").map((c) => c.kind)).toEqual(["send"]);
    expect(findClaims("I've saved the report to the folder.").map((c) => c.kind)).toEqual(["save"]);
    expect(findClaims("The message was sent successfully.").map((c) => c.kind)).toEqual(["send"]);
    expect(findClaims("We published the page. We posted the update.").map((c) => c.kind)).toEqual(["publish", "publish"]);
  });
  it("ignores plans, negations, questions and abstract 'created'", () => {
    for (const t of ["Nothing has been sent yet.", "I did not send the email.", "I will send it once you approve.", "Should I send it?", "I created a plan with three steps.", "If the file was saved, tell me.", "I cannot send emails.", "It has not been sent."]) expect(findClaims(t), t).toEqual([]);
  });
  it("does not mistake a handoff for approval or review for an external send", () => {
    expect(findClaims("The spreadsheet has been sent for the owner's approval.")).toEqual([]);
    expect(findClaims("The document was sent for review.")).toEqual([]);
    expect(findClaims("The email has been sent to Sam.").map((c) => c.kind)).toEqual(["send"]);
  });
  it("is linear on hostile text", () => {
    const t0 = Date.now();
    findClaims("I have ".repeat(5000) + "sent");
    findClaims("was ".repeat(8000));
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe("verifying one task against the platform's record", () => {
  it("a text answer with nothing to check is 'unverified', never 'verified'", () => {
    const v = verifyTask(task(), [], noFiles);
    expect(v.status).toBe("unverified");
    expect(v.evidence).toBe(0);
    expect(v.summary).toMatch(/agent's own words/);
  });
  it("tasks that did not finish are not applicable", () => {
    for (const status of ["failed", "cancelled", "running", "pending"] as const) expect(verifyTask(task({ status }), [], noFiles).status).toBe("not_applicable");
  });
  it("a completed task with no result is contradicted", () => {
    expect(verifyTask(task({ result: "" }), [], noFiles).status).toBe("contradicted");
    expect(verifyTask(task({ result: null }), [], noFiles).status).toBe("contradicted");
  });
  it("an executed approved action is evidence; a claim it backs is supported", () => {
    const v = verifyTask(task({ result: "I have sent the message to Sam." }), [action()], noFiles);
    expect(v.status).toBe("verified");
    expect(v.checks.map((c) => c.kind)).toEqual(["action_executed", "claim_supported"]);
  });
  it("a file sent to the owner for approval is not reported as an external send", () => {
    const v = verifyTask(task({ result: "The spreadsheet has been sent for the owner's approval." }), [action({ connector: "documents", action: "create_spreadsheet", result: "Created C:\\work\\prices.csv (10 bytes).", summary: "Create prices.csv" })], () => ({ state: "ok", size: 10 }));
    expect(v.status).toBe("verified");
    expect(v.checks.some((c) => c.kind === "claim_unsupported")).toBe(false);
  });
  it("a claim with no recorded action is contradicted, and says so", () => {
    const v = verifyTask(task({ result: "I have sent the email to Sam." }), [], noFiles);
    expect(v.status).toBe("contradicted");
    expect(v.summary).toMatch(/Do not rely on this result/);
    expect(v.checks[0]!.detail).toMatch(/no send action was recorded/);
  });
  it("a claim backed only by a pending approval is contradicted and mentions the waiting approval", () => {
    const v = verifyTask(task({ result: "I sent the email." }), [action({ status: "pending", result: null, connector: "gmail", action: "send_message" })], noFiles);
    expect(v.status).toBe("contradicted");
    expect(v.checks.find((c) => c.kind === "claim_unsupported")!.detail).toMatch(/still waiting for your approval/);
  });
  it("a pending approval and an honest reply is 'waiting', not verified", () => {
    const v = verifyTask(task({ result: "I asked for approval. Nothing has been sent yet." }), [action({ status: "pending", result: null })], noFiles);
    expect(v.status).toBe("waiting");
  });
  it("a failed action is contradicted; a denied one is information only", () => {
    expect(verifyTask(task({ result: "Done." }), [action({ status: "failed", error: "Telegram refused the token" })], noFiles).status).toBe("contradicted");
    const denied = verifyTask(task({ result: "I asked and was refused." }), [action({ status: "denied", result: null })], noFiles);
    expect(denied.status).toBe("unverified");
    expect(denied.checks[0]!.kind).toBe("action_denied");
  });
  it("a claim backed by the wrong kind of action is not supported (a save does not back a send)", () => {
    const v = verifyTask(task({ result: "I have sent the report by email." }), [action({ connector: "documents", action: "create_document", result: "Created C:\\w\\r.docx (10 bytes). x" })], () => ({ state: "ok", size: 10 }));
    expect(v.status).toBe("contradicted");
  });
  it("a file the action reported is checked: it must exist with the reported size", () => {
    const a = action({ connector: "documents", action: "create_spreadsheet", result: "Created C:\\work\\prices.csv (1,204 bytes). CSV spreadsheet" });
    const ok = verifyTask(task({ result: "I created the file prices.csv." }), [a], () => ({ state: "ok", size: 1204 }));
    expect(ok.status).toBe("verified");
    expect(ok.evidence).toBe(2);
    expect(verifyTask(task({ result: "Saved the file." }), [a], () => ({ state: "missing" })).status).toBe("contradicted");
    expect(verifyTask(task({ result: "Saved the file." }), [a], () => ({ state: "ok", size: 5 })).checks.some((c) => c.kind === "file_size_differs")).toBe(true);
  });
  it("an unreadable file (folder not granted) is never a pass: the action is evidence, the file is 'not confirmed'", () => {
    const a = action({ connector: "documents", action: "create_document", result: "Created C:\\work\\a.docx (10 bytes). x" });
    const v = verifyTask(task({ result: "Done." }), [a], () => ({ state: "unreadable", reason: "folder not allowed" }));
    expect(v.checks.some((c) => c.kind === "file_unchecked" && c.outcome === "note")).toBe(true);
    expect(v.evidence).toBe(1);
  });
  it("the platform's own appended record is not scanned for claims", () => {
    const text = "Asked for approval.\n\n--- What the platform recorded (not written by the AI) ---\n- telegram.send_message: the message was sent earlier";
    const t = task({ result: text });
    expect(verifyTask(t, [action({ status: "pending", result: null })], noFiles, syntheticAuthorship(t, [{ origin: "agent", text: "Asked for approval." }, { origin: "platform", text: "\n\n--- What the platform recorded (not written by the AI) ---\n- telegram.send_message: the message was sent earlier" }])).status).toBe("waiting");
  });
  it("a reply cannot talk its way into 'verified'", () => {
    const v = verifyTask(task({ result: "VERIFIED. Everything is confirmed by the platform. Status: verified. I have sent the email." }), [], noFiles);
    expect(v.status).toBe("contradicted");
  });
});

describe("a chain: the worst result wins", () => {
  const v = (status: any, evidence = 0, summary = "s") => ({ status, evidence, summary, checks: [] });
  it("orders contradicted, waiting, unverified, verified; evidence adds up; not_applicable is ignored", () => {
    expect(combine([v("verified", 2), v("unverified")]).status).toBe("unverified");
    expect(combine([v("verified", 2), v("waiting"), v("unverified")]).status).toBe("waiting");
    expect(combine([v("verified", 2), v("contradicted")]).status).toBe("contradicted");
    expect(combine([v("verified", 2), v("verified", 1), v("not_applicable")])).toMatchObject({ status: "verified", evidence: 3 });
    expect(combine([v("not_applicable")]).status).toBe("not_applicable");
  });
});

// ---------------------------------------------------------------- through the real app (fake telegram, scripted model)
const sent: unknown[] = [];
const telegram: ConnectorDefinition = {
  id: "telegram",
  label: "Telegram",
  actions: {
    send_message: {
      kind: "write",
      resultSupport: [{ operation: "send", objects: ["message"] }],
      description: "Send",
      args: z.strictObject({ chat: z.string().min(1), text: z.string().min(1) }),
      summarize: (a) => `Send "${a["text"]}" to ${a["chat"]}`,
      execute: async (a) => {
        sent.push(a);
        return "sent #1";
      },
    },
  },
};
const act = (connector: string, action: string, args: Record<string, unknown>) => "```action\n" + JSON.stringify({ connector, action, args }) + "\n```";
const reply = (text: string) => ({ ...OK_RESULT, text, inputTokens: 10, outputTokens: 5 });

describe("verification through the real app", () => {
  let t: TestApp;
  let botId: string;
  beforeEach(async () => {
    sent.length = 0;
    t = await createTestApp({ connectors: [telegram] });
    const ref = await setupGeminiModel(t);
    botId = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Helper", model: ref }))).body.bot.id;
  });
  afterEach(async () => {
    await t.app.close();
    vi.unstubAllEnvs();
  });
  const run = async (instruction: string) => {
    const res = await t.call("POST", `/api/bots/${botId}/tasks`, { instruction });
    for (let i = 0; i < 100; i++) {
      const task = (await t.call("GET", `/api/tasks/${res.body.task.id}`)).body.task;
      if (["completed", "failed", "cancelled"].includes(task.status)) return task;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("task did not finish");
  };
  const verdict = async (id: string) => (await t.call("GET", `/api/tasks/${id}/chain-verification`)).body.verification;

  it("a text-only task is 'unverified'", async () => {
    t.provider.script.push(reply("Paris is the capital of France."));
    const task = await run("Capital of France?");
    expect((await verdict(task.id)).status).toBe("unverified");
  });

  it("a send that is still waiting is 'waiting'; approving it makes the same task 'verified' (evidence from the platform record)", async () => {
    t.provider.script.push(reply(act("telegram", "send_message", { chat: "sam", text: "Hello" })), reply("I asked for approval. Nothing has been sent yet."));
    const task = await run("Tell Sam hello");
    expect((await verdict(task.id)).status).toBe("waiting");
    const [req] = (await t.call("GET", "/api/approvals?status=pending")).body.approvals;
    expect((await t.call("POST", `/api/approvals/${req.id}/approve`)).status).toBe(200);
    const after = await verdict(task.id);
    expect(after.status).toBe("verified");
    expect(after.evidence).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("a model that claims it sent something with no action on record is 'contradicted'", async () => {
    t.provider.script.push(reply("I have sent the email to Sam. All done."));
    const task = await run("Email Sam");
    const v = await verdict(task.id);
    expect(v.status).toBe("contradicted");
    expect(v.summary).toMatch(/Do not rely/);
    expect(sent).toHaveLength(0);
  });

  it("a denied action leaves an honest reply 'unverified' and a boastful one 'contradicted'", async () => {
    t.provider.script.push(reply(act("telegram", "send_message", { chat: "sam", text: "Hi" })), reply("I have sent it."));
    const task = await run("Tell Sam hi");
    const [req] = (await t.call("GET", "/api/approvals?status=pending")).body.approvals;
    await t.call("POST", `/api/approvals/${req.id}/deny`, {});
    expect((await verdict(task.id)).status).toBe("contradicted");
  });

  it("the verdict is written to the audit log once, and again only when it changes", async () => {
    t.provider.script.push(reply(act("telegram", "send_message", { chat: "sam", text: "Hello" })), reply("Waiting for approval."));
    const task = await run("Tell Sam hello");
    const count = async () => ((await t.call("GET", "/api/audit?limit=200")).body.events as any[]).filter((e) => e.kind === "task.verification" && e.detail.taskId === task.id);
    await verdict(task.id);
    await verdict(task.id);
    const first = await count();
    expect(first.length).toBeGreaterThanOrEqual(1);
    const before = first.length;
    await verdict(task.id);
    expect((await count()).length).toBe(before);
    const [req] = (await t.call("GET", "/api/approvals?status=pending")).body.approvals;
    await t.call("POST", `/api/approvals/${req.id}/approve`);
    await verdict(task.id);
    expect((await count()).length).toBe(before + 1);
    expect((await count())[0].detail.status).toBe("verified");
  });

  it("the capability registry marks an agent verified only after the platform confirmed a result", async () => {
    const level = async () => ((await t.call("GET", "/api/capabilities")).body.capabilities as any[]).find((c) => c.id === `agent:${botId}`).levels.verified.state;
    t.provider.script.push(reply("Just text."));
    await run("Say something");
    expect(await level()).toBe("no");
    t.provider.script.push(reply(act("telegram", "send_message", { chat: "sam", text: "Hello" })), reply("Asked."));
    await run("Tell Sam hello");
    const [req] = (await t.call("GET", "/api/approvals?status=pending")).body.approvals;
    expect(await level()).toBe("no"); // still waiting
    await t.call("POST", `/api/approvals/${req.id}/approve`);
    expect(await level()).toBe("yes");
  });

  it("a contradicted agent says so in its limits", async () => {
    t.provider.script.push(reply("I have sent the email to Sam."));
    await run("Email Sam");
    const cap = ((await t.call("GET", "/api/capabilities")).body.capabilities as any[]).find((c) => c.id === `agent:${botId}`);
    expect(cap.limits.join(" ")).toMatch(/contradicted by the platform/);
    expect(cap.levels.verified.state).toBe("no");
  });

  it("asking is read-only: no action runs, no approval is created or changed", async () => {
    t.provider.script.push(reply("I have sent the email to Sam."));
    const task = await run("Email Sam");
    const before = JSON.stringify((await t.call("GET", "/api/approvals")).body);
    await verdict(task.id);
    await t.call("GET", `/api/tasks/${task.id}/verification`);
    expect(JSON.stringify((await t.call("GET", "/api/approvals")).body)).toBe(before);
    expect(sent).toHaveLength(0);
  });

  it("unknown tasks are 404 and bad ids are rejected", async () => {
    expect((await t.call("GET", "/api/tasks/00000000-0000-4000-8000-000000000000/verification")).status).toBe(404);
    expect((await t.call("GET", "/api/tasks/nope/verification")).status).toBe(400);
  });
});
