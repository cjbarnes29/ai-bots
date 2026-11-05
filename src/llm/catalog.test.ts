import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/database.js";
import { LlmError } from "./errors.js";
import { geminiPlugin } from "./plugins/gemini.js";
import { groqPlugin } from "./plugins/groq.js";
import { PLUGINS } from "./plugins/index.js";
import { omniRoutePlugin } from "./plugins/omniroute.js";
import { ollamaPlugin } from "./plugins/ollama.js";
import { openRouterPlugin } from "./plugins/openrouter.js";
import { ModelCatalogService } from "./catalog.js";
import { checkCallable, FREE_ONLY_MODE } from "./policy.js";
import { LlmRepository, type ModelRow, type ProviderRow } from "./repository.js";
import { ScriptedProvider, modelInfo } from "./test-helpers.js";
import { UsageRepository } from "./usage.js";

afterEach(() => vi.unstubAllEnvs());

describe("which providers exist", () => {
  it("has Gemini, Groq, OpenRouter, Ollama, the OmniRoute gateway and the simulated demo: no Together AI", () => {
    expect(PLUGINS.map((p) => p.id)).toEqual(["gemini", "groq", "openrouter", "ollama", "omniroute", "demo"]);
    expect(PLUGINS.some((p) => /together/i.test(p.id) || /together/i.test(p.displayName))).toBe(false);
    expect(PLUGINS).toContain(omniRoutePlugin);
    expect(omniRoutePlugin.connectable).toBe(true);
  });

  it("fixes every cloud provider's address (https) and key name", () => {
    expect(geminiPlugin.apiKeyEnv).toBe("GEMINI_API_KEY");
    expect(groqPlugin.apiKeyEnv).toBe("GROQ_API_KEY");
    expect(openRouterPlugin.apiKeyEnv).toBe("OPENROUTER_API_KEY");
    for (const p of [geminiPlugin, groqPlugin, openRouterPlugin]) {
      expect(p.kind).toBe("cloud");
      expect(p.defaultBaseUrl.startsWith("https://")).toBe(true);
      expect(p.baseUrlEditable).toBe(false);
    }
    expect(ollamaPlugin.kind).toBe("local");
    expect(ollamaPlugin.apiKeyEnv).toBeNull();
  });

  it("uses the approved per-provider daily request caps", () => {
    expect(geminiPlugin.defaultDailyRequestCap).toBe(50);
    expect(groqPlugin.defaultDailyRequestCap).toBe(50);
    expect(openRouterPlugin.defaultDailyRequestCap).toBe(40);
    expect(ollamaPlugin.defaultDailyRequestCap).toBeNull();
  });
});

describe("free-status classification", () => {
  it("OpenRouter: only ':free' ids with a price of exactly 0 are verified free", () => {
    const classify = (id: string, priceInput: number | null, priceOutput: number | null) =>
      openRouterPlugin.classifyModel(modelInfo(id, { priceInput, priceOutput })).status;
    expect(classify("meta-llama/llama-3.3-70b-instruct:free", 0, 0)).toBe("verified_free");
    expect(classify("meta-llama/llama-3.3-70b-instruct:free", 0.000001, 0)).toBe("blocked");
    expect(classify("meta-llama/llama-3.3-70b-instruct:free", 0, 0.000001)).toBe("blocked");
    expect(classify("meta-llama/llama-3.3-70b-instruct:free", null, null)).toBe("blocked");
    expect(classify("meta-llama/llama-3.3-70b-instruct", 0, 0)).toBe("blocked"); // no :free suffix
    expect(classify("openai/gpt-x", 0.00001, 0.00003)).toBe("blocked");
  });

  it("Gemini and Groq models are 'free tier' (you confirm the account has no billing); Ollama is verified free", () => {
    expect(geminiPlugin.classifyModel(modelInfo("gemini-x")).status).toBe("free_tier");
    expect(groqPlugin.classifyModel(modelInfo("llama-3.1-8b-instant")).status).toBe("free_tier");
    expect(ollamaPlugin.classifyModel(modelInfo("llama3.1:8b")).status).toBe("verified_free");
  });

  it("free-only mode is a constant that is always on", () => {
    expect(FREE_ONLY_MODE).toBe(true);
  });
});

describe("the policy gate (checkCallable)", () => {
  const provider = (over: Partial<ProviderRow> = {}): ProviderRow => ({
    id: "gemini",
    enabled: true,
    freeConfirmed: true,
    dailyRequestCap: 50,
    baseUrl: null,
    lastStatus: null,
    lastCheckedAt: null,
    lastMessage: null,
    ...over,
  });
  const model = (over: Partial<ModelRow> = {}): ModelRow => ({
    id: 1,
    providerId: "gemini",
    modelId: "gemini-x",
    displayName: "gemini-x",
    freeStatus: "free_tier",
    freeSource: "test",
    freeCheckedAt: "now",
    contextWindow: null,
    enabled: true,
    ownerVerified: false,
    ownerOverridable: false,
    availability: "available",
    isLlama: false,
    ...over,
  });

  it("allows a confirmed, enabled, keyed, free model", () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key-000000");
    expect(checkCallable(provider(), geminiPlugin, model())).toBeNull();
  });

  it("blocks everything else, with a clear reason", () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key-000000");
    expect(checkCallable(provider({ enabled: false }), geminiPlugin, model())?.message).toMatch(/switched off/);
    expect(checkCallable(provider({ freeConfirmed: false }), geminiPlugin, model())?.message).toMatch(/no billing/);
    expect(checkCallable(provider(), geminiPlugin, model({ freeStatus: "blocked" }))?.message).toMatch(/blocked/);
    expect(checkCallable(provider(), geminiPlugin, model({ enabled: false }))?.message).toMatch(/switched off/);
    expect(checkCallable(provider(), geminiPlugin, model({ availability: "removed" }))?.code).toBe("model_unavailable");
    expect(checkCallable(provider({ id: "ollama" }), ollamaPlugin, model({ availability: "not_installed" }))?.message).toMatch(/not installed/);
    vi.stubEnv("OMNIROUTE_API_KEY", "test-key-000000");
    expect(checkCallable(provider({ id: "omniroute" }), omniRoutePlugin, model({ providerId: "omniroute", modelId: "auto" , freeStatus: "verified_free" }))?.message).toMatch(/auto-routing/);
  });

  it("blocks a cloud provider with no key, and never needs a key for the local one", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(checkCallable(provider(), geminiPlugin, model())?.code).toBe("key_missing");
    expect(checkCallable(provider({ id: "ollama", freeConfirmed: false }), ollamaPlugin, model({ providerId: "ollama", freeStatus: "verified_free" }))).toBeNull();
  });

  it("OpenRouter needs no billing confirmation (its models are checked by price instead)", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-000000");
    const m = model({ providerId: "openrouter", freeStatus: "verified_free" });
    expect(checkCallable(provider({ id: "openrouter", freeConfirmed: false }), openRouterPlugin, m)).toBeNull();
  });
});

describe("the model catalog", () => {
  function setup() {
    const db = openDatabase(":memory:");
    const repo = new LlmRepository(db);
    const usage = new UsageRepository(db);
    const provider = new ScriptedProvider();
    const catalog = new ModelCatalogService(repo, usage, () => provider);
    catalog.ensureProviders();
    return { db, repo, provider, catalog };
  }

  it("starts with all six providers switched off and unconfirmed, with the approved caps", () => {
    const { catalog } = setup();
    const views = catalog.listProviders();
    expect(views.map((v) => v.id)).toEqual(["gemini", "groq", "openrouter", "ollama", "omniroute", "demo"]);
    for (const v of views) {
      expect(v.enabled).toBe(false);
      expect(v.freeConfirmed).toBe(false);
    }
    expect(views.map((v) => v.dailyRequestCap)).toEqual([50, 50, 40, null, 40, null]);
  });

  it("OpenRouter refresh stores only verified-free models and ignores paid ones", async () => {
    const { catalog, provider } = setup();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-000000");
    provider.models = [
      modelInfo("meta-llama/llama-3.3-70b-instruct:free", { priceInput: 0, priceOutput: 0 }),
      modelInfo("meta-llama/llama-3.3-70b-instruct", { priceInput: 0.0000006, priceOutput: 0.0000006 }),
      modelInfo("some/free-looking:free", { priceInput: 0.000001, priceOutput: 0 }),
    ];
    const { models } = await catalog.refreshModels("openrouter");
    expect(models.map((m) => m.modelId)).toEqual(["meta-llama/llama-3.3-70b-instruct:free"]);
    expect(models[0]).toMatchObject({ freeStatus: "verified_free", isLlama: true, availability: "available", enabled: false });
  });

  it("blocks and switches off a stored model if it later stops being free", async () => {
    const { catalog, provider, repo } = setup();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-000000");
    const id = "meta-llama/llama-3.3-70b-instruct:free";
    provider.models = [modelInfo(id, { priceInput: 0, priceOutput: 0 })];
    const first = await catalog.refreshModels("openrouter");
    catalog.setModelEnabled(first.models[0]!.id, true);
    expect(repo.getModelByRef("openrouter", id)?.enabled).toBe(true);

    provider.models = [modelInfo(id, { priceInput: 0.000002, priceOutput: 0.000002 })];
    const second = await catalog.refreshModels("openrouter");
    expect(second.models[0]).toMatchObject({ freeStatus: "blocked", enabled: false });
  });

  it("Gemini/Groq refresh keeps text models as 'free tier' and marks vanished ones 'removed'", async () => {
    const { catalog, provider } = setup();
    vi.stubEnv("GROQ_API_KEY", "test-key-000000");
    provider.models = [modelInfo("llama-3.1-8b-instant"), modelInfo("mixtral-x")];
    await catalog.refreshModels("groq");
    provider.models = [modelInfo("llama-3.1-8b-instant")];
    const { models } = await catalog.refreshModels("groq");
    const byId = Object.fromEntries(models.map((m) => [m.modelId, m]));
    expect(byId["llama-3.1-8b-instant"]).toMatchObject({ freeStatus: "free_tier", isLlama: true, availability: "available" });
    expect(byId["mixtral-x"]).toMatchObject({ availability: "removed", isLlama: false });
  });

  it("Ollama: suggested Llama models appear as 'not installed' until they are really installed", async () => {
    const { catalog, provider } = setup();
    provider.models = [];
    const first = await catalog.refreshModels("ollama");
    expect(first.models.map((m) => [m.modelId, m.availability, m.freeStatus])).toEqual([
      ["llama3.1:8b", "not_installed", "verified_free"],
      ["llama3.2:3b", "not_installed", "verified_free"],
    ]);
    provider.models = [modelInfo("llama3.1:8b")];
    const second = await catalog.refreshModels("ollama");
    expect(second.models.find((m) => m.modelId === "llama3.1:8b")?.availability).toBe("available");
    expect(second.models.find((m) => m.modelId === "llama3.2:3b")?.availability).toBe("not_installed");
  });

  it("refuses to refresh a cloud provider that has no key, without contacting it", async () => {
    const { catalog, provider } = setup();
    vi.stubEnv("GEMINI_API_KEY", "");
    provider.models = [modelInfo("gemini-x")];
    await expect(catalog.refreshModels("gemini")).rejects.toMatchObject({ llmCode: "key_missing" });
  });

  it("a blocked model can never be enabled, in code or in the database", async () => {
    const { catalog, provider, repo, db } = setup();
    vi.stubEnv("OPENROUTER_API_KEY", "test-key-000000");
    provider.models = [modelInfo("a/b:free", { priceInput: 0, priceOutput: 0 })];
    const { models } = await catalog.refreshModels("openrouter");
    const model = models[0]!;
    repo.blockModel(model.id, "test", new Date().toISOString());
    expect(() => catalog.setModelEnabled(model.id, true)).toThrow(/blocked/);
    expect(() => db.prepare("UPDATE llm_models SET enabled = 1 WHERE id = ?").run(model.id)).toThrow();
  });

  it("explains why a model cannot be used yet", async () => {
    const { catalog, provider } = setup();
    vi.stubEnv("GEMINI_API_KEY", "test-key-000000");
    provider.models = [modelInfo("gemini-x")];
    const { models } = await catalog.refreshModels("gemini");
    expect(models[0]).toMatchObject({ callable: false });
    expect(models[0]!.blockedReason).toMatch(/switched off/);
  });

  it("only accepts known, non-blocked models for a bot", async () => {
    const { catalog, provider, repo } = setup();
    vi.stubEnv("GROQ_API_KEY", "test-key-000000");
    provider.models = [modelInfo("llama-3.1-8b-instant")];
    await catalog.refreshModels("groq");
    expect(() => catalog.validateModelRef("groq/llama-3.1-8b-instant")).not.toThrow();
    expect(() => catalog.validateModelRef("groq/not-listed")).toThrow(/not in the catalog/);
    expect(() => catalog.validateModelRef("together/llama")).toThrow(/not in the catalog/);
    expect(() => catalog.validateModelRef("garbage")).toThrow();
    const model = repo.getModelByRef("groq", "llama-3.1-8b-instant")!;
    repo.blockModel(model.id, "test", new Date().toISOString());
    expect(() => catalog.validateModelRef("groq/llama-3.1-8b-instant")).toThrow(/blocked/);
  });

  it("explains an unknown model when a bot is resolved", () => {
    const { catalog } = setup();
    expect(() => catalog.resolve("groq/gone")).toThrow(LlmError);
  });
});
