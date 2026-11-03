import { geminiPlugin } from "./gemini.js";
import { groqPlugin } from "./groq.js";
import { ollamaPlugin } from "./ollama.js";
import { openRouterPlugin } from "./openrouter.js";
import { redactSecrets } from "../secrets.js";
import type { ProviderPlugin } from "../types.js";

/**
 * The providers this platform knows about. Gemini first, then Groq and OpenRouter, then the
 * optional local Ollama. Together AI is excluded, and OmniRoute is intentionally not listed.
 */
export const PLUGINS: readonly ProviderPlugin[] = [geminiPlugin, groqPlugin, openRouterPlugin, ollamaPlugin];

export function getPlugin(id: string): ProviderPlugin | undefined {
  return PLUGINS.find((p) => p.id === id);
}

const KEY_ENVS = PLUGINS.map((p) => p.apiKeyEnv);

/** Removes every known API key from a piece of text. */
export function redactKnownSecrets(text: string): string {
  return redactSecrets(text, KEY_ENVS);
}
