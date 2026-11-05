import type { ModelCatalogService, ModelView, ProviderView } from "../llm/catalog.js";
import { LlmError, type LlmErrorCode } from "../llm/errors.js";
import type { LlmRepository } from "../llm/repository.js";
import type { CompleteInput, CompleteOutput } from "../llm/service.js";
import { CLASS_LABELS, ROUTE_CLASSES, loadRouting, parseAutoRef, type RouteClass, type RoutingConfig } from "./config.js";
import { scoreFor, traitsOf } from "./rank.js";
import { CAPABILITY_LABEL, meets, type Capability } from "./capabilities.js";

/** What the router needs from the model service (kept narrow so the router cannot reach around the limits). */
export interface RouterHost {
  /** One normal, fully checked call to ONE explicit model. */
  completeDirect(input: CompleteInput): Promise<CompleteOutput>;
  /** Milliseconds a provider is paused after repeated failures (0 = healthy). */
  breakerWaitMs(providerId: string): number;
  /** Milliseconds a single model must rest after hitting its free-tier limit (0 = may be tried). */
  modelCooldownMs(ref: string): number;
}

/** One automatic-routing decision, kept so the owner can see which model answered and when it had to switch. */
export interface RoutedRecord {
  at: string;
  class: RouteClass;
  botId: string | null;
  /** In the order they were tried. "answered" marks the model that produced the reply. */
  attempts: RouteAttempt[];
  answeredBy: string | null;
  /** True when the first model tried did not answer and another one did (or none did). */
  switched: boolean;
}
export const ROUTING_HISTORY_MAX = 50;

export interface RankedModel {
  ref: string;
  providerId: string;
  displayName: string;
  score: number;
  local: boolean;
  /** From the built-in demonstration provider: the answer would be made up by this app. */
  simulated: boolean;
}

export interface RouteAttempt {
  ref: string;
  outcome: "answered" | LlmErrorCode;
}

/** Problems with the provider as a whole: skip all of its models for the rest of this call. */
const PROVIDER_LEVEL: LlmErrorCode[] = ["auth_failed", "quota_exceeded", "network", "timeout", "provider_unavailable", "circuit_open", "key_missing"];
/** Problems with one model only: skip just that model. */
/** A rate limit belongs to ONE model (free-tier quotas are per model), so the provider's other models are still tried. Two different models of one provider limited in the same request escalate to the whole provider (see complete()). */
const MODEL_LEVEL: LlmErrorCode[] = ["rate_limited", "model_not_found", "model_unavailable", "model_mismatch", "bad_response", "bad_output"];
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
  /** When each model last answered (a counter, in memory): the one that answered longest ago goes first among equals when spreadLoad is on. */
  private readonly lastAnswered = new Map<string, number>();
  private answers = 0;
  private readonly recent: RoutedRecord[] = [];
  /** Called for every routing decision that switched model or failed (the app writes it to the audit log, so it survives a restart). */
  onSwitch?: (r: RoutedRecord) => void;
  /** The clock used for the history (the app passes its own). */
  clock: () => number = Date.now;

  /** The newest routing decisions first (memory only, at most ROUTING_HISTORY_MAX). */
  history(): RoutedRecord[] {
    return [...this.recent].reverse();
  }
  private remember(cls: RouteClass, input: CompleteInput, attempts: RouteAttempt[]): void {
    const answeredBy = attempts.find((a) => a.outcome === "answered")?.ref ?? null;
    const r: RoutedRecord = { at: new Date(this.clock()).toISOString(), class: cls, botId: input.botId ?? null, attempts: [...attempts], answeredBy, switched: attempts.length > 1 || answeredBy === null };
    this.recent.push(r);
    if (this.recent.length > ROUTING_HISTORY_MAX) this.recent.shift();
    if (r.switched) {
      try {
        this.onSwitch?.(r);
      } catch {
        /* a history problem never breaks a reply */
      }
    }
  }

  constructor(
    private readonly catalog: ModelCatalogService,
    private readonly repo: LlmRepository,
    private readonly host: RouterHost,
  ) {}

  config(): RoutingConfig {
    return loadRouting(this.repo);
  }

  /** The eligible models for a kind of task, best first. */
  candidates(cls: RouteClass, cfg: RoutingConfig = this.config(), require: readonly Capability[] = [], opts: { ignoreRest?: boolean } = {}): RankedModel[] {
    const providers = new Map<string, ProviderView>(this.catalog.listProviders().map((p) => [p.id, p]));
    const eligible = this.catalog.listModels().filter((m: ModelView) => {
      if (!m.callable) return false; // the free-only policy, switch-on state, key and availability are all decided here
      if (!m.routable) return false; // not verified (or retired / not a chat model): the registry keeps it out of automatic routing until it passes the tests
      if (cfg.allowedProviders.length > 0 && !cfg.allowedProviders.includes(m.providerId)) return false;
      if (cfg.excludedModels.includes(m.ref)) return false;
      const p = providers.get(m.providerId);
      if (!p) return false;
      // The built-in demonstration provider makes up its answers. It is a candidate only when the owner ticked it by name; an empty list ("all") never includes it.
      if (p.simulated && !cfg.allowedProviders.includes(p.id)) return false;
      if (p.dailyRequestCap !== null && p.requestsToday >= p.dailyRequestCap) return false; // this provider's daily cap is used up
      if (traitsOf(m.modelId, m.displayName).specialized) return false; // built for another job (computer control, filtering, embeddings), not for answering text
      if (!opts.ignoreRest && this.host.breakerWaitMs(m.providerId) > 0) return false; // this provider is cooling down after failures
      if (!opts.ignoreRest && this.host.modelCooldownMs(m.ref) > 0) return false; // this model hit its free-tier limit and is resting
      if (require.length > 0 && !meets({ modelId: m.modelId, displayName: m.displayName, contextWindow: m.contextWindow }, require).ok) return false; // the task needs something this model is not confirmed to do
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
      simulated: providers.get(m.providerId)?.simulated === true,
    }));
    const first = cfg.preferred[cls];
    return ranked.sort((a, b) => {
      // The owner's first choice for this kind of task leads while it is eligible; the rest is the usual automatic order (the fallbacks).
      if (first && (a.ref === first) !== (b.ref === first)) return a.ref === first ? -1 : 1;
      if (a.simulated !== b.simulated) return a.simulated ? 1 : -1; // simulated answers are never preferred over real models
      if (a.local !== b.local) return cfg.preferLocal ? (a.local ? -1 : 1) : a.local ? 1 : -1; // local models are a backup unless you prefer them
      if (cfg.spreadLoad && a.score === b.score) {
        const turn = (this.lastAnswered.get(a.ref) ?? 0) - (this.lastAnswered.get(b.ref) ?? 0);
        if (turn !== 0) return turn;
      }
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
    const limitedByProvider = new Map<string, Set<string>>();
    let last: LlmError | null = null;

    for (let n = 0; n < cfg.maxAttempts; n++) {
      const pick = this.candidates(cls, cfg, input.require ?? []).find((c) => !skipProviders.has(c.providerId) && !skipModels.has(c.ref));
      if (!pick) break;
      try {
        const out = await this.host.completeDirect({ ...input, modelRef: pick.ref });
        // A reply that breaks the task's output contract is a failed attempt for THIS model: the next eligible model gets the same request.
        const broken = input.contract?.check(out.text) ?? null;
        if (broken) {
          attempts.push({ ref: pick.ref, outcome: "bad_output" });
          last = new LlmError("bad_output", `${pick.ref} did not answer in the required form (${input.contract!.name}): ${broken}`);
          skipModels.add(pick.ref);
          continue;
        }
        attempts.push({ ref: pick.ref, outcome: "answered" });
        this.lastAnswered.set(pick.ref, ++this.answers);
        this.remember(cls, input, attempts);
        return { ...out, route: { class: cls, attempts } };
      } catch (err) {
        if (!(err instanceof LlmError)) throw err;
        const kind = failoverKind(err);
        if (kind === "stop") {
          if (attempts.length > 0) this.remember(cls, input, attempts);
          throw err; // the same refusal would happen with any model
        }
        attempts.push({ ref: pick.ref, outcome: err.llmCode });
        last = err;
        if (kind === "provider") skipProviders.add(pick.providerId);
        else skipModels.add(pick.ref);
        if (err.llmCode === "rate_limited") {
          const set = limitedByProvider.get(pick.providerId) ?? new Set<string>();
          set.add(pick.ref);
          limitedByProvider.set(pick.providerId, set);
          if (set.size >= 2) skipProviders.add(pick.providerId); // two different models limited in one request: the provider as a whole is out of allowance
        }
      }
    }

    if (attempts.length === 0) {
      // Nothing was tried. If models exist that are only RESTING (rate limit or provider cool-down), say so and when they return, instead of suggesting a setup problem.
      const resting = this.candidates(cls, cfg, input.require ?? [], { ignoreRest: true }).map((c) => ({ ref: c.ref, ms: Math.max(this.host.modelCooldownMs(c.ref), this.host.breakerWaitMs(c.providerId)) })).filter((c) => c.ms > 0);
      if (resting.length > 0) {
        const soonest = resting.reduce((a, b) => (b.ms < a.ms ? b : a));
        throw new LlmError("rate_limited", `Every eligible free model is resting after hitting its free-tier limit. The soonest to return is ${soonest.ref}, in about ${Math.max(1, Math.ceil(soonest.ms / 1000))} seconds. Nothing is wrong with your setup: free tiers have limits.`, { retryable: false, retryAfterMs: soonest.ms });
      }
      const needs = (input.require ?? []).length > 0 ? ` This task needs: ${(input.require ?? []).map((c) => CAPABILITY_LABEL[c]).join(", ")}; no eligible model is confirmed to have it (the task is paused rather than sent to a model that might not cope).` : "";
      throw new LlmError(
        "model_unavailable",
        `No eligible free model is available for "${CLASS_LABELS[cls]}".${needs} Connect a provider, refresh its models and switch a free model on in Settings, or start Ollama for a local backup.`,
      );
    }
    if (attempts.length > 0) this.remember(cls, input, attempts);
    const tried = attempts.map((a) => `${a.ref} (${a.outcome})`).join(", ");
    // When a tried model only hit a (non-quota) rate limit and every other attempt failed at MODEL level (e.g. a reply the provider refused),
    // that rate-limited model is the next real chance: report the rate limit with the soonest time it may be asked again, so a caller can wait
    // exactly that long instead of giving up or guessing (the task engine uses it; P-44 runs 3 and 5 lost the provider's "try again in 5.4s" here).
    // The same holds for an eligible model that was NOT tried only because it is resting (P-44 run 6: qwen was resting, gpt-oss's reply was refused).
    const limited = attempts.filter((a) => a.outcome === "rate_limited").map((a) => this.host.modelCooldownMs(a.ref));
    const restingUntried = this.candidates(cls, cfg, input.require ?? [], { ignoreRest: true })
      .filter((c) => !attempts.some((a) => a.ref === c.ref))
      .map((c) => this.host.modelCooldownMs(c.ref))
      .filter((ms) => ms > 0);
    const othersModelLevel = attempts.every((a) => a.outcome === "rate_limited" || MODEL_LEVEL.includes(a.outcome as LlmErrorCode));
    const waitable = limited.length + restingUntried.length > 0 && othersModelLevel && !last?.quota;
    const soonest = waitable ? Math.min(...limited, ...restingUntried) : undefined;
    const restingNote = waitable && restingUntried.length > 0 ? ` ${restingUntried.length} more eligible model(s) are resting after a rate limit and can be asked again in about ${Math.max(1, Math.ceil(soonest! / 1000))} s.` : "";
    throw new LlmError(waitable ? "rate_limited" : (last?.llmCode ?? "provider_unavailable"), `No model could answer. Tried: ${tried}. ${last?.message ?? ""}${restingNote}`.trim(), {
      retryable: false,
      ...(soonest !== undefined && Number.isFinite(soonest) ? { retryAfterMs: Math.max(1000, soonest) } : {}),
      ...(last?.quota ? { quota: true } : {}),
    });
  }
}
