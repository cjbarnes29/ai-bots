import type { ProviderPlugin } from "./types.js";

/**
 * API keys come from the encrypted vault first, then from environment variables (your .env file).
 * This file is the only place that reads them.
 */
let vaultLookup: ((name: string) => string | null) | null = null;

/** Connects the vault. Called once when the app starts. */
export function setSecretLookup(lookup: ((name: string) => string | null) | null): void {
  vaultLookup = lookup;
}

let askingVault = false;

export function resolveSecret(name: string): string | null {
  let stored: string | null = null;
  // Guard against a loop: if the vault itself runs into trouble and writes to the audit log, which cleans keys out of
  // the text by asking for the keys again, that inner question must not ask the vault a second time.
  if (vaultLookup && !askingVault) {
    askingVault = true;
    try {
      stored = vaultLookup(name);
    } finally {
      askingVault = false;
    }
  }
  return stored ?? (process.env[name]?.trim() || null);
}

export function readApiKey(plugin: Pick<ProviderPlugin, "apiKeyEnv">): string | null {
  return plugin.apiKeyEnv ? resolveSecret(plugin.apiKeyEnv) : null;
}

export function hasApiKey(plugin: Pick<ProviderPlugin, "apiKeyEnv">): boolean {
  return readApiKey(plugin) !== null;
}

// Common key shapes, removed from any text before it can be logged or shown.
const KEY_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{20,}/g,
  /gsk_[0-9A-Za-z]{20,}/g,
  /sk-or-[0-9A-Za-z_-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._-]{10,}/gi,
];

/** Removes API keys (the stored values and common shapes) from text. */
export function redactSecrets(text: string, knownKeyEnvs: (string | null)[] = []): string {
  let out = text;
  for (const env of knownKeyEnvs) {
    const value = env ? resolveSecret(env) : null;
    if (value && value.length >= 6) out = out.split(value).join("[redacted]");
  }
  for (const pattern of KEY_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out;
}
