# Vault

Stores API keys and tokens encrypted (AES-256-GCM) in the database. The encryption key is the file `data/vault.key`, created on
first start (never committed; back it up with the database or saved keys become unreadable).

- Only names the app knows (provider key names and connector secrets) can be stored.
- No API ever returns a stored value. The dashboard can add, replace, remove and show "saved / not set".
- `resolveSecret` (in `src/llm/secrets.ts`) asks the vault first, then `.env`.
- Changes are written to the audit log by name only, never by value. A key that cannot be decrypted is logged as `vault.unreadable`.
