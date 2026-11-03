import type { ProviderPlugin } from "../types.js";

/** Ollama: models that run on this PC. Free, private, no key. Not installed unless you approve it. */
export const ollamaPlugin: ProviderPlugin = {
  id: "ollama",
  displayName: "Ollama (local)",
  kind: "local",
  connectable: true,
  defaultBaseUrl: "http://127.0.0.1:11434/v1",
  apiKeyEnv: null,
  freePolicy: "local",
  freePolicyLabel: "Runs on this PC: no cost, no data leaves your computer",
  baseUrlEditable: true,
  defaultDailyRequestCap: null,
  normalizeModelId: (id) => id,
  isTextModel: (id) => !/embed/i.test(id),
  classifyModel: () => ({ status: "verified_free", source: "Runs locally on this PC" }),
  suggestedModels: [
    { id: "llama3.1:8b", displayName: "Llama 3.1 8B (local)" },
    { id: "llama3.2:3b", displayName: "Llama 3.2 3B (local)" },
  ],
};
