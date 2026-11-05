import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../test-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
describe("workforce recommendations (bot presets, memory, workflows, permissions, schedules, notifications) in the real app", () => {
  let t: TestApp;
  afterEach(async () => {
    await t?.app.close();
  });
  const view = async () => (await t.call("PUT", "/api/recommendations/mode", { mode: "advanced" })).body;
  const items = async () => Object.fromEntries(((await view()).items as any[]).map((i) => [i.id, i]));
  const delegation = async () => (await t.call("GET", "/api/delegation/limits")).body.limits;

  it("an empty install reports honestly: nothing to recommend, nothing applicable, no invented activity", async () => {
    t = await createTestApp({ hardware: { ramGb: 16, cores: 8 } });
    const i = await items();
    for (const id of ["bots.ready", "schedules.health", "memory.usage"]) expect(i[id], id).toMatchObject({ status: "not_configured", recommended: null, canApply: false });
    expect(i["notifications.phone"]).toMatchObject({ status: "not_configured", canApply: false });
    expect(i["workflows.teamwork-limits"]).toMatchObject({ status: "recommended", canApply: false });
    expect(i["permissions.review"]).toMatchObject({ kind: "advice", canApply: false });
    expect((await t.call("GET", "/api/recommendations")).body.history).toEqual([]);
  });

  it("only the teamwork limits are a setting; everything else is advice that can never be applied", async () => {
    t = await createTestApp({ hardware: { ramGb: 16, cores: 8 } });
    await t.call("POST", "/api/bots", { name: "Scout" });
    const all = Object.values(await items()) as any[];
    const area = (a: string) => all.filter((x) => x.area === a);
    for (const a of ["Bot presets", "Permissions", "Schedules", "Notifications", "Memory"]) {
      expect(area(a).length, a).toBeGreaterThan(0);
      expect(area(a).every((x) => x.kind === "advice" && !x.canApply), a).toBe(true);
    }
    const before = JSON.stringify((await t.call("GET", "/api/bots")).body);
    const r = await t.call("POST", "/api/recommendations/apply", { ids: ["bots.ready", "permissions.review", "schedules.health", "notifications.phone", "memory.usage"] });
    expect(r.body.results.every((x: any) => x.result !== "applied")).toBe(true);
    expect(JSON.stringify((await t.call("GET", "/api/bots")).body)).toBe(before);
  });

  it("flags agents that are switched off or have no model, from the real bot list", async () => {
    t = await createTestApp({ hardware: { ramGb: 16, cores: 8 } });
    await t.call("POST", "/api/bots", { name: "Scout" });
    const bots = await items();
    expect(bots["bots.ready"]).toMatchObject({ status: "requires_attention", current: "0 of 1 ready" });
    expect(bots["bots.ready"].note).toMatch(/Scout/);
  });

  it("teamwork limits above the approved defaults come down; applying then restoring puts the owner's value back", async () => {
    t = await createTestApp({ hardware: { ramGb: 16, cores: 8 } });
    await t.call("PUT", "/api/delegation/limits", { maxLlmCallsPerChain: 20, maxDepth: 1 });
    const it1 = (await items())["workflows.teamwork-limits"];
    expect(it1).toMatchObject({ status: "requires_attention", canApply: true });
    expect(it1.note).toMatch(/maxLlmCallsPerChain/);
    const before = await delegation();
    const r = await t.call("POST", "/api/recommendations/apply", { ids: ["workflows.teamwork-limits"] });
    expect(r.body.results[0].result).toBe("applied");
    // above the default: lowered to it. Already stricter (depth 1 < 2): kept, never loosened.
    expect(await delegation()).toMatchObject({ maxLlmCallsPerChain: 8, maxDepth: 1 });
    const hist = r.body.history[0];
    const back = await t.call("POST", "/api/recommendations/restore", { historyId: hist.id });
    expect(back.body.results[0].result).toBe("applied");
    expect(await delegation()).toEqual(before);
  });

  it("applying never makes any teamwork limit looser", async () => {
    t = await createTestApp({ hardware: { ramGb: 16, cores: 8 } });
    await t.call("PUT", "/api/delegation/limits", { maxDepth: 1, maxTasksPerChain: 2, maxLlmCallsPerChain: 3 });
    const before = await delegation();
    const rec = (await items())["workflows.teamwork-limits"];
    expect(rec).toMatchObject({ status: "recommended", canApply: false });
    await t.call("POST", "/api/recommendations/apply", { ids: ["workflows.teamwork-limits"] });
    expect(await delegation()).toEqual(before);
  });

  it("reports a schedule that switched itself off, and automation being paused, without switching anything back on", async () => {
    t = await createTestApp({ hardware: { ramGb: 16, cores: 8 } });
    const bot = (await t.call("POST", "/api/bots", { name: "Reporter" })).body.bot;
    const made = await t.call("POST", "/api/schedules", { name: "Morning report", botId: bot.id, instruction: "Summarise", kind: "interval", intervalMinutes: 60 });
    expect(made.status).toBe(201);
    expect((await items())["schedules.health"]).toMatchObject({ current: expect.stringContaining("0 of 1 running") });
    await t.call("PUT", "/api/automation/pause", { paused: true });
    const paused = (await items())["schedules.health"];
    expect(paused.status).toBe("requires_attention");
    expect(paused.note).toMatch(/paused/);
    const before = (await t.call("GET", "/api/schedules")).body;
    await t.call("POST", "/api/recommendations/apply", { ids: ["schedules.health"] });
    expect((await t.call("GET", "/api/schedules")).body).toEqual(before);
    expect((await t.call("GET", "/api/automation/status")).body.paused).toBe(true);
  });

  it("counts agents that may read outside services without changing a permission", async () => {
    t = await createTestApp({ hardware: { ramGb: 16, cores: 8 } });
    await t.call("POST", "/api/bots", { name: "Reader" });
    expect((await items())["permissions.review"].current).toBe("0 agents can read outside services");
  });

  it("owner-only apply: a request from outside this PC is refused and changes nothing", async () => {
    t = await createTestApp({ hardware: { ramGb: 16, cores: 8 }, remoteHosts: ["example.ts.net"] });
    await t.call("PUT", "/api/delegation/limits", { maxLlmCallsPerChain: 20 });
    const res = await t.app.inject({ method: "POST", url: "/api/recommendations/apply", headers: { host: "example.ts.net", "x-awp-client": "dashboard", "content-type": "application/json" }, payload: { ids: ["workflows.teamwork-limits"] } });
    expect([401, 403]).toContain(res.statusCode);
    expect(await delegation()).toMatchObject({ maxLlmCallsPerChain: 20 });
  });
});
