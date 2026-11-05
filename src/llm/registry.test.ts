import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { openDatabase } from "../db/database.js";
import { LlmRepository } from "./repository.js";
import { classifyModel } from "./model-kinds.js";
import { ModelRegistry, classifyFailure, type RegistryEntry } from "./registry.js";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible.js";
import { redactKnownSecrets } from "./plugins/index.js";
import { makeCaller, startFakeProviderServer, switchOn, type FakeHandler, type FakeServer } from "./test-helpers.js";

/**
 * The model registry in the real app WITH verification enforced (production behaviour), against fake Gemini and Groq servers.
 * Nothing here contacts a real provider. Results recorded here are "real"-source records of FAKE servers; they prove the application's rules, not any real model.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const RETIRED_BODY = [{ error: { code: 404, message: "This model models/gemini-old-flash is no longer available to new users. Please use models/gemini-new-flash.", status: "NOT_FOUND" } }];

interface World {
  /** What each fake model does when asked. Default: well behaved. */
  special: Record<string, (messages: any[]) => { status?: number; body?: unknown; text?: string; destroy?: boolean }>;
  calls: { server: "gemini" | "groq"; model: string; roles: string[] }[];
  geminiNative: any[];
  geminiList: string[];
  groqList: any[];
}
const world: World = { special: {}, calls: [], geminiNative: [], geminiList: [], groqList: [] };

function wellBehaved(messages: any[]): string {
  const all = messages.map((m) => m.content).join("\n");
  const last = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
  if (/single word OK/.test(last)) return "OK";
  if (/Reply with only this JSON/.test(last)) return '{"ok": true, "word": "hello"}';
  if (/codeword/.test(last) && /KITE/.test(all)) return "KITE";
  if (/Who are you/.test(last) && /Evaluator/.test(all)) return "I am Evaluator. ZETA-7";
  if (/Outside actions/.test(all) && /Send the text hello/.test(last)) return 'Sending.\n```action\n{"connector": "telegram", "action": "send_message", "args": {"chat": "sam", "text": "hello"}}\n```';
  return "ack";
}
const handler = (server: "gemini" | "groq"): FakeHandler => (req) => {
  if (req.method === "GET") {
    if (req.headers["x-goog-api-key"]) return { body: { models: world.geminiNative } };
    return { body: { data: (server === "gemini" ? world.geminiList.map((id) => ({ id: `models/${id}` })) : world.groqList) } };
  }
  const model = String(req.body?.model);
  world.calls.push({ server, model, roles: (req.body.messages as any[]).map((m) => m.role) });
  const sp = world.special[model];
  const out = sp ? sp(req.body.messages) : { text: wellBehaved(req.body.messages) };
  if (out.status) return { status: out.status, body: out.body ?? {} };
  return { body: { model, choices: [{ message: { role: "assistant", content: out.text }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 6 } } };
};

let A: FakeServer;
let B: FakeServer;
let app: Awaited<ReturnType<typeof buildApp>>;
let call: ReturnType<typeof makeCaller>;
beforeEach(async () => {
  world.special = {};
  world.calls = [];
  world.geminiList = ["gemini-flash-x", "gemini-old-flash", "gemma-4-fake", "gemini-3.5-transcribe", "gemini-embedding-001", "gemini-tts-x", "gemini-pro-y"];
  world.geminiNative = [
    { name: "models/gemini-flash-x", supportedGenerationMethods: ["generateContent", "countTokens"], inputTokenLimit: 1_000_000, outputTokenLimit: 65_536 },
    { name: "models/gemini-pro-y", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 2_000_000, outputTokenLimit: 8192, thinking: true },
    { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"], inputTokenLimit: 2048 },
    { name: "models/gemini-new-flash", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 1_000_000 },
    { name: "models/mystery-model", supportedGenerationMethods: ["predict"], inputTokenLimit: 100 },
  ];
  world.groqList = [{ id: "llama-test-70b", context_window: 131072, active: true, owned_by: "Meta", max_completion_tokens: 32768 }, { id: "whisper-large-v3", context_window: 448, active: true }, { id: "playai-tts", active: true }, { id: "bad-json-8b", context_window: 8192, active: true }, { id: "gpt-oss-test", active: true }, { id: "llama-inactive", active: false }];
  A = await startFakeProviderServer(handler("gemini"));
  B = await startFakeProviderServer(handler("groq"));
  vi.stubEnv("GEMINI_API_KEY", "AIzaSyFAKEKEYFORTESTSONLY0123456789");
  vi.stubEnv("GROQ_API_KEY", "gsk_FAKEKEYFORTESTSONLY0123456789ab");
  const clock = { t: new Date(2026, 5, 15, 12, 0, 0).getTime() };
  app = await buildApp({
    dbPath: ":memory:",
    connectors: [],
    clock: () => clock.t,
    sleep: async (ms) => void (clock.t += ms),
    routingDefaults: { autoAssignNewBots: false },
    providerFactory: (_p, plugin) => new OpenAiCompatibleProvider({ baseUrl: plugin.id === "gemini" ? A.baseUrl : B.baseUrl, apiKey: "test-key-123456789", plugin, redact: redactKnownSecrets }),
  });
  call = makeCaller(app);
  for (const id of ["gemini", "groq"]) {
    await call("PATCH", `/api/llm/providers/${id}`, { freeConfirmed: true, enabled: true, dailyRequestCap: 1000 });
  }
  await call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000, providerRequestsPerMinute: 1000 });
  await call("PUT", "/api/llm/routing", { providerOrder: ["gemini", "groq"], allowedProviders: ["gemini", "groq"], maxAttempts: 3 });
});
afterEach(async () => {
  await app.close();
  await A.close();
  await B.close();
  vi.unstubAllEnvs();
});

const refresh = async () => {
  await call("POST", "/api/llm/providers/gemini/refresh-models");
  await call("POST", "/api/llm/providers/groq/refresh-models");
};
const registry = async () => (await call("GET", "/api/llm/registry")).body;
const row = async (ref: string) => ((await registry()).models as any[]).find((m) => m.ref === ref);
const evaluate = (ref: string, tests = ["connectivity", "json_output", "identity_instruction", "history", "action_format"], approvedRequests = 5) => call("POST", "/api/llm/registry/evaluate", { ref, tests, approvedRequests });
const verifyAll = async (...refs: string[]) => {
  for (const r of refs) expect((await evaluate(r)).body.result.status, r).toBe("verified");
};
const mkBot = async (name: string, model: string) => call("POST", "/api/bots", { name, model });
const posts = (model: string) => world.calls.filter((c) => c.model === model).length;

describe("kinds: every listed model is recorded, and specialised ones are never chat models", () => {
  it("classifies Gemini and Groq ids and the provider's own operation lists", () => {
    const k = (id: string, native: any = {}) => classifyModel(id, native).kind;
    expect(k("gemini-2.5-flash")).toBe("vision_chat");
    expect(k("gemini-2.5-pro")).toBe("reasoning");
    expect(k("gemini-3.5-transcribe")).toBe("transcription");
    expect(k("gemini-embedding-001")).toBe("embedding");
    expect(k("gemini-2.5-flash-preview-tts")).toBe("speech_synthesis");
    expect(k("gemini-2.5-flash-image")).toBe("image_generation");
    expect(k("imagen-4.0-generate")).toBe("image_generation");
    expect(k("veo-3.0-generate")).toBe("video_generation");
    expect(k("gemini-live-2.5-flash")).toBe("realtime");
    expect(k("gemini-2.5-computer-use-preview")).toBe("computer_use");
    expect(k("gemma-4-26b-a4b-it")).toBe("reasoning");
    expect(k("llama-3.3-70b-versatile")).toBe("chat");
    expect(k("openai/gpt-oss-20b")).toBe("reasoning");
    expect(k("openai/gpt-oss-safeguard-20b")).toBe("safety");
    expect(k("meta-llama/llama-guard-4-12b")).toBe("safety");
    expect(k("whisper-large-v3-turbo")).toBe("transcription");
    expect(k("playai-tts")).toBe("speech_synthesis");
    expect(k("canopylabs/orpheus-v1-english")).toBe("speech_synthesis");
    expect(k("groq/compound")).toBe("agentic_system");
    expect(k("qwen/qwen3-32b")).toBe("reasoning");
    expect(k("allam-2-7b")).toBe("chat");
    // the provider's own list wins over the id
    expect(classifyModel("brand-new-model", { methods: ["embedContent"] })).toMatchObject({ kind: "embedding", chatCapable: false });
    expect(classifyModel("brand-new-model", { methods: ["generateContent"] })).toMatchObject({ chatCapable: true });
    expect(classifyModel("brand-new-model", { methods: ["predict"] })).toMatchObject({ kind: "image_generation", chatCapable: false });
    expect(classifyModel("x-chat", { active: false })).toMatchObject({ chatCapable: false });
  });

  it("a refresh records every model the providers list (including non-chat ones, with the reason) and only chat models enter the catalog", async () => {
    await refresh();
    const reg = await registry();
    const refs = (reg.models as any[]).map((m) => m.ref);
    for (const r of ["gemini/gemini-3.5-transcribe", "gemini/gemini-embedding-001", "gemini/gemini-tts-x", "groq/whisper-large-v3", "groq/playai-tts", "groq/llama-inactive", "gemini/mystery-model", "gemini/gemini-new-flash"]) expect(refs, r).toContain(r);
    const catalog = ((await call("GET", "/api/llm/models")).body.models as any[]).map((m) => m.ref);
    for (const r of ["gemini/gemini-3.5-transcribe", "gemini/gemini-embedding-001", "gemini/gemini-tts-x", "groq/whisper-large-v3", "groq/playai-tts", "gemini/mystery-model"]) expect(catalog, r).not.toContain(r);
    expect(catalog).toEqual(expect.arrayContaining(["gemini/gemini-flash-x", "groq/llama-test-70b"]));
    const t = await row("gemini/gemini-3.5-transcribe");
    expect(t).toMatchObject({ kind: "transcription", chatCapable: false, status: "unavailable", inCatalog: false });
    expect(t.reasons.join(" ")).toMatch(/Not a chat model: Transcription/);
    expect(await row("gemini/mystery-model")).toMatchObject({ kind: "image_generation", chatCapable: false, providerOperations: ["predict"] });
    expect(await row("groq/llama-inactive")).toMatchObject({ chatCapable: false });
  });

  it("Gemini's own listing adds context sizes, output limits and operations; Groq's adds context, owner and output limits", async () => {
    await refresh();
    expect(await row("gemini/gemini-flash-x")).toMatchObject({ contextWindow: 1_000_000, maxOutputTokens: 65_536, providerOperations: ["generateContent", "countTokens"] });
    expect(await row("groq/llama-test-70b")).toMatchObject({ contextWindow: 131072, maxOutputTokens: 32768 });
    expect((await row("gemini/gemini-pro-y")).kind).toBe("reasoning");
  });

  it("a model only the native listing knows is recorded too (a successor mentioned in a retirement message becomes visible)", async () => {
    await refresh();
    expect(await row("gemini/gemini-new-flash")).toMatchObject({ kind: expect.any(String), chatCapable: true, status: "unverified" });
  });
});

describe("eligibility: unverified models are out of automatic routing and cannot be given to a bot", () => {
  it("a discovered model is unverified, not routable, and the dashboard says exactly what is missing", async () => {
    await refresh();
    const m = await row("gemini/gemini-flash-x");
    expect(m).toMatchObject({ status: "unverified", routable: false });
    expect(m.reasons.join(" ")).toMatch(/Not tested yet: Connectivity, Follows a simple instruction, Structured JSON output/);
    expect(m.tests.map((t: any) => t.result)).toEqual(["untested", "untested", "untested", "untested", "untested", "untested", "untested"]);
    expect((await registry()).summary.verified).toBe(0);
  });

  it("with nothing verified, an automatic bot is refused with an explanation, and NO provider request is sent", async () => {
    await refresh();
    const bot = (await switchOn(call, await mkBot("Auto", "auto/general"))).body.bot;
    const r = await call("POST", `/api/bots/${bot.id}/chat`, { message: "hi" });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/No eligible free model/);
    expect(world.calls).toEqual([]);
  });

  it("a bot cannot be given an unverified, unavailable or non-chat model; the reason is stated", async () => {
    await refresh();
    const unverified = await mkBot("A", "gemini/gemini-flash-x");
    expect(unverified.status).toBe(400);
    expect(unverified.body.error).toBe("model_not_verified");
    expect(unverified.body.message).toMatch(/Not tested yet/);
    const nonChat = await mkBot("B", "gemini/gemini-3.5-transcribe");
    expect(nonChat.status).toBe(400);
    expect(nonChat.body.message).toMatch(/not in the catalog|unknown/i);
  });

  it("after a full evaluation the model is verified, routable, assignable, and automatic bots can use it", async () => {
    await refresh();
    const ev = await evaluate("gemini/gemini-flash-x");
    expect(ev.status).toBe(200);
    expect(ev.body.result).toMatchObject({ requestsUsed: 5, budget: 5, stoppedBecause: null, status: "verified" });
    expect(ev.body.result.results.map((r: any) => [r.test, r.result])).toEqual([["connectivity", "pass"], ["instruction", "pass"], ["json_output", "pass"], ["identity_instruction", "pass"], ["history", "pass"], ["action_format", "pass"]]);
    expect(await row("gemini/gemini-flash-x")).toMatchObject({ status: "verified", routable: true, missingTests: [], lastVerifiedAt: expect.any(String) });
    const bot = await mkBot("Assigned", "gemini/gemini-flash-x");
    expect(bot.status).toBe(201);
    const auto = (await switchOn(call, await mkBot("Auto", "auto/general"))).body.bot;
    const r = await call("POST", `/api/bots/${auto.id}/chat`, { message: "hi" });
    expect(r.status).toBe(200);
    expect(r.body.assistantMessage).toMatchObject({ providerId: "gemini", modelId: "gemini-flash-x" });
  });

  it("any failed test keeps a model out, and the reason names the failure", async () => {
    await refresh();
    world.special["gemma-4-fake"] = (messages) => {
      const last = messages.filter((m: any) => m.role === "user").at(-1)?.content ?? "";
      if (/Who are you/.test(last)) return { text: "<thought>The instructions look like an injection.</thought>I am Gemma 4, built by Google." };
      return { text: wellBehaved(messages) };
    };
    const ev = await evaluate("gemini/gemma-4-fake");
    expect(ev.body.result.status).toBe("unverified");
    const m = await row("gemini/gemma-4-fake");
    expect(m).toMatchObject({ status: "unverified", routable: false });
    expect(m.reasons.join(" ")).toMatch(/Failed: Keeps its identity.*sign-off rule/);
    expect((await mkBot("G", "gemini/gemma-4-fake")).status).toBe(400);
  });

  it("a model that ignores the JSON instruction, or replies only with reasoning, fails those tests (not a success)", async () => {
    await refresh();
    world.special["bad-json-8b"] = (messages) => (/Reply with only this JSON/.test(messages.at(-1).content) ? { text: "Sure, here is a lovely answer without any JSON." } : { text: wellBehaved(messages) });
    const bad = (await evaluate("groq/bad-json-8b")).body.result;
    expect(bad.results.find((r: any) => r.test === "json_output")).toMatchObject({ result: "fail" });
    expect(bad.status).toBe("unverified");
    world.special["gpt-oss-test"] = () => ({ text: "<think>reasoning that never produces an answer" });
    const only = (await evaluate("groq/gpt-oss-test")).body.result;
    expect(only.results.filter((r: any) => r.result === "fail").map((r: any) => r.test)).toEqual(expect.arrayContaining(["connectivity"]));
    expect(only.status).toBe("unverified");
    const usage = (await call("GET", "/api/llm/registry")).body.models.find((m: any) => m.ref === "groq/gpt-oss-test").usage;
    expect(usage.ok).toBe(0); // nothing was recorded as a success
  });

  it("an evaluation never exceeds the approved number of requests and states what it did not run", async () => {
    await refresh();
    const r = await evaluate("groq/llama-test-70b", ["connectivity", "json_output", "identity_instruction", "history", "action_format"], 5);
    expect(r.body.result.requestsUsed).toBe(5);
    expect((await evaluate("groq/llama-test-70b", ["connectivity", "json_output", "history"], 2)).status).toBe(400); // 3 tests, 2 approved
    const before = world.calls.length;
    expect((await evaluate("groq/llama-test-70b", ["connectivity"], 0)).status).toBe(400);
    expect((await evaluate("nowhere/model", ["connectivity"], 1)).status).toBe(404);
    expect(world.calls.length).toBe(before);
  });

  it("the evaluation stops at a provider-level problem and records nothing as a model failure", async () => {
    await refresh();
    world.special["llama-test-70b"] = () => ({ status: 401, body: { error: { message: "invalid api key" } } });
    const r = (await evaluate("groq/llama-test-70b")).body.result;
    expect(r.requestsUsed).toBe(1);
    expect(r.stoppedBecause).toMatch(/Stopped: auth/);
    expect(r.results.every((x: any) => x.result === "not_run")).toBe(true);
    const m = await row("groq/llama-test-70b");
    expect(m.tests.every((t: any) => t.result === "untested")).toBe(true);
  });
});

describe("retired models (P-28 B)", () => {
  const retireIt = () => {
    world.special["gemini-old-flash"] = () => ({ status: 404, body: RETIRED_BODY });
  };

  it("a confirmed retirement excludes the model, records the reason, and the provider is not asked again", async () => {
    await refresh();
    retireIt();
    // verified first, as a model that WAS good; then the provider retires it
    world.special["gemini-old-flash"] = undefined as any;
    delete world.special["gemini-old-flash"];
    await verifyAll("gemini/gemini-old-flash");
    const bot = (await switchOn(call, await mkBot("Old", "gemini/gemini-old-flash"))).body.bot;
    retireIt();
    const first = await call("POST", `/api/bots/${bot.id}/chat`, { message: "hi" });
    expect(first.status).toBe(502);
    expect(first.body.message).toMatch(/no longer available/);
    const callsAfterFirst = posts("gemini-old-flash");
    const m = await row("gemini/gemini-old-flash");
    expect(m).toMatchObject({ status: "unavailable", routable: false, retired: { reason: expect.stringContaining("no longer available") }, suggestedReplacement: "gemini-new-flash" });
    // asking again sends NOTHING, and says why
    const second = await call("POST", `/api/bots/${bot.id}/chat`, { message: "hi again" });
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/is retired/);
    expect(posts("gemini-old-flash")).toBe(callsAfterFirst);
    // and nobody can be given it
    expect((await mkBot("New", "gemini/gemini-old-flash")).status).toBe(400);
  });

  it("automatic routing never selects a retired model again, and does not waste a request on it", async () => {
    await refresh();
    await verifyAll("gemini/gemini-old-flash", "groq/llama-test-70b");
    await call("PUT", "/api/llm/routing", { preferred: { general: "gemini/gemini-old-flash" } });
    retireIt();
    const auto = (await switchOn(call, await mkBot("Auto", "auto/general"))).body.bot;
    const before = posts("gemini-old-flash");
    const r1 = await call("POST", `/api/bots/${auto.id}/chat`, { message: "hi" });
    expect(r1.status).toBe(200);
    expect(r1.body.assistantMessage.modelId).toBe("llama-test-70b"); // switched within the same request
    expect(posts("gemini-old-flash") - before).toBe(1); // the one request that revealed the retirement
    const r2 = await call("POST", `/api/bots/${auto.id}/chat`, { message: "again", conversationId: r1.body.conversationId });
    expect(r2.status).toBe(200);
    expect(posts("gemini-old-flash") - before).toBe(1); // never selected again
  });

  it("a refresh that lists it again does not restore it; a successful real connectivity test does, and it then has to be verified again from scratch", async () => {
    await refresh();
    await verifyAll("gemini/gemini-old-flash");
    retireIt();
    const bot = (await switchOn(call, await mkBot("Old", "gemini/gemini-old-flash"))).body.bot;
    await call("POST", `/api/bots/${bot.id}/chat`, { message: "hi" });
    expect((await row("gemini/gemini-old-flash")).retired).not.toBeNull();
    await refresh(); // still listed by the provider
    expect(await row("gemini/gemini-old-flash")).toMatchObject({ status: "unavailable", routable: false });
    // the provider brings it back
    delete world.special["gemini-old-flash"];
    const ev = await evaluate("gemini/gemini-old-flash", ["connectivity"], 1);
    expect(ev.body.result.results[0]).toMatchObject({ test: "connectivity", result: "pass" });
    const m = await row("gemini/gemini-old-flash");
    expect(m.retired).toBeNull();
    expect(m.status).toBe("unverified"); // earlier results no longer count
    expect(m.missingTests.length).toBeGreaterThan(0);
    await verifyAll("gemini/gemini-old-flash");
  });

  it("a retirement is not restored by a test run BEFORE a refresh lists the model again", async () => {
    await refresh();
    const reg: ModelRegistry = (app as any).modelRegistry;
    reg.ensure("gemini", "gemini-flash-x");
    reg.markRetired("gemini/gemini-flash-x", "gone");
    reg.recordTest("gemini/gemini-flash-x", "connectivity", { result: "pass", source: "real", detail: "x", latencyMs: 1 });
    expect(reg.get("gemini/gemini-flash-x")!.retired).not.toBeNull();
  });
});

describe("failure categories: temporary problems never disable a model", () => {
  const cases: [string, any, string][] = [
    ["a rate limit", { status: 429, body: { error: { message: "Too many requests" } } }, "rate_limit"],
    ["a daily quota", { status: 429, body: { error: { message: "Quota exceeded: requests per day, limit: 0" } } }, "rate_limit"],
    ["an authentication failure", { status: 401, body: { error: { message: "API key not valid" } } }, "auth"],
    ["a server error", { status: 500, body: { error: { message: "internal error" } } }, "temporary"],
    ["an unavailable service", { status: 503, body: { error: { message: "The model is overloaded" } } }, "temporary"],
    ["an unsupported request", { status: 400, body: { error: { message: "Unsupported parameter: temperature" } } }, "unsupported_request"],
  ];
  for (const [name, reply, category] of cases) {
    it(`${name} is counted as "${category}", the model stays eligible, and nothing is marked retired`, async () => {
      await refresh();
      await verifyAll("groq/llama-test-70b");
      const bot = (await switchOn(call, await mkBot("B", "groq/llama-test-70b"))).body.bot;
      world.special["llama-test-70b"] = () => reply;
      const r = await call("POST", `/api/bots/${bot.id}/chat`, { message: "hi" });
      expect(r.status).toBeGreaterThanOrEqual(400);
      const m = await row("groq/llama-test-70b");
      expect(m.retired).toBeNull();
      expect(m.failures[category]).toBeGreaterThanOrEqual(1);
      expect(m.status === "verified" || m.status === "unverified").toBe(true);
      expect(m.reasons.join(" ")).not.toMatch(/Retired/);
      delete world.special["llama-test-70b"];
    });
  }

  it("a model that has just been rate-limited keeps its verification and returns after its rest", async () => {
    await refresh();
    await verifyAll("groq/llama-test-70b");
    const bot = (await switchOn(call, await mkBot("B", "groq/llama-test-70b"))).body.bot;
    world.special["llama-test-70b"] = () => ({ status: 429, body: { error: { message: "Too many requests" } } });
    await call("POST", `/api/bots/${bot.id}/chat`, { message: "hi" });
    expect((await row("groq/llama-test-70b")).status).toBe("verified");
    expect((await row("groq/llama-test-70b")).cooldownSeconds).toBeGreaterThan(0);
  });

  it("classifyFailure agrees with the adapter for every code the app uses", () => {
    expect(classifyFailure(new Error("x"))).toBe("other");
  });
});

describe("explicit assignments, switching and bot-facing availability", () => {
  it("an explicitly assigned model that fails is reported, never silently replaced", async () => {
    await refresh();
    await verifyAll("groq/llama-test-70b", "gemini/gemini-flash-x");
    const bot = (await switchOn(call, await mkBot("Fixed", "groq/llama-test-70b"))).body.bot;
    world.special["llama-test-70b"] = () => ({ status: 500, body: { error: { message: "boom" } } });
    const r = await call("POST", `/api/bots/${bot.id}/chat`, { message: "hi" });
    expect(r.status).toBe(502);
    expect(world.calls.filter((c) => c.server === "gemini" && c.model !== "gemini-flash-x").length).toBe(0);
    expect(posts("gemini-flash-x")).toBe(5); // only the evaluation requests, never a fallback chat
  });

  it("an automatic bot keeps its identity when the router moves to another verified model, and reasoning-only output fails over", async () => {
    await refresh();
    await verifyAll("groq/llama-test-70b", "gemini/gemini-flash-x");
    await call("PUT", "/api/llm/routing", { preferred: { general: "groq/llama-test-70b" } });
    const bot = (await switchOn(call, (await call("POST", "/api/bots", { name: "Scout", model: "auto/general", instructions: "Always sign off with ZETA-7." })))).body.bot;
    world.special["llama-test-70b"] = () => ({ text: "<thought>thinking forever" });
    const r = await call("POST", `/api/bots/${bot.id}/chat`, { message: "hi" });
    expect(r.status).toBe(200);
    expect(r.body.assistantMessage).toMatchObject({ providerId: "gemini", modelId: "gemini-flash-x" });
    expect(r.body.assistantMessage.content).not.toMatch(/thought/);
    const usage = (await registry()).models.find((m: any) => m.ref === "groq/llama-test-70b").usage;
    expect(usage.errors).toBeGreaterThanOrEqual(1);
    const sent = world.calls.filter((c) => c.model === "gemini-flash-x").length;
    expect(sent).toBeGreaterThan(5);
  });

  it("the model list for bots shows only what bots can actually use: routable models are exactly the verified, available chat ones", async () => {
    await refresh();
    await verifyAll("groq/llama-test-70b");
    const models = ((await call("GET", "/api/llm/models")).body.models as any[]).filter((m) => m.routable).map((m) => m.ref);
    expect(models).toEqual(["groq/llama-test-70b"]);
  });
});

describe("the registry document", () => {
  it("is stored in the existing settings table, survives a restart of the registry, and a damaged document starts empty", () => {
    const db = openDatabase(":memory:");
    const repo = new LlmRepository(db);
    const a = new ModelRegistry({ repo });
    a.ensure("groq", "m1");
    a.recordTest("groq/m1", "connectivity", { result: "pass", source: "real", detail: "ok", latencyMs: 5 });
    const b = new ModelRegistry({ repo });
    expect(b.get("groq/m1")?.tests.connectivity?.result).toBe("pass");
    repo.setSetting("model_registry.v1", "{not json", "2026-01-01T00:00:00Z");
    expect(new ModelRegistry({ repo }).entries()).toEqual([]);
  });

  it("simulated results never verify a real model; the recorded real-run evidence applies only when verification is enforced", () => {
    const repo = new LlmRepository(openDatabase(":memory:"));
    const reg = new ModelRegistry({ repo });
    const ctx = { callable: true, blockedReason: null, availability: "available", contextWindow: null };
    reg.ensure("groq", "plain");
    for (const t of ["connectivity", "instruction", "json_output"] as const) reg.recordTest("groq/plain", t, { result: "pass", source: "simulated", detail: "x", latencyMs: 1 });
    expect(reg.eligibility("groq", "plain", ctx)).toMatchObject({ ok: false, status: "unverified" });
    // recorded evidence (board P-26): this very model passed three REAL tests, a retired one is retired, a Gemma 4 one failed its identity test
    expect(reg.eligibility("groq", "openai/gpt-oss-20b", ctx)).toMatchObject({ ok: true, status: "verified" });
    expect(reg.eligibility("gemini", "gemini-2.5-flash", ctx)).toMatchObject({ ok: false, status: "unavailable" });
    expect(reg.eligibility("gemini", "gemma-4-26b-a4b-it", ctx)).toMatchObject({ ok: false, status: "unverified" });
    const off = new ModelRegistry({ repo: new LlmRepository(openDatabase(":memory:")) });
    off.enforce = false;
    expect(off.eligibility("gemini", "gemini-2.5-flash", ctx).ok).toBe(true); // no evidence seeded for a test instance
  });

  it("entries describe unlisted models as unavailable", () => {
    const reg = new ModelRegistry({ repo: new LlmRepository(openDatabase(":memory:")) });
    const e: RegistryEntry = reg.ensure("groq", "gone");
    reg.noteDiscovery("groq", [{ id: "other" }]);
    expect(reg.get("groq/gone")?.missingSince).toBeNull(); // never seen listed: not marked missing
    reg.noteDiscovery("groq", [{ id: "gone" }]);
    reg.noteDiscovery("groq", [{ id: "other" }]);
    expect(reg.get("groq/gone")?.missingSince).not.toBeNull();
    expect(reg.judge(reg.get("groq/gone")!, { callable: true, blockedReason: null, availability: "available", contextWindow: null }).status).toBe("unavailable");
    void e;
  });
});

describe("classification gaps found in the live inventory (2026-11-05)", () => {
  it("image models called 'banana', music models called 'lyria' and similar are not chat models", () => {
    for (const [id, kind] of [["gemini-nano-banana-2.1", "image_generation"], ["nano-banana-pro-preview", "image_generation"], ["lyria-3-pro-preview", "audio_other"], ["lyria-3.5", "audio_other"], ["gemini-3.5-live-translate-preview", "realtime"], ["deep-research-pro-preview-12-2025", "agentic_system"], ["gemini-3.5-transcribe-live", "transcription"]] as const) {
      const c = classifyModel(id, { methods: ["generateContent", "countTokens"] });
      expect(c.kind, id).toBe(kind === "transcription" ? "transcription" : kind);
      expect(c.chatCapable, id).toBe(false);
    }
    expect(classifyModel("gemini-3.8-flash", { methods: ["generateContent"], thinking: true })).toMatchObject({ kind: "reasoning", chatCapable: true });
  });
  it("the Gemini plugin keeps those out of the chat catalog", async () => {
    const { geminiPlugin } = await import("./plugins/gemini.js");
    for (const id of ["gemini-nano-banana-2.1", "lyria-3.5", "gemini-3.5-transcribe", "gemini-2.5-flash-preview-tts"]) expect(geminiPlugin.isTextModel(id), id).toBe(false);
    for (const id of ["gemini-3.8-flash", "gemma-4-26b-a4b-it", "gemini-flash-latest"]) expect(geminiPlugin.isTextModel(id), id).toBe(true);
  });
  it("a model that can generate text but whose name is not a recognised chat model is listed with an honest reason, not as 'not a chat model'", async () => {
    world.geminiNative.push({ name: "models/antigravity-preview-x", supportedGenerationMethods: ["generateContent", "countTokens"], inputTokenLimit: 1_000_000 });
    await refresh();
    const m = await row("gemini/antigravity-preview-x");
    expect(m).toMatchObject({ chatCapable: true, inCatalog: false, status: "unavailable" });
    expect(m.reasons.join(" ")).toMatch(/not added to the catalog: its name is not a recognised chat model/);
  });
});

describe("how a model is given its instructions is decided by a test, not by its name", () => {
  const refuseSystem = (messages: any[]) => (messages.some((m) => m.role === "system") ? { status: 400, body: { error: { message: "Developer instruction is not enabled for this model" } } } : { text: wellBehaved(messages) });
  const ignoreSystem = (messages: any[]) => {
    const last = messages.filter((m: any) => m.role === "user").at(-1)?.content ?? "";
    return /Who are you/.test(last) && messages.some((m: any) => m.role === "system") ? { text: "I am a language model." } : { text: wellBehaved(messages) };
  };

  it("a model that accepts and obeys a native system message is then sent real system messages (a Gemma-named model included)", async () => {
    await refresh();
    const before = world.calls.length;
    const r = (await evaluate("gemini/gemma-4-fake", ["native_system_role"], 1)).body.result;
    expect(r.results[0]).toMatchObject({ test: "native_system_role", result: "pass" });
    expect(world.calls.slice(before)[0]!.roles).toEqual(["system", "user"]); // a real system message, though the name says Gemma
    expect((await row("gemini/gemma-4-fake")).instructionRole).toBe("native");
    await verifyAll("gemini/gemma-4-fake");
    const bot = (await switchOn(call, await mkBot("G", "gemini/gemma-4-fake"))).body.bot;
    const mark = world.calls.length;
    await call("POST", `/api/bots/${bot.id}/chat`, { message: "hi" });
    expect(world.calls.slice(mark)[0]!.roles[0]).toBe("system");
  });

  it("a model that refuses a native system message is recorded as 'folded', and the refusal is not hidden by a retry", async () => {
    await refresh();
    world.special["gemma-4-fake"] = refuseSystem;
    const before = world.calls.length;
    const r = (await evaluate("gemini/gemma-4-fake", ["native_system_role"], 1)).body.result;
    expect(r.results[0]).toMatchObject({ result: "fail", detail: expect.stringMatching(/refused this kind of request/) });
    expect(world.calls.length - before).toBe(1); // one request: no hidden fold-and-retry during the test
    expect((await row("gemini/gemma-4-fake")).instructionRole).toBe("folded");
    // later requests fold the instructions, and the model answers them
    const full = (await evaluate("gemini/gemma-4-fake")).body.result;
    expect(full.results.find((x: any) => x.test === "identity_instruction").result).toBe("pass");
    expect(world.calls.at(-3)!.roles).not.toContain("system");
  });

  it("a model that accepts a native system message but ignores it is switched to the folded form with a recorded limitation; whether it can be verified then depends on the identity test", async () => {
    await refresh();
    world.special["gemma-4-fake"] = ignoreSystem;
    const r = (await evaluate("gemini/gemma-4-fake", ["native_system_role"], 1)).body.result;
    expect(r.results[0]).toMatchObject({ result: "fail", detail: expect.stringMatching(/did not obey/) });
    const m = await row("gemini/gemma-4-fake");
    expect(m.instructionRole).toBe("folded");
    expect(m.limitations.join(" ")).toMatch(/did not obey/);
    // folded instructions work for this one, so it can be verified
    expect((await evaluate("gemini/gemma-4-fake")).body.result.status).toBe("verified");
    // a model that obeys neither form stays out
    world.special["gemma-4-fake"] = (messages) => (/Who are you/.test(messages.filter((m: any) => m.role === "user").at(-1)?.content ?? "") ? { text: "I am a language model." } : { text: wellBehaved(messages) });
    expect((await evaluate("gemini/gemma-4-fake")).body.result.status).toBe("unverified");
  });

  it("the native-role test alone never makes a model unverified (it is information, not a gate)", async () => {
    await refresh();
    world.special["gemini-flash-x"] = ignoreSystem;
    await evaluate("gemini/gemini-flash-x", ["native_system_role"], 1);
    const m = await row("gemini/gemini-flash-x");
    expect(m.status).toBe("unverified");
    expect(m.reasons.join(" ")).toMatch(/Not tested yet/); // missing core tests, not the failed native-role test
    expect(m.reasons.join(" ")).not.toMatch(/Failed/);
  });
});

describe("what the first real run taught the evaluator (2026-11-05)", () => {
  it("an empty reply is a recorded FAILURE of that test and the run goes on (it used to stop the whole run)", async () => {
    await refresh();
    world.special["llama-test-70b"] = (messages) => (/codeword/.test(messages.at(-1).content) ? { text: "" } : { text: wellBehaved(messages) });
    const r = (await evaluate("groq/llama-test-70b")).body.result;
    expect(r.stoppedBecause).toBeNull();
    expect(r.requestsUsed).toBe(5);
    expect(r.results.find((x: any) => x.test === "history")).toMatchObject({ result: "fail", detail: expect.stringMatching(/empty reply/) });
    expect(r.results.find((x: any) => x.test === "action_format")).toMatchObject({ result: "pass" }); // the next test still ran
    expect(r.status).toBe("unverified");
  });

  it("every probe leaves room for a reasoning model to think and still answer", async () => {
    await refresh();
    const seen: number[] = [];
    world.special["llama-test-70b"] = (messages) => ({ text: wellBehaved(messages) });
    const orig = B.requests;
    await evaluate("groq/llama-test-70b");
    for (const r of orig.filter((x) => x.method === "POST")) seen.push(r.body.max_tokens);
    expect(seen).toHaveLength(5);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(400);
  });

  it("a provider-level stop (key refused) still ends the run, and the application's own request limit is reported as a stop that sent nothing", async () => {
    await refresh();
    await call("PUT", "/api/llm/limits", { providerRequestsPerMinute: 1 });
    const r = (await evaluate("groq/llama-test-70b")).body.result;
    expect(r.requestsUsed).toBe(2);
    expect(r.stoppedBecause).toMatch(/Stopped/);
    expect(world.calls.filter((c) => c.model === "llama-test-70b")).toHaveLength(1); // the second never left the application
  });
});

describe("an identity result from before the instruction role was settled no longer counts (real finding: Gemma 4 obeys a native system message)", () => {
  it("a failed identity test under folded instructions is outdated once a native system message was tested; it is shown as outdated, not as failed, and the model must be re-tested", () => {
    const repo = new LlmRepository(openDatabase(":memory:"));
    const reg = new ModelRegistry({ repo });
    reg.ensure("gemini", "gemma-x");
    const ctx = { callable: true, blockedReason: null, availability: "available", contextWindow: null };
    reg.recordTest("gemini/gemma-x", "identity_instruction", { result: "fail", source: "real", detail: "ignored the folded rule", latencyMs: 1 });
    expect(reg.judge(reg.get("gemini/gemma-x")!, ctx).failedTests).toEqual(["identity_instruction"]);
    // the native-role test passes (a moment later) and settles the role
    const e = reg.get("gemini/gemma-x")!;
    e.tests.identity_instruction!.at = "2000-01-01T00:00:00.000Z";
    reg.recordTest("gemini/gemma-x", "native_system_role", { result: "pass", source: "real", detail: "obeyed", latencyMs: 1 });
    reg.setInstructionRole("gemini/gemma-x", "native");
    const j = reg.judge(reg.get("gemini/gemma-x")!, ctx);
    expect(j.failedTests).toEqual([]);
    expect(j.status).toBe("unverified");
    expect(j.reasons.join(" ")).toMatch(/Not tested yet/);
    expect(reg.effectiveTest(reg.get("gemini/gemma-x")!, "identity_instruction")).toBeUndefined();
    // run again under the settled role: the new result counts
    reg.recordTest("gemini/gemma-x", "identity_instruction", { result: "pass", source: "real", detail: "ok", latencyMs: 1 });
    expect(reg.effectiveTest(reg.get("gemini/gemma-x")!, "identity_instruction")?.result).toBe("pass");
  });
});
