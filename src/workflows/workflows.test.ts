import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { AuditLog } from "../audit/audit.js";
import { openDatabase } from "../db/database.js";
import { LlmError } from "../llm/errors.js";
import { OK_RESULT } from "../llm/test-helpers.js";
import type { CompletionRequest, CompletionResult } from "../llm/types.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { evaluateCondition, renderTemplate, validateGraph, type Graph } from "./graph.js";
import { WORKFLOW_LIMITS, WorkflowService } from "./service.js";
import { switchOn } from "../llm/test-helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const fence = "```";
const telegram = {
  id: "telegram" as const,
  label: "Telegram",
  actions: {
    send_message: {
      kind: "write" as const,
      description: "Send",
      args: z.strictObject({ chat: z.string().min(1), text: z.string().min(1) }),
      summarize: (a: Record<string, unknown>) => `Send "${a["text"]}" to ${a["chat"]}`,
      execute: async () => "sent",
    },
  },
};

let t: TestApp;
let ref: string;
let botA: string;
let botB: string;
type Responder = (req: CompletionRequest, botName: string | null) => CompletionResult | LlmError | null | Promise<CompletionResult | LlmError | null>;
let respond: Responder;
const seen: { bot: string | null; user: string }[] = [];

beforeEach(async () => {
  seen.length = 0;
  t = await createTestApp({ connectors: [telegram as any] });
  ref = await setupGeminiModel(t);
  await t.call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000 });
  botA = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Alpha", model: ref }))).body.bot.id;
  botB = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Beta", model: ref }))).body.bot.id;
  respond = () => null;
  const original = t.provider.complete.bind(t.provider);
  t.provider.complete = async (req) => {
    const name = /You are "([^"]+)"/.exec(req.messages[0]!.content)?.[1] ?? null;
    seen.push({ bot: name, user: String(req.messages.at(-1)?.content ?? "") });
    const r = await respond(req, name);
    if (r === null) return original(req);
    t.provider.calls.push(req);
    if (r instanceof LlmError) throw r;
    return r;
  };
});
afterEach(async () => {
  await t.app.close();
  vi.unstubAllEnvs();
});

const text = (s: string): CompletionResult => ({ ...OK_RESULT, text: s });
const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, label: id, x: 0, y: 0, ...extra });
const start = (extra: Record<string, unknown> = {}) => node("start", "trigger", { kind: "manual", ...extra });
const edge = (from: string, to: string, when = "always") => ({ id: `${from}-${to}`, from, to, when });
const task = (id: string, botId: string, instruction: string, extra: Record<string, unknown> = {}) => node(id, "bot_task", { botId, instruction, retries: 0, ...extra });
const make = async (graph: unknown, name = "Flow") => (await t.call("POST", "/api/workflows", { name, graph })).body.workflow as any;
const runIt = async (id: string, input = "") => {
  const res = await t.call("POST", `/api/workflows/${id}/run`, { input });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  await t.app.workflows.idle();
  return (await t.call("GET", `/api/workflows/runs/${res.body.run.id}`)).body.run as any;
};
const step = (run: any, id: string) => run.steps.find((s: any) => s.nodeId === id);
const linear = (botId = botA) => ({ nodes: [start(), task("work", botId, "Do: {{input}}"), node("end", "end")], edges: [edge("start", "work"), edge("work", "end")] });

describe("the shape of a workflow", () => {
  const g = (nodes: any[], edges: any[] = []): Graph => ({ nodes, edges }) as any;
  const problems = (graph: Graph) => validateGraph(graph).map((p) => p.message);

  it("a valid workflow has no problems", () => {
    expect(problems(g([start(), task("a", botA ?? "x", "hi"), node("e", "end")], [edge("start", "a"), edge("a", "e")]))).toEqual([]);
  });

  it.each([
    ["no Start box", g([node("e", "end")]), /needs one Start/],
    ["two Start boxes", g([start(), node("s2", "trigger", { kind: "manual" })]), /only one Start/],
    ["an event Start with no name", g([start({ kind: "event" })]), /no event name/],
    ["an interval Start with no minutes", g([start({ kind: "interval" })]), /no number of minutes/],
    ["a loop", g([start(), node("a", "set", { value: "x" }), node("b", "set", { value: "y" })], [edge("start", "a"), edge("a", "b"), edge("b", "a")]), /loop/],
    ["a box pointing at itself", g([start(), node("a", "set", { value: "x" })], [edge("start", "a"), edge("a", "a")]), /point at itself/],
    ["an arrow to nowhere", g([start()], [edge("start", "ghost")]), /does not exist/],
    ["a box nothing leads to", g([start(), node("a", "set", { value: "x" })]), /not connected/],
    ["an arrow into Start", g([start(), node("a", "set", { value: "x" })], [edge("start", "a"), edge("a", "start")]), /Start box|loop/],
    ["an arrow leaving End", g([start(), node("e", "end"), node("a", "set", { value: "x" })], [edge("start", "e"), edge("e", "a")]), /Nothing can follow an End/],
    ["true/false from a non-If box", g([start(), node("a", "set", { value: "x" })], [edge("start", "a", "true")]), /Only an If box/],
    ["an If box with plain arrows", g([start(), node("c", "condition", { left: "x", op: "not_empty", value: "" }), node("e", "end")], [edge("start", "c"), edge("c", "e")]), /must say true or false/],
    ["two true arrows", g([start(), node("c", "condition", { left: "x", op: "not_empty", value: "" }), node("a", "end"), node("b", "end")], [edge("start", "c"), edge("c", "a", "true"), edge("c", "b", "true")]), /only one true arrow/],
    ["duplicate box names", g([start(), node("a", "end"), node("a", "end")], [edge("start", "a")]), /share the name/],
  ])("explains: %s", (_name, graph, expected) => {
    expect(problems(graph).join(" | ")).toMatch(expected);
  });

  it("the server refuses malformed graphs outright (unknown fields, too many boxes, bad types)", async () => {
    const many = Array.from({ length: 26 }, (_, i) => node(`n${i}`, "end"));
    for (const bad of [{ nodes: [], edges: [] }, { nodes: [start()], edges: [], extra: 1 }, { nodes: [{ ...start(), kind: "weird" }], edges: [] }, { nodes: many, edges: [] }, { nodes: [start(), node("x", "shell", { command: "calc" })], edges: [] }, { nodes: [task("a", "not-a-uuid", "x")], edges: [] }]) {
      expect((await t.call("POST", "/api/workflows", { name: "Bad", graph: bad })).status, JSON.stringify(bad).slice(0, 60)).toBe(400);
    }
  });

  it("templates only fill in {{input}} and {{box}} and are clipped; conditions compare text", () => {
    const scope = { input: "IN", outputs: new Map([["a", "OUT-A"], ["big", "x".repeat(5000)]]) };
    expect(renderTemplate("{{input}} / {{a}} / {{a.output}} / {{ a }} / {{missing}} / {{$(calc)}} / {{process.env}}", scope)).toBe("IN / OUT-A / OUT-A / OUT-A /  / {{$(calc)}} / {{process.env}}");
    expect(renderTemplate("{{big}}", scope).length).toBeLessThan(3010);
    expect([evaluateCondition("contains", "Hello World", "world"), evaluateCondition("not_contains", "abc", "z"), evaluateCondition("equals", " Yes ", "yes"), evaluateCondition("not_equals", "a", "b"), evaluateCondition("not_empty", "  ", ""), evaluateCondition("longer_than", "12345", "3")]).toEqual([true, true, true, true, false, true]);
  });
});

describe("checking a drawing without saving it", () => {
  it("lists the problems in plain words, and a malformed drawing is reported instead of crashing", async () => {
    const ok = await t.call("POST", "/api/workflows/validate", { graph: linear() });
    expect(ok.body.problems).toEqual([]);
    const bad = await t.call("POST", "/api/workflows/validate", { graph: { nodes: [start(), node("a", "set", { value: "x" })], edges: [] } });
    expect(bad.body.problems[0].message).toMatch(/not connected/);
    const junk = await t.call("POST", "/api/workflows/validate", { graph: { nodes: "nope" } });
    expect(junk.status).toBe(200);
    expect(junk.body.problems[0].message).toMatch(/not valid/);
    expect((await t.call("GET", "/api/workflows")).body.workflows).toHaveLength(0); // nothing was saved
  });
});

describe("saving and switching on", () => {
  it("a new workflow starts OFF, has version history, and cannot be switched on while it has problems", async () => {
    const broken = await make({ nodes: [start(), node("lonely", "set", { value: "x" })], edges: [] }, "Broken");
    expect(broken).toMatchObject({ enabled: false, version: 1 });
    expect(broken.problems.length).toBeGreaterThan(0);
    const res = await t.call("POST", `/api/workflows/${broken.id}/enable`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("workflow_has_problems");
    const good = await make(linear(), "Good");
    expect((await t.call("POST", `/api/workflows/${good.id}/enable`)).body.workflow.enabled).toBe(true);
    expect((await t.call("POST", `/api/workflows/${good.id}/disable`)).body.workflow.enabled).toBe(false);
  });

  it("an edit is a new permanent version, and an edit that breaks it switches it off", async () => {
    const w = await make(linear());
    await t.call("POST", `/api/workflows/${w.id}/enable`);
    const same = await t.call("PATCH", `/api/workflows/${w.id}`, { graph: w.graph });
    expect(same.body.workflow.version).toBe(1);
    const edited = await t.call("PATCH", `/api/workflows/${w.id}`, { graph: { ...w.graph, nodes: w.graph.nodes.map((n: any) => (n.id === "work" ? { ...n, instruction: "New text" } : n)) }, note: "reworded" });
    expect(edited.body.workflow).toMatchObject({ version: 2, enabled: true });
    const broke = await t.call("PATCH", `/api/workflows/${w.id}`, { graph: { nodes: [start(), node("x", "set", { value: "1" })], edges: [] } });
    expect(broke.body.workflow).toMatchObject({ version: 3, enabled: false });
    expect((await t.call("GET", `/api/workflows/${w.id}`)).body.workflow.versions.map((v: any) => v.version)).toEqual([3, 2, 1]);
  });

  it("names are unique, workflows are archived not deleted, and can be duplicated", async () => {
    const w = await make(linear(), "One");
    expect((await t.call("POST", "/api/workflows", { name: "One", graph: linear() })).body.error).toBe("name_taken");
    const copy = (await t.call("POST", `/api/workflows/${w.id}/duplicate`)).body.workflow;
    expect(copy).toMatchObject({ name: "Copy of One", enabled: false });
    expect((await t.call("DELETE", `/api/workflows/${w.id}`)).status).toBe(404);
    await t.call("POST", `/api/workflows/${w.id}/enable`);
    const arch = (await t.call("POST", `/api/workflows/${w.id}/archive`)).body.workflow;
    expect(arch).toMatchObject({ archived: true, enabled: false });
    expect((await t.call("GET", "/api/workflows")).body.workflows.map((x: any) => x.name)).toEqual(["Copy of One"]);
    expect((await t.call("POST", `/api/workflows/${w.id}/run`, {})).body.error).toBe("workflow_archived");
  });
});

describe("running", () => {
  it("runs boxes in order, passes results forward with {{ }}, and saves each result", async () => {
    respond = (_r, bot) => (bot === "Alpha" ? text("RESEARCH DONE") : bot === "Beta" ? text("WRITTEN") : null);
    const w = await make({ nodes: [start(), task("research", botA, "Research {{input}}"), task("write", botB, "Write about: {{research}} (asked: {{input}})"), node("end", "end")], edges: [edge("start", "research"), edge("research", "write"), edge("write", "end")] });
    const run = await runIt(w.id, "cats");
    expect(run.status).toBe("completed");
    expect(run.steps.map((s: any) => [s.nodeId, s.status])).toEqual([["start", "completed"], ["research", "completed"], ["write", "completed"], ["end", "completed"]]);
    expect(step(run, "write").output).toBe("WRITTEN");
    expect(seen.find((s) => s.bot === "Beta")!.user).toContain("Write about: RESEARCH DONE (asked: cats)");
    expect(run.trigger).toBe("manual");
  });

  it("branches: only the arrow that matches the condition is followed, the other side is skipped", async () => {
    respond = (_r, bot) => (bot === "Alpha" ? text("URGENT: server down") : text("handled"));
    const w = await make({
      nodes: [start(), task("check", botA, "Check"), node("urgent", "condition", { left: "{{check}}", op: "contains", value: "urgent" }), task("page", botB, "Page the owner: {{check}}"), node("later", "set", { value: "log it" }), node("end", "end")],
      edges: [edge("start", "check"), edge("check", "urgent"), edge("urgent", "page", "true"), edge("urgent", "later", "false"), edge("page", "end"), edge("later", "end")],
    });
    const run = await runIt(w.id);
    expect(run.status).toBe("completed");
    expect(step(run, "urgent").output).toBe("true");
    expect(step(run, "page").status).toBe("completed");
    expect(step(run, "later").status).toBe("skipped");
    expect(seen.filter((s) => s.bot === "Beta")).toHaveLength(1);

    respond = (_r, bot) => (bot === "Alpha" ? text("all quiet") : text("handled"));
    const quiet = await runIt(w.id);
    expect(step(quiet, "page").status).toBe("skipped");
    expect(step(quiet, "later")).toMatchObject({ status: "completed", output: "log it" });
  });

  it("starts boxes that do not depend on each other together, and waits for both before the join", async () => {
    respond = (_r, bot) => text(`from ${bot}`);
    const w = await make({ nodes: [start(), task("a", botA, "A"), task("b", botB, "B"), node("join", "set", { value: "{{a}} + {{b}}" })], edges: [edge("start", "a"), edge("start", "b"), edge("a", "join"), edge("b", "join")] });
    const run = await runIt(w.id);
    expect(step(run, "join").output).toBe("from Alpha + from Beta");
  });

  it("a failed box fails the run, skips what depended on it, and says which box and why", async () => {
    respond = (_r, bot) => (bot === "Alpha" ? new LlmError("bad_request", "the model refused") : text("fine"));
    const w = await make({ nodes: [start(), task("one", botA, "x"), task("two", botB, "y"), node("end", "end")], edges: [edge("start", "one"), edge("one", "two"), edge("two", "end")] });
    const run = await runIt(w.id);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/Box "one" failed/);
    expect(step(run, "one")).toMatchObject({ status: "failed" });
    expect(step(run, "two").status).toBe("skipped");
    expect(seen.filter((s) => s.bot === "Beta")).toHaveLength(0);
  });

  it("a Manager box runs a Manager request and uses its result", async () => {
    t.provider.script.push({ ...OK_RESULT, text: '{"mode":"direct","answer":"The answer is 42"}' });
    const w = await make({ nodes: [start(), node("ask", "manager", { goal: "What is {{input}}?" }), node("keep", "set", { value: "Got: {{ask}}" })], edges: [edge("start", "ask"), edge("ask", "keep")] });
    const run = await runIt(w.id, "life");
    expect(step(run, "keep").output).toBe("Got: The answer is 42");
  });

  it("a Manager box records which workflow run and box started the Manager run, and the step links to the same run (D-111)", async () => {
    t.provider.script.push({ ...OK_RESULT, text: '{"mode":"direct","answer":"42"}' });
    const w = await make({ nodes: [start(), node("ask", "manager", { goal: "What is {{input}}?" })], edges: [edge("start", "ask")] });
    const run = await runIt(w.id, "life");
    const origins = ((await t.call("GET", "/api/audit?limit=200")).body.events as any[]).filter((e) => e.kind === "manager.origin");
    expect(origins).toHaveLength(1);
    expect(origins[0].detail).toMatchObject({ originKind: "workflow", workflowRunId: run.id, nodeId: "ask" });
    expect(step(run, "ask").refId).toBe(origins[0].detail.managerRunId);
  });

  it("a bot box can be retried automatically (when allowed) but never after it asked for an outside action", async () => {
    let n = 0;
    respond = (_r, bot) => (bot === "Alpha" ? (++n === 1 ? new LlmError("bad_request", "first try fails") : text("second try works")) : null);
    const w = await make({ nodes: [start(), task("flaky", botA, "x", { retries: 1 })], edges: [edge("start", "flaky")] });
    const run = await runIt(w.id);
    expect(run.status).toBe("completed");
    expect(step(run, "flaky").attempts).toBe(2);

    // now a bot that asks to send a message and then fails: the retry must NOT happen (it would ask twice)
    await t.call("PUT", `/api/bots/${botB}/permissions/telegram`, { readEnabled: false });
    let m = 0;
    respond = (_r, bot) => {
      if (bot !== "Beta") return null;
      m++;
      return m === 1 ? text(`${fence}action\n${JSON.stringify({ connector: "telegram", action: "send_message", args: { chat: "sam", text: "hi" } })}\n${fence}`) : m === 2 ? new LlmError("bad_request", "then it crashed") : text("never");
    };
    const w2 = await make({ nodes: [start(), task("risky", botB, "x", { retries: 2 })], edges: [edge("start", "risky")] }, "Risky");
    const run2 = await runIt(w2.id);
    expect(run2.status).toBe("failed");
    expect(step(run2, "risky").attempts).toBe(1);
    expect((await t.call("GET", "/api/approvals?status=pending")).body.approvals).toHaveLength(1); // one request, not two
  });
});

describe("checkpoints (a person decides)", () => {
  const gated = () => ({ nodes: [start(), task("draft", botA, "Draft"), node("gate", "checkpoint", { message: "OK to continue? Draft: {{draft}}" }), task("send", botB, "Send: {{draft}}")], edges: [edge("start", "draft"), edge("draft", "gate"), edge("gate", "send")] });

  it("stops and waits, shows the message, and carries on only after approval", async () => {
    respond = (_r, bot) => text(bot === "Alpha" ? "DRAFT TEXT" : "sent");
    const w = await make(gated());
    const run = await runIt(w.id);
    expect(run.status).toBe("waiting");
    expect(step(run, "gate")).toMatchObject({ status: "waiting", output: "OK to continue? Draft: DRAFT TEXT" });
    expect(seen.filter((s) => s.bot === "Beta")).toHaveLength(0);
    const list = (await t.call("GET", "/api/workflows")).body;
    expect(list.waiting).toEqual([{ runId: run.id, workflowName: "Flow", nodeId: "gate", message: "OK to continue? Draft: DRAFT TEXT" }]);

    const approved = await t.call("POST", `/api/workflows/runs/${run.id}/steps/gate/approve`);
    expect(approved.status).toBe(200);
    await t.app.workflows.idle();
    const done = (await t.call("GET", `/api/workflows/runs/${run.id}`)).body.run;
    expect(done.status).toBe("completed");
    expect(step(done, "gate")).toMatchObject({ status: "completed", decidedBy: "owner" });
    expect(seen.filter((s) => s.bot === "Beta")).toHaveLength(1);
    expect(seen.filter((s) => s.bot === "Alpha")).toHaveLength(1); // the first box was NOT run again after the pause
    expect((await t.call("POST", `/api/workflows/runs/${run.id}/steps/gate/approve`)).body.error).toBe("step_not_waiting");
  });

  it("rejecting ends the run as cancelled and nothing after it runs", async () => {
    respond = () => text("x");
    const run = await runIt((await make(gated())).id);
    await t.call("POST", `/api/workflows/runs/${run.id}/steps/gate/reject`);
    await t.app.workflows.idle();
    const done = (await t.call("GET", `/api/workflows/runs/${run.id}`)).body.run;
    expect(done.status).toBe("cancelled");
    expect(done.error).toMatch(/Stopped at a checkpoint by owner/);
    expect(step(done, "send").status).toBe("skipped");
    expect(JSON.stringify((await t.call("GET", "/api/audit?limit=100")).body)).toContain("workflow.checkpoint_rejected");
  });

  it("a paired phone can decide a checkpoint, and it is recorded with the phone's name", async () => {
    const phone = await createTestApp({ remoteHosts: ["my-pc.tail1234.ts.net"] });
    const ref2 = await setupGeminiModel(phone);
    const bot = (await phone.call("POST", "/api/bots", { name: "P", model: ref2 })).body.bot.id;
    const w = (await phone.call("POST", "/api/workflows", { name: "W", graph: { nodes: [start(), node("gate", "checkpoint", { message: "Go?" }), node("e", "end")], edges: [edge("start", "gate"), edge("gate", "e")] } })).body.workflow;
    void bot;
    const { body } = await phone.call("POST", "/api/devices/pairing");
    const h = { host: "my-pc.tail1234.ts.net", origin: "https://my-pc.tail1234.ts.net", "x-awp-client": "dashboard" };
    const paired = await phone.app.inject({ method: "POST", url: "/api/devices/pair", payload: { code: body.code, name: "Pixel" }, headers: h });
    const hh = { ...h, cookie: String(paired.headers["set-cookie"]).split(";")[0]! };
    const started = await phone.app.inject({ method: "POST", url: `/api/workflows/${w.id}/run`, payload: {}, headers: hh });
    expect(started.statusCode).toBe(202);
    await phone.app.workflows.idle();
    const runId = started.json().run.id;
    expect((await phone.app.inject({ method: "POST", url: `/api/workflows/runs/${runId}/steps/gate/approve`, payload: {}, headers: hh })).statusCode).toBe(200);
    await phone.app.workflows.idle();
    expect((await phone.call("GET", `/api/workflows/runs/${runId}`)).body.run.steps.find((s: any) => s.nodeId === "gate").decidedBy).toBe("device:Pixel");
    // ...but a phone cannot create, edit, switch on, duplicate or retry
    for (const [method, url, payload] of [["POST", "/api/workflows", { name: "X", graph: linear() }], ["PATCH", `/api/workflows/${w.id}`, { name: "Y" }], ["POST", `/api/workflows/${w.id}/enable`, {}], ["POST", `/api/workflows/${w.id}/duplicate`, {}], ["POST", `/api/workflows/${w.id}/archive`, {}], ["POST", `/api/workflows/runs/${runId}/steps/gate/retry`, {}]] as const) {
      const r = await phone.app.inject({ method, url, payload, headers: hh });
      expect(r.statusCode, url).toBe(403);
    }
    await phone.app.close();
  });
});

describe("starting by themselves (only when switched on)", () => {
  const eventFlow = (eventName = "inbox") => ({ nodes: [start({ kind: "event", eventName }), node("note", "set", { value: "Got: {{input}}" })], edges: [edge("start", "note")] });

  it("an event starts a workflow only if it is ON and waiting for that name; the same event twice in a minute runs once", async () => {
    const w = await make(eventFlow());
    await t.call("POST", "/api/events", { name: "inbox", text: "hello" });
    await t.app.workflows.idle();
    expect((await t.call("GET", "/api/workflows")).body.runs).toHaveLength(0); // it was OFF
    await t.call("POST", `/api/workflows/${w.id}/enable`);
    await t.call("POST", "/api/events", { name: "other", text: "hello" });
    await t.call("POST", "/api/events", { name: "INBOX", text: "hello" });
    await t.call("POST", "/api/events", { name: "inbox", text: "hello" });
    await t.app.workflows.idle();
    const runs = (await t.call("GET", "/api/workflows")).body.runs;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "completed", trigger: "event", input: "hello" });
    expect(step(runs[0], "note").output).toBe("Got: hello");
    t.clock.t += WORKFLOW_LIMITS.dedupeMs + 1000;
    await t.call("POST", "/api/events", { name: "inbox", text: "hello" });
    await t.call("POST", "/api/events", { name: "inbox", text: "something else" });
    await t.app.workflows.idle();
    expect((await t.call("GET", "/api/workflows")).body.runs).toHaveLength(3);
  });

  it("an interval workflow runs every N minutes, never makes up missed times, and not while OFF", async () => {
    const w = await make({ nodes: [start({ kind: "interval", everyMinutes: 30 }), node("note", "set", { value: "tick" })], edges: [edge("start", "note")] });
    t.clock.t += 60 * 60_000;
    expect(t.app.workflows.tickSchedules()).toBe(0); // OFF
    await t.call("POST", `/api/workflows/${w.id}/enable`);
    expect(t.app.workflows.tickSchedules()).toBe(0); // counting starts when switched on
    t.clock.t += 29 * 60_000;
    expect(t.app.workflows.tickSchedules()).toBe(0);
    t.clock.t += 2 * 60_000;
    expect(t.app.workflows.tickSchedules()).toBe(1);
    t.clock.t += 5 * 3_600_000; // the PC "slept" for five hours
    expect(t.app.workflows.tickSchedules()).toBe(1); // one run, not ten
    await t.app.workflows.idle();
    expect((await t.call("GET", "/api/workflows")).body.runs.map((r: any) => r.trigger)).toEqual(["schedule", "schedule"]);
  });

  it("the automation pause switch holds everything: nothing starts, queued runs wait, and they carry on afterwards", async () => {
    const w = await make(eventFlow("inbox"));
    await t.call("POST", `/api/workflows/${w.id}/enable`);
    await t.call("PUT", "/api/automation/pause", { paused: true });
    await t.call("POST", "/api/events", { name: "inbox", text: "a" });
    expect((await t.call("GET", "/api/workflows")).body.runs).toHaveLength(0);
    const manual = await t.call("POST", `/api/workflows/${w.id}/run`, { input: "m" });
    await t.app.workflows.idle();
    expect((await t.call("GET", `/api/workflows/runs/${manual.body.run.id}`)).body.run.status).toBe("queued");
    await t.call("PUT", "/api/automation/pause", { paused: false });
    await t.app.workflows.idle();
    expect((await t.call("GET", `/api/workflows/runs/${manual.body.run.id}`)).body.run.status).toBe("completed");
  });
});

describe("limits", () => {
  it("daily limits per workflow, and a cap on runs alive at once", async () => {
    const w = await make({ nodes: [start(), node("n", "set", { value: "x" })], edges: [edge("start", "n")] });
    for (let i = 0; i < WORKFLOW_LIMITS.runsPerDayPerWorkflow; i++) {
      expect((await t.call("POST", `/api/workflows/${w.id}/run`, {})).status).toBe(202);
      await t.app.workflows.idle();
    }
    expect((await t.call("POST", `/api/workflows/${w.id}/run`, {})).body.error).toBe("workflow_daily_limit");

    const slow = await make({ nodes: [start(), node("g", "checkpoint", { message: "wait" })], edges: [edge("start", "g")] }, "Waits");
    const ids: string[] = [];
    for (let i = 0; i < WORKFLOW_LIMITS.alive; i++) {
      const r = await t.call("POST", `/api/workflows/${slow.id}/run`, {});
      expect(r.status).toBe(202);
      ids.push(r.body.run.id);
      await t.app.workflows.idle();
    }
    expect((await t.call("POST", `/api/workflows/${slow.id}/run`, {})).body.error).toBe("workflow_busy");
    await t.call("POST", `/api/workflows/runs/${ids[0]}/cancel`);
    expect((await t.call("POST", `/api/workflows/${slow.id}/run`, {})).status).toBe(202);
  });

  it("cancel stops a run that is working and cancels the bot task it started", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    respond = async (_r, bot) => {
      if (bot === "Alpha") await gate;
      return text("late");
    };
    const w = await make(linear());
    const res = await t.call("POST", `/api/workflows/${w.id}/run`, {});
    await vi.waitFor(() => expect(seen.filter((s) => s.bot === "Alpha")).toHaveLength(1), { timeout: 2000 });
    await t.call("POST", `/api/workflows/runs/${res.body.run.id}/cancel`);
    release();
    await t.app.workflows.idle();
    const run = (await t.call("GET", `/api/workflows/runs/${res.body.run.id}`)).body.run;
    expect(run.status).toBe("cancelled");
    expect(run.steps.map((s: any) => s.status)).not.toContain("running");
  });

  it("a run follows the graph it started with, even if the workflow is edited meanwhile", async () => {
    const w = await make({ nodes: [start(), node("g", "checkpoint", { message: "wait" }), node("a", "set", { value: "OLD" })], edges: [edge("start", "g"), edge("g", "a")] });
    const run = await runIt(w.id);
    await t.call("PATCH", `/api/workflows/${w.id}`, { graph: { nodes: [start(), node("g", "checkpoint", { message: "wait" }), node("a", "set", { value: "NEW" })], edges: [edge("start", "g"), edge("g", "a")] } });
    await t.call("POST", `/api/workflows/runs/${run.id}/steps/g/approve`);
    await t.app.workflows.idle();
    expect(step((await t.call("GET", `/api/workflows/runs/${run.id}`)).body.run, "a").output).toBe("OLD");
    expect((await t.call("GET", `/api/workflows/runs/${run.id}`)).body.run.workflowVersion).toBe(1);
  });
});

describe("restarting (the saved state a crash leaves behind)", () => {
  const BOT = "11111111-1111-4111-8111-111111111111";
  const tasks = new Map<string, any>();
  const submitted: string[] = [];
  let db: DatabaseSync;
  let wf: WorkflowService;
  let wfId: string;

  const build = () =>
    new WorkflowService({
      db,
      audit: new AuditLog(db, () => 1_000_000),
      now: () => 1_000_000,
      engine: {
        submit: (_bot: string, instruction: string) => {
          const id = `T${tasks.size + 1}`;
          submitted.push(instruction);
          tasks.set(id, { id, rootId: id, status: "completed", result: `result of: ${instruction}`, errorMessage: null, assigneeName: "Bot" });
          return tasks.get(id);
        },
        cancel: () => ({}) as any,
      } as any,
      getTask: (id: string) => tasks.get(id),
      manager: { start: () => ({}) as any, view: () => ({ status: "completed", result: "m" }) as any, cancel: () => ({}) as any } as any,
      botExists: () => true,
      automationPaused: () => false,
      pollMs: 1,
    });

  /** Writes what a crash would leave: a run that was 'running', with some boxes in the given states. */
  const seed = (graph: any, states: Record<string, { status: string; output?: string; refKind?: string; refId?: string }>) => {
    const runId = "run-1";
    db.prepare("INSERT INTO workflow_runs (id, workflow_id, workflow_version, graph, status, trigger, input, input_hash, created_at) VALUES (?, ?, 1, ?, 'running', 'manual', 'IN', 'h', '2026-01-01T00:00:00.000Z')").run(runId, wfId, JSON.stringify(graph));
    for (const n of graph.nodes) {
      const st = states[n.id] ?? { status: "pending" };
      db.prepare("INSERT INTO workflow_steps (run_id, node_id, status, output, ref_kind, ref_id, attempts) VALUES (?, ?, ?, ?, ?, ?, 1)").run(runId, n.id, st.status, st.output ?? null, st.refKind ?? null, st.refId ?? null);
    }
    return runId;
  };
  const graph = { nodes: [start(), task("mid", BOT, "middle: {{input}}"), task("later", BOT, "after: {{mid}}")], edges: [edge("start", "mid"), edge("mid", "later")] };

  beforeEach(() => {
    tasks.clear();
    submitted.length = 0;
    db = openDatabase(":memory:");
    wf = build();
    wfId = wf.create({ name: "Crashy", graph }).id;
  });
  afterEach(() => db.close());

  it("keeps finished boxes, and starts boxes that never started", async () => {
    const runId = seed(graph, { start: { status: "completed", output: "IN" }, mid: { status: "completed", output: "MID DONE" } });
    const after = build();
    expect(after.recover()).toBe(1);
    await after.idle();
    expect(after.runView(runId).status).toBe("completed");
    expect(submitted).toEqual(["after: MID DONE"]); // only the box that had not started ran; mid was not repeated
  });

  it("a box that was running a bot task which never finished is NOT started a second time: it fails with a clear reason, and the rest is skipped", async () => {
    tasks.set("T0", { id: "T0", rootId: "T0", status: "running", result: null, errorMessage: null, assigneeName: "Bot" });
    const runId = seed(graph, { start: { status: "completed", output: "IN" }, mid: { status: "running", refKind: "task", refId: "T0" } });
    const after = build();
    after.recover();
    await after.idle();
    const run = after.runView(runId);
    expect(run.status).toBe("failed");
    expect(run.steps.find((s) => s.nodeId === "mid")).toMatchObject({ status: "failed", error: expect.stringMatching(/not started again/) });
    expect(run.steps.find((s) => s.nodeId === "later")!.status).toBe("skipped");
    expect(submitted).toEqual([]); // nothing was submitted a second time
  });

  it("if the bot task had actually finished before the restart, its result is taken and the run carries on", async () => {
    tasks.set("T0", { id: "T0", rootId: "T0", status: "completed", result: "FINISHED JUST BEFORE", errorMessage: null, assigneeName: "Bot" });
    const runId = seed(graph, { start: { status: "completed", output: "IN" }, mid: { status: "running", refKind: "task", refId: "T0" } });
    const after = build();
    after.recover();
    await after.idle();
    expect(after.runView(runId).status).toBe("completed");
    expect(submitted).toEqual(["after: FINISHED JUST BEFORE"]);
  });

  it("a box that had not started anything outside yet (crashed before submitting) is simply started", async () => {
    const runId = seed(graph, { start: { status: "completed", output: "IN" }, mid: { status: "running" } });
    const after = build();
    after.recover();
    await after.idle();
    expect(after.runView(runId).status).toBe("completed");
    expect(submitted).toEqual(["middle: IN", "after: result of: middle: IN"]);
  });

  it("a run that was waiting at a checkpoint stays waiting (it is not restarted or decided)", async () => {
    const g = { nodes: [start(), node("gate", "checkpoint", { message: "ok?" }), node("e", "end")], edges: [edge("start", "gate"), edge("gate", "e")] };
    const id = wf.create({ name: "Gated", graph: g }).id;
    db.prepare("INSERT INTO workflow_runs (id, workflow_id, workflow_version, graph, status, trigger, input, input_hash, created_at) VALUES ('r2', ?, 1, ?, 'waiting', 'manual', '', 'h', '2026-01-01T00:00:00.000Z')").run(id, JSON.stringify(g));
    for (const [n, st] of [["start", "completed"], ["gate", "waiting"], ["e", "pending"]] as [string, string][]) db.prepare("INSERT INTO workflow_steps (run_id, node_id, status) VALUES ('r2', ?, ?)").run(n, st);
    const after = build();
    expect(after.recover()).toBe(0);
    await after.idle();
    expect(after.runView("r2").status).toBe("waiting");
  });

  it("Retry runs a failed box again (once the cause is fixed), then the rest follows; only failed boxes can be retried", async () => {
    tasks.set("T0", { id: "T0", rootId: "T0", status: "running", result: null, errorMessage: null, assigneeName: "Bot" });
    const runId = seed(graph, { start: { status: "completed", output: "IN" }, mid: { status: "running", refKind: "task", refId: "T0" } });
    const after = build();
    after.recover();
    await after.idle();
    expect(after.runView(runId).status).toBe("failed");
    const retried = after.retryStep(runId, "mid");
    expect(retried.status).toBe("queued");
    await after.idle();
    expect(after.runView(runId).status).toBe("completed");
    expect(() => after.retryStep(runId, "mid")).toThrow(/Only a failed box/);
  });

  it("Retry is refused for a box whose task already asked for an outside action (it could do the same thing twice)", async () => {
    // Real bot row so the approval request can exist.
    db.prepare("INSERT INTO bots (id, name, created_at, updated_at) VALUES (?, 'B', 't', 't')").run(BOT);
    tasks.set("T0", { id: "T0", rootId: "T0", status: "running", result: null, errorMessage: null, assigneeName: "Bot" });
    const runId = seed(graph, { start: { status: "completed", output: "IN" }, mid: { status: "running", refKind: "task", refId: "T0" } });
    db.prepare("INSERT INTO approval_requests (id, bot_id, task_id, connector, action, summary, args_json, args_hash, status, created_at, expires_at) VALUES ('a1', ?, 'T0', 'telegram', 'send_message', 's', '{}', 'h', 'pending', 't', 't')").run(BOT);
    const after = build();
    after.recover();
    await after.idle();
    expect(() => after.retryStep(runId, "mid")).toThrow(/already asked for an outside action/);
  });
});
