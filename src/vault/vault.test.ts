import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { openDatabase } from "../db/database.js";
import { redactKnownSecrets } from "../llm/plugins/index.js";
import { readApiKey } from "../llm/secrets.js";
import { geminiPlugin } from "../llm/plugins/gemini.js";
import { makeCaller } from "../llm/test-helpers.js";
import { createTestApp, type TestApp } from "../test-app.js";
import { decryptSecret, encryptSecret, loadOrCreateKeyFile } from "./crypto.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SECRET = "AIzaSyVAULTTESTSECRET0123456789abcdefgh";
let t: TestApp;
beforeEach(async () => {
  vi.stubEnv("GEMINI_API_KEY", "");
  t = await createTestApp();
});
afterEach(async () => {
  await t.app.close();
  vi.unstubAllEnvs();
});

const dump = async () => {
  // Everything the API can say about secrets, anywhere.
  const bodies: string[] = [];
  for (const url of ["/api/vault", "/api/audit?limit=500", "/api/llm/providers", "/api/llm/status", "/api/external/status"]) {
    bodies.push((await t.app.inject({ method: "GET", url })).body);
  }
  return bodies.join("\n");
};

describe("the encryption", () => {
  const key = Buffer.alloc(32, 7);

  it("round-trips a value, and the stored form does not contain it", () => {
    const enc = encryptSecret(key, "GEMINI_API_KEY", SECRET);
    expect(JSON.stringify(enc)).not.toContain(SECRET);
    expect(decryptSecret(key, "GEMINI_API_KEY", enc)).toBe(SECRET);
  });

  it("uses a fresh random start value each time, so equal secrets look different", () => {
    const a = encryptSecret(key, "GEMINI_API_KEY", SECRET);
    const b = encryptSecret(key, "GEMINI_API_KEY", SECRET);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("refuses a wrong key, a changed value, or a value moved to another name", () => {
    const enc = encryptSecret(key, "GEMINI_API_KEY", SECRET);
    expect(() => decryptSecret(Buffer.alloc(32, 8), "GEMINI_API_KEY", enc)).toThrow();
    expect(() => decryptSecret(key, "GROQ_API_KEY", enc)).toThrow(); // the name is part of the lock
    const flipped = Buffer.from(enc.ciphertext, "base64");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => decryptSecret(key, "GEMINI_API_KEY", { ...enc, ciphertext: flipped.toString("base64") })).toThrow();
    expect(() => decryptSecret(key, "GEMINI_API_KEY", { ...enc, tag: Buffer.alloc(16).toString("base64") })).toThrow();
  });

  describe("the key file", () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "awp-vault-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("is created once as 64 hex characters, and reused", () => {
      const path = join(dir, "sub", "vault.key");
      const first = loadOrCreateKeyFile(path);
      expect(first).toHaveLength(32);
      expect(readFileSync(path, "utf8")).toMatch(/^[0-9a-f]{64}$/);
      expect(loadOrCreateKeyFile(path).equals(first)).toBe(true);
    });

    it("refuses a damaged key file instead of silently making a new one (which would lock you out)", () => {
      const path = join(dir, "vault.key");
      writeFileSync(path, "not a key");
      expect(() => loadOrCreateKeyFile(path)).toThrow(/damaged/);
    });
  });
});

describe("storing secrets", () => {
  it("lists the secrets the platform uses (the three provider keys) and what is set", async () => {
    const res = await t.call("GET", "/api/vault");
    expect(res.body.secrets.map((s: any) => s.name)).toEqual(["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"]);
    for (const s of res.body.secrets) expect(s).toMatchObject({ inVault: false, inEnv: false, updatedAt: null });
    expect(res.body.secrets[0].description).toMatch(/Gemini/);
  });

  it("stores a key encrypted, and never returns it", async () => {
    const res = await t.call("PUT", "/api/vault/GEMINI_API_KEY", { value: `  ${SECRET}  ` });
    expect(res.status).toBe(200);
    expect(res.body.secrets[0]).toMatchObject({ name: "GEMINI_API_KEY", inVault: true });
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(await dump()).not.toContain(SECRET);
    expect((await t.call("GET", "/api/vault")).body.secrets[0].updatedAt).not.toBeNull();
  });

  it("the provider uses the vault key with no .env at all, and the key is scrubbed from messages", async () => {
    expect(readApiKey(geminiPlugin)).toBeNull();
    await t.call("PUT", "/api/vault/GEMINI_API_KEY", { value: SECRET });
    expect(readApiKey(geminiPlugin)).toBe(SECRET);
    const providers = (await t.call("GET", "/api/llm/providers")).body.providers;
    expect(providers.find((p: any) => p.id === "gemini").keyConfigured).toBe(true);
    expect(redactKnownSecrets(`The provider said key ${SECRET} is wrong`)).toBe("The provider said key [redacted] is wrong");
  });

  it("the vault wins over .env; removing it falls back to .env", async () => {
    vi.stubEnv("GEMINI_API_KEY", "key-from-env-00000000");
    expect(readApiKey(geminiPlugin)).toBe("key-from-env-00000000");
    expect((await t.call("GET", "/api/vault")).body.secrets[0]).toMatchObject({ inEnv: true, inVault: false });
    await t.call("PUT", "/api/vault/GEMINI_API_KEY", { value: SECRET });
    expect(readApiKey(geminiPlugin)).toBe(SECRET);
    await t.call("DELETE", "/api/vault/GEMINI_API_KEY");
    expect(readApiKey(geminiPlugin)).toBe("key-from-env-00000000");
  });

  it("replacing a key keeps one entry; removing it removes it", async () => {
    await t.call("PUT", "/api/vault/GROQ_API_KEY", { value: "first-key-1234567" });
    await t.call("PUT", "/api/vault/GROQ_API_KEY", { value: "second-key-1234567" });
    expect(readApiKey({ apiKeyEnv: "GROQ_API_KEY" })).toBe("second-key-1234567");
    const removed = await t.call("DELETE", "/api/vault/GROQ_API_KEY");
    expect(removed.body.secrets.find((s: any) => s.name === "GROQ_API_KEY").inVault).toBe(false);
    expect(readApiKey({ apiKeyEnv: "GROQ_API_KEY" })).toBeNull();
  });

  it("only stores secrets the platform uses, and checks what is sent", async () => {
    expect((await t.call("PUT", "/api/vault/SOME_OTHER_THING", { value: "x" })).body.error).toBe("unknown_secret");
    expect((await t.call("DELETE", "/api/vault/SOME_OTHER_THING")).status).toBe(404);
    expect((await t.call("PUT", "/api/vault/gemini_api_key", { value: "x" })).status).toBe(400);
    expect((await t.call("PUT", "/api/vault/GEMINI_API_KEY", { value: "   " })).body.error).toBe("empty_secret");
    expect((await t.call("PUT", "/api/vault/GEMINI_API_KEY", { value: "x".repeat(4097) })).body.error).toBe("secret_too_long");
    expect((await t.call("PUT", "/api/vault/GEMINI_API_KEY", { value: "line1\nline2" })).body.error).toBe("invalid_secret");
    expect((await t.call("PUT", "/api/vault/GEMINI_API_KEY", { value: 123 })).status).toBe(400);
    expect((await t.call("PUT", "/api/vault/GEMINI_API_KEY", { value: "x", extra: 1 })).status).toBe(400);
    expect((await t.call("PUT", "/api/vault/GEMINI_API_KEY", {})).status).toBe(400);
    expect((await t.call("GET", "/api/vault")).body.secrets.every((s: any) => !s.inVault)).toBe(true);
  });

  it("changes need the client header, and there is no way to read a value back", async () => {
    const noHeader = await t.app.inject({ method: "PUT", url: "/api/vault/GEMINI_API_KEY", payload: { value: SECRET } });
    expect(noHeader.statusCode).toBe(403);
    expect(readApiKey(geminiPlugin)).toBeNull();
    await t.call("PUT", "/api/vault/GEMINI_API_KEY", { value: SECRET });
    for (const url of ["/api/vault/GEMINI_API_KEY", "/api/vault/GEMINI_API_KEY/value", "/api/vault/reveal"]) {
      const res = await t.app.inject({ method: "GET", url });
      expect(res.body).not.toContain(SECRET);
    }
  });

  it("writes only the NAME to the audit log, never the value", async () => {
    await t.call("PUT", "/api/vault/GEMINI_API_KEY", { value: SECRET });
    await t.call("DELETE", "/api/vault/GEMINI_API_KEY");
    const events = (await t.call("GET", "/api/audit")).body.events;
    expect(events.map((e: any) => [e.kind, e.detail.name])).toEqual([["vault.delete", "GEMINI_API_KEY"], ["vault.set", "GEMINI_API_KEY"]]);
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(events[0].actor).toBe("owner");
  });
});

describe("in the database file", () => {
  describe("with real files", () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "awp-vault-db-"));
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("survives a restart (the key file is reused), keeps the key out of the database, and detects tampering", async () => {
      const dbPath = join(dir, "data", "app.db");
      const first = await buildApp({ dbPath });
      await makeCaller(first)("PUT", "/api/vault/GEMINI_API_KEY", { value: SECRET });
      await first.close();

      // The database file itself holds no readable secret.
      const raw = readFileSync(dbPath);
      expect(raw.includes(Buffer.from(SECRET))).toBe(false);
      expect(readFileSync(join(dir, "data", "vault.key"), "utf8")).toMatch(/^[0-9a-f]{64}$/);

      const second = await buildApp({ dbPath });
      expect(readApiKey(geminiPlugin)).toBe(SECRET);

      // Tamper with the stored value directly in the database file.
      const db = openDatabase(dbPath);
      const row = db.prepare("SELECT ciphertext FROM vault_secrets WHERE name = 'GEMINI_API_KEY'").get() as any;
      const bytes = Buffer.from(row.ciphertext, "base64");
      bytes[0] = bytes[0]! ^ 1;
      db.prepare("UPDATE vault_secrets SET ciphertext = ?").run(bytes.toString("base64"));
      db.close();
      expect(readApiKey(geminiPlugin)).toBeNull(); // treated as missing, never as garbage
      const events = (await makeCaller(second)("GET", "/api/audit")).body.events;
      expect(events.some((e: any) => e.kind === "vault.unreadable" && e.detail.name === "GEMINI_API_KEY")).toBe(true);
      await second.close();
    });

    it("a different key file cannot read the secrets", async () => {
      const dbPath = join(dir, "app.db");
      const first = await buildApp({ dbPath, vaultKey: Buffer.alloc(32, 1) });
      await makeCaller(first)("PUT", "/api/vault/GEMINI_API_KEY", { value: SECRET });
      await first.close();
      const second = await buildApp({ dbPath, vaultKey: Buffer.alloc(32, 2) });
      expect(readApiKey(geminiPlugin)).toBeNull();
      await second.close();
    });
  });
});

describe("the audit log", () => {
  it("is append-only", () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO audit_events (created_at, created_ms, kind, detail) VALUES ('x', 1, 'k', '{}')").run();
    expect(() => db.prepare("UPDATE audit_events SET kind = 'z'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM audit_events").run()).toThrow(/append-only/);
  });

  it("cleans anything that looks like a key out of an event", async () => {
    const { AuditLog } = await import("../audit/audit.js");
    const db = openDatabase(":memory:");
    const log = new AuditLog(db);
    log.record("test", { note: `leaked ${SECRET} here` });
    expect(JSON.stringify(log.list(10))).not.toContain(SECRET);
    expect(JSON.stringify(log.list(10))).toContain("[redacted]");
  });

  it("can be limited, and rejects bad limits", async () => {
    await t.call("PUT", "/api/vault/GEMINI_API_KEY", { value: SECRET });
    await t.call("PUT", "/api/vault/GROQ_API_KEY", { value: "another-key-123456" });
    expect((await t.call("GET", "/api/audit?limit=1")).body.events).toHaveLength(1);
    expect((await t.call("GET", "/api/audit?limit=0")).status).toBe(400);
    expect((await t.call("GET", "/api/audit?limit=501")).status).toBe(400);
  });
});
