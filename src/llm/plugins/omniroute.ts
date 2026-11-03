import type { ProviderPlugin } from "../types.js";

/**
 * OmniRoute is defined here so it can be added later, but it is deliberately NOT connectable and is
 * not in the plugin list. Nothing in this project contacts or touches an OmniRoute install.
 */
export const omniRoutePlugin: ProviderPlugin = {
  id: "omniroute",
  displayName: "OmniRoute (not connected)",
  kind: "local",
  connectable: false,
  defaultBaseUrl: "http://127.0.0.1:20128/v1",
  apiKeyEnv: "OMNIROUTE_API_KEY",
  freePolicy: "account_billing_confirmation",
  freePolicyLabel: "Not connected",
  baseUrlEditable: false,
  defaultDailyRequestCap: null,
  normalizeModelId: (id) => id,
  isTextModel: () => true,
  classifyModel: () => ({ status: "blocked", source: "OmniRoute is not connected" }),
};
