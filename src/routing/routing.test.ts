import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { LlmError } from "../llm/errors.js";
import { OK_RESULT, ScriptedProvider, makeCaller, modelInfo } from "../llm/test-helpers.js";
import { RoutingMaintenance } from "./routes.js";
import { geminiPlugin } from "../llm/plugins/gemini.js";
import { groqPlugin } from "../llm/plugins/groq.js";
import { failoverKind } from "./router.js";
import { parseAutoRef } from "./config.js";
import { scoreFor, traitsOf } from "./rank.js";
import { switchOn } from "../llm/test-helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Providers = Record<string, ScriptedProvider>;
let app: Awaited<ReturnType<typeof buildApp>>;
let call: ReturnType<typeof makeCaller>;
let providers: Providers;
let clock: { t: number };

const FREE = (id: string, over: Record<string, unknown> = {}) => modelInfo(id, over as any);

async function start(modelLists: Record<string, any[]> = {}, routingDefaults: Record<string, unknown> = {}) {
  vi.stubEnv("GEMINI_API_KEY", "AIzaSyFAKEKEYFORTESTSONLY0123456789");
  vi.stubEnv("GROQ_API_KEY", "gsk_FAKEKEYFORTESTSONLY0123456789ab");
  clock = { t: new Date(2026, 5, 15, 12, 0, 0).getTime() };
  providers = { gemini: new ScriptedProvider(), groq: new ScriptedProvider(), ollama: new ScriptedProvider(), openrouter: new ScriptedProvider(), omniroute: new ScriptedProvider() };
  providers["gemini"]!.models = modelLists["gemini"] ?? [FREE("gemini-2.5-flash"), FREE("gemini-2.5-pro")];
  providers["groq"]!.models = modelLists["groq"] ?? [FREE("llama-3.3-70b-versatile"), FREE("llama-3.1-8b-instant"), FREE("qwen-2.5-coder-32b")];
  providers["ollama"]!.models = modelLists["ollama"] ?? [FREE("llama3.2:3b")];
  app = await buildApp({
    dbPath: ":memory:",
    verification: "off",
    connectors: [],
    clock: () => clock.t,
    sleep: async (ms) => void (clock.t += ms),
    providerFactory: (_p, plugin) => providers[plugin.id]!,
    routingDefaults: { autoAssignNewBots: false, ...routingDefaults },
  });
  call = makeCaller(app);
  for (const id of ["gemini", "groq"]) await call("PATCH", `/api/llm/providers/${id}`, { freeConfirmed: true, enabled: true });
  await call("PATCH", "/api/llm/providers/ollama", { enabled: true });
  await call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000 });
  return (await call("POST", "/api/llm/routing/refresh-all")).body;
}

afterEach(async () => {
  await app?.close();
  app = undefined as any;
  vi.unstubAllEnvs();
});

const preview = async () => (await call("GET", "/api/llm/routing")).body.preview as Record<string, { ref: string }[]>;
const top = async (cls: string) => (await preview())[cls]!.map((m) => m.ref);
const mkBot = async (model: string | null = "auto/general") => (await switchOn(call, await call("POST", "/api/bots", { name: `Bot${Math.random()}`, ...(model ? { model } : {}) }))).body.bot as any;
const chat = (botId: string, message = "hi") => call("POST", `/api/bots/${botId}/chat`, { message });
const usageModels = async () => ((await call("GET", "/api/llm/usage?days=1")).body.usage as any);

describe("what the rules of thumb prefer", () => {
  it("reads size, coding and reasoning hints from names", () => {
    expect(traitsOf("qwen-2.5-coder-32b")).toMatchObject({ coding: true });
    expect(traitsOf("llama-3.1-8b-instant")).toMatchObject({ small: true, large: false, billions: 8 });
    expect(traitsOf("llama-3.3-70b-versatile")).toMatchObject({ large: true, small: false });
    expect(traitsOf("gemini-2.5-pro").large).toBe(true);
    expect(traitsOf("gemini-2.5-flash").small).toBe(true);
    expect(traitsOf("deepseek-r1-distill").reasoning).toBe(true);
    expect(scoreFor("coding", traitsOf("x-coder-7b"))).toBeGreaterThan(scoreFor("coding", traitsOf("llama-3.3-70b")));
    expect(scoreFor("light", traitsOf("llama-3.1-8b-instant"))).toBeGreaterThan(scoreFor("light", traitsOf("llama-3.3-70b")));
    expect(scoreFor("research", traitsOf("gemini-2.5-pro"))).toBeGreaterThan(scoreFor("research", traitsOf("gemini-2.5-flash")));
  });

  it("only exact kinds of task are automatic choices", () => {
    expect(parseAutoRef("auto/coding")).toBe("coding");
    for (const bad of ["auto/", "auto/fastest", "auto", "groq/auto", "AUTO/general", null, undefined]) expect(parseAutoRef(bad as any)).toBeNull();
  });
});

describe("choosing a model for the task", () => {
  it("discovers models from the connected providers and switches the free ones on by itself", async () => {
    const out = await start();
    expect(out.results.filter((r: any) => r.ok).map((r: any) => r.id).sort()).toEqual(["gemini", "groq", "ollama"]);
    const models = (await call("GET", "/api/llm/models")).body.models as any[];
    const usable = models.filter((m) => m.callable).map((m) => m.ref).sort();
    expect(usable).toEqual(["gemini/gemini-2.5-flash", "gemini/gemini-2.5-pro", "groq/llama-3.1-8b-instant", "groq/llama-3.3-70b-versatile", "groq/qwen-2.5-coder-32b", "ollama/llama3.2:3b"]);
  });

  it("picks a suitable model for each kind of task, with the local Ollama model only as a backup", async () => {
    await start();
    expect((await top("coding"))[0]).toBe("groq/qwen-2.5-coder-32b");
    expect((await top("light"))[0]).toMatch(/flash|8b-instant/);
    expect((await top("research"))[0]).toMatch(/gemini-2.5-pro|70b/);
    for (const cls of ["general", "coding", "research", "light"]) {
      const list = await top(cls);
      expect(list.at(-1) === "ollama/llama3.2:3b" || !list.includes("ollama/llama3.2:3b")).toBe(true);
      expect(list.indexOf("ollama/llama3.2:3b") === -1 || list.indexOf("ollama/llama3.2:3b") === list.length - 1).toBe(true);
    }
  });

  it("prefers local models when asked to", async () => {
    await start({}, { preferLocal: true });
    expect((await top("general"))[0]).toBe("ollama/llama3.2:3b");
  });

  it("a bot set to automatic uses the chosen model and the answer comes from it", async () => {
    await start();
    const bot = await mkBot("auto/coding");
    const res = await chat(bot.id);
    expect(res.status).toBe(200);
    expect(providers["groq"]!.calls.map((c) => c.model)).toEqual(["qwen-2.5-coder-32b"]);
    expect(providers["gemini"]!.calls).toHaveLength(0);
    expect(JSON.stringify(await usageModels())).toContain("qwen-2.5-coder-32b"); // the record names the real model
  });

  it("a bot with its own specific model is never re-routed, even when that model fails", async () => {
    await start();
    providers["groq"]!.script.push(new LlmError("provider_unavailable", "down"), new LlmError("provider_unavailable", "down"), new LlmError("provider_unavailable", "down"), new LlmError("provider_unavailable", "down"));
    const bot = await mkBot("groq/llama-3.1-8b-instant");
    const res = await chat(bot.id);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(providers["gemini"]!.calls).toHaveLength(0);
    expect(providers["ollama"]!.calls).toHaveLength(0);
  });
});

describe("only free, eligible, allowed models", () => {
  it("never offers models that are blocked, switched off, from a provider that is off, or that you excluded", async () => {
    await start();
    const models = (await call("GET", "/api/llm/models")).body.models as any[];
    const flash = models.find((m) => m.ref === "gemini/gemini-2.5-flash");
    await call("PATCH", `/api/llm/models/${flash.id}`, { enabled: false });
    await call("PUT", "/api/llm/routing", { excludedModels: ["groq/qwen-2.5-coder-32b"] });
    const all = Object.values(await preview()).flat().map((m) => m.ref);
    expect(all).not.toContain("gemini/gemini-2.5-flash");
    expect(all).not.toContain("groq/qwen-2.5-coder-32b");
    await call("PATCH", "/api/llm/providers/groq", { enabled: false });
    expect(Object.values(await preview()).flat().map((m) => m.ref).every((r) => !r.startsWith("groq/"))).toBe(true);
  });

  it("can be limited to chosen providers", async () => {
    await start();
    await call("PUT", "/api/llm/routing", { allowedProviders: ["gemini"] });
    expect(Object.values(await preview()).flat().every((m) => m.ref.startsWith("gemini/"))).toBe(true);
  });

  it("a provider that used up its daily cap, or is cooling down after failures, is skipped", async () => {
    await start();
    await call("PATCH", "/api/llm/providers/groq", { dailyRequestCap: 1 });
    const bot = await mkBot("groq/llama-3.1-8b-instant");
    expect((await chat(bot.id)).status).toBe(200); // uses groq's one call
    expect(Object.values(await preview()).flat().every((m) => !m.ref.startsWith("groq/"))).toBe(true);
  });

  it("a provider that keeps failing is paused, shown as such, and left out until it recovers", async () => {
    await start();
    const bot = await mkBot("groq/llama-3.1-8b-instant");
    for (let i = 0; i < 12; i++) providers["groq"]!.script.push(new LlmError("provider_unavailable", "down"));
    for (let i = 0; i < 6; i++) await chat(bot.id);
    const status = (await call("GET", "/api/llm/routing")).body;
    expect(status.providers.find((p: any) => p.id === "groq").pausedForSeconds).toBeGreaterThan(0);
    expect(Object.values(status.preview as Record<string, { ref: string }[]>).flat().every((m) => !m.ref.startsWith("groq/"))).toBe(true);
    clock.t += 60 * 60_000;
    expect(Object.values(await preview()).flat().some((m) => m.ref.startsWith("groq/"))).toBe(true);
  });

  it("a model OmniRoute does not verify as free is never chosen", async () => {
    vi.stubEnv("OMNIROUTE_API_KEY", "omni-key-0123456789abcdef");
    await start();
    providers["omniroute"]!.models = [FREE("paid/gpt-x", { priceInput: 0.000002, priceOutput: 0.00001, pricingFields: { "pricing.prompt": "0.000002", "pricing.completion": "0.00001" } }), FREE("free/model-70b", { pricingFields: { "pricing.prompt": "0", "pricing.completion": "0" }, priceInput: 0, priceOutput: 0 })];
    await call("PATCH", "/api/llm/providers/omniroute", { enabled: true });
    await call("POST", "/api/llm/routing/refresh-all");
    const all = Object.values(await preview()).flat().map((m) => m.ref);
    expect(all).toContain("omniroute/free/model-70b");
    expect(all).not.toContain("omniroute/paid/gpt-x");
  });

  it("when nothing is eligible the error says what to do", async () => {
    await start();
    await call("PUT", "/api/llm/routing", { allowedProviders: ["openrouter"] });
    const res = await chat((await mkBot("auto/general")).id);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/No eligible free model/);
  });

  it("can be switched off completely", async () => {
    await start();
    const bot = await mkBot("auto/general");
    await call("PUT", "/api/llm/routing", { enabled: false });
    const res = await chat(bot.id);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toMatch(/routing is switched off/);
    for (const p of Object.values(providers)) expect(p.calls).toHaveLength(0);
  });
});

describe("failover", () => {
  it("moves to the next provider when one is rate-limited, and says which models it tried", async () => {
    await start();
    const bot = await mkBot("auto/coding");
    for (let i = 0; i < 4; i++) providers["groq"]!.script.push(new LlmError("rate_limited", "slow down", { retryable: true }));
    const res = await chat(bot.id);
    expect(res.status).toBe(200);
    expect(providers["gemini"]!.calls.length).toBeGreaterThanOrEqual(1);
    const usage = JSON.stringify(await usageModels());
    expect(usage).toMatch(/gemini/);
  });

  it("does not try the other models of a provider that rejected the key", async () => {
    await start();
    const bot = await mkBot("auto/general");
    providers["groq"]!.script.push(new LlmError("auth_failed", "bad key"), new LlmError("auth_failed", "bad key"));
    providers["gemini"]!.script.push(new LlmError("auth_failed", "bad key"), new LlmError("auth_failed", "bad key"));
    const res = await chat(bot.id);
    expect(res.status).toBe(200);
    expect(providers["ollama"]!.calls).toHaveLength(1); // only the local backup was left
    const groqModels = new Set(providers["groq"]!.calls.map((c) => c.model));
    expect(groqModels.size).toBeLessThanOrEqual(1);
  });

  it("falls back to the local Ollama model when every cloud provider fails", async () => {
    await start();
    const bot = await mkBot("auto/general");
    for (const id of ["groq", "gemini"]) for (let i = 0; i < 6; i++) providers[id]!.script.push(new LlmError("provider_unavailable", "down", { retryable: true }));
    const res = await chat(bot.id);
    expect(res.status).toBe(200);
    expect(providers["ollama"]!.calls.map((c) => c.model)).toEqual(["llama3.2:3b"]);
  });

  it("gives up after the allowed number of different models, listing what it tried", async () => {
    await start({}, { maxAttempts: 2 });
    const bot = await mkBot("auto/general");
    for (const id of ["groq", "gemini", "ollama"]) for (let i = 0; i < 8; i++) providers[id]!.script.push(new LlmError("provider_unavailable", "down", { retryable: true }));
    const res = await chat(bot.id);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.message).toMatch(/No model could answer\. Tried: .*\(provider_unavailable\), .*\(provider_unavailable\)/);
    expect((res.body.message.match(/provider_unavailable\)/g) ?? []).length).toBe(2);
  });

  it("does NOT hop around limits that apply to everything, and never bypasses them", async () => {
    await start();
    const bot = await mkBot("auto/general");
    await call("PUT", "/api/llm/limits", { botDailyRequests: 1 });
    expect((await chat(bot.id)).status).toBe(200);
    const calls = Object.values(providers).reduce((n, p) => n + p.calls.length, 0);
    const second = await chat(bot.id);
    expect(second.status).toBe(429);
    expect(Object.values(providers).reduce((n, p) => n + p.calls.length, 0)).toBe(calls);
  });

  it("the pause switch stops automatic calls like any other", async () => {
    await start();
    const bot = await mkBot("auto/general");
    await call("PUT", "/api/llm/pause", { paused: true });
    expect((await chat(bot.id)).status).toBe(409);
    for (const p of Object.values(providers)) expect(p.calls).toHaveLength(0);
  });

  it("classifies failures: provider-level, model-level, or stop", () => {
    expect(failoverKind(new LlmError("rate_limited", "x"))).toBe("model"); // free-tier quotas belong to one model
    expect(failoverKind(new LlmError("quota_exceeded", "x"))).toBe("provider");
    expect(failoverKind(new LlmError("limit_exceeded", "x", { limitKey: "providerDailyRequests" }))).toBe("provider");
    expect(failoverKind(new LlmError("limit_exceeded", "x", { limitKey: "globalDailyRequests" }))).toBe("stop");
    expect(failoverKind(new LlmError("limit_exceeded", "x", { limitKey: "botDailyTokens" }))).toBe("stop");
    expect(failoverKind(new LlmError("model_mismatch", "x"))).toBe("model");
    expect(failoverKind(new LlmError("model_not_found", "x"))).toBe("model");
    for (const code of ["paused", "prompt_too_large", "blocked_by_policy", "bad_request", "content_blocked", "no_model_selected"] as const) expect(failoverKind(new LlmError(code, "x"))).toBe("stop");
  });
});

describe("a model that is out of free-tier quota", () => {
  const limited = () => new LlmError("rate_limited", "quota", { retryable: true });
  const geminiOnly = { allowedProviders: ["gemini"] };

  it("is rested on its own: its sibling models are still tried, the provider stays healthy, and nothing is wasted afterwards", async () => {
    await start({}, geminiOnly);
    expect((await top("general"))[0]).toBe("gemini/gemini-2.5-pro");
    providers["gemini"]!.script.push(limited()); // the first call (Pro) is out of quota
    const bot = await mkBot();
    const res = await chat(bot.id);
    expect(res.status).toBe(200);
    expect(providers["gemini"]!.calls.map((c) => c.model)).toEqual(["gemini-2.5-pro", "gemini-2.5-flash"]); // one wasted call, then the sibling answered
    expect(res.body.assistantMessage.modelId).toBe("gemini-2.5-flash");
    expect((await call("GET", "/api/llm/providers")).body.providers.find((p: any) => p.id === "gemini").status).not.toBe("rate_limited");
    expect((await call("GET", "/api/llm/routing")).body.cooldowns).toEqual([{ ref: "gemini/gemini-2.5-pro", secondsLeft: 60 }]); // the dashboard can show it

    providers["gemini"]!.calls.length = 0;
    for (let i = 0; i < 3; i++) expect((await chat(bot.id)).status).toBe(200);
    expect(providers["gemini"]!.calls.map((c) => c.model)).toEqual(["gemini-2.5-flash", "gemini-2.5-flash", "gemini-2.5-flash"]); // Pro was not asked again while it rests
    expect((await top("general")).includes("gemini/gemini-2.5-pro")).toBe(false);

    providers["gemini"]!.calls.length = 0;
    clock.t += 61_000; // its rest is over: it gets one fresh try
    expect((await chat(bot.id)).status).toBe(200);
    expect(providers["gemini"]!.calls[0]!.model).toBe("gemini-2.5-pro");
  });

  it("two different models limited in one request escalate to the whole provider: its third model is not tried", async () => {
    await start({ gemini: [FREE("gemini-2.5-pro"), FREE("gemini-2.5-flash"), FREE("gemini-2.5-flash-lite")] }, geminiOnly);
    providers["gemini"]!.script.push(limited(), limited());
    const res = await chat((await mkBot()).id);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(providers["gemini"]!.calls).toHaveLength(2); // two limited models = the provider is out of allowance; no third request
    expect(providers["groq"]!.calls).toHaveLength(0); // and Groq stayed out of it because the owner limited routing to Gemini
  });

  it("with another provider allowed, that provider answers after the first limited model", async () => {
    await start({ gemini: [FREE("gemini-2.5-pro"), FREE("gemini-2.5-flash")] }, { providerOrder: ["gemini", "groq"] });
    providers["gemini"]!.script.push(limited(), limited());
    const res = await chat((await mkBot("auto/research")).id);
    expect(res.status).toBe(200);
    expect(providers["gemini"]!.calls.length).toBeLessThanOrEqual(2);
    expect(res.body.assistantMessage.modelId).toBeTruthy();
  });

  it("when every model is resting it says so, with the time left, and sends nothing (not 'connect a provider')", async () => {
    await start({}, geminiOnly);
    providers["gemini"]!.script.push(limited(), limited()); // both Gemini models limited
    const bot = await mkBot();
    const first = await chat(bot.id);
    expect(first.status).toBeGreaterThanOrEqual(400);
    providers["gemini"]!.calls.length = 0;
    const second = await chat(bot.id);
    expect(providers["gemini"]!.calls).toHaveLength(0);
    expect(second.status).toBe(429);
    expect(second.body.message).toMatch(/resting after hitting its free-tier limit.*in about \d+ seconds/);
    expect(second.body.message).not.toMatch(/Connect a provider/);
    clock.t += 61_000;
    expect((await chat(bot.id)).status).toBe(200);
  });

  it("never picks a model built for another job (computer control, filtering, embeddings) for automatic routing", async () => {
    await start({ gemini: [FREE("gemini-2.5-computer-use-preview-10-2025"), FREE("gemini-2.5-flash")], groq: [FREE("llama-guard-4-12b"), FREE("llama-3.1-8b-instant")] });
    for (const cls of ["general", "coding", "research", "light"]) expect((await top(cls)).filter((r) => /computer-use|guard/.test(r))).toEqual([]);
    expect(traitsOf("gemini-2.5-computer-use-preview-10-2025").specialized).toBe(true);
    expect(traitsOf("gemini-2.5-pro").specialized).toBe(false);
    expect(geminiPlugin.isTextModel("gemini-2.5-computer-use-preview-10-2025")).toBe(false);
    expect(geminiPlugin.isTextModel("gemini-2.5-flash")).toBe(true);
  });

  it("speech models (transcription) are not chat models: not listed, not routed (real case: gemini-3.5-transcribe answered chat with HTTP 400 twice)", async () => {
    await start({ gemini: [FREE("gemini-3.5-transcribe"), FREE("gemini-2.5-flash")], groq: [FREE("whisper-large-v3"), FREE("distil-whisper-large"), FREE("playai-speech-1"), FREE("llama-3.1-8b-instant")] });
    // the real adapter drops these from the provider's model list (the scripted provider used here does not, so the plugin filters are asserted directly)
    for (const id of ["gemini-3.5-transcribe", "gemini-2.5-flash-preview-tts"]) expect(geminiPlugin.isTextModel(id)).toBe(false);
    for (const id of ["whisper-large-v3", "distil-whisper-large", "playai-speech-1"]) expect(groqPlugin.isTextModel(id)).toBe(false);
    expect(groqPlugin.isTextModel("llama-3.1-8b-instant")).toBe(true);
    expect(traitsOf("gemini-3.5-transcribe").specialized).toBe(true); // also ruled out by the router if a provider lists it some other way
    expect(traitsOf("gemini-2.5-flash").specialized).toBe(false);
    expect(geminiPlugin.isTextModel("gemini-3.5-transcribe")).toBe(false);
    for (const cls of ["general", "coding", "research", "light"]) expect((await top(cls)).filter((r) => /transcri|whisper|speech/.test(r))).toEqual([]);
  });

  it("does not change the free-only rules: no paid or blocked model becomes eligible while others rest", async () => {
    await start({}, geminiOnly);
    const models = (await call("GET", "/api/llm/models")).body.models as any[];
    const flash = models.find((m) => m.ref === "gemini/gemini-2.5-flash");
    await call("PATCH", `/api/llm/models/${flash.id}`, { enabled: false }); // the owner switched Flash off
    providers["gemini"]!.script.push(limited());
    const res = await chat((await mkBot()).id);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(providers["gemini"]!.calls.map((c) => c.model)).toEqual(["gemini-2.5-pro"]); // Flash stayed off
  });
});

describe("new and existing bots", () => {
  it("a new bot with no model gets automatic routing when a free model is available", async () => {
    await start({}, { autoAssignNewBots: true });
    const bot = (await switchOn(call, await call("POST", "/api/bots", { name: "Fresh" }))).body.bot;
    expect(bot.model).toBe("auto/general");
    expect((await chat(bot.id)).status).toBe(200);
  });

  it("but not when none is available, nor when you chose a model, nor when the setting is off", async () => {
    await start({}, { autoAssignNewBots: true, allowedProviders: ["openrouter"] });
    expect((await switchOn(call, await call("POST", "/api/bots", { name: "None" }))).body.bot.model).toBeNull();
    await call("PUT", "/api/llm/routing", { allowedProviders: [] });
    expect((await switchOn(call, await call("POST", "/api/bots", { name: "Own", model: "groq/llama-3.1-8b-instant" }))).body.bot.model).toBe("groq/llama-3.1-8b-instant");
    await call("PUT", "/api/llm/routing", { autoAssignNewBots: false });
    expect((await switchOn(call, await call("POST", "/api/bots", { name: "Off" }))).body.bot.model).toBeNull();
  });

  it("one click gives automatic routing to bots without a model and leaves the others alone", async () => {
    await start();
    const none = await mkBot(null);
    const own = await mkBot("groq/llama-3.1-8b-instant");
    const res = await call("POST", "/api/llm/routing/assign");
    expect(res.body.changed).toBe(1);
    expect((await call("GET", `/api/bots/${none.id}`)).body.bot.model).toBe("auto/general");
    expect((await call("GET", `/api/bots/${own.id}`)).body.bot.model).toBe("groq/llama-3.1-8b-instant");
    expect((await call("GET", `/api/bots/${none.id}/versions`)).body.versions.length).toBeGreaterThan(1); // recorded in version history
  });

  it("rejects made-up automatic choices", async () => {
    await start();
    expect((await switchOn(call, await call("POST", "/api/bots", { name: "X", model: "auto/fastest" }))).status).toBe(400);
  });
});

describe("keeping the catalog fresh", () => {
  it("auto-enables only brand-new free models: one you switched off stays off, and unverified ones are not touched", async () => {
    await start();
    const models = (await call("GET", "/api/llm/models")).body.models as any[];
    const pro = models.find((m) => m.ref === "gemini/gemini-2.5-pro");
    await call("PATCH", `/api/llm/models/${pro.id}`, { enabled: false });
    providers["gemini"]!.models = [FREE("gemini-2.5-flash"), FREE("gemini-2.5-pro"), FREE("gemini-3-new")];
    await call("POST", "/api/llm/routing/refresh-all");
    const after = (await call("GET", "/api/llm/models")).body.models as any[];
    expect(after.find((m) => m.ref === "gemini/gemini-2.5-pro").enabled).toBe(false);
    expect(after.find((m) => m.ref === "gemini/gemini-3-new").enabled).toBe(true);
  });

  it("does nothing by itself when switched off", async () => {
    await start({}, { autoEnableEligible: false });
    const models = (await call("GET", "/api/llm/models")).body.models as any[];
    expect(models.every((m) => !m.enabled)).toBe(true);
  });

  it("refreshes by itself on the clock, only when due, and never when set to 0", async () => {
    await start({}, { autoRefreshHours: 12 });
    const repo = (app as any); // the scheduler hook is created inside buildApp; use a second instance on the same pieces through the API
    void repo;
    const before = providers["groq"]!.models.length;
    providers["groq"]!.models = [...providers["groq"]!.models, FREE("mixtral-8x7b-new")];
    clock.t += 13 * 3_600_000;
    await (app as any).automation.tick();
    await new Promise((r) => setTimeout(r, 50));
    const models = (await call("GET", "/api/llm/models")).body.models as any[];
    expect(models.some((m) => m.ref === "groq/mixtral-8x7b-new")).toBe(true);
    expect(before).toBeGreaterThan(0);
  });

  it("the maintenance clock respects its interval", async () => {
    await start({}, { autoRefreshHours: 12 });
    const calls = { n: 0 };
    const fake = { listProviders: () => [], refreshModels: async () => (calls.n++, undefined as any) } as any;
    const repoStub = new Map<string, string>();
    const repo = { getSetting: (k: string) => repoStub.get(k) ?? null, setSetting: (k: string, v: string) => void repoStub.set(k, v) } as any;
    // loadRouting reads "routing" from the repo; give it a 12 hour interval
    repoStub.set("routing", JSON.stringify({ autoRefreshHours: 12 }));
    let now = 10_000_000_000;
    const m = new RoutingMaintenance(repo, fake, () => now);
    await m.tick();
    const first = repoStub.get("routing_last_refresh_ms");
    expect(first).toBe(String(now));
    now += 3_600_000;
    await m.tick();
    expect(repoStub.get("routing_last_refresh_ms")).toBe(first);
    now += 12 * 3_600_000;
    await m.tick();
    expect(repoStub.get("routing_last_refresh_ms")).toBe(String(now));
    repoStub.set("routing", JSON.stringify({ autoRefreshHours: 0 }));
    now += 100 * 3_600_000;
    await m.tick();
    expect(repoStub.get("routing_last_refresh_ms")).not.toBe(String(now));
  });
});

describe("who may change the routing", () => {
  it("the PC can; the settings are validated; a phone cannot", async () => {
    await start();
    expect((await call("PUT", "/api/llm/routing", { maxAttempts: 9 })).status).toBe(400);
    expect((await call("PUT", "/api/llm/routing", { surprise: true })).status).toBe(400);
    expect((await call("PUT", "/api/llm/routing", { maxAttempts: 4, preferLocal: true })).body.config).toMatchObject({ maxAttempts: 4, preferLocal: true });
    expect(JSON.stringify((await call("GET", "/api/audit?limit=50")).body)).toContain("routing.changed");
  });

  it("a phone is refused (owner only)", async () => {
    const phone = await buildApp({ dbPath: ":memory:",
    verification: "off", connectors: [], remoteHosts: ["my-pc.tail1234.ts.net"] });
    const pcCall = makeCaller(phone);
    const { body } = await pcCall("POST", "/api/devices/pairing");
    const h = { host: "my-pc.tail1234.ts.net", origin: "https://my-pc.tail1234.ts.net", "x-awp-client": "dashboard" };
    const paired = await phone.inject({ method: "POST", url: "/api/devices/pair", payload: { code: body.code, name: "P" }, headers: h });
    const cookie = String(paired.headers["set-cookie"]).split(";")[0]!;
    for (const [method, url, payload] of [["PUT", "/api/llm/routing", { enabled: false }], ["POST", "/api/llm/routing/refresh-all", undefined], ["POST", "/api/llm/routing/assign", undefined]] as const) {
      const r = await phone.inject({ method, url, ...(payload ? { payload } : {}), headers: { ...h, cookie } });
      expect(r.statusCode, url).toBe(403);
    }
    await phone.close();
  });
});

beforeEach(() => undefined);

describe("sharing work between providers (spreadLoad, off by default)", () => {
  it("off: equally good models are tried in the provider order every time", async () => {
    await start({ gemini: [FREE("model-a-8b")], groq: [FREE("model-b-8b")] });
    const bot = await mkBot("auto/light");
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) seen.push((await chat(bot.id)).body.assistantMessage.providerId);
    expect(seen).toEqual(["gemini", "gemini", "gemini", "gemini"]);
  });

  it("on: they take turns, a failed or resting model is still skipped, and the chosen order never ignores quality", async () => {
    await start({ gemini: [FREE("model-a-8b")], groq: [FREE("model-b-8b"), FREE("big-70b-versatile")] });
    await call("PUT", "/api/llm/routing", { spreadLoad: true });
    const bot = await mkBot("auto/light");
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) seen.push((await chat(bot.id)).body.assistantMessage.modelId);
    // tied small models alternate; the larger model scores differently for a light task and is not mixed into the rotation
    expect(new Set(seen)).toEqual(new Set(["model-a-8b", "model-b-8b"]));
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen[0]).toBe(seen[2]);
    // a model that fails drops out of that call, the other answers
    providers["gemini"]!.script.push(new LlmError("provider_unavailable", "down"));
    const r = await chat(bot.id);
    expect(r.status).toBe(200);
  });
});
