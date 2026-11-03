import type { ProviderPlugin } from "./types.js";

/**
 * API keys live in environment variables (your .env file), never in the database.
 * This file is the only place that reads them.
 */
export function readApiKey(plugin: Pick<ProviderPlugin, "apiKeyEnv">): string | null {
  if (!plugin.apiKeyEnv) return null;
  const value = process.env[plugin.apiKeyEnv]?.trim();
  return value ? value : null;
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

/** Removes API keys (known values and common shapes) from text. */
export function redactSecrets(text: string, knownKeyEnvs: (string | null)[] = []): string {
  let out = text;
  for (const env of knownKeyEnvs) {
    const value = env ? process.env[env]?.trim() : undefined;
    if (value && value.length >= 6) out = out.split(value).join("[redacted]");
  }
  for (const pattern of KEY_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out;
}
