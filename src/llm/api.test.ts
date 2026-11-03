import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_GEMINI_KEY, createTestApp, setupGeminiModel, setupOllamaModel, type TestApp } from "../test-app.js";
import { LlmError } from "./errors.js";
import { modelInfo } from "./test-helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.app.close();
  vi.unstubAllEnvs();
});

const provider = async (id: string) =>
  ((await t.call("GET", "/api/llm/providers")).body.providers as any[]).find((p) => p.id === id);

describe("providers", () => {
  it("lists the five providers, all switched off, unconfirmed, with the approved caps", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const res = await t.call("GET", "/api/llm/providers");
    expect(res.status).toBe(200);
    expect(res.body.providers.map((p: any) => p.id)).toEqual(["gemini", "groq", "openrouter", "ollama", "omniroute"]);
    for (const p of res.body.providers) {
      expect(p.enabled).toBe(false);
      expect(p.freeConfirmed).toBe(false);
      expect(p.modelCount).toBe(0);
    }
    expect(res.body.providers.map((p: any) => p.dailyRequestCap)).toEqual([50, 50, 40, null, 40]);
    expect(res.body.providers[0]).toMatchObject({ kind: "cloud", keyEnv: "GEMINI_API_KEY", keyConfigured: false, requiresFreeConfirmation: true });
    expect(res.body.providers[3]).toMatchObject({ kind: "local", keyEnv: null, keyConfigured: true, baseUrlEditable: true });
  });

  it("reports whether a key is configured but NEVER returns the key itself", async () => {
    vi.stubEnv("GEMINI_API_KEY", FAKE_GEMINI_KEY);
    const key = await t.app.inject({ method: "GET", url: "/api/llm/providers" });
    expect((await provider("gemini")).keyConfigured).toBe(true);
    expect(key.body).not.toContain(FAKE_GEMINI_KEY);
    // ...nor on any other page that talks about providers or models:
    await setupGeminiModel(t);
    for (const url of ["/api/llm/providers", "/api/llm/models", "/api/llm/status", "/api/llm/usage", "/api/bots"]) {
      const res = await t.app.inject({ method: "GET", url });
      expect(res.body).not.toContain(FAKE_GEMINI_KEY);
      expect(res.body).not.toContain("AIzaSy");
    }
  });

  it("a cloud provider cannot be enabled until you confirm the account has no billing", async () => {
    const early = await t.call("PATCH", "/api/llm/providers/gemini", { enabled: true });
    expect(early.status).toBe(409);
    expect(early.body.error).toBe("free_not_confirmed");

    const confirmed = await t.call("PATCH", "/api/llm/providers/gemini", { freeConfirmed: true, enabled: true });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.provider).toMatchObject({ enabled: true, freeConfirmed: true });
  });

  it("withdrawing the confirmation switches the provider off", async () => {
    await t.call("PATCH", "/api/llm/providers/groq", { freeConfirmed: true, enabled: true });
    const res = await t.call("PATCH", "/api/llm/providers/groq", { freeConfirmed: false });
    expect(res.body.provider).toMatchObject({ enabled: false, freeConfirmed: false });
  });

  it("OpenRouter needs no confirmation, and rejects one (it is judged by price instead)", async () => {
    expect((await t.call("PATCH", "/api/llm/providers/openrouter", { enabled: true })).status).toBe(200);
    expect((await t.call("PATCH", "/api/llm/providers/openrouter", { freeConfirmed: true })).status).toBe(400);
  });

  it("a cloud provider's address is fixed and cannot be changed", async () => {
    const res = await t.call("PATCH", "/api/llm/providers/gemini", { baseUrl: "http://evil.example.com/v1" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("base_url_locked");
    expect((await provider("gemini")).baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
  });

  it("the local provider's address must stay on this PC", async () => {
    for (const bad of [
      "http://example.com:11434/v1",
      "http://192.168.1.50:11434/v1",
      "http://127.0.0.1.evil.com/v1",
      "ftp://127.0.0.1/v1",
      "http://user:pass@127.0.0.1:11434/v1",
      "http://127.0.0.1:11434/v1?key=1",
      "not a url",
    ]) {
      const res = await t.call("PATCH", "/api/llm/providers/ollama", { baseUrl: bad });
      expect(res.status, bad).toBe(400);
    }
    const ok = await t.call("PATCH", "/api/llm/providers/ollama", { baseUrl: "http://localhost:11500/v1/" });
    expect(ok.status).toBe(200);
    expect(ok.body.provider.baseUrl).toBe("http://localhost:11500/v1");
    expect((await t.call("PATCH", "/api/llm/providers/ollama", { baseUrl: "http://127.0.0.1:11434/v1" })).status).toBe(200);
  });

  it("the daily request cap is editable; cloud providers must keep one", async () => {
    expect((await t.call("PATCH", "/api/llm/providers/gemini", { dailyRequestCap: 20 })).body.provider.dailyRequestCap).toBe(20);
    expect((await t.call("PATCH", "/api/llm/providers/gemini", { dailyRequestCap: null })).status).toBe(400);
    expect((await t.call("PATCH", "/api/llm/providers/gemini", { dailyRequestCap: 0 })).status).toBe(400);
    expect((await t.call("PATCH", "/api/llm/providers/ollama", { dailyRequestCap: 5 })).body.provider.dailyRequestCap).toBe(5);
    expect((await t.call("PATCH", "/api/llm/providers/ollama", { dailyRequestCap: null })).body.provider.dailyRequestCap).toBeNull();
  });

  it("rejects unknown fields, unknown providers, and any attempt to touch the key or free-only mode", async () => {
    expect((await t.call("PATCH", "/api/llm/providers/gemini", { apiKey: "x" })).status).toBe(400);
    expect((await t.call("PATCH", "/api/llm/providers/gemini", { apiKeyEnv: "HOME" })).status).toBe(400);
    expect((await t.call("PATCH", "/api/llm/providers/gemini", { freeOnly: false })).status).toBe(400);
    expect((await t.call("PATCH", "/api/llm/providers/together", { enabled: true })).status).toBe(404);
    expect((await t.call("POST", "/api/llm/providers/together/test")).status).toBe(404);
  });

  it("has no switch anywhere for free-only mode", async () => {
    expect((await t.call("PATCH", "/api/llm/status", { freeOnly: false })).status).toBe(404);
    expect((await t.call("PUT", "/api/llm/status", { freeOnly: false })).status).toBe(404);
    expect((await t.call("PUT", "/api/llm/pause", { paused: false, freeOnly: false })).status).toBe(400);
    expect((await t.call("PUT", "/api/llm/limits", { freeOnly: false })).status).toBe(400);
    expect((await t.call("GET", "/api/llm/status")).body.freeOnly).toBe(true);
  });
});

describe("testing a connection (uses no tokens)", () => {
  it("says 'key missing' without contacting the provider", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const res = await t.call("POST", "/api/llm/providers/gemini/test");
    expect(res.body.provider).toMatchObject({ status: "key_missing" });
    expect(res.body.provider.statusMessage).toContain("GEMINI_API_KEY");
  });

  it("reports 'connected', and explains a bad key or an unreachable provider", async () => {
    vi.stubEnv("GEMINI_API_KEY", FAKE_GEMINI_KEY);
    t.provider.models = [modelInfo("a"), modelInfo("b")];
    expect((await t.call("POST", "/api/llm/providers/gemini/test")).body.provider).toMatchObject({ status: "connected" });

    t.provider.listError = new LlmError("auth_failed", "The provider rejected the API key.");
    expect((await t.call("POST", "/api/llm/providers/gemini/test")).body.provider).toMatchObject({ status: "auth_failed" });

    t.provider.listError = new LlmError("network", "Could not reach the provider.");
    const res = await t.call("POST", "/api/llm/providers/ollama/test");
    expect(res.body.provider).toMatchObject({ status: "unreachable" });
    expect((await provider("ollama")).lastCheckedAt).not.toBeNull();
  });
});

describe("models", () => {
  it("lists refreshed models with their free badge, and explains why they cannot be used yet", async () => {
    vi.stubEnv("GROQ_API_KEY", "test-key-000000");
    t.provider.models = [modelInfo("llama-3.1-8b-instant"), modelInfo("some-other")];
    const refreshed = await t.call("POST", "/api/llm/providers/groq/refresh-models");
    expect(refreshed.status).toBe(200);
    const models = (await t.call("GET", "/api/llm/models?providerId=groq")).body.models;
    expect(models).toHaveLength(2);
    expect(models[0]).toMatchObject({ providerName: "Groq", freeStatus: "free_tier", isLlama: true, callable: false, enabled: false });
    expect(models[0].blockedReason).toMatch(/switched off|no billing/);
  });

  it("switching a model on makes it callable once its provider is ready", async () => {
    await setupGeminiModel(t);
    const models = (await t.call("GET", "/api/llm/models")).body.models;
    expect(models[0]).toMatchObject({ ref: "gemini/gemini-test", callable: true, blockedReason: null });
  });

  it("refuses to enable a blocked model, and unknown models give 404", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-000000");
    t.provider.models = [modelInfo("a/b:free", { priceInput: 0, priceOutput: 0 })];
    const { body } = await t.call("POST", "/api/llm/providers/openrouter/refresh-models");
    const id = body.models[0].id;
    t.provider.models = [modelInfo("a/b:free", { priceInput: 0.01, priceOutput: 0.01 })];
    await t.call("POST", "/api/llm/providers/openrouter/refresh-models");
    const blocked = await t.call("PATCH", `/api/llm/models/${id}`, { enabled: true });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("model_blocked");
    expect((await t.call("PATCH", "/api/llm/models/99999", { enabled: true })).status).toBe(404);
    expect((await t.call("PATCH", "/api/llm/models/abc", { enabled: true })).status).toBe(404);
  });

  it("refresh surfaces provider problems clearly and keeps the old catalog", async () => {
    vi.stubEnv("GEMINI_API_KEY", FAKE_GEMINI_KEY);
    await setupGeminiModel(t);
    t.provider.listError = new LlmError("rate_limited", "Slow down.", { retryable: true });
    const res = await t.call("POST", "/api/llm/providers/gemini/refresh-models");
    expect(res.status).toBe(429);
    expect((await t.call("GET", "/api/llm/models")).body.models).toHaveLength(1);
    vi.stubEnv("GEMINI_API_KEY", "");
    expect((await t.call("POST", "/api/llm/providers/gemini/refresh-models")).status).toBe(409);
  });
});

describe("bots choose a provider and model", () => {
  it("accepts a catalog model, saves it in version history, and restores it", async () => {
    const ref = await setupGeminiModel(t);
    const created = await t.call("POST", "/api/bots", { name: "Chatty" });
    const id = created.body.bot.id;

    const picked = await t.call("PATCH", `/api/bots/${id}`, { model: ref, temperature: 1.1, maxOutputTokens: 300 });
    expect(picked.status).toBe(200);
    expect(picked.body.bot).toMatchObject({ model: ref, temperature: 1.1, maxOutputTokens: 300, currentVersion: 2 });

    await t.call("PATCH", `/api/bots/${id}`, { model: null, temperature: null, maxOutputTokens: null });
    const restored = await t.call("POST", `/api/bots/${id}/versions/2/restore`);
    expect(restored.body.bot).toMatchObject({ model: ref, temperature: 1.1, maxOutputTokens: 300, currentVersion: 4 });
  });

  it("each bot can use a different provider and model", async () => {
    const gemini = await setupGeminiModel(t);
    const ollama = await setupOllamaModel(t);
    const a = (await t.call("POST", "/api/bots", { name: "A", model: gemini })).body.bot;
    const b = (await t.call("POST", "/api/bots", { name: "B", model: ollama })).body.bot;
    expect([a.model, b.model]).toEqual(["gemini/gemini-test", "ollama/llama3.1:8b"]);
  });

  it("rejects models that are unknown or badly written", async () => {
    await setupGeminiModel(t);
    const id = (await t.call("POST", "/api/bots", { name: "X" })).body.bot.id;
    expect((await t.call("PATCH", `/api/bots/${id}`, { model: "gemini/not-listed" })).body.error).toBe("unknown_model");
    expect((await t.call("PATCH", `/api/bots/${id}`, { model: "together/llama-3.3-70b" })).body.error).toBe("unknown_model");
    expect((await t.call("PATCH", `/api/bots/${id}`, { model: "no-slash" })).status).toBe(400);
    expect((await t.call("POST", "/api/bots", { name: "Y", model: "gemini/nope" })).status).toBe(400);
  });

  it("rejects a model that is blocked because it is, or became, paid", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-000000");
    const free = modelInfo("meta-llama/llama-x:free", { priceInput: 0, priceOutput: 0 });
    t.provider.models = [free];
    await t.call("POST", "/api/llm/providers/openrouter/refresh-models");
    const id = (await t.call("POST", "/api/bots", { name: "X" })).body.bot.id;
    expect((await t.call("PATCH", `/api/bots/${id}`, { model: "openrouter/meta-llama/llama-x:free" })).status).toBe(200);

    // The provider starts charging for it: the next refresh blocks it, and no bot can pick it again.
    t.provider.models = [{ ...free, priceInput: 0.000002, priceOutput: 0.000002 }];
    await t.call("POST", "/api/llm/providers/openrouter/refresh-models");
    const other = (await t.call("POST", "/api/bots", { name: "Y" })).body.bot.id;
    const res = await t.call("PATCH", `/api/bots/${other}`, { model: "openrouter/meta-llama/llama-x:free" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("model_blocked");
  });

  it("validates temperature (0 to 2) and max tokens (1 to 4,096)", async () => {
    const id = (await t.call("POST", "/api/bots", { name: "X" })).body.bot.id;
    for (const bad of [{ temperature: -0.1 }, { temperature: 2.1 }, { maxOutputTokens: 0 }, { maxOutputTokens: 4097 }, { maxOutputTokens: 1.5 }, { temperature: "hot" }]) {
      expect((await t.call("PATCH", `/api/bots/${id}`, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    const ok = await t.call("PATCH", `/api/bots/${id}`, { temperature: 0, maxOutputTokens: 4096 });
    expect(ok.body.bot).toMatchObject({ temperature: 0, maxOutputTokens: 4096 });
  });

  it("a model that was valid and later disappears does not block unrelated edits or a restore", async () => {
    const ref = await setupGeminiModel(t);
    const id = (await t.call("POST", "/api/bots", { name: "Old", model: ref })).body.bot.id;
    t.provider.models = [];
    await t.call("POST", "/api/llm/providers/gemini/refresh-models"); // model is now "removed"
    const edit = await t.call("PATCH", `/api/bots/${id}`, { role: "Still editable" });
    expect(edit.status).toBe(200);
    expect(edit.body.bot.model).toBe(ref);
  });

  it("changing the model never changes permissions", async () => {
    const ref = await setupGeminiModel(t);
    const bot = (await t.call("POST", "/api/bots", { name: "P" })).body.bot;
    await t.call("PUT", `/api/bots/${bot.id}/permissions/gmail`, { readEnabled: true });
    const after = (await t.call("PATCH", `/api/bots/${bot.id}`, { model: ref })).body.bot;
    expect(after.permissions.find((p: any) => p.connector === "gmail").readEnabled).toBe(true);
    expect(after.permissions.filter((p: any) => p.readEnabled)).toHaveLength(1);
    expect(after.permissions.every((p: any) => p.writePolicy === "approval_required")).toBe(true);
  });
});

describe("limits, pause and usage endpoints", () => {
  it("shows the approved limits and the free-only lock", async () => {
    const res = await t.call("GET", "/api/llm/status");
    expect(res.body).toMatchObject({ paused: false, freeOnly: true, maxOutputTokensCeiling: 4096 });
    expect(res.body.limits.globalDailyRequests).toBe(100);
    expect(res.body.limits.botDailyTokens).toBe(50_000);
    expect(res.body.defaults.globalMonthlyTokens).toBe(2_000_000);
  });

  it("edits limits within bounds, rejects the rest, and resets", async () => {
    expect((await t.call("PUT", "/api/llm/limits", { botDailyRequests: 10 })).body.limits.botDailyRequests).toBe(10);
    expect((await t.call("PUT", "/api/llm/limits", { maxOutputTokensDefault: 5000 })).status).toBe(400);
    expect((await t.call("PUT", "/api/llm/limits", { botDailyRequests: -1 })).status).toBe(400);
    expect((await t.call("PUT", "/api/llm/limits", { nonsense: 1 })).status).toBe(400);
    expect((await t.call("PUT", "/api/llm/limits", { botDailyRequests: "many" })).status).toBe(400);
    expect((await t.call("POST", "/api/llm/limits/reset")).body.limits.botDailyRequests).toBe(30);
  });

  it("the pause switch works", async () => {
    expect((await t.call("PUT", "/api/llm/pause", { paused: true })).body.paused).toBe(true);
    expect((await t.call("GET", "/api/llm/status")).body.paused).toBe(true);
    expect((await t.call("PUT", "/api/llm/pause", { paused: false })).body.paused).toBe(false);
    expect((await t.call("PUT", "/api/llm/pause", { paused: "yes" })).status).toBe(400);
  });

  it("changes need the client header (protection against other websites)", async () => {
    const res = await t.app.inject({ method: "PUT", url: "/api/llm/pause", payload: { paused: true } });
    expect(res.statusCode).toBe(403);
    expect((await t.call("GET", "/api/llm/status")).body.paused).toBe(false);
  });

  it("reports usage", async () => {
    const res = await t.call("GET", "/api/llm/usage?days=7");
    expect(res.status).toBe(200);
    expect(res.body.usage).toMatchObject({ today: { requests: 0, tokens: 0 }, byDay: [], byBot: [], byModel: [], recentProblems: [] });
    expect((await t.call("GET", "/api/llm/usage?days=500")).status).toBe(400);
  });
});
