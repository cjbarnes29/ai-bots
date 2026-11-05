import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestApp, type TestApp, FAKE_GEMINI_KEY, setupGeminiModel, setupOllamaModel } from "../test-app.js";
import { RecommendationEngine, type RecDef, type Store } from "./engine.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const memoryStore = (): Store => {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
};

/** A tiny numeric setting held in a variable, with a configurable recommendation. */
function numberDef(state: { value: number }, over: Partial<RecDef<number>> & { rec?: number | undefined } = {}): RecDef<number> {
  const { rec, ...rest } = over;
  return {
    id: "t.number",
    area: "Test",
    title: "A number",
    level: "beginner",
    kind: "setting",
    cost: "free",
    defaultValue: 3,
    customizeAt: "/x",
    read: () => state.value,
    write: (v) => void (state.value = v),
    evaluate: () => (rec === undefined ? { unavailable: { state: "requires_connection", note: "Nothing connected" }, why: "", benefits: [], tradeoffs: [], compatibility: [] } : { recommended: rec, why: "because", benefits: ["b"], tradeoffs: ["t"], compatibility: ["c"] }),
    ...rest,
  };
}

describe("the recommendation engine", () => {
  it("labels a setting Recommended, Current (still the default), or Custom, and Requires connection when nothing can be recommended", () => {
    const e = new RecommendationEngine(memoryStore());
    const a = { value: 3 };
    e.register(numberDef(a, { rec: 3 }));
    e.register(numberDef({ value: 3 }, { id: "t.default", rec: 1 }));
    e.register(numberDef({ value: 9 }, { id: "t.custom", rec: 1 }));
    e.register(numberDef({ value: 3 }, { id: "t.none" }));
    e.register(numberDef({ value: 3 }, { id: "t.attention", rec: 1, evaluate: () => ({ recommended: 1, attention: "broken", why: "", benefits: [], tradeoffs: [], compatibility: [] }) }));
    const by = Object.fromEntries(e.list("advanced").items.map((i) => [i.id, i]));
    expect(by["t.number"]).toMatchObject({ status: "recommended", label: "Recommended", canApply: false });
    expect(by["t.default"]).toMatchObject({ status: "current", label: "Current", current: "3", recommended: "1", canApply: true });
    expect(by["t.custom"]).toMatchObject({ status: "custom", label: "Custom", canApply: true });
    expect(by["t.none"]).toMatchObject({ status: "requires_connection", label: "Requires connection", recommended: null, canApply: false, note: "Nothing connected" });
    expect(by["t.attention"]).toMatchObject({ status: "requires_attention", label: "Requires attention", note: "broken" });
    expect(by["t.default"]).toMatchObject({ why: "because", benefits: ["b"], tradeoffs: ["t"], compatibility: ["c"] });
  });

  it("changes only the setting named, records the old value, and restores it", () => {
    const e = new RecommendationEngine(memoryStore());
    const a = { value: 9 };
    const b = { value: 9 };
    e.register(numberDef(a, { id: "t.a", rec: 1 }));
    e.register(numberDef(b, { id: "t.b", rec: 1 }));
    const [r] = e.apply(["t.a"]);
    expect(r).toMatchObject({ result: "applied", before: "9", after: "1" });
    expect(a.value).toBe(1);
    expect(b.value).toBe(9); // untouched
    expect(e.history()).toHaveLength(1);
    expect(e.restore(r!.historyId!)).toMatchObject({ result: "applied", after: "9" });
    expect(a.value).toBe(9);
    expect(e.restore(r!.historyId!)).toMatchObject({ result: "refused", reason: expect.stringMatching(/already restored/) });
  });

  it("never undoes something the owner changed afterwards", () => {
    const e = new RecommendationEngine(memoryStore());
    const a = { value: 9 };
    e.register(numberDef(a, { rec: 1 }));
    const [r] = e.apply(["t.number"]);
    a.value = 7; // the owner changes it by hand
    expect(e.restore(r!.historyId!)).toMatchObject({ result: "refused", reason: expect.stringMatching(/changed again/) });
    expect(a.value).toBe(7);
  });

  it("refuses to apply anything that cannot be recommended, advice, paid settings and unknown ids", () => {
    const e = new RecommendationEngine(memoryStore());
    const none = { value: 3 };
    const paid = { value: 0 };
    e.register(numberDef(none, { id: "t.none" }));
    e.register(numberDef(paid, { id: "t.paid", cost: "paid", rec: 5 }));
    e.register(numberDef({ value: 1 }, { id: "t.advice", kind: "advice", rec: 2, write: undefined as never }));
    const out = e.apply(["t.none", "t.paid", "t.advice", "t.ghost"]);
    expect(out.map((r) => r.result)).toEqual(["refused", "refused", "refused", "refused"]);
    expect(out[1]!.reason).toMatch(/cost money/);
    expect(none.value).toBe(3);
    expect(paid.value).toBe(0);
    expect(e.history()).toHaveLength(0);
  });

  it("reports unchanged when the setting already matches, and keeps no history for it", () => {
    const e = new RecommendationEngine(memoryStore());
    e.register(numberDef({ value: 1 }, { rec: 1 }));
    expect(e.apply(["t.number"])[0]).toMatchObject({ result: "unchanged" });
    expect(e.history()).toHaveLength(0);
  });

  it("undoes a change that did not take effect, and survives a check that throws", () => {
    const e = new RecommendationEngine(memoryStore());
    const a = { value: 9 };
    e.register(numberDef(a, { id: "t.stuck", rec: 1, write: () => undefined })); // write silently does nothing
    expect(e.apply(["t.stuck"])[0]).toMatchObject({ result: "refused", reason: expect.stringMatching(/did not take effect/) });
    e.register(numberDef(a, { id: "t.boom", rec: 1, evaluate: () => { throw new Error("x"); } }));
    expect(e.get("t.boom")).toMatchObject({ status: "requires_attention", recommended: null, canApply: false });
    expect(e.apply(["t.boom"])[0]!.result).toBe("refused");
    expect(a.value).toBe(9);
  });

  it("shows more in a higher mode, and changing the mode changes no setting", () => {
    const e = new RecommendationEngine(memoryStore());
    const a = { value: 9 };
    e.register(numberDef(a, { id: "t.b", level: "beginner", rec: 1 }));
    e.register(numberDef(a, { id: "t.i", level: "intermediate", rec: 1 }));
    e.register(numberDef(a, { id: "t.a", level: "advanced", rec: 1 }));
    expect(e.mode()).toBe("intermediate");
    expect(e.list("beginner")).toMatchObject({ hidden: 2 });
    expect(e.list("beginner").items.map((i) => i.id)).toEqual(["t.b"]);
    expect(e.list("intermediate").items.map((i) => i.id)).toEqual(["t.b", "t.i"]);
    expect(e.list("advanced").hidden).toBe(0);
    for (const m of ["beginner", "advanced", "intermediate"] as const) e.setMode(m);
    expect(a.value).toBe(9);
    expect(e.history()).toHaveLength(0);
  });

  it("lets a feature register its own recommendation once, and rejects a duplicate id", () => {
    const e = new RecommendationEngine(memoryStore());
    e.register(numberDef({ value: 1 }, { rec: 1 }));
    expect(() => e.register(numberDef({ value: 1 }, { rec: 1 }))).toThrow(/already registered/);
  });
});

describe("the core recommendations in the real app (fake providers, no network)", () => {
  let t: TestApp;
  afterEach(async () => {
    await t?.app.close();
    vi.unstubAllEnvs();
  });
  const items = async () => Object.fromEntries(((await t.call("GET", "/api/recommendations")).body.items as any[]).map((i) => [i.id, i]));
  const routing = async () => (await t.call("GET", "/api/llm/routing")).body.config;
  const limits = async () => (await t.call("GET", "/api/llm/status")).body.limits;

  it("with no provider connected it recommends nothing that depends on one, and applying such a thing changes nothing", async () => {
    t = await createTestApp({ hardware: { ramGb: 16, cores: 8 } });
    const before = await routing();
    const i = await items();
    for (const id of ["routing.max-attempts", "routing.allowed-providers", "routing.default-model", "providers.connect"]) {
      expect(i[id], id).toMatchObject({ status: "requires_connection", recommended: null, canApply: false });
    }
    const r = await t.call("POST", "/api/recommendations/apply", { ids: ["routing.max-attempts", "routing.allowed-providers", "routing.default-model"] });
    expect(r.body.results.every((x: any) => x.result === "refused")).toBe(true);
    expect(await routing()).toEqual(before);
    expect((await t.call("GET", "/api/recommendations")).body.history).toEqual([]);
  });

  it("recommends from what is really usable, applies one setting, leaves the rest alone, and restores it", async () => {
    t = await createTestApp({ hardware: { ramGb: 16, cores: 8 } });
    await setupGeminiModel(t);
    const i = await items();
    expect(i["routing.max-attempts"]).toMatchObject({ status: "current", current: "3 attempts", recommended: "1 attempt", canApply: true });
    expect(i["routing.max-attempts"].why).toMatch(/1 usable model/);
    const before = await routing();
    const lim = await limits();

    const r = await t.call("POST", "/api/recommendations/apply", { ids: ["routing.max-attempts"] });
    expect(r.body.results[0]).toMatchObject({ result: "applied", before: "3 attempts", after: "1 attempt" });
    expect(await routing()).toEqual({ ...before, maxAttempts: 1 }); // only that one field
    expect(await limits()).toEqual(lim);
    expect((await items())["routing.max-attempts"].status).toBe("recommended");

    const hist = (await t.call("GET", "/api/recommendations")).body.history[0];
    const back = await t.call("POST", "/api/recommendations/restore", { historyId: hist.id });
    expect(back.body.results[0]).toMatchObject({ result: "applied", after: "3 attempts" });
    expect(await routing()).toEqual(before);
    const again = await t.call("POST", "/api/recommendations/restore", { historyId: hist.id });
    expect(again.body.results[0].result).toBe("refused");
    expect((await t.call("POST", "/api/recommendations/restore", { historyId: "nope" })).status).toBe(404);
  });

  it("calls a value the owner chose Custom and replaces it only when asked", async () => {
    t = await createTestApp({ hardware: { ramGb: 16, cores: 8 } });
    await setupGeminiModel(t);
    await t.call("PUT", "/api/llm/routing", { maxAttempts: 5, preferLocal: true });
    expect((await items())["routing.max-attempts"]).toMatchObject({ status: "custom", label: "Custom", current: "5 attempts" });
    // Applying a different recommendation must not touch it.
    await t.call("POST", "/api/recommendations/apply", { ids: ["routing.auto-refresh"] });
    expect((await routing()).maxAttempts).toBe(5);
    expect((await routing()).preferLocal).toBe(true);
    await t.call("POST", "/api/recommendations/apply", { ids: ["routing.max-attempts"] });
    expect(await routing()).toMatchObject({ maxAttempts: 1, preferLocal: true });
  });

  it("flags an available provider that routing never uses, and the simulated AI standing in for a real one", async () => {
    t = await createTestApp({ hardware: { ramGb: 16, cores: 8 } });
    await setupGeminiModel(t);
    await setupOllamaModel(t);
    await t.call("PUT", "/api/llm/routing", { allowedProviders: ["gemini", "demo"] });
    const it1 = (await items())["routing.allowed-providers"];
    expect(it1.status).toBe("requires_attention");
    expect(it1.note).toMatch(/ollama.*never uses it/);
    expect(it1.note).toMatch(/simulated Demo AI/);
    expect(it1.recommended).toBe("gemini, ollama"); // demo dropped, ollama added; nothing unavailable added
    await t.call("POST", "/api/recommendations/apply", { ids: ["routing.allowed-providers"] });
    expect((await routing()).allowedProviders.sort()).toEqual(["gemini", "ollama"]);
  });

  it("does not recommend a provider whose key has gone away", async () => {
    t = await createTestApp({ hardware: { ramGb: 16, cores: 8 } });
    await setupGeminiModel(t);
    vi.stubEnv("GEMINI_API_KEY", "");
    expect((await items())["routing.max-attempts"]).toMatchObject({ status: "requires_connection", recommended: null });
  });

  it("reflects this PC: waits longer for a model on this PC's processor, and runs local models one at a time unless there is room", async () => {
    t = await createTestApp({ hardware: { ramGb: 8, cores: 4 } });
    await setupOllamaModel(t);
    let i = await items();
    expect(i["limits.timeout"]).toMatchObject({ recommended: "180 seconds", current: "60 seconds" });
    expect(i["limits.timeout"].compatibility.join(" ")).toMatch(/all on this PC/);
    expect(i["hardware.local-models"].recommended).toMatch(/3 billion/);
    await t.call("POST", "/api/recommendations/apply", { ids: ["limits.timeout"] });
    expect((await limits()).timeoutMs).toBe(180_000);
    await t.app.close();

    t = await createTestApp({ hardware: { ramGb: 64, cores: 16 } });
    await setupGeminiModel(t);
    await t.call("PUT", "/api/recommendations/mode", { mode: "advanced" }); // the memory setting is advanced-level
    i = await items();
    expect(i["limits.timeout"].recommended).toBe("60 seconds");
    expect(i["limits.local-concurrency"].recommended).toBe("2 at a time");
    expect(i["hardware.local-models"].recommended).toMatch(/14 billion/);
  });

  it("recommends keeping screen text private and shows the app's honest desktop and Guardian advice", async () => {
    t = await createTestApp({ hardware: { ramGb: 16, cores: 8 } });
    await t.call("PUT", "/api/desktop/settings", { cloudScreenText: true });
    let i = await items();
    expect(i["desktop.cloud-text"]).toMatchObject({ status: "custom", current: "Allowed", recommended: "Not allowed" });
    await t.call("POST", "/api/recommendations/apply", { ids: ["desktop.cloud-text"] });
    i = await items();
    expect(i["desktop.cloud-text"]).toMatchObject({ status: "recommended", current: "Not allowed" }); // never probes the real Windows host
    expect(i["desktop.runtime"]).toMatchObject({ kind: "advice", status: "requires_attention", canApply: false });
    expect(i["desktop.runtime"].compatibility.join(" ")).toMatch(/VMware: not built/);
    expect(i["security.guardian"]).toMatchObject({ kind: "advice", status: "requires_attention", canApply: false });
  });

  it("modes only change what is shown; every configuration survives switching", async () => {
    t = await createTestApp({ hardware: { ramGb: 16, cores: 8 } });
    await setupGeminiModel(t);
    await t.call("PUT", "/api/llm/routing", { maxAttempts: 2 });
    const snapshot = { routing: await routing(), limits: await limits() };
    const counts: Record<string, number> = {};
    for (const m of ["beginner", "intermediate", "advanced", "beginner"]) {
      const r = await t.call("PUT", "/api/recommendations/mode", { mode: m });
      expect(r.body.mode).toBe(m);
      counts[m] = r.body.items.length;
    }
    expect(counts["beginner"]).toBeLessThan(counts["intermediate"]!);
    expect(counts["intermediate"]).toBeLessThan(counts["advanced"]!);
    expect({ routing: await routing(), limits: await limits() }).toEqual(snapshot);
    expect((await t.call("PUT", "/api/recommendations/mode", { mode: "expert" })).status).toBe(400);
    expect((await t.call("GET", "/api/recommendations")).body.mode).toBe("beginner"); // remembered
  });

  it("records every applied change in the audit log without any key", async () => {
    t = await createTestApp({ hardware: { ramGb: 16, cores: 8 } });
    await setupGeminiModel(t);
    await t.call("POST", "/api/recommendations/apply", { ids: ["routing.max-attempts"] });
    const audit = JSON.stringify((await t.call("GET", "/api/audit?limit=50")).body);
    expect(audit).toContain("recommendation.applied");
    expect(audit).not.toContain(FAKE_GEMINI_KEY);
  });
});
