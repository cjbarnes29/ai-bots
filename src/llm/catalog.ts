import { loadRouting, parseAutoRef } from "../routing/config.js";
import { AppError } from "../errors.js";
import { LlmError } from "./errors.js";
import { effectiveBaseUrl, type ProviderFactory } from "./factory.js";
import { PLUGINS, getPlugin } from "./plugins/index.js";
import type { ModelRegistry } from "./registry.js";
import { checkCallable } from "./policy.js";
import type { LlmRepository, ModelRow, ProviderRow } from "./repository.js";
import { APP_AUTOMATION_KEY, PROFILES, type ProviderProfile } from "./profiles.js";
import { hasApiKey } from "./secrets.js";
import type { UsageRepository } from "./usage.js";
import { localDay } from "./limits.js";
import { capabilitiesOf, type CapabilityMap } from "../routing/capabilities.js";
import { parseModelRef, type FreeStatus, type ModelInfo, type ProviderPlugin } from "./types.js";

export interface ProviderView {
  id: string;
  displayName: string;
  kind: "cloud" | "local";
  /** The built-in demonstration provider: answers are simulated, not from a real AI. */
  simulated: boolean;
  connectable: boolean;
  enabled: boolean;
  freeConfirmed: boolean;
  requiresFreeConfirmation: boolean;
  freePolicyLabel: string;
  /** The NAME of the environment variable (never its value). */
  keyEnv: string | null;
  keyConfigured: boolean;
  baseUrl: string;
  baseUrlEditable: boolean;
  dailyRequestCap: number | null;
  status: string | null;
  statusMessage: string | null;
  lastCheckedAt: string | null;
  modelCount: number;
  enabledModelCount: number;
  requestsToday: number;
  /** What this provider costs, can do and does with data, verified on a stated date (profiles.ts, docs/SETTINGS-AUDIT.md). */
  profile: ProviderProfile | null;
  /** The owner allowed this provider for operating desktop applications. Off by default; no engine uses it yet. */
  appAutomation: boolean;
  /** The app's own daily cap (not the provider's real quota). exhausted = nothing more is sent today. */
  quota: { dailyCap: number | null; requestsToday: number; exhausted: boolean };
}

export interface ModelView {
  id: number;
  providerId: string;
  providerName: string;
  modelId: string;
  /** "providerId/modelId", the value stored on a bot. */
  ref: string;
  displayName: string;
  freeStatus: FreeStatus;
  freeSource: string;
  freeCheckedAt: string;
  contextWindow: number | null;
  enabled: boolean;
  availability: string;
  isLlama: boolean;
  /** Honest tri-state capability facts (yes / no / unknown), a rule of thumb from the name and context size. */
  capabilities: CapabilityMap;
  /** You confirmed this gateway model is free (it lists no price). */
  ownerVerified: boolean;
  /** You could confirm it: its only problem is that no price is listed. */
  ownerOverridable: boolean;
  callable: boolean;
  blockedReason: string | null;
  /** What kind of model this is (general chat, reasoning, speech, embedding...). */
  kind: import("./model-kinds.js").ModelKind;
  /** Verified / unverified / unavailable, from the model registry. */
  verification: import("./registry.js").Eligibility;
  verificationReasons: string[];
  /** Automatic routing may use it, and a bot may be given it. */
  routable: boolean;
  /** The provider confirmed it is retired. */
  retired: boolean;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Local provider addresses must stay on this PC. Returns a clean URL or throws. */
export function validateLoopbackUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(400, "invalid_base_url", "That is not a valid address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError(400, "invalid_base_url", "The address must start with http:// or https://");
  }
  if (!LOOPBACK_HOSTS.has(url.hostname) && !LOOPBACK_HOSTS.has(`[${url.hostname}]`)) {
    throw new AppError(400, "invalid_base_url", "The local provider's address must be on this PC (127.0.0.1 or localhost).");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new AppError(400, "invalid_base_url", "The address must not contain a login, query or fragment.");
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

export interface ProviderUpdate {
  enabled?: boolean | undefined;
  freeConfirmed?: boolean | undefined;
  dailyRequestCap?: number | null | undefined;
  baseUrl?: string | undefined;
  appAutomation?: boolean | undefined;
}

/** Providers and models: what exists, what is free, what may be used. */
export class ModelCatalogService {
  constructor(
    private readonly repo: LlmRepository,
    private readonly usage: UsageRepository,
    private readonly factory: ProviderFactory,
    private readonly now: () => number = Date.now,
    private readonly audit?: { record(kind: string, detail?: Record<string, unknown>, options?: { actor?: string }): void },
  ) {}

  private registry: ModelRegistry | null = null;
  /** Connects the model registry (verification, kinds, retirement). Without it every callable model is routable (older behaviour, used by a few tests). */
  setRegistry(registry: ModelRegistry): void {
    this.registry = registry;
  }
  getRegistry(): ModelRegistry | null {
    return this.registry;
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  /** Makes sure every known provider has a row. New providers start switched off and unconfirmed. */
  ensureProviders(): void {
    const now = this.iso();
    for (const plugin of PLUGINS) this.repo.ensureProvider(plugin.id, plugin.defaultDailyRequestCap, now);
  }

  private mustProvider(id: string): { provider: ProviderRow; plugin: ProviderPlugin } {
    const plugin = getPlugin(id);
    const provider = plugin ? this.repo.getProvider(id) : undefined;
    if (!plugin || !provider) throw new AppError(404, "provider_not_found", "Provider not found");
    return { provider, plugin };
  }

  private providerView(provider: ProviderRow, plugin: ProviderPlugin, models: ModelRow[]): ProviderView {
    const mine = models.filter((m) => m.providerId === provider.id);
    const requestsToday = this.usage.totals({ providerId: provider.id, day: localDay(this.now()) }).requests;
    return {
      id: provider.id,
      displayName: plugin.displayName,
      kind: plugin.kind,
      simulated: plugin.simulated === true,
      connectable: plugin.connectable,
      enabled: provider.enabled,
      freeConfirmed: provider.freeConfirmed,
      requiresFreeConfirmation: plugin.freePolicy === "account_billing_confirmation",
      freePolicyLabel: plugin.freePolicyLabel,
      keyEnv: plugin.apiKeyEnv,
      keyConfigured: plugin.kind === "local" && !plugin.apiKeyEnv ? true : hasApiKey(plugin),
      baseUrl: effectiveBaseUrl(provider, plugin),
      baseUrlEditable: plugin.baseUrlEditable,
      dailyRequestCap: provider.dailyRequestCap,
      status: provider.lastStatus,
      statusMessage: provider.lastMessage,
      lastCheckedAt: provider.lastCheckedAt,
      modelCount: mine.length,
      enabledModelCount: mine.filter((m) => m.enabled).length,
      requestsToday,
      profile: PROFILES[plugin.id] ?? null,
      appAutomation: this.appAutomationIds().includes(plugin.id),
      quota: { dailyCap: provider.dailyRequestCap, requestsToday, exhausted: provider.dailyRequestCap !== null && requestsToday >= provider.dailyRequestCap },
    };
  }

  /** Providers the owner allowed for application automation (stored in the existing settings table). */
  appAutomationIds(): string[] {
    try {
      const v = JSON.parse(this.repo.getSetting(APP_AUTOMATION_KEY) ?? "[]") as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  listProviders(): ProviderView[] {
    const models = this.repo.listModels();
    const views: ProviderView[] = [];
    for (const plugin of PLUGINS) {
      const provider = this.repo.getProvider(plugin.id);
      if (provider) views.push(this.providerView(provider, plugin, models));
    }
    return views;
  }

  getProviderView(id: string): ProviderView {
    const { provider, plugin } = this.mustProvider(id);
    return this.providerView(provider, plugin, this.repo.listModels(id));
  }

  updateProvider(id: string, patch: ProviderUpdate): ProviderView {
    const { provider, plugin } = this.mustProvider(id);
    const changes: Parameters<LlmRepository["updateProvider"]>[1] = {};

    if (patch.baseUrl !== undefined) {
      if (!plugin.baseUrlEditable) {
        throw new AppError(400, "base_url_locked", `${plugin.displayName}'s address is fixed and cannot be changed.`);
      }
      changes.baseUrl = validateLoopbackUrl(patch.baseUrl);
    }

    if (patch.dailyRequestCap !== undefined) {
      if (patch.dailyRequestCap === null && plugin.kind === "cloud") {
        throw new AppError(400, "cap_required", "Cloud providers must have a daily request cap.");
      }
      changes.dailyRequestCap = patch.dailyRequestCap;
    }

    if (patch.freeConfirmed !== undefined) {
      if (plugin.freePolicy !== "account_billing_confirmation") {
        throw new AppError(400, "confirmation_not_needed", `${plugin.displayName} does not need a billing confirmation.`);
      }
      changes.freeConfirmed = patch.freeConfirmed;
    }

    const nextConfirmed = changes.freeConfirmed ?? provider.freeConfirmed;
    let nextEnabled = patch.enabled ?? provider.enabled;
    if (patch.enabled === true) {
      if (!plugin.connectable) throw new AppError(409, "not_connectable", `${plugin.displayName} cannot be enabled.`);
      if (plugin.freePolicy === "account_billing_confirmation" && !nextConfirmed) {
        throw new AppError(
          409,
          "free_not_confirmed",
          `First confirm that your ${plugin.displayName} account has no billing (no payment method, no billing account).`,
        );
      }
    }
    // Withdrawing the "no billing" confirmation also switches the provider off.
    if (changes.freeConfirmed === false) nextEnabled = false;
    // Switching a provider off also takes it out of application automation.
    let allowed = this.appAutomationIds();
    if (patch.appAutomation === true) {
      if (!nextEnabled) throw new AppError(409, "provider_off", `Switch ${plugin.displayName} on first.`);
      if (!allowed.includes(id)) allowed = [...allowed, id];
    } else if (patch.appAutomation === false || !nextEnabled) {
      allowed = allowed.filter((x) => x !== id);
    }
    if (JSON.stringify(allowed) !== JSON.stringify(this.appAutomationIds())) this.repo.setSetting(APP_AUTOMATION_KEY, JSON.stringify(allowed), this.iso());
    if (nextEnabled !== provider.enabled) changes.enabled = nextEnabled;

    this.repo.updateProvider(id, changes, this.iso());
    return this.getProviderView(id);
  }

  /** Asks the provider for its model list. Uses no tokens. Only runs when you click the button. */
  async checkConnection(id: string, timeoutMs = 10_000): Promise<ProviderView> {
    const { provider, plugin } = this.mustProvider(id);
    const now = this.iso();
    if (!plugin.connectable) throw new AppError(409, "not_connectable", `${plugin.displayName} cannot be tested.`);
    if (plugin.kind === "cloud" && !hasApiKey(plugin)) {
      this.repo.setStatus(id, "key_missing", `No key saved yet. Open the Integrations Center, press Connect on ${plugin.displayName} and paste your key (it is saved as ${plugin.apiKeyEnv}).`, now);
      return this.getProviderView(id);
    }
    try {
      const models = await this.factory(provider, plugin).listModels(timeoutMs);
      this.repo.setStatus(id, "connected", `Connected. The provider lists ${models.filter((m) => m.chat !== false).length} models.`, now);
    } catch (err) {
      this.repo.setStatus(id, this.statusFor(err), err instanceof Error ? err.message : "Connection failed.", now);
    }
    return this.getProviderView(id);
  }

  /**
   * Keeps the shown provider status honest after REAL calls, not only after "Test connection". A provider-level failure (key refused,
   * unreachable, rate-limited, outage) replaces "connected"; the next successful call restores it. Model-level problems (one model
   * missing) and refusals made by this app (limits, pause) do not change the provider's status. Writes only when the status changes.
   */
  noteCallOutcome(id: string, err: LlmError | null): void {
    const provider = this.repo.getProvider(id);
    if (!provider) return;
    if (err === null) {
      if (provider.lastStatus !== "connected") this.repo.setStatus(id, "connected", "Connected. The last request succeeded.", this.iso());
      return;
    }
    const providerLevel: string[] = ["auth_failed", "quota_exceeded", "rate_limited", "network", "timeout", "provider_unavailable"];
    if (!providerLevel.includes(err.llmCode)) return;
    const status = err.llmCode === "provider_unavailable" ? "unavailable" : this.statusFor(err);
    const message = `The last request failed: ${err.message}`.slice(0, 300);
    if (provider.lastStatus !== status || provider.lastMessage !== message) this.repo.setStatus(id, status, message, this.iso());
  }

  private statusFor(err: unknown): string {
    if (!(err instanceof LlmError)) return "error";
    switch (err.llmCode) {
      case "network":
      case "timeout":
        return "unreachable";
      case "auth_failed":
        return "auth_failed";
      case "rate_limited":
      case "quota_exceeded":
        return "rate_limited";
      default:
        return "error";
    }
  }

  /**
   * Reads the provider's model list and updates the catalog. Each model is classified as
   * verified free, free tier (needs your confirmation) or blocked. Blocked models that are not
   * already known are not stored at all.
   */
  async refreshModels(id: string, timeoutMs = 15_000): Promise<{ provider: ProviderView; models: ModelView[] }> {
    const { provider, plugin } = this.mustProvider(id);
    if (!plugin.connectable) throw new AppError(409, "not_connectable", `${plugin.displayName} cannot be refreshed.`);
    if (plugin.kind === "cloud" && !hasApiKey(plugin)) {
      throw new LlmError(
        "key_missing",
        `No API key saved for ${plugin.displayName}. Open the Integrations Center, press Connect on ${plugin.displayName} and paste your key.`,
      );
    }

    let everything: ModelInfo[];
    try {
      everything = await this.factory(provider, plugin).listModels(timeoutMs);
    } catch (err) {
      this.repo.setStatus(id, this.statusFor(err), err instanceof Error ? err.message : "Connection failed.", this.iso());
      throw err;
    }

    // Every model the provider lists is recorded in the registry (with its kind); only chat-capable ones enter the catalog that bots can use.
    this.registry?.noteDiscovery(id, everything.map((m) => ({ id: m.id, ...(m.native ? { native: m.native } : {}) })));
    const listed = everything.filter((m) => m.chat !== false);
    const now = this.iso();
    this.repo.transaction(() => {
      const present: string[] = [];
      for (const info of listed) {
        let verdict = plugin.classifyModel(info);
        const known = this.repo.getModelByRef(id, info.id);
        if (plugin.ownerOverridable && this.repo.isOwnerFree(id, info.id)) {
          if (verdict.status === "blocked" && verdict.overridable) {
            // Still lists no price: the owner's confirmation stands.
            verdict = { status: "free_tier", source: "You confirmed this model is free (OmniRoute lists no price for it)", overridable: true };
          } else if (verdict.status === "blocked") {
            // It now has a price, or became a routing name: the confirmation is void.
            this.repo.clearOwnerFree(id, info.id);
            this.audit?.record("model.owner_free_withdrawn", { provider: id, model: info.id, reason: "no longer eligible" });
          }
        }
        if (verdict.status === "blocked" && !known && !plugin.storeBlocked) continue;
        this.repo.upsertModel(id, info, verdict.status, verdict.source, "available", now, verdict.overridable === true);
        // Newly discovered verified-free models become usable by themselves (routing setting). Models you confirmed by hand are never switched on for you,
        // and a model you switched off yourself is left alone because only brand-new models are touched.
        if (!known && provider.enabled && loadRouting(this.repo).autoEnableEligible) {
          const free = verdict.status === "verified_free" || (verdict.status === "free_tier" && !plugin.ownerOverridable);
          const row = this.repo.getModelByRef(id, info.id);
          if (free && row) this.repo.setModelEnabled(row.id, true, now);
        }
        present.push(info.id);
      }
      for (const suggestion of plugin.suggestedModels ?? []) {
        if (present.includes(suggestion.id)) continue;
        const verdict = plugin.classifyModel({
          id: suggestion.id,
          displayName: suggestion.displayName,
          contextWindow: null,
          priceInput: null,
          priceOutput: null,
        });
        this.repo.upsertModel(
          id,
          { id: suggestion.id, displayName: suggestion.displayName, contextWindow: null, priceInput: null, priceOutput: null },
          verdict.status,
          verdict.source,
          "not_installed",
          now,
        );
        present.push(suggestion.id);
      }
      this.repo.markMissing(id, present, plugin.kind === "local" ? "not_installed" : "removed", now);
      this.repo.setStatus(id, "connected", `Connected. ${listed.length} models listed.`, now);
    });
    return { provider: this.getProviderView(id), models: this.listModels(id) };
  }

  private modelView(model: ModelRow, provider: ProviderRow, plugin: ProviderPlugin): ModelView {
    const policyBlock = checkCallable(provider, plugin, model);
    const ref = `${model.providerId}/${model.modelId}`;
    const retired = this.registry?.retiredInfo(ref) ?? null;
    const block = policyBlock ?? (retired ? { code: "model_unavailable" as const, message: `Retired: ${retired.reason}` } : null);
    const reg = this.registry?.ensure(model.providerId, model.modelId) ?? null;
    const ctx = { callable: policyBlock === null, blockedReason: policyBlock?.message ?? null, availability: model.availability, contextWindow: model.contextWindow };
    const judged = reg && this.registry ? this.registry.judge(reg, ctx) : null;
    // The built-in demonstration provider is simulated (no network, no real AI): it cannot be verified with real requests, so the registry does not apply to it.
    // It is still never used by automatic routing unless the owner ticks it by name (router.ts), and its answers are marked as simulated.
    const routable = this.registry && plugin.simulated !== true ? this.registry.eligibility(model.providerId, model.modelId, ctx).ok : block === null;
    return {
      id: model.id,
      providerId: model.providerId,
      providerName: plugin.displayName,
      modelId: model.modelId,
      ref: `${model.providerId}/${model.modelId}`,
      displayName: model.displayName,
      freeStatus: model.freeStatus,
      freeSource: model.freeSource,
      freeCheckedAt: model.freeCheckedAt,
      contextWindow: model.contextWindow,
      enabled: model.enabled,
      availability: model.availability,
      isLlama: model.isLlama,
      capabilities: capabilitiesOf({ modelId: model.modelId, displayName: model.displayName, contextWindow: model.contextWindow }),
      ownerVerified: model.ownerVerified,
      ownerOverridable: model.ownerOverridable,
      callable: block === null,
      blockedReason: block?.message ?? null,
      kind: reg?.kind ?? "chat",
      verification: judged?.status ?? (block === null ? "verified" : "unavailable"),
      verificationReasons: judged?.reasons ?? [],
      routable: routable && block === null,
      retired: retired !== null,
    };
  }

  listModels(providerId?: string): ModelView[] {
    const views: ModelView[] = [];
    for (const model of this.repo.listModels(providerId)) {
      const plugin = getPlugin(model.providerId);
      const provider = this.repo.getProvider(model.providerId);
      if (plugin && provider) views.push(this.modelView(model, provider, plugin));
    }
    return views;
  }

  setModelEnabled(id: number, enabled: boolean): ModelView {
    const model = this.repo.getModel(id);
    const plugin = model ? getPlugin(model.providerId) : undefined;
    const provider = model ? this.repo.getProvider(model.providerId) : undefined;
    if (!model || !plugin || !provider) throw new AppError(404, "model_not_found", "Model not found");
    if (enabled && model.freeStatus === "blocked") {
      throw new AppError(409, "model_blocked", "This model is blocked (paid or unverified). Free-only mode is locked on.");
    }
    this.repo.setModelEnabled(id, enabled, this.iso());
    return this.modelView({ ...model, enabled }, provider, plugin);
  }

  /**
   * The owner confirms (or withdraws) that one gateway model is free. Only possible when the model's sole problem is that
   * no price is listed. A model with a price, a routing name, or a different provider can never be confirmed this way.
   * The model stays OFF until the owner switches it on, and is still checked on every reply and by the daily limits.
   */
  setOwnerVerified(modelDbId: number, verified: boolean): ModelView {
    const model = this.repo.getModel(modelDbId);
    const plugin = model ? getPlugin(model.providerId) : undefined;
    const provider = model ? this.repo.getProvider(model.providerId) : undefined;
    if (!model || !plugin || !provider) throw new AppError(404, "model_not_found", "Model not found");
    if (!plugin.ownerOverridable) throw new AppError(409, "not_overridable", "Only models from an AI gateway can be confirmed by hand.");
    const now = this.iso();
    if (verified) {
      if (!model.ownerOverridable || model.freeStatus !== "blocked") {
        throw new AppError(409, "not_overridable", "This model cannot be confirmed by hand: it lists a price, is a routing name, or its price status is not simply missing.");
      }
      this.repo.setOwnerFree(model.providerId, model.modelId, now);
      this.repo.setFreeStatus(model.id, "free_tier", "You confirmed this model is free (OmniRoute lists no price for it)", now, false);
      this.audit?.record("model.owner_free_confirmed", { provider: model.providerId, model: model.modelId }, { actor: "owner" });
    } else {
      this.repo.clearOwnerFree(model.providerId, model.modelId);
      this.repo.setFreeStatus(model.id, "blocked", "Blocked: your confirmation was withdrawn", now, false);
      this.audit?.record("model.owner_free_withdrawn", { provider: model.providerId, model: model.modelId }, { actor: "owner" });
    }
    const fresh = this.repo.getModel(model.id)!;
    return this.modelView(fresh, provider, plugin);
  }

  /** Used by the Agent Manager: a bot may only be given a known, non-blocked model. */
  validateModelRef(ref: string): void {
    if (parseAutoRef(ref)) return; // "auto/<kind of task>": a routing choice, resolved to an explicit free model at call time
    const parsed = parseModelRef(ref);
    const model = parsed ? this.repo.getModelByRef(parsed.providerId, parsed.modelId) : undefined;
    if (!model) {
      throw new AppError(
        400,
        "unknown_model",
        "That model is not in the catalog. Open Settings, connect the provider and refresh its models first.",
      );
    }
    if (model.freeStatus === "blocked") {
      throw new AppError(400, "model_blocked", "That model is blocked (paid or unverified). Only free models can be used.");
    }
    // A bot may only be given a model that is verified for bot use. (Unchanged assignments are not re-checked, so existing bots keep working.)
    if (this.registry?.enforce) {
      const view = this.listModels().find((m) => m.ref === ref);
      if (view && !view.routable) {
        const why = view.blockedReason ?? view.verificationReasons.join(" ");
        throw new AppError(400, view.verification === "unavailable" ? "model_unavailable" : "model_not_verified", `That model cannot be given to a bot yet: ${why || "it has not been verified."}`);
      }
    }
  }

  /** Looks up everything needed to call a model, or explains why not. */
  resolve(ref: string): { provider: ProviderRow; plugin: ProviderPlugin; model: ModelRow } {
    const parsed = parseModelRef(ref);
    const plugin = parsed ? getPlugin(parsed.providerId) : undefined;
    const provider = parsed && plugin ? this.repo.getProvider(parsed.providerId) : undefined;
    const model = parsed && provider ? this.repo.getModelByRef(parsed.providerId, parsed.modelId) : undefined;
    if (!parsed || !plugin || !provider || !model) {
      throw new LlmError(
        "model_unavailable",
        "This bot's model is no longer in the catalog. Choose another model on the Details tab.",
      );
    }
    return { provider, plugin, model };
  }

  /** A gateway answered as a different model than the one requested: switch that model off until the owner looks at it. */
  blockModelForIdentity(model: ModelRow): void {
    this.repo.clearOwnerFree(model.providerId, model.modelId);
    this.repo.blockModel(model.id, "Blocked automatically: the gateway answered as a different model than the one requested", this.iso());
  }

  /** A provider reported a cost on a "free" model: switch that model off for good. */
  blockModelForCost(model: ModelRow): void {
    this.repo.clearOwnerFree(model.providerId, model.modelId);
    this.repo.blockModel(
      model.id,
      "Blocked automatically: the provider reported a cost for this model",
      this.iso(),
    );
  }
}
