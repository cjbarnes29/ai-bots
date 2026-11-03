import type { DatabaseSync } from "node:sqlite";
import type { AuditLog } from "../audit/audit.js";
import { AppError } from "../errors.js";
import { PLUGINS } from "../llm/plugins/index.js";
import { decryptSecret, encryptSecret } from "./crypto.js";

export interface KnownSecret {
  name: string;
  description: string;
}

export interface SecretStatus extends KnownSecret {
  /** Stored (encrypted) in the vault. */
  inVault: boolean;
  /** Also present as an environment variable (.env). The vault takes precedence. */
  inEnv: boolean;
  updatedAt: string | null;
}

const MAX_VALUE_CHARS = 4096;

/** Only secrets the platform actually uses can be stored: no arbitrary storage. */
export function providerSecrets(): KnownSecret[] {
  return PLUGINS.filter((p) => p.apiKeyEnv).map((p) => ({ name: p.apiKeyEnv!, description: `API key for ${p.displayName}` }));
}

/**
 * Encrypted storage for API keys and tokens. Values go in and are used internally; they are never returned by
 * the API, shown on screen, or written to the audit log.
 */
export class VaultService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly key: Buffer,
    private readonly audit: AuditLog,
    /** More secret names (from connectors). Provider keys are always included. */
    private readonly extraSecrets: () => KnownSecret[] = () => [],
    private readonly now: () => number = Date.now,
  ) {}

  known(): KnownSecret[] {
    return [...providerSecrets(), ...this.extraSecrets()];
  }

  private mustBeKnown(name: string): KnownSecret {
    const found = this.known().find((s) => s.name === name);
    if (!found) throw new AppError(404, "unknown_secret", "That is not a secret this platform uses.");
    return found;
  }

  list(): SecretStatus[] {
    const stored = new Map(
      this.db
        .prepare("SELECT name, updated_at FROM vault_secrets")
        .all()
        .map((r) => [String(r["name"]), String(r["updated_at"])] as const),
    );
    return this.known().map((s) => ({
      ...s,
      inVault: stored.has(s.name),
      inEnv: Boolean(process.env[s.name]?.trim()),
      updatedAt: stored.get(s.name) ?? null,
    }));
  }

  set(name: string, value: string): SecretStatus[] {
    this.mustBeKnown(name);
    const clean = value.trim();
    if (clean.length === 0) throw new AppError(400, "empty_secret", "Paste the key first.");
    if (clean.length > MAX_VALUE_CHARS) throw new AppError(400, "secret_too_long", "That value is too long to be a key.");
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(clean)) throw new AppError(400, "invalid_secret", "A key is a single line of text without line breaks.");

    const enc = encryptSecret(this.key, name, clean);
    const nowIso = new Date(this.now()).toISOString();
    this.db
      .prepare(
        `INSERT INTO vault_secrets (name, iv, tag, ciphertext, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET iv = excluded.iv, tag = excluded.tag, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
      )
      .run(name, enc.iv, enc.tag, enc.ciphertext, nowIso, nowIso);
    this.audit.record("vault.set", { name }, { actor: "owner" }); // the name only, never the value
    return this.list();
  }

  delete(name: string): SecretStatus[] {
    this.mustBeKnown(name);
    this.db.prepare("DELETE FROM vault_secrets WHERE name = ?").run(name);
    this.audit.record("vault.delete", { name }, { actor: "owner" });
    return this.list();
  }

  /** The decrypted value for internal use (calling a provider or connector). Null if not in the vault. */
  getStored(name: string): string | null {
    const row = this.db.prepare("SELECT iv, tag, ciphertext FROM vault_secrets WHERE name = ?").get(name);
    if (!row) return null;
    try {
      return decryptSecret(this.key, name, { iv: String(row["iv"]), tag: String(row["tag"]), ciphertext: String(row["ciphertext"]) });
    } catch {
      // Wrong key file, or the stored data was changed. Treat as missing, and record it.
      this.audit.record("vault.unreadable", { name });
      return null;
    }
  }

  /** The vault first, then the environment (.env). */
  resolve(name: string): string | null {
    return this.getStored(name) ?? (process.env[name]?.trim() || null);
  }
}
