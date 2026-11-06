import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { switchOn } from "../llm/test-helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
let t: TestApp;
let ref: string;
beforeEach(async () => {
  t = await createTestApp();
  ref = await setupGeminiModel(t);
});
afterEach(async () => {
  await t.app.close();
  vi.unstubAllEnvs();
});

const caps = async () => (await t.call("GET", "/api/capabilities")).body.capabilities as any[];
const find = async (id: string) => (await caps()).find((c) => c.id === id);
const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, label: id, x: 0, y: 0, ...extra });
const graphFor = (botId: string) => ({ nodes: [node("start", "trigger", { kind: "manual" }), node("work", "bot_task", { botId, instruction: "Do it", retries: 0 }), node("end", "end")], edges: [{ id: "a", from: "start", to: "work", when: "always" }, { id: "b", from: "work", to: "end", when: "always" }] });
const mkBot = async (name: string) => (await switchOn(t.call, await t.call("POST", "/api/bots", { name, model: ref }))).body.bot as any;

describe("automatic registration through the real services", () => {
  it("a new agent, model and workflow appear in the registry with no registration step", async () => {
    expect(await find("model:" + ref)).toMatchObject({ group: "model" });
    const bot = await mkBot("Alpha");
    const a = await find(`agent:${bot.id}`);
    expect(a).toMatchObject({ group: "agent", name: "Alpha" });
    expect(Object.keys(a.levels)).toHaveLength(6);
    expect(a.state).toBe("unverified"); // active with a model, but no task has ever completed
    const wf = (await t.call("POST", "/api/workflows", { name: "Flow", graph: graphFor(bot.id) })).body.workflow;
    expect((await find(`workflow:${wf.id}`)).group).toBe("workflow");
  });

  it("a new bot starts disabled and the registry says it needs setup", async () => {
    const bot = (await t.call("POST", "/api/bots", { name: "Fresh", model: ref })).body.bot;
    expect((await find(`agent:${bot.id}`)).state).toBe("needs_setup");
    await switchOn(t.call, { body: { bot } } as any);
    expect((await find(`agent:${bot.id}`)).levels.configured.state).toBe("yes");
  });

  it("a completed task moves the agent's operational level to yes, still not verified", async () => {
    const bot = await mkBot("Worker");
    expect((await find(`agent:${bot.id}`)).levels.operational.state).toBe("unknown");
    const res = await t.call("POST", `/api/bots/${bot.id}/tasks`, { instruction: "say hi" });
    expect(res.status).toBeLessThan(300);
    await (t.app as any).delegation?.idle?.();
    for (let i = 0; i < 50; i++) {
      const task = (await t.call("GET", `/api/tasks/${res.body.task.id}`)).body.task;
      if (["completed", "failed"].includes(task.status)) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const a = await find(`agent:${bot.id}`);
    expect(a.levels.operational.state).toBe("yes");
    expect(a.levels.verified.state).toBe("no");
    expect(a.state).toBe("available");
  });

  it("archiving an agent removes it, and the removal is in the change history", async () => {
    await caps(); // baseline
    const bot = await mkBot("Temp");
    await caps();
    await t.call("DELETE", `/api/bots/${bot.id}`); // archive
    expect(await find(`agent:${bot.id}`)).toBeUndefined();
    const history = (await t.call("GET", "/api/capabilities/changes")).body.changes as any[];
    const all = history.flatMap((h) => (h.detail.changes ?? []) as any[]);
    expect(all.some((c) => c.id === `agent:${bot.id}` && c.kind === "added")).toBe(true);
    expect(all.some((c) => c.id === `agent:${bot.id}` && c.kind === "removed")).toBe(true);
  });

  it("switching an agent off is a configuration change; the model it uses going away is an operational one", async () => {
    await caps();
    const bot = await mkBot("Mover");
    await caps();
    await t.call("PATCH", `/api/bots/${bot.id}`, { status: "paused" });
    expect((await find(`agent:${bot.id}`)).state).toBe("needs_setup");
    const history = (await t.call("GET", "/api/capabilities/changes")).body.changes as any[];
    const c = history.flatMap((h) => (h.detail.changes ?? []) as any[]).find((x) => x.id === `agent:${bot.id}` && x.kind === "changed");
    expect(c.aspects).toContain("configuration");
  });

  it("every consumer sees the change at once: a provider switched off shows in the registry and the assistant", async () => {
    expect((await find("model-provider:gemini")).state).not.toBe("needs_setup");
    await t.call("PATCH", "/api/llm/providers/gemini", { enabled: false });
    expect((await find("model-provider:gemini")).state).toBe("needs_setup");
    const answer = (await t.call("POST", "/api/assistant/interpret", { text: "what can you do?" })).body;
    expect(answer.kind).toBe("capabilities");
    expect(answer.cannot.join(" ")).toMatch(/Gemini/);
  });
});

describe("the Assistant answers from the live registry", () => {
  const ask = async (text: string) => (await t.call("POST", "/api/assistant/interpret", { text })).body;

  it("'what can you do right now?' lists working, partial and impossible things", async () => {
    const a = await ask("what can you do right now?");
    expect(a).toMatchObject({ kind: "capabilities", handled: true });
    expect(a.can.join(" ")).toMatch(/Node\.js/);
    expect(a.cannot.join(" ")).toMatch(/Video generation/);
    expect(a.link.to).toBe("/capabilities");
    expect(a.checkedAt).toBeTruthy();
  });

  it("the answer changes after a bot is created (nothing is cached)", async () => {
    expect((await ask("what can you do?")).can.join(" ")).toMatch(/No agents exist yet/);
    await mkBot("Alpha");
    expect((await ask("what can you do?")).can.join(" ")).toMatch(/1 agent\(s\)/);
  });

  it("'can you design a logo?' says no and why; 'can you explain recursion?' is left to ordinary chat", async () => {
    const logo = await ask("Can you design a logo for my bakery?");
    expect(logo.kind).toBe("capabilities");
    expect(logo.message).toMatch(/^No, not as asked/);
    expect((await ask("Can you explain recursion?")).kind).toBe("none");
  });

  it("asking never changes anything", async () => {
    const before = JSON.stringify([(await t.call("GET", "/api/bots")).body, (await t.call("GET", "/api/llm/providers")).body, (await t.call("GET", "/api/approvals")).body]);
    await ask("what can you do?");
    await ask("can you deploy this to production?");
    const after = JSON.stringify([(await t.call("GET", "/api/bots")).body, (await t.call("GET", "/api/llm/providers")).body, (await t.call("GET", "/api/approvals")).body]);
    expect(after).toBe(before);
  });
});

describe("the workflow engine and the Manager use the registry", () => {
  it("a workflow whose agent cannot run is refused with the reasons; proceedAnyway lets the owner try", async () => {
    const bot = await mkBot("Alpha");
    const wf = (await t.call("POST", "/api/workflows", { name: "Flow", graph: graphFor(bot.id) })).body.workflow;
    expect((await t.call("POST", `/api/workflows/${wf.id}/enable`, {})).status).toBe(200);
    expect((await find(`workflow:${wf.id}`)).state).not.toBe("partial");
    await t.call("PATCH", `/api/bots/${bot.id}`, { status: "paused" });
    const cap = await find(`workflow:${wf.id}`);
    expect(cap.state).toBe("partial");
    expect(cap.missing.join(" ")).toMatch(/Alpha/);
    const refused = await t.call("POST", `/api/workflows/${wf.id}/run`, { input: "" });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("workflow_not_ready");
    expect(refused.body.capability.missing.length).toBeGreaterThan(0);
    const forced = await t.call("POST", `/api/workflows/${wf.id}/run`, { input: "", proceedAnyway: true });
    expect(forced.status).toBe(202);
  });

  it("the Manager's planning prompt is drawn from the registry", async () => {
    const seen: string[] = [];
    const original = t.provider.complete.bind(t.provider);
    t.provider.complete = async (req) => {
      seen.push(String(req.messages[0]?.content));
      return original(req);
    };
    t.provider.script.push({ text: '{"mode":"direct","answer":"ok"}', inputTokens: 1, outputTokens: 1, finishReason: "stop" } as any);
    await t.call("POST", "/api/manager/runs", { goal: "What is 2+2?" });
    await t.app.manager.idle();
    expect(seen[0]).toMatch(/Things this platform can really do now:.*Node\.js/s);
    expect(seen[0]).toMatch(/NOT available.*Video generation and editing/s);
  });
});

describe("the background rescan", () => {
  it("noticing a change with nobody looking: start() rescans and logs, stop() ends it", async () => {
    await caps(); // baseline
    t.app.capabilities.start(20);
    await mkBot("Silent");
    await new Promise((r) => setTimeout(r, 120));
    t.app.capabilities.stop();
    const history = (await t.call("GET", "/api/capabilities/changes")).body.changes as any[];
    expect(history.some((h) => h.kind === "capability.changed")).toBe(true);
  });
});
