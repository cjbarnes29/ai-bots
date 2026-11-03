import type { ProviderPlugin } from "../types.js";

/**
 * OpenRouter. Only models whose id ends in ":free" AND whose live price is exactly 0 are allowed.
 * Everything else is blocked, and we never send fallback lists or auto-routing options.
 */
export const openRouterPlugin: ProviderPlugin = {
  id: "openrouter",
  displayName: "OpenRouter",
  kind: "cloud",
  connectable: true,
  defaultBaseUrl: "https://openrouter.ai/api/v1",
  apiKeyEnv: "OPENROUTER_API_KEY",
  freePolicy: "price_zero_suffix",
  freePolicyLabel: "Only models ending in :free with a live price of exactly 0 (never buy credits)",
  baseUrlEditable: false,
  defaultDailyRequestCap: 40,
  normalizeModelId: (id) => id,
  isTextModel: () => true,
  classifyModel: (model) => {
    const free = model.id.endsWith(":free") && model.priceInput === 0 && model.priceOutput === 0;
    return free
      ? { status: "verified_free", source: "OpenRouter model list: id ends in :free and price is exactly 0" }
      : { status: "blocked", source: "Not a verified-free OpenRouter model (price is not 0, or unknown)" };
  },
};
