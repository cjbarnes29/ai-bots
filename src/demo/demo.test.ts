import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { makeCaller } from "../llm/test-helpers.js";
import { SIMULATED_MARK } from "../llm/providers/demo.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// These tests use the REAL built-in demo provider (no fake provider factory) and make sure nothing can reach the network.
let app: FastifyInstance;
let call: ReturnType<typeof makeCaller>;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  fetchSpy = vi.fn(async () => {
    throw new Error("The demo environment must never make a network request");
  });
  vi.stubGlobal("fetch", fetchSpy);
  app = await buildApp({ dbPath: ":memory:",
    verification: "off", routingDefaults: { autoAssignNewBots: false }, managerPollMs: 5, connectors: [] });
  call = makeCaller(app);
});
afterEach(async () => {
  await app.close();
  vi.unstubAllGlobals();
});

const setup = async () => (await call("POST", "/api/demo/setup")).body;
const botByName = async (name: string) => ((await call("GET", "/api/bots")).body.bots as any[]).find((b) => b.name === name);
const waitRun = async (id: string, done: string[]) => {
  let run: any;
  await vi.waitFor(async () => {
    run = (await call("GET", `/api/workflows/runs/${id}`)).body.run;
    expect(done).toContain(run.status);
  }, { timeout: 15000, interval: 20 });
  return run;
};

describe("the demo provider", () => {
  it("is listed as simulated, switched off, and costs nothing", async () => {
    const p = (await call("GET", "/api/llm/providers")).body.providers.find((x: any) => x.id === "demo");
    expect(p).toMatchObject({ simulated: true, enabled: false, kind: "local", keyConfigured: true });
    expect((await call("GET", "/api/llm/providers")).body.providers.filter((x: any) => x.simulated)).toHaveLength(1);
  });

  it("setup enables it and the sample agents with NO permissions, using only the simulated models", async () => {
    const s = await setup();
    expect(s.ready).toBe(true);
    expect(s.provider.enabled).toBe(true);
    expect(s.bots.every((b: any) => b.id && b.status === "active")).toBe(true);
    expect(s.workflows.every((w: any) => w.id)).toBe(true);
    const bots = (await call("GET", "/api/bots")).body.bots as any[];
    for (const b of bots) {
      expect(b.model).toMatch(/^demo\/simulated-(echo|failing)$/);
      for (const perm of Object.values(b.permissions ?? {}) as any[]) expect(perm.readEnabled ?? false).toBe(false);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("setup is safe to repeat and never overwrites what the owner edited", async () => {
    await setup();
    const researcher = await botByName("Demo: Researcher");
    await call("PATCH", `/api/bots/${researcher.id}`, { instructions: "My own instructions" });
    await setup();
    const again = await botByName("Demo: Researcher");
    expect(again.instructions).toBe("My own instructions");
    expect(((await call("GET", "/api/bots")).body.bots as any[]).length).toBe(4);
    expect(((await call("GET", "/api/workflows")).body.workflows as any[]).length).toBe(2);
  });

  it("every chat answer is plainly marked as simulated and records the demo provider", async () => {
    await setup();
    const bot = await botByName("Demo: Writer");
    const r = await call("POST", `/api/bots/${bot.id}/chat`, { message: "Summarise the moon" });
    expect(r.status).toBe(200);
    expect(r.body.assistantMessage.content.startsWith(SIMULATED_MARK)).toBe(true);
    expect(r.body.assistantMessage.content).toContain("Summarise the moon");
    expect(r.body.assistantMessage).toMatchObject({ providerId: "demo", modelId: "simulated-echo" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the failing model fails clearly, as designed", async () => {
    await setup();
    const bot = await botByName("Demo: Failing agent");
    const r = await call("POST", `/api/bots/${bot.id}/chat`, { message: "hello" });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.body)).toContain("Simulated failure");
  });
});

describe("automatic routing and the simulated provider", () => {
  it("never silently picks the simulated provider (an empty provider list does not include it)", async () => {
    await setup();
    const preview = (await call("GET", "/api/llm/routing")).body.preview;
    expect(preview.general).toEqual([]);
    const auto = (await call("POST", "/api/bots", { name: "Auto bot", model: "auto/general" })).body.bot;
    await call("PATCH", `/api/bots/${auto.id}`, { status: "active" });
    const r = await call("POST", `/api/bots/${auto.id}/chat`, { message: "hi" });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.body)).toMatch(/No eligible free model/);
  });

  it("is used by automatic routing only when the owner ticks it by name, and the answer is still marked", async () => {
    await setup();
    await call("PUT", "/api/llm/routing", { allowedProviders: ["demo"] });
    const preview = (await call("GET", "/api/llm/routing")).body.preview;
    expect(preview.general.length).toBeGreaterThan(0);
    expect(preview.general.every((m: any) => m.simulated)).toBe(true);
    const auto = (await call("POST", "/api/bots", { name: "Auto bot", model: "auto/general" })).body.bot;
    await call("PATCH", `/api/bots/${auto.id}`, { status: "active" });
    const r = await call("POST", `/api/bots/${auto.id}/chat`, { message: "hi" });
    // The router may try the failing demo model first and fall back to the echo model; either way the answer says it is simulated.
    expect(r.status).toBe(200);
    expect(r.body.assistantMessage.content.startsWith(SIMULATED_MARK)).toBe(true);
    expect(r.body.assistantMessage.providerId).toBe("demo");
  });
});

describe("the sample workflows", () => {
  it("run to the checkpoint with simulated outputs, and you can inspect every step", async () => {
    await setup();
    const wf = ((await call("GET", "/api/workflows")).body.workflows as any[]).find((w) => w.name === "Demo: Research, write, review");
    expect(wf.problems).toEqual([]);
    const started = await call("POST", `/api/workflows/${wf.id}/run`, { input: "solar panels" });
    expect(started.status).toBe(202);
    const run = await waitRun(started.body.run.id, ["waiting", "completed", "failed"]);
    expect(run.status).toBe("waiting"); // the checkpoint waits for the owner
    const steps = run.steps as any[];
    const text = JSON.stringify(steps);
    expect(text).toContain(SIMULATED_MARK);
    expect(text).toContain("solar panels");
    const approve = await call("POST", `/api/workflows/runs/${run.id}/steps/decide/approve`);
    expect(approve.status).toBe(200);
    expect((await waitRun(run.id, ["completed", "failed"])).status).toBe("completed");
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 30000);

  it("the failing sample stops at the broken box and says which one it was", async () => {
    await setup();
    const wf = ((await call("GET", "/api/workflows")).body.workflows as any[]).find((w) => w.name === "Demo: Where did it fail?");
    const started = await call("POST", `/api/workflows/${wf.id}/run`, { input: "anything" });
    const run = await waitRun(started.body.run.id, ["failed", "completed"]);
    expect(run.status).toBe("failed");
    const steps = run.steps as any[];
    const broken = steps.find((s) => s.nodeId === "broken" || s.node === "broken" || s.id === "broken");
    expect(broken?.status).toBe("failed");
    expect(JSON.stringify(broken)).toContain("Simulated failure");
    expect(steps.find((s) => (s.nodeId ?? s.node ?? s.id) === "first")?.status).toBe("completed");
  }, 30000);
});
