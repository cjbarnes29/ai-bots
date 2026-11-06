import { afterEach, describe, expect, it, vi } from "vitest";
import { OK_RESULT, switchOn } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { parseWorkflowDraft } from "./draft.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Workflow drafting from a description. A SCRIPTED FAKE model answers; nothing real is contacted. A draft is never saved. */
let t: TestApp;
afterEach(async () => {
  await t?.app.close();
  vi.unstubAllEnvs();
});
const reply = (o: unknown) => ({ ...OK_RESULT, text: typeof o === "string" ? o : JSON.stringify(o), inputTokens: 20, outputTokens: 20 });

async function setup() {
  t = await createTestApp();
  await t.call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000, providerRequestsPerMinute: 1000 });
  const ref = await setupGeminiModel(t);
  const bot = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Researcher", role: "Finds facts", model: ref }))).body.bot as any;
  return { bot };
}
const draft = (description: string) => t.call("POST", "/api/workflows/draft", { description });

describe("workflow draft", () => {
  it("turns a description into a checked drawing with a manual start, ordered boxes and an End, and saves nothing", async () => {
    const { bot } = await setup();
    t.provider.script = [reply({ name: "Weekly research", steps: [{ type: "agent", agent: "researcher", instruction: "Research {{input}}" }, { type: "checkpoint", message: "Send the summary?" }] })];
    const res = await draft("Every week research a topic and ask me before sending the summary");
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(false);
    const g = res.body.draft.graph;
    expect(res.body.draft.name).toBe("Weekly research");
    expect(g.nodes.map((n: any) => n.type)).toEqual(["trigger", "bot_task", "checkpoint", "end"]);
    expect(g.nodes[1].botId).toBe(bot.id);
    expect(g.edges).toHaveLength(3);
    // the platform's own checker accepts it
    expect((await t.call("POST", "/api/workflows/validate", { graph: g })).body.problems).toEqual([]);
    // nothing was saved
    expect((await t.call("GET", "/api/workflows")).body.workflows).toEqual([]);
  });

  it("revises an existing draft from a requested change, still saving nothing", async () => {
    await setup();
    t.provider.script = [reply({ name: "Weekly research", steps: [{ type: "agent", agent: "Researcher", instruction: "Research {{input}}" }] })];
    const first = await draft("Research a topic every week for me please");
    t.provider.script = [reply({ name: "Weekly research", steps: [{ type: "agent", agent: "Researcher", instruction: "Research {{input}}" }, { type: "checkpoint", message: "Share the result?" }] })];
    const second = await t.call("POST", "/api/workflows/draft", { description: "Add a question before sharing", revise: first.body.draft });
    expect(second.status).toBe(200);
    expect(second.body.draft.graph.nodes.map((n: any) => n.type)).toEqual(["trigger", "bot_task", "checkpoint", "end"]);
    expect(JSON.stringify(t.provider.calls.at(-1)!.messages)).toContain("Apply this change to the workflow below: Add a question before sharing");
    expect(JSON.stringify(t.provider.calls.at(-1)!.messages)).toContain("add a checkpoint step with that question"); // learned from a real model that ignored the change twice
    expect(JSON.stringify(t.provider.calls.at(-1)!.messages).indexOf("Apply this change")).toBeLessThan(JSON.stringify(t.provider.calls.at(-1)!.messages).indexOf("Current steps:")); // the change comes first
    expect((await t.call("GET", "/api/workflows")).body.workflows).toEqual([]);
  });

  it("refuses an agent that does not exist, unreadable answers and descriptions with a secret", async () => {
    await setup();
    t.provider.script = [reply({ name: "X", steps: [{ type: "agent", agent: "Ghost", instruction: "do it" }] })];
    const bad = await draft("Do something with a made-up agent please");
    expect(bad.status).toBe(502);
    expect(bad.body.message).toMatch(/does not exist|draw the workflow/i);
    expect((await draft("short")).status).toBe(400);
    expect((await draft("Use my key AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q to check things")).status).toBe(400);
    expect((await t.call("GET", "/api/workflows")).body.workflows).toEqual([]);
  });

  it("parses defensively: extra fields, too many steps and web addresses", () => {
    const agents = [{ id: "00000000-0000-4000-8000-000000000001", name: "A" }];
    expect(() => parseWorkflowDraft('{"name":"n","steps":[{"type":"agent","agent":"A","instruction":"x","extra":1}]}', agents)).toThrow();
    const many = { name: "n", steps: Array.from({ length: 14 }, () => ({ type: "agent", agent: "A", instruction: "see https://example.com" })) };
    const r = parseWorkflowDraft(JSON.stringify(many), agents);
    expect(r.draft.graph.nodes).toHaveLength(12);
    expect(r.warnings.join(" ")).toMatch(/first 10 steps/);
    expect(r.warnings.join(" ")).toMatch(/web address/);
  });
});
