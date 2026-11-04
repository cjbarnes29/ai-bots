import type { ModelCatalogService } from "./catalog.js";
import { LlmError } from "./errors.js";
import type { ProviderFactory } from "./factory.js";
import {
  DEFAULT_LIMITS,
  MAX_OUTPUT_TOKENS_CEILING,
  limitsUpdateSchema,
  localDay,
  localMonth,
  mergeLimits,
  type LimitsConfig,
  type LimitsUpdate,
} from "./limits.js";
import { FREE_ONLY_MODE, checkCallable } from "./policy.js";
import { parseAutoRef } from "../routing/config.js";
import type { ModelRouter } from "../routing/router.js";
import type { LlmRepository, ProviderRow } from "./repository.js";
import { CircuitBreaker, Semaphore } from "./resilience.js";
import { estimateMessagesTokens, estimateTokens, type ChatMessage, type CompletionResult, type ProviderPlugin } from "./types.js";
import type { UsageRepository } from "./usage.js";

export interface CompleteInput {
  botId: string | null;
  conversationId: string | null;
  /** "providerId/modelId" */
  modelRef: string;
  messages: ChatMessage[];
  temperature: number;
  /** Null = use the platform default. Always capped at 4,096. */
  maxOutputTokens: number | null;
}

export interface CompleteOutput {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** True when the provider did not report token counts and we estimated them. */
  estimated: boolean;
  providerId: string;
  modelId: string;
  latencyMs: number;
  toolCallsIgnored: boolean;
  warning: string | null;
  /** Set when an automatic (auto/...) model choice was used: which kind of task and which models were tried. */
  route?: { class: string; attempts: { ref: string; outcome: string }[] };
}

export interface LlmServiceOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const LIMITS_KEY = "limits";
const PAUSED_KEY = "paused";

/**
 * Every model call goes through here. In order it checks: pause switch, free-only policy,
 * prompt size, circuit breaker, limits, and concurrency. Then it calls the provider (with a
 * timeout and at most a few retries) and records the outcome, whether it worked or not.
 */
export class LlmService {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly slots = { cloud: new Semaphore(), local: new Semaphore() };

  constructor(
    private readonly repo: LlmRepository,
    private readonly usage: UsageRepository,
    private readonly catalog: ModelCatalogService,
    private readonly factory: ProviderFactory,
    options: LlmServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  // ---- settings ----

  limits(): LimitsConfig {
    const raw = this.repo.getSetting(LIMITS_KEY);
    if (!raw) return mergeLimits(null);
    try {
      return mergeLimits(limitsUpdateSchema.parse(JSON.parse(raw)));
    } catch {
      return mergeLimits(null); // a damaged setting falls back to the approved defaults
    }
  }

  updateLimits(update: LimitsUpdate): LimitsConfig {
    const parsed = limitsUpdateSchema.parse(update);
    const stored = this.repo.getSetting(LIMITS_KEY);
    let current: LimitsUpdate = {};
    try {
      current = stored ? limitsUpdateSchema.parse(JSON.parse(stored)) : {};
    } catch {
      current = {};
    }
    this.repo.setSetting(LIMITS_KEY, JSON.stringify({ ...current, ...parsed }), new Date(this.now()).toISOString());
    return this.limits();
  }

  resetLimits(): LimitsConfig {
    this.repo.deleteSetting(LIMITS_KEY);
    return this.limits();
  }

  isPaused(): boolean {
    return this.repo.getSetting(PAUSED_KEY) === "true";
  }

  setPaused(paused: boolean): void {
    this.repo.setSetting(PAUSED_KEY, paused ? "true" : "false", new Date(this.now()).toISOString());
  }

  status() {
    return {
      paused: this.isPaused(),
      /** Always true. There is no way to turn free-only mode off. */
      freeOnly: FREE_ONLY_MODE,
      limits: this.limits(),
      defaults: { ...DEFAULT_LIMITS } as LimitsConfig,
      maxOutputTokensCeiling: MAX_OUTPUT_TOKENS_CEILING,
    };
  }

  // ---- the call ----

  private breaker(providerId: string): CircuitBreaker {
    let b = this.breakers.get(providerId);
    if (!b) {
      b = new CircuitBreaker(this.now);
      this.breakers.set(providerId, b);
    }
    return b;
  }

  private router: ModelRouter | null = null;

  /** Connects the automatic model router (Stage 1). */
  setRouter(router: ModelRouter): void {
    this.router = router;
  }

  /** Seconds-level health: how long a provider is paused after repeated failures (0 = healthy). */
  breakerWaitMs(providerId: string): number {
    return this.breakers.get(providerId)?.blockedForMs() ?? 0;
  }

  /** The one entry point. "auto/..." choices are routed to an explicit model; everything else is a direct, fully checked call. */
  async complete(input: CompleteInput): Promise<CompleteOutput> {
    if (parseAutoRef(input.modelRef)) {
      if (!this.router) throw new LlmError("model_unavailable", "Automatic model routing is not available.");
      return this.router.complete(input);
    }
    return this.completeDirect(input);
  }

  /** One call to ONE explicit model: pause switch, free-only policy, size, breaker, limits, concurrency, record. */
  async completeDirect(input: CompleteInput): Promise<CompleteOutput> {
    const limits = this.limits();
    const { provider, plugin, model } = this.catalog.resolve(input.modelRef);
    const cloud = plugin.kind === "cloud";
    const base = {
      botId: input.botId,
      conversationId: input.conversationId,
      providerId: provider.id,
      modelId: model.modelId,
      cloud,
    };

    /** Records a call we refused to make, then throws. Blocked calls do not count against limits. */
    const refuse = (err: LlmError): never => {
      this.record(base, { status: "blocked", errorCode: err.llmCode, note: err.limitKey ?? null });
      throw err;
    };

    if (this.isPaused()) {
      refuse(new LlmError("paused", "All AI calls are paused. Turn the pause switch off in Settings to continue."));
    }

    const policy = checkCallable(provider, plugin, model);
    if (policy) refuse(new LlmError(policy.code, policy.message));

    const estimatedInput = estimateMessagesTokens(input.messages);
    if (estimatedInput > limits.maxPromptTokens) {
      refuse(
        new LlmError(
          "prompt_too_large",
          `This conversation is too long to send (about ${estimatedInput.toLocaleString()} tokens; the limit is ${limits.maxPromptTokens.toLocaleString()}). Shorten the bot's instructions or start a new conversation.`,
        ),
      );
    }

    const maxOutput = Math.min(
      MAX_OUTPUT_TOKENS_CEILING,
      Math.max(1, Math.floor(input.maxOutputTokens ?? limits.maxOutputTokensDefault)),
    );
    const worstCaseTokens = estimatedInput + maxOutput;
    const breaker = this.breaker(provider.id);
    const slots = cloud ? this.slots.cloud : this.slots.local;
    const maxSlots = cloud ? limits.maxConcurrentCloud : limits.maxConcurrentLocal;
    const maxAttempts = limits.retries + 1;
    const client = this.factory(provider, plugin);

    for (let attempt = 1; ; attempt++) {
      // Checked again on every attempt: a retry is another request and counts as one.
      const wait = breaker.blockedForMs();
      if (wait > 0) {
        refuse(
          new LlmError(
            "circuit_open",
            `${plugin.displayName} failed several times in a row, so calls are paused for ${Math.ceil(wait / 1000)} more seconds.`,
          ),
        );
      }
      const blocked = this.checkLimits(limits, provider, plugin, input.botId, worstCaseTokens);
      if (blocked) refuse(blocked);
      if (!slots.tryAcquire(maxSlots)) {
        refuse(
          new LlmError(
            "limit_exceeded",
            `Too many requests are running at once (limit ${maxSlots}). Wait a moment and try again.`,
            { limitKey: cloud ? "maxConcurrentCloud" : "maxConcurrentLocal" },
          ),
        );
      }

      const started = this.now();
      let result: CompletionResult;
      try {
        result = await client.complete({
          model: model.modelId,
          messages: input.messages,
          temperature: input.temperature,
          maxOutputTokens: maxOutput,
          timeoutMs: limits.timeoutMs,
        });
      } catch (err) {
        slots.release();
        const latency = this.now() - started;
        const error =
          err instanceof LlmError ? err : new LlmError("bad_response", "The provider call failed unexpectedly.");
        this.record(base, { status: "error", errorCode: error.llmCode, latencyMs: latency });
        breaker.recordFailure(limits.breakerFailures, limits.breakerOpenMs);
        if (error.retryable && attempt < maxAttempts) {
          const delay = Math.min(limits.retryDelayMaxMs, Math.max(limits.retryDelayMs, error.retryAfterMs ?? 0));
          await this.sleep(delay);
          continue;
        }
        throw error;
      }
      slots.release();

      // Gateways (OmniRoute) may answer with another model than the one asked for, for example a paid fallback.
      // The reply must name exactly the requested model. Missing or different = rejected, never silently accepted.
      if (plugin.verifyReturnedModel && result.modelReturned !== model.modelId) {
        const said = result.modelReturned === null || result.modelReturned === undefined ? null : cleanForMessage(result.modelReturned);
        this.record(base, {
          status: "error",
          errorCode: "model_mismatch",
          inputTokens: result.inputTokens ?? estimatedInput,
          outputTokens: result.outputTokens ?? estimateTokens(result.text),
          tokensEstimated: result.inputTokens === null || result.outputTokens === null,
          latencyMs: this.now() - started,
          note: said === null ? "model_missing" : "model_mismatch",
        });
        this.catalog.blockModelForIdentity(model);
        breaker.trip(limits.breakerOpenMs);
        throw new LlmError(
          "model_mismatch",
          said === null
            ? `${plugin.displayName} did not say which model answered, so the reply was discarded and ${model.modelId} was blocked.`
            : `${plugin.displayName} answered as "${said}" instead of "${model.modelId}". The reply was discarded and the model was blocked.`,
        );
      }

      const latencyMs = this.now() - started;
      const estimated = result.inputTokens === null || result.outputTokens === null;
      const inputTokens = result.inputTokens ?? estimatedInput;
      const outputTokens = result.outputTokens ?? estimateTokens(result.text);
      const cost = result.costReportedMicro ?? 0;
      const notes: string[] = [];
      if (result.toolCallsIgnored) notes.push("tool_call_ignored");
      if (cost > 0) notes.push("cost_reported");

      this.record(base, {
        status: "ok",
        inputTokens,
        outputTokens,
        tokensEstimated: estimated,
        latencyMs,
        costReportedMicro: cost,
        note: notes.length ? notes.join(",") : null,
      });
      breaker.recordSuccess();

      let warning: string | null = null;
      if (cost > 0) {
        // Free-only safety net: a provider reported a charge. Switch this model off for good.
        this.catalog.blockModelForCost(model);
        breaker.trip(limits.breakerOpenMs);
        warning = `The provider reported a cost for ${model.modelId}. It has been blocked automatically. Check your account.`;
      }

      return {
        text: result.text,
        inputTokens,
        outputTokens,
        estimated,
        providerId: provider.id,
        modelId: model.modelId,
        latencyMs,
        toolCallsIgnored: result.toolCallsIgnored,
        warning,
      };
    }
  }

  /** Returns the error for the first limit that would be exceeded, or null if the call may go ahead. */
  private checkLimits(
    limits: LimitsConfig,
    provider: ProviderRow,
    plugin: ProviderPlugin,
    botId: string | null,
    worstCaseTokens: number,
  ): LlmError | null {
    const nowMs = this.now();
    const day = localDay(nowMs);
    const month = localMonth(nowMs);
    const hit = (key: string, message: string): LlmError => new LlmError("limit_exceeded", message, { limitKey: key });
    const requestsMsg = (what: string, used: number, max: number, reset: string) =>
      `${what} request limit reached (${used}/${max}). ${reset}`;
    const tokensMsg = (what: string, used: number, max: number, reset: string) =>
      `This message could push ${what} tokens past the limit (${used.toLocaleString()} used of ${max.toLocaleString()}; this call may use up to ${worstCaseTokens.toLocaleString()}). ${reset}`;
    const midnight = "It resets at midnight.";
    const nextMonth = "It resets on the 1st of next month.";
    const minute = "Wait a minute and try again.";

    if (provider.dailyRequestCap !== null) {
      const used = this.usage.totals({ providerId: provider.id, day }).requests;
      if (used >= provider.dailyRequestCap) {
        return hit("providerDailyRequests", requestsMsg(`Daily ${plugin.displayName}`, used, provider.dailyRequestCap, midnight));
      }
    }

    if (plugin.kind === "cloud") {
      const gDay = this.usage.totals({ cloud: true, day });
      if (gDay.requests >= limits.globalDailyRequests) {
        return hit("globalDailyRequests", requestsMsg("Daily (all bots)", gDay.requests, limits.globalDailyRequests, midnight));
      }
      if (gDay.tokens + worstCaseTokens > limits.globalDailyTokens) {
        return hit("globalDailyTokens", tokensMsg("today's total", gDay.tokens, limits.globalDailyTokens, midnight));
      }
      const gMonth = this.usage.totals({ cloud: true, month });
      if (gMonth.requests >= limits.globalMonthlyRequests) {
        return hit("globalMonthlyRequests", requestsMsg("Monthly (all bots)", gMonth.requests, limits.globalMonthlyRequests, nextMonth));
      }
      if (gMonth.tokens + worstCaseTokens > limits.globalMonthlyTokens) {
        return hit("globalMonthlyTokens", tokensMsg("this month's total", gMonth.tokens, limits.globalMonthlyTokens, nextMonth));
      }
      const rpm = this.usage.totals({ providerId: provider.id, sinceMs: nowMs - 60_000 }).requests;
      if (rpm >= limits.providerRequestsPerMinute) {
        return hit("providerRequestsPerMinute", requestsMsg(`Per-minute ${plugin.displayName}`, rpm, limits.providerRequestsPerMinute, minute));
      }
    }

    if (botId !== null) {
      const bDay = this.usage.totals({ botId, day });
      if (bDay.requests >= limits.botDailyRequests) {
        return hit("botDailyRequests", requestsMsg("Daily (this bot)", bDay.requests, limits.botDailyRequests, midnight));
      }
      if (bDay.tokens + worstCaseTokens > limits.botDailyTokens) {
        return hit("botDailyTokens", tokensMsg("this bot's daily", bDay.tokens, limits.botDailyTokens, midnight));
      }
      const bMonth = this.usage.totals({ botId, month });
      if (bMonth.requests >= limits.botMonthlyRequests) {
        return hit("botMonthlyRequests", requestsMsg("Monthly (this bot)", bMonth.requests, limits.botMonthlyRequests, nextMonth));
      }
      if (bMonth.tokens + worstCaseTokens > limits.botMonthlyTokens) {
        return hit("botMonthlyTokens", tokensMsg("this bot's monthly", bMonth.tokens, limits.botMonthlyTokens, nextMonth));
      }
      const bRpm = this.usage.totals({ botId, sinceMs: nowMs - 60_000 }).requests;
      if (bRpm >= limits.botRequestsPerMinute) {
        return hit("botRequestsPerMinute", requestsMsg("Per-minute (this bot)", bRpm, limits.botRequestsPerMinute, minute));
      }
    }
    return null;
  }

  private record(
    base: { botId: string | null; conversationId: string | null; providerId: string; modelId: string; cloud: boolean },
    extra: {
      status: "ok" | "error" | "blocked";
      errorCode?: string | null;
      inputTokens?: number;
      outputTokens?: number;
      tokensEstimated?: boolean;
      latencyMs?: number | null;
      costReportedMicro?: number;
      note?: string | null;
    },
  ): void {
    this.usage.insert({
      nowMs: this.now(),
      botId: base.botId,
      conversationId: base.conversationId,
      providerId: base.providerId,
      modelId: base.modelId,
      cloud: base.cloud,
      status: extra.status,
      errorCode: extra.errorCode ?? null,
      inputTokens: extra.inputTokens ?? 0,
      outputTokens: extra.outputTokens ?? 0,
      tokensEstimated: extra.tokensEstimated ?? false,
      latencyMs: extra.latencyMs ?? null,
      costReportedMicro: extra.costReportedMicro ?? 0,
      note: extra.note ?? null,
    });
  }
}

/** A model name from outside, made safe to show: one line, no control characters, short. */
function cleanForMessage(text: string): string {
  // eslint-disable-next-line no-control-regex
  const one = text.replace(/[ -]/g, " ").trim();
  return one.length > 80 ? `${one.slice(0, 80)}...` : one;
}
