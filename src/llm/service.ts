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
import { classifyFailure, type ModelRegistry } from "./registry.js";
import { parseAutoRef } from "../routing/config.js";
import type { ModelRouter } from "../routing/router.js";
import type { LlmRepository, ProviderRow } from "./repository.js";
import { CircuitBreaker, Semaphore } from "./resilience.js";
import { estimateMessagesTokens, estimateTokens, type ChatMessage, type CompletionResult, type ProviderPlugin } from "./types.js";
import type { UsageRepository } from "./usage.js";

/**
 * The form a reply must have, checked by our own code. A task that needs structured output (a plan, options, a bot draft) passes one.
 * `check` returns null when the reply is usable, or a short plain-words problem. With an automatic model choice a reply that breaks the contract counts
 * as a failed attempt and the next eligible model is tried; with an explicit model the call fails with a clear "bad_output" error. A broken reply is
 * never handed on as if it were good.
 */
export interface OutputContract {
  name: string;
  check(text: string): string | null;
}

export interface CompleteInput {
  botId: string | null;
  conversationId: string | null;
  /** "providerId/modelId" */
  modelRef: string;
  messages: ChatMessage[];
  temperature: number;
  /** Null = use the platform default. Always capped at 4,096. */
  maxOutputTokens: number | null;
  /** Automatic routing only: capabilities the chosen model must have (see routing/capabilities.ts). Unknown counts as not met. */
  require?: import("../routing/capabilities.js").Capability[];
  /** The form the reply must have (see OutputContract). Absent = any text is fine. */
  contract?: OutputContract;
  /** Set only by the model evaluation process: lets ONE call reach a model the registry marks retired, to find out whether it is back. Every other check still applies. */
  verification?: boolean;
  /** Overrides how instructions are sent (see CompletionRequest). Used by the model evaluation; otherwise the registry's tested knowledge decides. */
  instructionRole?: "native" | "folded";
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

/** Seconds until the next midnight in Pacific time, when Google resets its daily free quotas (at least one minute). */
export function msUntilPacificMidnight(nowMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(new Date(nowMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Math.max(60_000, (86_400 - (get("hour") * 3600 + get("minute") * 60 + get("second"))) * 1000);
}

/** How long a model rests after hitting its free-tier limit, when the provider did not say: 1 min, then 5, 15 and finally 60 minutes if it keeps happening. */
const REST_LADDER_MS = [60_000, 300_000, 900_000, 3_600_000];

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

  private registry: ModelRegistry | null = null;
  /** Connects the model registry: confirmed retirements stop being called, and failures are counted by category. */
  setRegistry(registry: ModelRegistry): void {
    this.registry = registry;
  }

  /** Connects the automatic model router (Stage 1). */
  setRouter(router: ModelRouter): void {
    this.router = router;
  }

  /** Seconds-level health: how long a provider is paused after repeated failures (0 = healthy). */
  breakerWaitMs(providerId: string): number {
    return this.breakers.get(providerId)?.blockedForMs() ?? 0;
  }

  // ---- models resting after a rate limit ----
  // Free-tier quotas belong to ONE model, so a rate limit rests that model only (in memory: cleared by a restart or by a successful call).
  // It is never counted toward the provider-wide circuit breaker, so a model that is out of quota cannot take its healthy siblings down with it.
  private readonly resting = new Map<string, { until: number; strikes: number }>();

  /** Milliseconds this model must still rest (0 = it may be tried). */
  modelCooldownMs(ref: string): number {
    const c = this.resting.get(ref);
    return c ? Math.max(0, c.until - this.now()) : 0;
  }

  /** Models resting now, for the dashboard. */
  modelCooldowns(): { ref: string; secondsLeft: number }[] {
    return [...this.resting.keys()].map((ref) => ({ ref, secondsLeft: Math.ceil(this.modelCooldownMs(ref) / 1000) })).filter((c) => c.secondsLeft > 0);
  }

  private restModel(ref: string, err: LlmError): void {
    const strikes = (this.resting.get(ref)?.strikes ?? 0) + 1;
    let ms: number;
    if (err.quota) ms = msUntilPacificMidnight(this.now());
    else if (err.retryAfterMs !== undefined) ms = Math.min(3_600_000, Math.max(1000, err.retryAfterMs));
    else ms = REST_LADDER_MS[Math.min(strikes, REST_LADDER_MS.length) - 1]!;
    this.resting.set(ref, { until: this.now() + ms, strikes });
  }

  private botGate: ((botId: string) => LlmError | null) | null = null;

  /** Connects the bot on/off check: a call made for a bot that is not switched on is refused before anything is sent. */
  setBotGate(gate: (botId: string) => LlmError | null): void {
    this.botGate = gate;
  }

  /** The one entry point. "auto/..." choices are routed to an explicit model; everything else is a direct, fully checked call. */
  async complete(input: CompleteInput): Promise<CompleteOutput> {
    // Every way a bot runs (chat, tasks, teammates, workflows, schedules, the Manager's specialists, inbound messages) reaches a model
    // through here, so this is the one place where "switched off" really means off.
    if (input.botId && this.botGate) {
      const refused = this.botGate(input.botId);
      if (refused) throw refused;
    }
    if (parseAutoRef(input.modelRef)) {
      if (!this.router) throw new LlmError("model_unavailable", "Automatic model routing is not available.");
      return this.router.complete(input);
    }
    const out = await this.completeDirect(input);
    const broken = input.contract?.check(out.text) ?? null;
    if (broken) throw new LlmError("bad_output", `The model ${out.providerId}/${out.modelId} did not answer in the required form (${input.contract!.name}): ${broken}`);
    return out;
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
    // A model the provider has confirmed as retired is not asked again: the answer would be the same and would only use up allowance.
    const retiredNow = input.verification ? null : this.registry?.retiredInfo(`${provider.id}/${model.modelId}`) ?? null;
    if (retiredNow) refuse(new LlmError("model_unavailable", `${model.modelId} is retired: ${retiredNow.reason} No request was sent. Choose another model, or refresh the models and verify it again.`));

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
    const ref = `${provider.id}/${model.modelId}`;
    const rest = this.modelCooldownMs(ref);
    if (rest > 0) {
      // Asking again now would only waste a request against a limit we already know about.
      refuse(new LlmError("rate_limited", `${model.modelId} hit its free-tier limit and is resting for about ${Math.ceil(rest / 1000)} more seconds. No request was sent.`, { retryAfterMs: rest }));
    }

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
          ...((input.instructionRole ?? this.registry?.get(ref)?.instructionRole) ? { instructionRole: (input.instructionRole ?? this.registry?.get(ref)?.instructionRole)! } : {}),
        });
      } catch (err) {
        slots.release();
        const latency = this.now() - started;
        const error =
          err instanceof LlmError ? err : new LlmError("bad_response", "The provider call failed unexpectedly.");
        this.record(base, { status: "error", errorCode: error.llmCode, latencyMs: latency });
        if (this.registry) {
          const refKey = `${provider.id}/${model.modelId}`;
          this.registry.noteFailure(refKey, classifyFailure(error));
          if (error.retired) this.registry.markRetired(refKey, error.message);
        }
        // A rate limit is retried only when the provider itself said to wait a few seconds, and never when it is a used-up quota.
        const worthRetry = error.llmCode !== "rate_limited" || (!error.quota && error.retryAfterMs !== undefined && error.retryAfterMs <= 5000);
        const retry = error.retryable && worthRetry && attempt < maxAttempts;
        if (error.llmCode === "rate_limited") {
          // A model-level problem: rest THIS model; the provider's breaker and shown status are left alone.
          if (!retry) this.restModel(ref, error);
        } else if (error.llmCode === "bad_output" || error.retired || error.llmCode === "model_not_found") {
          // A problem with this ONE model's answer or existence, not with the provider: the provider's breaker and shown status are left alone.
        } else {
          breaker.recordFailure(limits.breakerFailures, limits.breakerOpenMs);
          // A real call failing at the provider level (key, reachability, outage) also changes the provider's shown status,
          // so the dashboard never keeps saying "Connected" after it stopped working.
          this.catalog.noteCallOutcome(provider.id, error);
        }
        if (retry) {
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
      if (result.reasoningRemoved) notes.push("reasoning_removed");
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
      this.resting.delete(ref);
      this.catalog.noteCallOutcome(provider.id, null);

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
