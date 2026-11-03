import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/database.js";
import { ModelCatalogService } from "./catalog.js";
import { LlmError } from "./errors.js";
import { DEFAULT_LIMITS, MAX_OUTPUT_TOKENS_CEILING } from "./limits.js";
import { LlmRepository } from "./repository.js";
import { LlmService, type CompleteInput } from "./service.js";
import { OK_RESULT, ScriptedProvider, modelInfo } from "./test-helpers.js";
import type { CompletionResult } from "./types.js";
import { UsageRepository } from "./usage.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const DAY = 86_400_000;

interface Ctx {
  db: ReturnType<typeof openDatabase>;
  repo: LlmRepository;
  usage: UsageRepository;
  provider: ScriptedProvider;
  catalog: ModelCatalogService;
  llm: LlmService;
  clock: { t: number };
  sleeps: number[];
  gemini: string;
  ollama: string;
}

/** Everything wired up with a scripted provider, a fake clock, and two ready-to-use models. */
async function setup(): Promise<Ctx> {
  vi.stubEnv("GEMINI_API_KEY", "test-gemini-key-000000");
  const db = openDatabase(":memory:");
  const repo = new LlmRepository(db);
  const usage = new UsageRepository(db);
  const provider = new ScriptedProvider();
  const clock = { t: new Date(2026, 5, 15, 12, 0, 0).getTime() };
  const sleeps: number[] = [];
  const now = () => clock.t;
  const catalog = new ModelCatalogService(repo, usage, () => provider, now);
  catalog.ensureProviders();
  const llm = new LlmService(repo, usage, catalog, () => provider, {
    now,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.t += ms;
    },
  });

  catalog.updateProvider("gemini", { freeConfirmed: true, enabled: true });
  provider.models = [modelInfo("gemini-test")];
  const g = await catalog.refreshModels("gemini");
  catalog.setModelEnabled(g.models[0]!.id, true);

  catalog.updateProvider("ollama", { enabled: true });
  provider.models = [modelInfo("llama3.1:8b")];
  const o = await catalog.refreshModels("ollama");
  catalog.setModelEnabled(o.models.find((m) => m.modelId === "llama3.1:8b")!.id, true);

  return { db, repo, usage, provider, catalog, llm, clock, sleeps, gemini: "gemini/gemini-test", ollama: "ollama/llama3.1:8b" };
}

function bot(ctx: Ctx, id: string): string {
  const now = new Date(ctx.clock.t).toISOString();
  ctx.db.prepare("INSERT INTO bots (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, id, now, now);
  return id;
}

function input(ctx: Ctx, over: Partial<CompleteInput> = {}): CompleteInput {
  return {
    botId: over.botId ?? bot2(ctx),
    conversationId: null,
    modelRef: ctx.gemini,
    messages: [{ role: "user", content: "Hi" }],
    temperature: 0.7,
    maxOutputTokens: 200,
    ...over,
  };
}

let botCounter = 0;
const botIds = new WeakMap<Ctx, string>();
/** One shared bot per context unless a test asks for a different one. */
function bot2(ctx: Ctx): string {
  let id = botIds.get(ctx);
  if (!id) {
    id = bot(ctx, `bot-${++botCounter}`);
    botIds.set(ctx, id);
  }
  return id;
}

const big = (tokens: number): CompletionResult => ({ ...OK_RESULT, inputTokens: tokens, outputTokens: 0 });

async function fails(p: Promise<unknown>): Promise<LlmError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(LlmError);
    return err as LlmError;
  }
  throw new Error("expected the call to fail");
}

let ctx: Ctx;
beforeEach(async () => {
  ctx = await setup();
});
afterEach(() => vi.unstubAllEnvs());

describe("the approved default limits", () => {
  it("match the table you approved, exactly", () => {
    const limits = ctx.llm.limits();
    expect(limits).toMatchObject({
      globalDailyRequests: 100, // 1
      globalMonthlyRequests: 2000, // 2
      globalDailyTokens: 200_000, // 3
      globalMonthlyTokens: 2_000_000, // 4
      botDailyRequests: 30, // 5
      botMonthlyRequests: 600, // 6
      botDailyTokens: 50_000, // 7
      maxOutputTokensDefault: 1024, // 8 (default)
      maxPromptTokens: 12_000, // 9
      maxConcurrentCloud: 2, // 10
      // section B and C
      providerRequestsPerMinute: 10,
      maxConcurrentLocal: 1,
      botMonthlyTokens: 500_000,
      botRequestsPerMinute: 6,
      maxMessageChars: 8000,
      historyMessages: 20,
      timeoutMs: 60_000,
      retries: 1,
      retryDelayMs: 2000,
      retryDelayMaxMs: 30_000,
      breakerFailures: 3,
      breakerOpenMs: 60_000,
    });
    expect(MAX_OUTPUT_TOKENS_CEILING).toBe(4096); // 8 (permanent ceiling)
    expect(ctx.llm.limits()).toEqual({ ...DEFAULT_LIMITS });
  });

  it("start with the pause switch off and free-only mode on", () => {
    expect(ctx.llm.status()).toMatchObject({ paused: false, freeOnly: true, maxOutputTokensCeiling: 4096 });
  });
});

describe("a normal call", () => {
  it("returns the reply and records the usage", async () => {
    const out = await ctx.llm.complete(input(ctx));
    expect(out).toMatchObject({ text: OK_RESULT.text, inputTokens: 10, outputTokens: 5, estimated: false, providerId: "gemini", modelId: "gemini-test" });
    const summary = ctx.usage.summary(ctx.clock.t, 7);
    expect(summary.today).toEqual({ requests: 1, tokens: 15 });
    expect(summary.byModel[0]).toMatchObject({ providerId: "gemini", modelId: "gemini-test", requests: 1, tokens: 15 });
  });

  it("estimates tokens when the provider does not report them, and says so", async () => {
    ctx.provider.script.push({ ...OK_RESULT, text: "a".repeat(400), inputTokens: null, outputTokens: null });
    const out = await ctx.llm.complete(input(ctx));
    expect(out.estimated).toBe(true);
    expect(out.outputTokens).toBe(100);
    const row = ctx.db.prepare("SELECT tokens_estimated, input_tokens FROM llm_usage").get() as any;
    expect(row.tokens_estimated).toBe(1);
    expect(row.input_tokens).toBeGreaterThan(0);
  });

  it("passes temperature to the model and sends NO tools, ever", async () => {
    await ctx.llm.complete(input(ctx, { temperature: 1.3 }));
    const sent = ctx.provider.calls[0]!;
    expect(sent.temperature).toBe(1.3);
    expect(Object.keys(sent).sort()).toEqual(["maxOutputTokens", "messages", "model", "temperature", "timeoutMs"]);
    expect(sent.model).toBe("gemini-test");
  });

  it("caps the reply length: default 1,024, permanent ceiling 4,096, minimum 1", async () => {
    await ctx.llm.complete(input(ctx, { maxOutputTokens: null }));
    await ctx.llm.complete(input(ctx, { maxOutputTokens: 999_999 }));
    await ctx.llm.complete(input(ctx, { maxOutputTokens: 0 }));
    expect(ctx.provider.calls.map((c) => c.maxOutputTokens)).toEqual([1024, 4096, 1]);
  });

  it("flags a tool request and does nothing with it", async () => {
    ctx.provider.script.push({ ...OK_RESULT, text: "", toolCallsIgnored: true });
    const out = await ctx.llm.complete(input(ctx));
    expect(out.toolCallsIgnored).toBe(true);
    expect((ctx.db.prepare("SELECT note FROM llm_usage").get() as any).note).toContain("tool_call_ignored");
  });
});

describe("the pause switch and free-only gate", () => {
  it("pausing blocks every call before it reaches the provider, and un-pausing restores it", async () => {
    ctx.llm.setPaused(true);
    expect((await fails(ctx.llm.complete(input(ctx)))).llmCode).toBe("paused");
    expect(ctx.provider.calls).toHaveLength(0);
    expect(ctx.usage.summary(ctx.clock.t, 7).byDay[0]).toMatchObject({ blocked: 1, ok: 0 });
    ctx.llm.setPaused(false);
    await expect(ctx.llm.complete(input(ctx))).resolves.toBeDefined();
  });

  it("blocks a provider that is switched off, unconfirmed, or missing its key", async () => {
    ctx.repo.updateProvider("gemini", { enabled: false }, "now");
    expect((await fails(ctx.llm.complete(input(ctx)))).llmCode).toBe("blocked_by_policy");
    ctx.repo.updateProvider("gemini", { enabled: true, freeConfirmed: false }, "now");
    expect((await fails(ctx.llm.complete(input(ctx)))).message).toMatch(/no billing/);
    ctx.repo.updateProvider("gemini", { freeConfirmed: true }, "now");
    vi.stubEnv("GEMINI_API_KEY", "");
    expect((await fails(ctx.llm.complete(input(ctx)))).llmCode).toBe("key_missing");
    expect(ctx.provider.calls).toHaveLength(0);
  });

  it("blocks a paid or blocked model and a model that is switched off", async () => {
    const model = ctx.repo.getModelByRef("gemini", "gemini-test")!;
    ctx.repo.setModelEnabled(model.id, false, "now");
    expect((await fails(ctx.llm.complete(input(ctx)))).message).toMatch(/switched off/);
    ctx.repo.blockModel(model.id, "test", "now");
    expect((await fails(ctx.llm.complete(input(ctx)))).message).toMatch(/blocked/);
    expect(ctx.provider.calls).toHaveLength(0);
  });

  it("blocks a model that is not installed locally", async () => {
    ctx.provider.models = [];
    await ctx.catalog.refreshModels("ollama");
    expect((await fails(ctx.llm.complete(input(ctx, { modelRef: ctx.ollama })))).llmCode).toBe("model_unavailable");
  });

  it("blocks a model that is not in the catalog at all", async () => {
    expect((await fails(ctx.llm.complete(input(ctx, { modelRef: "together/llama-3" })))).llmCode).toBe("model_unavailable");
    expect(ctx.provider.calls).toHaveLength(0);
  });

  it("switches a model off for good if the provider reports a cost on it", async () => {
    ctx.provider.script.push({ ...OK_RESULT, costReportedMicro: 500 });
    const out = await ctx.llm.complete(input(ctx));
    expect(out.warning).toMatch(/blocked automatically/);
    expect(ctx.repo.getModelByRef("gemini", "gemini-test")).toMatchObject({ freeStatus: "blocked", enabled: false });
    expect(ctx.usage.summary(ctx.clock.t, 7).reportedCostMicroThisMonth).toBe(500);
    // The next call is stopped by the gate. The provider is not contacted again.
    expect((await fails(ctx.llm.complete(input(ctx)))).llmCode).toBe("blocked_by_policy");
    expect(ctx.provider.calls).toHaveLength(1);
  });
});

describe("prompt size", () => {
  it("refuses a prompt over 12,000 estimated tokens without contacting the provider", async () => {
    const tooBig = [{ role: "user" as const, content: "x".repeat(12_000 * 4 + 40) }];
    const err = await fails(ctx.llm.complete(input(ctx, { messages: tooBig })));
    expect(err.llmCode).toBe("prompt_too_large");
    expect(ctx.provider.calls).toHaveLength(0);
  });

  it("allows a prompt just under the limit", async () => {
    const ok = [{ role: "user" as const, content: "x".repeat(40_000) }];
    await expect(ctx.llm.complete(input(ctx, { messages: ok }))).resolves.toBeDefined();
  });
});

describe("limits: each one stops the call and says which limit was hit", () => {
  const cases: { name: string; limits?: Record<string, number>; providerCap?: number; script?: CompletionResult; allowed: number; key: string }[] = [
    { name: "1. global daily requests", limits: { globalDailyRequests: 2 }, allowed: 2, key: "globalDailyRequests" },
    { name: "2. global monthly requests", limits: { globalMonthlyRequests: 2 }, allowed: 2, key: "globalMonthlyRequests" },
    { name: "3. global daily tokens", limits: { globalDailyTokens: 1000 }, script: big(400), allowed: 2, key: "globalDailyTokens" },
    { name: "4. global monthly tokens", limits: { globalMonthlyTokens: 1000 }, script: big(400), allowed: 2, key: "globalMonthlyTokens" },
    { name: "5. per-bot daily requests", limits: { botDailyRequests: 2 }, allowed: 2, key: "botDailyRequests" },
    { name: "6. per-bot monthly requests", limits: { botMonthlyRequests: 2 }, allowed: 2, key: "botMonthlyRequests" },
    { name: "7. per-bot daily tokens", limits: { botDailyTokens: 1000 }, script: big(400), allowed: 2, key: "botDailyTokens" },
    { name: "per-bot monthly tokens", limits: { botMonthlyTokens: 1000 }, script: big(400), allowed: 2, key: "botMonthlyTokens" },
    { name: "per-bot requests per minute", limits: { botRequestsPerMinute: 2 }, allowed: 2, key: "botRequestsPerMinute" },
    { name: "per-provider requests per minute", limits: { providerRequestsPerMinute: 2 }, allowed: 2, key: "providerRequestsPerMinute" },
    { name: "11. per-provider daily cap", providerCap: 2, allowed: 2, key: "providerDailyRequests" },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      if (c.limits) ctx.llm.updateLimits(c.limits);
      if (c.providerCap) ctx.catalog.updateProvider("gemini", { dailyRequestCap: c.providerCap });
      for (let i = 0; i < c.allowed; i++) {
        if (c.script) ctx.provider.script.push(c.script);
        await ctx.llm.complete(input(ctx));
      }
      const err = await fails(ctx.llm.complete(input(ctx)));
      expect(err.llmCode).toBe("limit_exceeded");
      expect(err.limitKey).toBe(c.key);
      expect(err.status).toBe(429);
      expect(ctx.provider.calls).toHaveLength(c.allowed); // the blocked call never reached the provider
    });
  }

  it("blocked attempts are logged but do not count against the limits", async () => {
    ctx.llm.updateLimits({ globalDailyRequests: 1 });
    await ctx.llm.complete(input(ctx));
    await fails(ctx.llm.complete(input(ctx)));
    await fails(ctx.llm.complete(input(ctx)));
    expect(ctx.usage.totals({ day: "2026-06-15" }).requests).toBe(1);
    expect(ctx.usage.summary(ctx.clock.t, 7).byDay[0]).toMatchObject({ ok: 1, blocked: 2 });
  });

  it("failed calls DO count (the provider may count them too)", async () => {
    ctx.llm.updateLimits({ globalDailyRequests: 2, retries: 0 });
    ctx.provider.script.push(new LlmError("auth_failed", "bad key"), new LlmError("auth_failed", "bad key"));
    await fails(ctx.llm.complete(input(ctx)));
    await fails(ctx.llm.complete(input(ctx)));
    expect((await fails(ctx.llm.complete(input(ctx)))).limitKey).toBe("globalDailyRequests");
  });

  it("checks the worst case: prompt plus the longest allowed reply must fit in what is left", async () => {
    ctx.llm.updateLimits({ botDailyTokens: 1000 });
    // 1,024 default reply tokens alone already exceeds 1,000, so nothing may be sent.
    const err = await fails(ctx.llm.complete(input(ctx, { maxOutputTokens: null })));
    expect(err.limitKey).toBe("botDailyTokens");
    expect(ctx.provider.calls).toHaveLength(0);
  });

  it("daily limits reset at local midnight; monthly limits reset on the 1st", async () => {
    ctx.llm.updateLimits({ globalDailyRequests: 1, globalMonthlyRequests: 3, botDailyRequests: 100 });
    await ctx.llm.complete(input(ctx));
    expect((await fails(ctx.llm.complete(input(ctx)))).limitKey).toBe("globalDailyRequests");

    ctx.clock.t += DAY; // tomorrow
    await ctx.llm.complete(input(ctx));
    ctx.clock.t += DAY;
    await ctx.llm.complete(input(ctx));
    ctx.clock.t += DAY;
    expect((await fails(ctx.llm.complete(input(ctx)))).limitKey).toBe("globalMonthlyRequests");

    ctx.clock.t = new Date(2026, 6, 2, 12, 0, 0).getTime(); // July
    await expect(ctx.llm.complete(input(ctx))).resolves.toBeDefined();
  });

  it("global limits count cloud calls only. Local calls do not use up the cloud budget", async () => {
    ctx.llm.updateLimits({ globalDailyRequests: 1 });
    await ctx.llm.complete(input(ctx)); // cloud: uses the single request
    for (let i = 0; i < 3; i++) await ctx.llm.complete(input(ctx, { modelRef: ctx.ollama }));
    expect((await fails(ctx.llm.complete(input(ctx)))).limitKey).toBe("globalDailyRequests");
  });

  it("per-bot limits apply to local models too", async () => {
    ctx.llm.updateLimits({ botDailyRequests: 2 });
    await ctx.llm.complete(input(ctx, { modelRef: ctx.ollama }));
    await ctx.llm.complete(input(ctx, { modelRef: ctx.ollama }));
    expect((await fails(ctx.llm.complete(input(ctx, { modelRef: ctx.ollama })))).limitKey).toBe("botDailyRequests");
  });

  it("the local provider has no daily cap", async () => {
    ctx.llm.updateLimits({ botDailyRequests: 1000, botMonthlyRequests: 1000, botRequestsPerMinute: 1000 });
    for (let i = 0; i < 80; i++) await ctx.llm.complete(input(ctx, { modelRef: ctx.ollama }));
    expect(ctx.provider.calls).toHaveLength(80);
  });

  it("10. at most 2 cloud requests at once, and 1 local request at once", async () => {
    const hold: (() => void)[] = [];
    const pending = (): (() => Promise<CompletionResult>) => () =>
      new Promise<CompletionResult>((resolve) => hold.push(() => resolve(OK_RESULT)));

    ctx.provider.script.push(pending(), pending());
    const a = ctx.llm.complete(input(ctx));
    const b = ctx.llm.complete(input(ctx));
    await vi.waitFor(() => expect(ctx.provider.calls).toHaveLength(2));
    const third = await fails(ctx.llm.complete(input(ctx)));
    expect(third.limitKey).toBe("maxConcurrentCloud");
    hold.forEach((release) => release());
    await Promise.all([a, b]);
    await expect(ctx.llm.complete(input(ctx))).resolves.toBeDefined(); // slots were released

    hold.length = 0;
    ctx.provider.script.push(pending());
    const local = ctx.llm.complete(input(ctx, { modelRef: ctx.ollama }));
    await vi.waitFor(() => expect(ctx.provider.calls).toHaveLength(4));
    expect((await fails(ctx.llm.complete(input(ctx, { modelRef: ctx.ollama })))).limitKey).toBe("maxConcurrentLocal");
    hold.forEach((release) => release());
    await local;
  });

  it("releases the slot even when a call fails", async () => {
    ctx.llm.updateLimits({ retries: 0, maxConcurrentCloud: 1 });
    ctx.provider.script.push(new LlmError("auth_failed", "bad key"));
    await fails(ctx.llm.complete(input(ctx)));
    await expect(ctx.llm.complete(input(ctx))).resolves.toBeDefined();
  });
});

describe("retries", () => {
  it("retries once after a rate limit, waiting 2 seconds, and then succeeds", async () => {
    ctx.provider.script.push(new LlmError("rate_limited", "slow down", { retryable: true }));
    const out = await ctx.llm.complete(input(ctx));
    expect(out.text).toBe(OK_RESULT.text);
    expect(ctx.sleeps).toEqual([2000]);
    expect(ctx.provider.calls).toHaveLength(2);
    // Both attempts are recorded: one error, one success.
    expect(ctx.usage.summary(ctx.clock.t, 7).byDay[0]).toMatchObject({ ok: 1, errors: 1 });
  });

  it("respects the provider's 'retry after' hint, but never waits more than 30 seconds", async () => {
    ctx.provider.script.push(new LlmError("rate_limited", "x", { retryable: true, retryAfterMs: 5000 }));
    await ctx.llm.complete(input(ctx));
    ctx.provider.script.push(new LlmError("rate_limited", "x", { retryable: true, retryAfterMs: 120_000 }));
    await ctx.llm.complete(input(ctx));
    expect(ctx.sleeps).toEqual([5000, 30_000]);
  });

  it("does not retry errors that will not fix themselves", async () => {
    ctx.llm.updateLimits({ breakerFailures: 20 }); // five failures in a row would otherwise open the breaker
    for (const code of ["auth_failed", "bad_request", "model_not_found", "quota_exceeded", "content_blocked"] as const) {
      ctx.provider.calls.length = 0;
      ctx.provider.script.push(new LlmError(code, "no"));
      expect((await fails(ctx.llm.complete(input(ctx)))).llmCode).toBe(code);
      expect(ctx.provider.calls).toHaveLength(1);
    }
    expect(ctx.sleeps).toEqual([]);
  });

  it("gives up after 1 retry", async () => {
    ctx.provider.script.push(new LlmError("timeout", "slow", { retryable: true }), new LlmError("timeout", "slow", { retryable: true }));
    expect((await fails(ctx.llm.complete(input(ctx)))).llmCode).toBe("timeout");
    expect(ctx.provider.calls).toHaveLength(2);
  });

  it("a retry counts as another request, so it cannot slip past a limit", async () => {
    ctx.llm.updateLimits({ globalDailyRequests: 1 });
    ctx.provider.script.push(new LlmError("network", "down", { retryable: true }), OK_RESULT);
    const err = await fails(ctx.llm.complete(input(ctx)));
    expect(err.limitKey).toBe("globalDailyRequests");
    expect(ctx.provider.calls).toHaveLength(1);
  });

  it("retries can be turned off", async () => {
    ctx.llm.updateLimits({ retries: 0 });
    ctx.provider.script.push(new LlmError("rate_limited", "x", { retryable: true }));
    await fails(ctx.llm.complete(input(ctx)));
    expect(ctx.provider.calls).toHaveLength(1);
  });
});

describe("circuit breaker", () => {
  it("after 3 failures in a row, stops calling that provider for 60 seconds", async () => {
    ctx.llm.updateLimits({ retries: 0 });
    for (let i = 0; i < 3; i++) {
      ctx.provider.script.push(new LlmError("provider_unavailable", "down", { retryable: true }));
      await fails(ctx.llm.complete(input(ctx)));
    }
    const blocked = await fails(ctx.llm.complete(input(ctx)));
    expect(blocked.llmCode).toBe("circuit_open");
    expect(ctx.provider.calls).toHaveLength(3);

    ctx.clock.t += 61_000;
    await expect(ctx.llm.complete(input(ctx))).resolves.toBeDefined();
    expect(ctx.provider.calls).toHaveLength(4);
  });

  it("is per provider: a broken cloud provider does not stop the local one", async () => {
    ctx.llm.updateLimits({ retries: 0 });
    for (let i = 0; i < 3; i++) {
      ctx.provider.script.push(new LlmError("provider_unavailable", "down", { retryable: true }));
      await fails(ctx.llm.complete(input(ctx)));
    }
    await expect(ctx.llm.complete(input(ctx, { modelRef: ctx.ollama }))).resolves.toBeDefined();
  });

  it("a success resets the failure count", async () => {
    ctx.llm.updateLimits({ retries: 0 });
    for (let i = 0; i < 2; i++) {
      ctx.provider.script.push(new LlmError("provider_unavailable", "down", { retryable: true }));
      await fails(ctx.llm.complete(input(ctx)));
    }
    await ctx.llm.complete(input(ctx));
    for (let i = 0; i < 2; i++) {
      ctx.provider.script.push(new LlmError("provider_unavailable", "down", { retryable: true }));
      await fails(ctx.llm.complete(input(ctx)));
    }
    await expect(ctx.llm.complete(input(ctx))).resolves.toBeDefined(); // still closed: only 2 in a row
  });
});

describe("editing limits", () => {
  it("saves changes, merges them, and can reset to the approved defaults", () => {
    ctx.llm.updateLimits({ botDailyRequests: 12 });
    ctx.llm.updateLimits({ globalDailyRequests: 60 });
    expect(ctx.llm.limits()).toMatchObject({ botDailyRequests: 12, globalDailyRequests: 60, globalMonthlyRequests: 2000 });
    ctx.llm.resetLimits();
    expect(ctx.llm.limits()).toEqual({ ...DEFAULT_LIMITS });
  });

  it("refuses values above the permanent ceiling, or unknown settings", () => {
    expect(() => ctx.llm.updateLimits({ maxOutputTokensDefault: 5000 })).toThrow();
    expect(() => ctx.llm.updateLimits({ botDailyRequests: 0 })).toThrow();
    expect(() => ctx.llm.updateLimits({ botDailyRequests: 1.5 })).toThrow();
    expect(() => ctx.llm.updateLimits({ freeOnly: false } as any)).toThrow();
    expect(() => ctx.llm.updateLimits({ costCap: 100 } as any)).toThrow();
    expect(ctx.llm.status().freeOnly).toBe(true);
  });

  it("a damaged saved setting falls back to the approved defaults", () => {
    ctx.repo.setSetting("limits", "{not json", "now");
    expect(ctx.llm.limits()).toEqual({ ...DEFAULT_LIMITS });
    ctx.repo.setSetting("limits", JSON.stringify({ botDailyRequests: -5 }), "now");
    expect(ctx.llm.limits()).toEqual({ ...DEFAULT_LIMITS });
  });

  it("a raised limit takes effect on the next call", async () => {
    ctx.llm.updateLimits({ botDailyRequests: 1 });
    await ctx.llm.complete(input(ctx));
    await fails(ctx.llm.complete(input(ctx)));
    ctx.llm.updateLimits({ botDailyRequests: 5 });
    await expect(ctx.llm.complete(input(ctx))).resolves.toBeDefined();
  });
});

describe("the usage log", () => {
  it("cannot be edited or deleted", async () => {
    await ctx.llm.complete(input(ctx));
    expect(() => ctx.db.prepare("UPDATE llm_usage SET input_tokens = 0").run()).toThrow(/append-only/);
    expect(() => ctx.db.prepare("DELETE FROM llm_usage").run()).toThrow(/append-only/);
  });

  it("summarises by day, bot and model, and lists recent problems", async () => {
    const other = bot(ctx, "other-bot");
    await ctx.llm.complete(input(ctx));
    await ctx.llm.complete(input(ctx, { botId: other, modelRef: ctx.ollama }));
    ctx.provider.script.push(new LlmError("auth_failed", "bad"));
    await fails(ctx.llm.complete(input(ctx)));
    const s = ctx.usage.summary(ctx.clock.t, 7);
    expect(s.byBot.map((b) => b.botName).sort()).toEqual(["bot-" + botCounter, "other-bot"].sort());
    expect(s.byModel.map((m) => `${m.providerId}/${m.modelId}`).sort()).toEqual(["gemini/gemini-test", "ollama/llama3.1:8b"]);
    expect(s.recentProblems[0]).toMatchObject({ status: "error", errorCode: "auth_failed", providerId: "gemini" });
    expect(s.todayCloud.requests).toBe(2);
    expect(s.today.requests).toBe(3);
  });
});

describe("direct providers are unaffected by the gateway model-identity rule", () => {
  it("Gemini and Ollama replies are accepted whatever model name the provider echoes (or omits)", async () => {
    const ctx = await setup();
    ctx.provider.script.push({ ...OK_RESULT, modelReturned: "models/gemini-test-001-preview" }, { ...OK_RESULT, modelReturned: null });
    expect((await ctx.llm.complete(input(ctx))).text).toBe(OK_RESULT.text);
    expect((await ctx.llm.complete(input(ctx))).text).toBe(OK_RESULT.text);
    expect(ctx.catalog.listModels("gemini")[0]).toMatchObject({ enabled: true, callable: true });
  });

  it("only the gateway plugin asks for identity checks, and only it stores blocked models", async () => {
    const { PLUGINS } = await import("./plugins/index.js");
    expect(PLUGINS.filter((p) => p.verifyReturnedModel).map((p) => p.id)).toEqual(["omniroute"]);
    expect(PLUGINS.filter((p) => p.storeBlocked).map((p) => p.id)).toEqual(["omniroute"]);
    expect(PLUGINS.filter((p) => p.freePolicy === "gateway_verified_zero_price").map((p) => p.id)).toEqual(["omniroute"]);
  });
});
