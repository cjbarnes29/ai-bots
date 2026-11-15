import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OK_RESULT, switchOn } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { assessExecution, assessmentBlocks } from "./execution-policy.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const BLOCKED = "Deploy the website to production and buy a domain";
const reply = (text: string) => ({ ...OK_RESULT, text, inputTokens: 10, outputTokens: 5 });

describe("shared execution assessment (scripted fake provider, no network)", () => {
  let t: TestApp;
  let bot: any;
  beforeEach(async () => {
    t = await createTestApp();
    const model = await setupGeminiModel(t);
    bot = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Helper", model }))).body.bot;
  });
  afterEach(async () => {
    await t.app.close();
    vi.restoreAllMocks();
  });
  const roots = async () => (await t.call("GET", "/api/tasks")).body.tasks as any[];
  const settle = () => vi.waitFor(async () => expect((await roots()).every(x => ["completed", "failed", "cancelled"].includes(x.status))).toBe(true), { timeout: 4000, interval: 10 });
  const schedule = async (instruction: string) => {
    const made = await t.call("POST", "/api/schedules", { name: "Test schedule", botId: bot.id, instruction, kind: "interval", intervalMinutes: 15 });
    expect(made.status).toBe(201);
    const started = await t.call("POST", `/api/schedules/${made.body.schedule.id}/run-now`);
    expect(started.body.outcome.status).toBe("started");
    return started.body.outcome.taskId as string;
  };
  const executionEvents = async () => ((await t.call("GET", "/api/audit?limit=200")).body.events as any[]).filter(x => x.kind === "capability.assessed" && x.detail.phase === "execution");

  it("scheduled work is recorded as failed before any provider call when explicitly prohibited", async () => {
    const id = await schedule(BLOCKED);
    await settle();
    expect((await roots()).find(x => x.id === id)).toMatchObject({ status: "failed", errorCode: "task_unsupported", llmCalls: 0 });
    expect(t.provider.calls).toHaveLength(0);
    expect(await executionEvents()).toEqual(expect.arrayContaining([expect.objectContaining({ detail: expect.objectContaining({ taskId: id, source: "schedule", refused: true }) })]));
  });

  it("event-triggered work cannot skip assessment", async () => {
    const made = await t.call("POST", "/api/triggers", { name: "Test trigger", botId: bot.id, source: "event", eventName: "test.event", instructionTemplate: BLOCKED });
    expect(made.status).toBe(201);
    expect((await t.call("PATCH", `/api/triggers/${made.body.trigger.id}`, { enabled: true })).status).toBe(200);
    await t.call("POST", "/api/events", { name: "test.event", text: "go" });
    await settle();
    expect(await roots()).toEqual([expect.objectContaining({ status: "failed", errorCode: "task_unsupported", origin: "trigger" })]);
    expect(t.provider.calls).toHaveLength(0);
  });

  it("group mentions receive the same execution assessment", async () => {
    await t.call("PUT", "/api/groups/enabled", { on: true });
    const group = await t.call("POST", "/api/groups", { name: "Test group", botIds: [bot.id] });
    expect(group.status).toBe(201);
    const sent = await t.call("POST", `/api/groups/${group.body.group.id}/messages`, { content: `@Helper ${BLOCKED}` });
    expect(sent.body.started).toHaveLength(1);
    await settle();
    expect((await roots())[0]).toMatchObject({ status: "failed", errorCode: "task_unsupported" });
    expect(t.provider.calls).toHaveLength(0);
  });

  it("decision assignments receive the same execution assessment", async () => {
    const made = await t.call("POST", "/api/decisions", { title: "Example decision", options: [{ title: "Draft a summary" }, { title: "Draft a checklist" }] });
    expect(made.status).toBe(201);
    const d = made.body.decision;
    expect((await t.call("PUT", `/api/decisions/${d.id}/choice`, { optionId: d.options[0].id })).status).toBe(200);
    const approved = await t.call("POST", `/api/decisions/${d.id}/approve`, { assignments: [{ botId: bot.id, duty: BLOCKED }] });
    expect(approved.status).toBe(200);
    await settle();
    expect((await roots())[0]).toMatchObject({ status: "failed", errorCode: "task_unsupported", llmCalls: 0 });
    expect(t.provider.calls).toHaveLength(0);
  });

  it.each(["bot_task", "manager"])("workflow %s steps assess before their first model call", async (type) => {
    const node = type === "bot_task" ? { botId: bot.id, instruction: BLOCKED } : { goal: BLOCKED };
    const graph = { nodes: [{ id: "start", type: "trigger", kind: "manual", x: 0, y: 0 }, { id: "work", type, ...node, x: 100, y: 0 }, { id: "end", type: "end", x: 200, y: 0 }], edges: [{ id: "a", from: "start", to: "work", when: "always" }, { id: "b", from: "work", to: "end", when: "always" }] };
    const made = await t.call("POST", "/api/workflows", { name: "Test workflow", graph });
    expect(made.status).toBe(201);
    const started = await t.call("POST", `/api/workflows/${made.body.workflow.id}/run`, { proceedAnyway: true });
    expect(started.status).toBe(202);
    await t.app.workflows.idle();
    const run = t.app.workflows.runView(started.body.run.id);
    expect(run.status).toBe("failed");
    expect(t.provider.calls).toHaveLength(0);
    expect((await executionEvents()).some(e => e.detail.via === (type === "manager" ? "manager" : "task") && e.detail.refused)).toBe(true);
  });

  it("an internal Manager start is assessed without going through HTTP", async () => {
    const run = t.app.manager.start(BLOCKED, {}, "workflow");
    await t.app.manager.idle();
    expect(t.app.manager.view(run.id)).toMatchObject({ status: "failed", modelCalls: 0, error: expect.stringMatching(/No model call/) });
    expect(t.provider.calls).toHaveLength(0);
  });

  it("retains ordinary scheduled text fallback for unavailable non-policy features", async () => {
    t.provider.script.push(reply("Here are draft research questions."));
    const id = await schedule("Research competitors and draft a checklist");
    await settle();
    expect((await roots()).find(x => x.id === id)?.status).toBe("completed");
    expect(t.provider.calls).toHaveLength(1);
  });

  it("preserves an explicit direct-task best-effort choice through execution", async () => {
    t.provider.script.push(reply("I can draft a deployment checklist; nothing was deployed."));
    const started = await t.call("POST", `/api/bots/${bot.id}/tasks`, { instruction: BLOCKED, proceedAnyway: true });
    expect(started.status).toBe(202);
    await settle();
    expect((await roots())[0]?.status).toBe("completed");
    expect(t.provider.calls).toHaveLength(1);
    expect((await executionEvents())[0]?.detail).toMatchObject({ proceedAnyway: true, refused: false });
    expect((await t.call("GET", `/api/bots/${bot.id}`)).body.bot.permissions).toEqual(bot.permissions);
    expect((await t.call("GET", "/api/approvals")).body.approvals).toHaveLength(0);
  });

  it("preserves an explicit Manager best-effort choice through execution", async () => {
    t.provider.script.push(reply(JSON.stringify({ mode: "direct", answer: "Here is a planning checklist only." })));
    const started = await t.call("POST", "/api/manager/runs", { goal: BLOCKED, proceedAnyway: true });
    expect(started.status).toBe(202);
    await t.app.manager.idle();
    expect(t.app.manager.view(started.body.run.id).status).toBe("completed");
    expect(t.provider.calls).toHaveLength(1);
  });

  it("assesses delegated children and does not inherit the root's best-effort override", async () => {
    const child = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Child", model: bot.model }))).body.bot;
    await t.call("PUT", `/api/bots/${bot.id}/delegation`, { targetBotIds: [child.id] });
    const block = "```delegate\n" + JSON.stringify({ to: "Child", task: BLOCKED }) + "\n```";
    t.provider.script.push(reply(block), reply("The child could not do that; here is a checklist."));
    const started = await t.call("POST", `/api/bots/${bot.id}/tasks`, { instruction: BLOCKED, proceedAnyway: true });
    expect(started.status).toBe(202);
    await settle();
    const tree = (await t.call("GET", `/api/tasks/${started.body.task.id}`)).body;
    expect(tree.task.children).toEqual(expect.arrayContaining([expect.objectContaining({ parentId: started.body.task.id, status: "failed", errorCode: "task_unsupported", llmCalls: 0 })]));
    expect(t.provider.calls).toHaveLength(2); // root before/after delegation; no child call
    expect((await executionEvents()).some(e => e.detail.source === "delegated_child" && e.detail.refused && e.detail.proceedAnyway === false)).toBe(true);
  });

  it("fails closed when the assessment service rejects, with no provider call", async () => {
    vi.spyOn(t.app.capabilities, "assess").mockRejectedValue(new Error("Unavailable assessment"));
    const id = await schedule("Draft a summary");
    await settle();
    expect((await roots()).find(x => x.id === id)?.status).toBe("failed");
    expect(t.provider.calls).toHaveLength(0);
  });

  it("the root's best-effort choice does not leak to a later scheduled task", async () => {
    t.provider.script.push(reply("A checklist only."));
    expect((await t.call("POST", `/api/bots/${bot.id}/tasks`, { instruction: BLOCKED, proceedAnyway: true })).status).toBe(202);
    const id = await schedule(BLOCKED);
    await settle();
    expect((await roots()).find(x => x.id === id)).toMatchObject({ status: "failed", errorCode: "task_unsupported" });
    expect(t.provider.calls).toHaveLength(1);
  });

  it("internal Manager planning also fails closed when assessment is unavailable", async () => {
    vi.spyOn(t.app.capabilities, "assess").mockRejectedValue(new Error("Assessment offline"));
    const run = t.app.manager.start("Draft a summary", {}, "workflow");
    await t.app.manager.idle();
    expect(t.app.manager.view(run.id)).toMatchObject({ status: "failed", modelCalls: 0 });
    expect(t.provider.calls).toHaveLength(0);
  });

  it("cancelling Manager planning during assessment prevents the first provider call", async () => {
    const assessment = await t.app.capabilities.assess("Draft a summary");
    let finish!: () => void;
    vi.spyOn(t.app.capabilities, "assess").mockImplementation(() => new Promise(resolve => { finish = () => resolve(assessment); }));
    const run = t.app.manager.start("Draft a summary", {}, "workflow");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    t.app.manager.cancel(run.id);
    finish();
    await t.app.manager.idle();
    expect(t.app.manager.view(run.id).status).toBe("cancelled");
    expect(t.provider.calls).toHaveLength(0);
  });

  it("cancelling during an assessment prevents a later provider call", async () => {
    const assessment = await t.app.capabilities.assess("Draft a summary");
    let finish!: () => void;
    vi.spyOn(t.app.capabilities, "assess").mockImplementation(() => new Promise(resolve => { finish = () => resolve(assessment); }));
    const id = await schedule("Draft a summary");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await t.call("POST", `/api/tasks/${id}/cancel`);
    finish();
    await settle();
    expect((await roots()).find(x => x.id === id)?.status).toBe("cancelled");
    expect(t.provider.calls).toHaveLength(0);
  });

  it("a missing registry cannot silently permit execution", async () => {
    await expect(assessExecution(undefined, { record: vi.fn() }, { kind: "task", id: "example", goal: "Summarize", source: "schedule", proceedAnyway: false })).rejects.toMatchObject({ code: "capabilities_unavailable" });
  });

  it("shares the established Manager/task refusal predicates without blocking text fallback", async () => {
    const prohibited = await t.app.capabilities.assess(BLOCKED);
    expect(assessmentBlocks(prohibited, "task")).toBe(true);
    expect(assessmentBlocks(prohibited, "manager")).toBe(true);
    const unavailable = await t.app.capabilities.assess("Research businesses on the web");
    expect(assessmentBlocks(unavailable, "task")).toBe(false);
  });
});
