import type { ProviderPlugin } from "../types.js";

/** A model that Ollama runs on its own servers: the id ends in -cloud or :cloud (also -cloud inside a tag, such as qwen:480b-cloud). */
export const CLOUD_MODEL = /(^|[:_/-])cloud$/i;

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
  // A local Ollama can also list models that run on Ollama's servers (names ending in cloud). Those are billed per token (ollama.com/pricing,
  // checked 2026-11-04), so they are never free here, whatever the owner is signed in to.
  classifyModel: (m) => (CLOUD_MODEL.test(m.id) ? { status: "blocked", source: "Runs on Ollama's servers and is billed per token, so it is not free" } : { status: "verified_free", source: "Runs locally on this PC" }),
  suggestedModels: [
    { id: "llama3.1:8b", displayName: "Llama 3.1 8B (local)" },
    { id: "llama3.2:3b", displayName: "Llama 3.2 3B (local)" },
  ],
};
