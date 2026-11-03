import type { LlmErrorCode } from "./errors.js";
import type { ModelRow, ProviderRow } from "./repository.js";
import { hasApiKey } from "./secrets.js";
import type { ProviderPlugin } from "./types.js";

/**
 * Free-only mode. This is a constant, not a setting: there is no switch, API or dashboard control
 * that can turn it off. A model that is not explicitly free can never be called.
 */
export const FREE_ONLY_MODE = true as const;

export interface PolicyBlock {
  code: LlmErrorCode;
  message: string;
}

/**
 * The gate every call must pass. Returns null if the model may be called right now,
 * or the reason it may not. The dashboard uses the same function to explain greyed-out models.
 */
export function checkCallable(provider: ProviderRow, plugin: ProviderPlugin, model: ModelRow): PolicyBlock | null {
  if (!plugin.connectable) {
    return { code: "blocked_by_policy", message: `${plugin.displayName} is not connected.` };
  }
  if (!provider.enabled) {
    return { code: "blocked_by_policy", message: `${plugin.displayName} is switched off. Enable it in Settings.` };
  }
  if (plugin.kind === "cloud" && !hasApiKey(plugin)) {
    return {
      code: "key_missing",
      message: `No API key found for ${plugin.displayName}. Add ${plugin.apiKeyEnv} to your .env file and restart.`,
    };
  }
  if (plugin.freePolicy === "account_billing_confirmation" && !provider.freeConfirmed) {
    return {
      code: "blocked_by_policy",
      message: `Confirm in Settings that your ${plugin.displayName} account has no billing before using it.`,
    };
  }
  if (FREE_ONLY_MODE && model.freeStatus === "blocked") {
    return {
      code: "blocked_by_policy",
      message: "This model is blocked: it is paid, or could not be verified as free. Free-only mode is locked on.",
    };
  }
  if (!model.enabled) {
    return { code: "blocked_by_policy", message: "This model is switched off. Enable it in Settings." };
  }
  if (model.availability === "removed" || model.availability === "not_installed") {
    return {
      code: "model_unavailable",
      message:
        model.availability === "not_installed"
          ? "This model is not installed on this PC."
          : "The provider no longer lists this model. Refresh the model list in Settings.",
    };
  }
  return null;
}
