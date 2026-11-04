import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LlmError } from "../llm/errors.js";
import type { CompletionRequest, CompletionResult } from "../llm/types.js";
import { OK_RESULT } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { parseJsonReply } from "./service.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const fence = "```";
const sent: unknown[] = [];
const telegram = {
  id: "telegram" as const,
  label: "Telegram",
  actions: {
    send_message: {
      kind: "write" as const,
      description: "Send",
      args: z.strictObject({ chat: z.string().min(1), text: z.string().min(1) }),
      summarize: (a: Record<string, unknown>) => `Send "${a["text"]}" to ${a["chat"]}`,
      execute: async (a: Record<string, unknown>) => {
        sent.push(a);
        return "sent";
      },
    },
  },
};

type Responder = (req: CompletionRequest, kind: "plan" | "step" | "review" | "bot") => CompletionResult | LlmError | null | Promise<CompletionResult | LlmError | null>;
let t: TestApp;
let ref: string;
let respond: Responder;
const seen: { kind: string; req: CompletionRequest }[] = [];
const text = (s: string): CompletionResult => ({ ...OK_RESULT, text: s });
const json = (o: unknown): CompletionResult => text(`Here you go:\n${fence}json\n${JSON.stringify(o)}\n${fence}`);

const kindOf = (req: CompletionRequest) => {
  const sys = req.messages[0]!.content;
  return sys.includes("You are the Manager of a small AI workforce") ? "plan" : sys.includes("checking finished work") ? "review" : sys.includes("ONE step of a larger job") ? "step" : "bot";
};

beforeEach(async () => {
  sent.length = 0;
  seen.length = 0;
  t = await createTestApp({ connectors: [telegram as any] });
  ref = await setupGeminiModel(t);
  respond = () => null;
  const original = t.provider.complete.bind(t.provider);
  t.provider.complete = async (req) => {
    const kind = kindOf(req);
    seen.push({ kind, req });
    const r = await respond(req, kind);
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

const mkBot = async (name: string, role = "Helper") => (await t.call("POST", "/api/bots", { name, role, model: ref, responsibilities: [`Does ${name} things`] })).body.bot as any;
const allow = (ids: string[]) => t.call("PUT", "/api/manager/settings", { allowedBots: ids });
const start = async (goal = "Do the thing", budget?: Record<string, number>) => {
  const res = await t.call("POST", "/api/manager/runs", { goal, ...(budget ? { budget } : {}) });
  expect(res.status).toBe(202);
  await t.app.manager.idle();
  return (await t.call("GET", `/api/manager/runs/${res.body.run.id}`)).body.run as any;
};
const calls = (kind: string) => seen.filter((s) => s.kind === kind).length;
const plan = (steps: any[]) => json({ mode: "plan", steps });
const step = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: `Step ${id}`, specialist: null, instruction: `Do ${id}`, dependsOn: [], ...extra });

describe("simple requests", () => {
  it("a request the Manager can answer itself takes ONE model call, no steps and no review", async () => {
    respond = (_r, kind) => (kind === "plan" ? json({ mode: "direct", answer: "Paris." }) : null);
    const run = await start("What is the capital of France?");
    expect(run).toMatchObject({ status: "completed", mode: "direct", result: "Paris.", modelCalls: 1, steps: [] });
    expect(run.inputTokens + run.outputTokens).toBe(15);
    expect(seen).toHaveLength(1);
  });

  it("the planning prompt is compact: only the request and the allowed specialists, no history", async () => {
    const bot = await mkBot("Writer", "Copywriter");
    await mkBot("Hidden", "Secret role");
    await allow([bot.id]);
    respond = (_r, kind) => (kind === "plan" ? json({ mode: "direct", answer: "ok" }) : null);
    await start("Short request");
    const sys = seen[0]!.req.messages[0]!.content;
    expect(sys).toContain(bot.id);
    expect(sys).toContain("Writer");
    expect(sys).not.toContain("Hidden");
    expect(seen[0]!.req.messages[1]!.content).toBe("Request:\nShort request");
    expect(sys.length).toBeLessThan(1500);
  });
});

describe("plans", () => {
  it("runs the steps in order, passes earlier results on, then checks and combines in one review call", async () => {
    respond = (req, kind) => {
      if (kind === "plan") return plan([step("s1"), step("s2", { dependsOn: ["s1"] })]);
      if (kind === "step") return text(req.messages[1]!.content.includes("Do s1") ? "RESULT-ONE" : "RESULT-TWO");
      if (kind === "review") return json({ verdict: "pass", issues: "", fixSteps: [], final: "FINAL: one and two" });
      return null;
    };
    const run = await start("Two things");
    expect(run).toMatchObject({ status: "completed", mode: "plan", result: "FINAL: one and two", revisions: 0, modelCalls: 4 });
    expect(run.steps.map((s: any) => [s.id, s.status, s.output])).toEqual([["s1", "completed", "RESULT-ONE"], ["s2", "completed", "RESULT-TWO"]]);
    const second = seen.filter((s) => s.kind === "step")[1]!.req.messages[1]!.content;
    expect(second).toContain("RESULT-ONE"); // the dependency's result reached the next step
    expect(calls("review")).toBe(1);
  });

  it("uses a specialist bot only when you allowed it, as a normal task, and the Manager's own call count stays low", async () => {
    const bot = await mkBot("Coder", "Programmer");
    await allow([bot.id]);
    respond = (_r, kind) => {
      if (kind === "plan") return plan([step("s1", { specialist: bot.id })]);
      if (kind === "bot") return text("SPECIALIST RESULT");
      if (kind === "review") return json({ verdict: "pass", final: "Combined: SPECIALIST RESULT" });
      return null;
    };
    const run = await start("Write code");
    expect(run.status).toBe("completed");
    expect(run.steps[0]).toMatchObject({ specialistId: bot.id, specialistName: "Coder", status: "completed", output: "SPECIALIST RESULT" });
    expect(run.steps[0].taskId).toBeTruthy();
    const task = (await t.call("GET", `/api/tasks/${run.steps[0].taskId}`)).body;
    expect(JSON.stringify(task)).toContain("Manager: Write code"); // labelled so you can see where it came from
    expect(run.modelCalls).toBe(3); // plan + the specialist's one call + review
  });

  it("ignores specialists you did not allow or that do not exist: the Manager does that step itself", async () => {
    const stranger = await mkBot("Stranger");
    respond = (_r, kind) => {
      if (kind === "plan") return plan([step("s1", { specialist: stranger.id }), step("s2", { specialist: "00000000-0000-4000-8000-000000000000" })]);
      if (kind === "step") return text("done by manager");
      if (kind === "review") return json({ verdict: "pass", final: "ok" });
      return null;
    };
    const run = await start();
    expect(run.steps.every((s: any) => s.specialistId === null && s.status === "completed")).toBe(true);
    expect(calls("bot")).toBe(0);
  });

  it("starts steps that do not depend on each other together, and skips steps whose dependency failed", async () => {
    respond = (req, kind) => {
      if (kind === "plan") return plan([step("s1"), step("s2"), step("s3", { dependsOn: ["s1", "s2"] })]);
      if (kind === "step") return req.messages[1]!.content.includes("Do s1") ? new LlmError("bad_request", "refused") : text("fine");
      if (kind === "review") return json({ verdict: "pass", final: "partial answer" });
      return null;
    };
    const run = await start();
    expect(run.steps.map((s: any) => [s.id, s.status])).toEqual([["s1", "failed"], ["s2", "completed"], ["s3", "skipped"]]);
    expect(run.steps[2].error).toMatch(/did not finish/);
    expect(run.status).toBe("completed");
    const review = seen.find((s) => s.kind === "review")!.req.messages[1]!.content;
    expect(review).toMatch(/s1.*failed/s); // the reviewer is told what failed
  });

  it("fails clearly when every step failed, instead of inventing a result", async () => {
    respond = (_r, kind) => (kind === "plan" ? plan([step("s1")]) : kind === "step" ? new LlmError("bad_request", "refused") : null);
    const run = await start();
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/Every step failed/);
    expect(calls("review")).toBe(0); // no review call is wasted when nothing worked
  });

  it("refuses a plan that uses the same step name twice, with a clear message", async () => {
    respond = (_r, kind) => (kind === "plan" ? plan([step("s1"), step("s1")]) : null);
    const run = await start();
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/same step name twice/);
    expect(run.steps).toHaveLength(0);
  });

  it("cuts a plan to the step budget and drops dependencies on later or unknown steps", async () => {
    respond = (_r, kind) => {
      if (kind === "plan") return plan([step("s1", { dependsOn: ["s2", "s9"] }), step("s2"), step("s3"), step("s4")]);
      if (kind === "step") return text("x");
      if (kind === "review") return json({ verdict: "pass", final: "ok" });
      return null;
    };
    const run = await start("Many", { maxSteps: 3 });
    expect(run.steps.map((s: any) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(run.steps[0].dependsOn).toEqual([]);
    expect(run.status).toBe("completed");
  });
});

describe("checking and correcting", () => {
  it("a review that finds a problem redoes the flagged step ONCE, then writes the final answer", async () => {
    let attempt = 0;
    respond = (req, kind) => {
      if (kind === "plan") return plan([step("s1")]);
      if (kind === "step") return text(`attempt ${++attempt}`);
      if (kind === "review") return attempt < 2 ? json({ verdict: "fix", issues: "too short", fixSteps: ["s1"], final: "draft" }) : json({ verdict: "pass", final: "FINAL after fix" });
      return null;
    };
    const run = await start();
    expect(run).toMatchObject({ status: "completed", result: "FINAL after fix", revisions: 1 });
    expect(run.steps[0]).toMatchObject({ attempts: 2, output: "attempt 2" });
    const redo = seen.filter((s) => s.kind === "step")[1]!.req.messages[1]!.content;
    expect(redo).toContain("too short"); // the fix attempt is told what was wrong
    expect(calls("review")).toBe(2);
  });

  it("never asks again after one fix round, even if the second review still complains", async () => {
    respond = (_r, kind) => (kind === "plan" ? plan([step("s1")]) : kind === "step" ? text("out") : kind === "review" ? json({ verdict: "fix", issues: "still bad", fixSteps: ["s1"], final: "best effort" }) : null);
    const run = await start();
    expect(run).toMatchObject({ status: "completed", revisions: 1, result: "best effort" });
    expect(calls("review")).toBe(2);
    expect(calls("step")).toBe(2);
  });

  it("does not redo a specialist step that already asked for an outside action (no duplicate requests)", async () => {
    const bot = await mkBot("Messenger");
    await allow([bot.id]);
    let botCalls = 0;
    respond = (_r, kind) => {
      if (kind === "plan") return plan([step("s1", { specialist: bot.id })]);
      if (kind === "bot") return ++botCalls === 1 ? text(`${fence}action\n${JSON.stringify({ connector: "telegram", action: "send_message", args: { chat: "sam", text: "Hi" } })}\n${fence}`) : text("Waiting for the owner.");
      if (kind === "review") return json({ verdict: "fix", issues: "please resend", fixSteps: ["s1"], final: "reported" });
      return null;
    };
    const run = await start();
    expect(run.steps[0].attempts).toBe(1);
    expect(run.revisions).toBe(0);
    expect((await t.call("GET", "/api/approvals?status=pending")).body.approvals).toHaveLength(1); // one request, not two
    expect(sent).toHaveLength(0); // and nothing was sent: it still waits for you
  });

  it("unreadable replies get one second try, with the stronger model, and then a clear failure", async () => {
    let n = 0;
    respond = (_r, kind) => (kind === "plan" ? (++n === 1 ? text("I think we should do it, no JSON here") : json({ mode: "direct", answer: "second try worked" })) : null);
    expect((await start()).result).toBe("second try worked");
    expect(seen[1]!.req.messages[1]!.content).toContain("not valid JSON");

    seen.length = 0;
    respond = (_r, kind) => (kind === "plan" ? text("still not json") : null);
    const bad = await start();
    expect(bad.status).toBe("failed");
    expect(bad.error).toMatch(/could not be understood/);
    expect(seen).toHaveLength(2); // never a third
  });

  it("only accepts the exact reply shapes", () => {
    const schema = z.object({ a: z.number() });
    expect(parseJsonReply('noise {"a": 1} noise', schema)).toEqual({ a: 1 });
    expect(parseJsonReply('{"a": "x"}', schema)).toBeNull();
    expect(parseJsonReply("no braces", schema)).toBeNull();
    expect(parseJsonReply("{broken", schema)).toBeNull();
  });
});

describe("budgets and limits", () => {
  it("stops when the model-call budget is used up and reports what it has, without more calls", async () => {
    respond = (_r, kind) => (kind === "plan" ? plan([step("s1"), step("s2", { dependsOn: ["s1"] }), step("s3", { dependsOn: ["s2"] })]) : kind === "step" ? text("partial output") : null);
    const run = await start("Long job", { maxModelCalls: 3 });
    expect(run.status).toBe("budget_exhausted");
    expect(run.error).toMatch(/budget/);
    expect(run.modelCalls).toBe(3);
    expect(run.result).toContain("partial output");
    expect(run.steps.map((s: any) => s.status)).toEqual(["completed", "completed", "skipped"]);
    expect(seen).toHaveLength(3);
  });

  it("stops on the token budget too", async () => {
    respond = (_r, kind) => (kind === "plan" ? plan([step("s1"), step("s2", { dependsOn: ["s1"] })]) : kind === "step" ? { ...OK_RESULT, text: "x", inputTokens: 600, outputTokens: 600 } : null);
    const run = await start("Big", { maxTokens: 1000 });
    expect(run.status).toBe("budget_exhausted");
  });

  it("budgets have hard ceilings that cannot be raised", async () => {
    expect((await t.call("POST", "/api/manager/runs", { goal: "x", budget: { maxModelCalls: 999 } })).status).toBe(400);
    expect((await t.call("PUT", "/api/manager/settings", { defaultBudget: { maxModelCalls: 999 } })).status).toBe(400);
  });

  it("has a daily limit on runs and at most two at once", async () => {
    respond = (_r, kind) => (kind === "plan" ? new Promise((r) => setTimeout(() => r(json({ mode: "direct", answer: "ok" })), 30)) : null);
    expect((await t.call("POST", "/api/manager/runs", { goal: "a" })).status).toBe(202);
    expect((await t.call("POST", "/api/manager/runs", { goal: "b" })).status).toBe(202);
    expect((await t.call("POST", "/api/manager/runs", { goal: "c" })).body.error).toBe("manager_busy");
    await t.app.manager.idle();
    await t.call("PUT", "/api/manager/settings", { maxRunsPerDay: 2 });
    expect((await t.call("POST", "/api/manager/runs", { goal: "d" })).body.error).toBe("manager_daily_limit");
  });

  it("the AI pause switch and the off switch stop it before any model call", async () => {
    await t.call("PUT", "/api/llm/pause", { paused: true });
    const paused = await start();
    expect(paused.status).toBe("failed");
    expect(paused.error).toMatch(/paused/);
    expect(seen).toHaveLength(0);
    await t.call("PUT", "/api/llm/pause", { paused: false });
    await t.call("PUT", "/api/manager/settings", { enabled: false });
    expect((await t.call("POST", "/api/manager/runs", { goal: "x" })).body.error).toBe("manager_off");
  });

  it("refuses empty and oversized requests", async () => {
    expect((await t.call("POST", "/api/manager/runs", { goal: "   " })).body.error).toBe("empty_goal");
    expect((await t.call("POST", "/api/manager/runs", { goal: "x".repeat(4001) })).status).toBe(400);
  });
});

describe("cancelling and restarting", () => {
  it("cancelling stops a run that is working and skips what is left", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    respond = async (_r, kind) => {
      if (kind === "plan") return plan([step("s1"), step("s2", { dependsOn: ["s1"] })]);
      if (kind === "step") {
        await gate;
        return text("late");
      }
      return null;
    };
    const res = await t.call("POST", "/api/manager/runs", { goal: "slow" });
    await vi.waitFor(() => expect(calls("step")).toBe(1), { timeout: 2000 });
    expect((await t.call("POST", `/api/manager/runs/${res.body.run.id}/cancel`)).status).toBe(200);
    release();
    await t.app.manager.idle();
    const run = (await t.call("GET", `/api/manager/runs/${res.body.run.id}`)).body.run;
    expect(run.status).toBe("cancelled");
    expect(run.steps.map((s: any) => s.status)).not.toContain("running");
    expect(calls("review")).toBe(0);
  });

  it("a run cut off by a restart is marked interrupted, never silently resumed or repeated", async () => {
    respond = (_r, kind) => (kind === "plan" ? new Promise(() => undefined) : null);
    const res = await t.call("POST", "/api/manager/runs", { goal: "hangs" });
    t.app.manager.recoverInterrupted();
    const run = (await t.call("GET", `/api/manager/runs/${res.body.run.id}`)).body.run;
    expect(run.status).toBe("interrupted");
  });
});

describe("settings and who may use it", () => {
  it("choose specialists and models; unknown bots and models are refused", async () => {
    const bot = await mkBot("Helper");
    const ok = await allow([bot.id]);
    expect(ok.body.settings.allowedBots).toEqual([bot.id]);
    expect((await allow(["00000000-0000-4000-8000-000000000000"])).body.error).toBe("unknown_bot");
    expect((await t.call("PUT", "/api/manager/settings", { model: "nope/none" })).status).toBe(400);
    expect((await t.call("PUT", "/api/manager/settings", { model: "auto/coding" })).body.settings.model).toBe("auto/coding");
    expect((await t.call("PUT", "/api/manager/settings", { surprise: 1 })).status).toBe(400);
    expect(JSON.stringify((await t.call("GET", "/api/audit?limit=50")).body)).toContain("manager.settings_changed");
  });

  it("an archived bot is not used as a specialist", async () => {
    const bot = await mkBot("Gone");
    await allow([bot.id]);
    await t.call("DELETE", `/api/bots/${bot.id}`);
    expect((await t.call("GET", "/api/manager")).body.specialists).toHaveLength(0);
  });

  it("a phone can ask the Manager for work and watch it, but cannot change what it may use", async () => {
    const phone = await createTestApp({ remoteHosts: ["my-pc.tail1234.ts.net"] });
    const { body } = await phone.call("POST", "/api/devices/pairing");
    const h = { host: "my-pc.tail1234.ts.net", origin: "https://my-pc.tail1234.ts.net", "x-awp-client": "dashboard" };
    const paired = await phone.app.inject({ method: "POST", url: "/api/devices/pair", payload: { code: body.code, name: "Pixel" }, headers: h });
    const hh = { ...h, cookie: String(paired.headers["set-cookie"]).split(";")[0]! };
    expect((await phone.app.inject({ method: "PUT", url: "/api/manager/settings", payload: { enabled: false }, headers: hh })).statusCode).toBe(403);
    expect((await phone.app.inject({ method: "GET", url: "/api/manager", headers: hh })).statusCode).toBe(200);
    await ssetup(phone);
    const started = await phone.app.inject({ method: "POST", url: "/api/manager/runs", payload: { goal: "from the phone" }, headers: hh });
    expect(started.statusCode).toBe(202);
    await phone.app.manager.idle();
    expect(JSON.stringify((await phone.call("GET", "/api/audit?limit=50")).body)).toContain("device:Pixel");
    await phone.app.close();
  });
});

async function ssetup(app: TestApp) {
  await setupGeminiModel(app);
}

beforeEach(() => undefined);
