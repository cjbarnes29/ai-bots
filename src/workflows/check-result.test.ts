import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LlmError } from "../llm/errors.js";
import { OK_RESULT, switchOn } from "../llm/test-helpers.js";
import type { CompletionResult } from "../llm/types.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { graphSchema, validateGraph, type Graph } from "./graph.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The read-only "Check result" box: it reports the platform's own check of an earlier agent-task box and nothing else. Fake provider only. */
let t: TestApp;
let bot: string;
let reply: CompletionResult | LlmError;

beforeEach(async () => {
  t = await createTestApp();
  const ref = await setupGeminiModel(t);
  await t.call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000 });
  bot = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Alpha", model: ref }))).body.bot.id;
  reply = { ...OK_RESULT, text: "Here is a plain answer." };
  t.provider.complete = async (req) => {
    t.provider.calls.push(req);
    if (reply instanceof LlmError) throw reply;
    return reply;
  };
});
afterEach(async () => {
  await t.app.close();
});

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, label: id, x: 0, y: 0, ...extra });
const edge = (from: string, to: string, when = "always") => ({ id: `${from}-${to}`, from, to, when });
const start = () => node("start", "trigger", { kind: "manual" });
const work = () => node("work", "bot_task", { botId: bot, instruction: "Do: {{input}}", retries: 0 });
const check = (target = "work") => node("check", "check_result", { target });
const problems = (g: unknown) => validateGraph(g as Graph).map((p) => p.message).join(" | ");
const make = async (graph: unknown) => (await t.call("POST", "/api/workflows", { name: "Flow", graph })).body.workflow as any;
const runIt = async (id: string) => {
  const res = await t.call("POST", `/api/workflows/${id}/run`, { input: "go" });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  await t.app.workflows.idle();
  return (await t.call("GET", `/api/workflows/runs/${res.body.run.id}`)).body.run as any;
};
const step = (run: any, id: string) => run.steps.find((s: any) => s.nodeId === id);

describe("Check result box: shape", () => {
  it("accepts a check that comes after an agent-task box", () => {
    const g = { nodes: [start(), work(), check()], edges: [edge("start", "work"), edge("work", "check")] };
    expect(graphSchema.safeParse(g).success).toBe(true);
    expect(problems(g)).toBe("");
  });
  it("refuses a missing target, a non-agent target and a check placed before its target", () => {
    expect(problems({ nodes: [start(), check("ghost")], edges: [edge("start", "check")] })).toMatch(/does not exist/);
    expect(problems({ nodes: [start(), node("s", "set", { value: "x" }), check("s")], edges: [edge("start", "s"), edge("s", "check")] })).toMatch(/only look at an Agent task/);
    expect(problems({ nodes: [start(), work(), check()], edges: [edge("start", "check"), edge("start", "work")] })).toMatch(/must come after/);
  });
  it("the saved format stays strict: an unknown field is refused", () => {
    expect(graphSchema.safeParse({ nodes: [start(), { ...check(), extra: 1 }], edges: [] }).success).toBe(false);
  });
});

describe("Check result box: running", () => {
  it("outputs the platform's own verdict for the task, and makes no model call of its own", async () => {
    const w = await make({ nodes: [start(), work(), check(), node("end", "end")], edges: [edge("start", "work"), edge("work", "check"), edge("check", "end")] });
    const run = await runIt(w.id);
    expect(run.status).toBe("completed");
    const taskId = step(run, "work").refId;
    const expected = t.app.verification.verifyChain(taskId)!.status;
    expect(step(run, "check").output).toBe(expected);
    expect(step(run, "check").output).not.toBe("verified"); // a plain-text claim with no recorded action is never confirmed
    expect(t.provider.calls.length).toBe(1); // only the agent task called a model
  });
  it("a condition can branch on the verdict", async () => {
    const cond = node("c", "condition", { left: "{{check}}", op: "equals", value: "verified" });
    const g = { nodes: [start(), work(), check(), cond, node("yes", "set", { value: "confirmed" }), node("no", "set", { value: "not confirmed" })], edges: [edge("start", "work"), edge("work", "check"), edge("check", "c"), edge("c", "yes", "true"), edge("c", "no", "false")] };
    const run = await runIt((await make(g)).id);
    expect(step(run, "no").status).toBe("completed");
    expect(step(run, "yes").status).toBe("skipped");
  });
  it("a target that failed gives 'unverified', never a confirmation", async () => {
    reply = new LlmError("bad_request", "down");
    const w = await make({ nodes: [start(), work(), check()], edges: [edge("start", "work"), edge("work", "check")] });
    const run = await runIt(w.id);
    expect(step(run, "work").status).toBe("failed");
    expect(["skipped", "completed"]).toContain(step(run, "check").status); // skipped: nothing after a failed box runs
    expect(step(run, "check").output ?? "unverified").not.toBe("verified");
  });
  it("the run's result check treats the box as structural: it adds no evidence", async () => {
    const w = await make({ nodes: [start(), work(), check()], edges: [edge("start", "work"), edge("work", "check")] });
    const run = await runIt(w.id);
    const v = t.app.verification.verifyWorkflow(run.id)!;
    const s = v.steps.find((x: any) => x.nodeId === "check")!;
    expect(s.binding).toBe("structural");
    expect(v.supporting.status).not.toBe("verified");
  });
});
