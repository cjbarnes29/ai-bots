import { AppError } from "../errors.js";
import { LlmError } from "./errors.js";
import { effectiveBaseUrl, type ProviderFactory } from "./factory.js";
import { PLUGINS, getPlugin } from "./plugins/index.js";
import { checkCallable } from "./policy.js";
import type { LlmRepository, ModelRow, ProviderRow } from "./repository.js";
import { hasApiKey } from "./secrets.js";
import type { UsageRepository } from "./usage.js";
import { localDay } from "./limits.js";
import { parseModelRef, type FreeStatus, type ModelInfo, type ProviderPlugin } from "./types.js";

export interface ProviderView {
  id: string;
  displayName: string;
  kind: "cloud" | "local";
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
  callable: boolean;
  blockedReason: string | null;
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
}

/** Providers and models: what exists, what is free, what may be used. */
export class ModelCatalogService {
  constructor(
    private readonly repo: LlmRepository,
    private readonly usage: UsageRepository,
    private readonly factory: ProviderFactory,
    private readonly now: () => number = Date.now,
  ) {}

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
    return {
      id: provider.id,
      displayName: plugin.displayName,
      kind: plugin.kind,
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
      requestsToday: this.usage.totals({ providerId: provider.id, day: localDay(this.now()) }).requests,
    };
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
      this.repo.setStatus(id, "key_missing", `No key found. Add ${plugin.apiKeyEnv} to your .env file and restart.`, now);
      return this.getProviderView(id);
    }
    try {
      const models = await this.factory(provider, plugin).listModels(timeoutMs);
      this.repo.setStatus(id, "connected", `Connected. The provider lists ${models.length} models.`, now);
    } catch (err) {
      this.repo.setStatus(id, this.statusFor(err), err instanceof Error ? err.message : "Connection failed.", now);
    }
    return this.getProviderView(id);
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
        `No API key found for ${plugin.displayName}. Add ${plugin.apiKeyEnv} to your .env file and restart.`,
      );
    }

    let listed: ModelInfo[];
    try {
      listed = await this.factory(provider, plugin).listModels(timeoutMs);
    } catch (err) {
      this.repo.setStatus(id, this.statusFor(err), err instanceof Error ? err.message : "Connection failed.", this.iso());
      throw err;
    }

    const now = this.iso();
    this.repo.transaction(() => {
      const present: string[] = [];
      for (const info of listed) {
        const verdict = plugin.classifyModel(info);
        const known = this.repo.getModelByRef(id, info.id);
        if (verdict.status === "blocked" && !known && !plugin.storeBlocked) continue;
        this.repo.upsertModel(id, info, verdict.status, verdict.source, "available", now);
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
    const block = checkCallable(provider, plugin, model);
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
      callable: block === null,
      blockedReason: block?.message ?? null,
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

  /** Used by the Agent Manager: a bot may only be given a known, non-blocked model. */
  validateModelRef(ref: string): void {
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
    this.repo.blockModel(model.id, "Blocked automatically: the gateway answered as a different model than the one requested", this.iso());
  }

  /** A provider reported a cost on a "free" model: switch that model off for good. */
  blockModelForCost(model: ModelRow): void {
    this.repo.blockModel(
      model.id,
      "Blocked automatically: the provider reported a cost for this model",
      this.iso(),
    );
  }
}
