import { OpenAiCompatibleProvider } from "./providers/openai-compatible.js";
import { redactKnownSecrets } from "./plugins/index.js";
import type { ProviderRow } from "./repository.js";
import { readApiKey } from "./secrets.js";
import type { LlmProvider, ProviderPlugin } from "./types.js";

/** Builds the object that actually talks to a provider. Tests supply their own. */
export type ProviderFactory = (provider: ProviderRow, plugin: ProviderPlugin) => LlmProvider;

/** Cloud addresses are fixed in code. Only the local provider's address can be edited. */
export function effectiveBaseUrl(provider: ProviderRow, plugin: ProviderPlugin): string {
  return plugin.baseUrlEditable && provider.baseUrl ? provider.baseUrl : plugin.defaultBaseUrl;
}

export const defaultProviderFactory: ProviderFactory = (provider, plugin) =>
  new OpenAiCompatibleProvider({
    baseUrl: effectiveBaseUrl(provider, plugin),
    apiKey: readApiKey(plugin),
    plugin,
    redact: redactKnownSecrets,
  });
