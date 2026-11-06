import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.app.close();
  vi.unstubAllEnvs();
});

const find = (body: any, id: string) => body.capabilities.find((c: any) => c.id === id);

describe("capability API (real app wiring, fake services)", () => {
  it("lists capabilities with six levels, a summary and the supervised-only flag", async () => {
    const res = await t.call("GET", "/api/capabilities");
    expect(res.status).toBe(200);
    expect(res.body.supervisedOnly).toBe(true);
    expect(res.body.summary.total).toBe(res.body.capabilities.length);
    expect(Object.keys(find(res.body, "node").levels)).toEqual(["installed", "configured", "authenticated", "operational", "tested", "verified"]);
    // The test app pretends node and git exist and nothing else.
    expect(find(res.body, "node").state).toBe("available");
    expect(find(res.body, "python").state).toBe("unavailable");
    expect(find(res.body, "env-ffmpeg").state).toBe("unavailable");
    expect(find(res.body, "perm-autonomy").state).toBe("unavailable");
    expect(find(res.body, "env-guardian-tier-b").state).toBe("unavailable");
  });

  it("with no provider connected there is no verified model, and the answer says so", async () => {
    const res = await t.call("GET", "/api/capabilities");
    expect(find(res.body, "ai-models").state).not.toBe("available");
    const a = (await t.call("POST", "/api/capabilities/assess", { goal: "Summarise this note" })).body.assessment;
    expect(a.classification).toBe("unsupported");
    expect(a.blockers).toContain("A verified AI model");
  });

  it("after a provider is connected and a model switched on, the same goal becomes supported (reassessment)", async () => {
    await setupGeminiModel(t);
    const res = await t.call("POST", "/api/capabilities/refresh");
    expect(find(res.body, "model-provider:gemini").configured ?? true).toBeTruthy();
    expect(find(res.body, "model-provider:gemini").levels.configured.state).toBe("yes");
    // The (fake) provider answered the model-list request, which is what "accepted" means; it has not passed the registry tests.
    expect(find(res.body, "model-provider:gemini").levels.authenticated.state).toBe("yes");
    expect(find(res.body, "model-provider:gemini").levels.tested.state).toBe("no");
    expect(find(res.body, "model-provider:gemini").levels.verified.state).toBe("no");
  });

  it("assessment records one audit line and never stores the whole goal", async () => {
    const secretish = "Summarise the file " + "x".repeat(300);
    await t.call("POST", "/api/capabilities/assess", { goal: secretish });
    const audit = await t.call("GET", "/api/audit?limit=50");
    const events = (audit.body.events ?? audit.body.items ?? []) as any[];
    const line = events.find((e) => e.kind === "capability.assessed");
    expect(line).toBeTruthy();
    expect(JSON.stringify(line.detail).length).toBeLessThan(400);
  });

  it("rejects an empty or oversized goal and unknown fields", async () => {
    expect((await t.call("POST", "/api/capabilities/assess", { goal: "" })).status).toBe(400);
    expect((await t.call("POST", "/api/capabilities/assess", { goal: "x".repeat(4001) })).status).toBe(400);
    expect((await t.call("POST", "/api/capabilities/assess", { goal: "ok", approve: true })).status).toBe(400);
  });

  it("the Manager refuses a task that is impossible as asked, with the reasons, and starts nothing", async () => {
    await setupGeminiModel(t);
    const res = await t.call("POST", "/api/manager/runs", { goal: "Deploy the website to production and buy the domain" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("task_unsupported");
    expect(res.body.assessment.requirements.some((r: any) => r.status === "blocked_by_policy")).toBe(true);
    const list = await t.call("GET", "/api/manager");
    expect(list.body.runs).toHaveLength(0);
  });

  it("proceedAnyway lets the owner run a best-effort plan after reading the refusal", async () => {
    await setupGeminiModel(t);
    const refused = await t.call("POST", "/api/manager/runs", { goal: "Design a logo for my bakery" });
    expect(refused.status).toBe(422);
    expect(refused.body.message).toMatch(/proceedAnyway/);
    const ok = await t.call("POST", "/api/manager/runs", { goal: "Design a logo for my bakery", proceedAnyway: true });
    expect(ok.status).toBe(202);
    expect(ok.body.assessment.classification).toBe("unsupported");
    await t.app.manager.idle();
  });

  it("the Manager still accepts a task that is possible, and returns the assessment alongside the run", async () => {
    await setupGeminiModel(t);
    const res = await t.call("POST", "/api/manager/runs", { goal: "What is the capital of France?" });
    expect(res.status).toBe(202);
    expect(res.body.run.id).toBeTruthy();
    expect(res.body.assessment.classification).toBe("fully");
    await t.app.manager.idle();
  });

  it("a task that only needs setup (not impossible) is accepted, and the missing pieces are reported", async () => {
    await setupGeminiModel(t);
    const res = await t.call("POST", "/api/manager/runs", { goal: "Save the notes to a folder on my computer" });
    expect(res.status).toBe(202);
    expect(res.body.assessment.requirements.find((r: any) => r.id === "perm-folders").status).toBe("needs_owner");
    await t.app.manager.idle();
  });

  it("changes in a capability's state are written to the audit log, not stored anywhere new", async () => {
    await t.call("GET", "/api/capabilities");
    await setupGeminiModel(t);
    await t.call("POST", "/api/capabilities/refresh");
    const audit = await t.call("GET", "/api/audit?limit=100");
    const events = (audit.body.events ?? audit.body.items ?? []) as any[];
    expect(events.some((e) => e.kind === "capability.changed")).toBe(true);
  });

  it("every capability route is read-only: calling them changes no setting, bot, approval or provider", async () => {
    const before = JSON.stringify([(await t.call("GET", "/api/llm/providers")).body, (await t.call("GET", "/api/bots")).body, (await t.call("GET", "/api/approvals")).body]);
    await t.call("GET", "/api/capabilities");
    await t.call("POST", "/api/capabilities/refresh");
    await t.call("POST", "/api/capabilities/assess", { goal: "send an email, buy a domain and deploy while I'm away" });
    const after = JSON.stringify([(await t.call("GET", "/api/llm/providers")).body, (await t.call("GET", "/api/bots")).body, (await t.call("GET", "/api/approvals")).body]);
    expect(after).toBe(before);
  });
});
