import type { ProviderPlugin } from "../types.js";

/**
 * The built-in demonstration provider (see providers/demo.ts). SIMULATED: it never contacts anything and never produces real AI output.
 * Automatic routing never chooses it unless the owner ticks it in Model routing; a bot uses it only when given a "demo/..." model.
 */
export const demoPlugin: ProviderPlugin = {
  id: "demo",
  displayName: "Demo AI (simulated, built in)",
  kind: "local",
  connectable: true,
  simulated: true,
  defaultBaseUrl: "builtin:demo",
  apiKeyEnv: null,
  freePolicy: "local",
  freePolicyLabel: "Simulated inside this app: no network, no key, no cost, and no real AI",
  baseUrlEditable: false,
  defaultDailyRequestCap: null,
  normalizeModelId: (id) => id,
  isTextModel: () => true,
  classifyModel: () => ({ status: "verified_free", source: "Simulated inside this app (no real AI, no cost)" }),
};
