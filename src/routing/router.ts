import type { ModelCatalogService, ModelView, ProviderView } from "../llm/catalog.js";
import { LlmError, type LlmErrorCode } from "../llm/errors.js";
import type { LlmRepository } from "../llm/repository.js";
import type { CompleteInput, CompleteOutput } from "../llm/service.js";
import { CLASS_LABELS, ROUTE_CLASSES, loadRouting, parseAutoRef, type RouteClass, type RoutingConfig } from "./config.js";
import { scoreFor, traitsOf } from "./rank.js";

/** What the router needs from the model service (kept narrow so the router cannot reach around the limits). */
export interface RouterHost {
  /** One normal, fully checked call to ONE explicit model. */
  completeDirect(input: CompleteInput): Promise<CompleteOutput>;
  /** Milliseconds a provider is paused after repeated failures (0 = healthy). */
  breakerWaitMs(providerId: string): number;
}

export interface RankedModel {
  ref: string;
  providerId: string;
  displayName: string;
  score: number;
  local: boolean;
}

export interface RouteAttempt {
  ref: string;
  outcome: "answered" | LlmErrorCode;
}

/** Problems with the provider as a whole: skip all of its models for the rest of this call. */
const PROVIDER_LEVEL: LlmErrorCode[] = ["auth_failed", "quota_exceeded", "rate_limited", "network", "timeout", "provider_unavailable", "circuit_open", "key_missing"];
/** Problems with one model only: skip just that model. */
const MODEL_LEVEL: LlmErrorCode[] = ["model_not_found", "model_unavailable", "model_mismatch", "bad_response"];
/** Limits that belong to ONE provider. Every other limit (bot, global, per-minute for the bot) applies to all providers, so switching would not help. */
const PROVIDER_LIMITS = new Set(["providerDailyRequests", "providerRequestsPerMinute"]);

export type FailoverKind = "provider" | "model" | "stop";
export function failoverKind(err: LlmError): FailoverKind {
  if (err.llmCode === "limit_exceeded") return err.limitKey !== undefined && PROVIDER_LIMITS.has(err.limitKey) ? "provider" : "stop";
  if (PROVIDER_LEVEL.includes(err.llmCode)) return "provider";
  if (MODEL_LEVEL.includes(err.llmCode)) return "model";
  return "stop"; // paused, too large, blocked by policy, bad request, content filter...: another model would not change the answer
}

export class ModelRouter {
  constructor(
    private readonly catalog: ModelCatalogService,
    private readonly repo: LlmRepository,
    private readonly host: RouterHost,
  ) {}

  config(): RoutingConfig {
    return loadRouting(this.repo);
  }

  /** The eligible models for a kind of task, best first. */
  candidates(cls: RouteClass, cfg: RoutingConfig = this.config()): RankedModel[] {
    const providers = new Map<string, ProviderView>(this.catalog.listProviders().map((p) => [p.id, p]));
    const eligible = this.catalog.listModels().filter((m: ModelView) => {
      if (!m.callable) return false; // the free-only policy, switch-on state, key and availability are all decided here
      if (cfg.allowedProviders.length > 0 && !cfg.allowedProviders.includes(m.providerId)) return false;
      if (cfg.excludedModels.includes(m.ref)) return false;
      const p = providers.get(m.providerId);
      if (!p) return false;
      if (p.dailyRequestCap !== null && p.requestsToday >= p.dailyRequestCap) return false; // this provider's daily cap is used up
      if (this.host.breakerWaitMs(m.providerId) > 0) return false; // this provider is cooling down after failures
      return true;
    });
    const orderIndex = (id: string) => {
      const i = cfg.providerOrder.indexOf(id);
      return i === -1 ? cfg.providerOrder.length : i;
    };
    const ranked = eligible.map((m): RankedModel => ({
      ref: m.ref,
      providerId: m.providerId,
      displayName: m.displayName,
      score: scoreFor(cls, traitsOf(m.modelId, m.displayName)),
      local: providers.get(m.providerId)?.kind === "local",
    }));
    return ranked.sort((a, b) => {
      if (a.local !== b.local) return cfg.preferLocal ? (a.local ? -1 : 1) : a.local ? 1 : -1; // local models are a backup unless you prefer them
      return b.score - a.score || orderIndex(a.providerId) - orderIndex(b.providerId) || a.ref.localeCompare(b.ref);
    });
  }

  /** What the Settings page shows: the top choices for every kind of task. */
  preview(): Record<RouteClass, RankedModel[]> {
    const cfg = this.config();
    return Object.fromEntries(ROUTE_CLASSES.map((c) => [c, this.candidates(c, cfg).slice(0, 5)])) as Record<RouteClass, RankedModel[]>;
  }

  async complete(input: CompleteInput): Promise<CompleteOutput & { route: { class: RouteClass; attempts: RouteAttempt[] } }> {
    const cls = parseAutoRef(input.modelRef);
    if (!cls) throw new LlmError("model_unavailable", "That is not an automatic model choice.");
    const cfg = this.config();
    if (!cfg.enabled) {
      throw new LlmError("blocked_by_policy", "Automatic model routing is switched off in Settings. Switch it on, or give this bot a specific model.");
    }
    const attempts: RouteAttempt[] = [];
    const skipProviders = new Set<string>();
    const skipModels = new Set<string>();
    let last: LlmError | null = null;

    for (let n = 0; n < cfg.maxAttempts; n++) {
      const pick = this.candidates(cls, cfg).find((c) => !skipProviders.has(c.providerId) && !skipModels.has(c.ref));
      if (!pick) break;
      try {
        const out = await this.host.completeDirect({ ...input, modelRef: pick.ref });
        attempts.push({ ref: pick.ref, outcome: "answered" });
        return { ...out, route: { class: cls, attempts } };
      } catch (err) {
        if (!(err instanceof LlmError)) throw err;
        const kind = failoverKind(err);
        if (kind === "stop") throw err; // the same refusal would happen with any model
        attempts.push({ ref: pick.ref, outcome: err.llmCode });
        last = err;
        if (kind === "provider") skipProviders.add(pick.providerId);
        else skipModels.add(pick.ref);
      }
    }

    if (attempts.length === 0) {
      throw new LlmError(
        "model_unavailable",
        `No eligible free model is available for "${CLASS_LABELS[cls]}". Connect a provider, refresh its models and switch a free model on in Settings, or start Ollama for a local backup.`,
      );
    }
    const tried = attempts.map((a) => `${a.ref} (${a.outcome})`).join(", ");
    throw new LlmError(last?.llmCode ?? "provider_unavailable", `No model could answer. Tried: ${tried}. ${last?.message ?? ""}`.trim(), {
      retryable: false,
    });
  }
}
