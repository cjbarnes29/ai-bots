import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { openDatabase } from "../db/database.js";
import { CLIENT_HEADER, CLIENT_HEADER_VALUE } from "../security.js";

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApp({ dbPath: ":memory:" });
});
afterEach(async () => {
  await app.close();
});

/* eslint-disable @typescript-eslint/no-explicit-any */
async function call(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, payload?: unknown) {
  const res = await app.inject({
    method,
    url,
    payload: payload as object | undefined,
    headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE },
  });
  return { status: res.statusCode, body: res.json() as any };
}

async function createBot(extra: Record<string, unknown> = {}) {
  const res = await call("POST", "/api/bots", { name: "Helper", ...extra });
  expect(res.status).toBe(201);
  return res.body.bot as any;
}

describe("creating bots", () => {
  it("starts disabled, at version 1, with every permission OFF and writes approval-only", async () => {
    const bot = await createBot({ role: "Assistant", instructions: "Be helpful" });
    expect(bot.status).toBe("disabled");
    expect(bot.currentVersion).toBe(1);
    expect(bot.archived).toBe(false);
    expect(bot.runtime).toBe("builtin");
    expect(bot.permissions).toHaveLength(3);
    for (const p of bot.permissions) {
      expect(p.readEnabled).toBe(false);
      expect(p.writePolicy).toBe("approval_required");
    }
    expect(bot.permissions.map((p: any) => p.connector).sort()).toEqual(["browser", "gmail", "telegram"]);
  });

  it("cannot be created as active", async () => {
    const res = await call("POST", "/api/bots", { name: "X", status: "active" });
    expect(res.status).toBe(400); // "status" is not an accepted field when creating
    const bots = await call("GET", "/api/bots");
    expect(bots.body.bots).toHaveLength(0);
  });

  it("rejects invalid input", async () => {
    expect((await call("POST", "/api/bots", {})).status).toBe(400);
    expect((await call("POST", "/api/bots", { name: "   " })).status).toBe(400);
    expect((await call("POST", "/api/bots", { name: "a".repeat(81) })).status).toBe(400);
    expect((await call("POST", "/api/bots", { name: "ok", instructions: "x".repeat(20_001) })).status).toBe(400);
    expect((await call("POST", "/api/bots", { name: "ok", surprise: 1 })).status).toBe(400);
    expect((await call("POST", "/api/bots", { name: "ok", runtime: "bogus" })).status).toBe(400);
    expect((await call("POST", "/api/bots", { name: "ok", responsibilities: [""] })).status).toBe(400);
  });
});

describe("editing and version history", () => {
  it("creates a new version when content changes", async () => {
    const bot = await createBot();
    const res = await call("PATCH", `/api/bots/${bot.id}`, {
      instructions: "New rules",
      changeNote: "Tightened rules",
    });
    expect(res.status).toBe(200);
    expect(res.body.bot.currentVersion).toBe(2);
    expect(res.body.bot.instructions).toBe("New rules");

    const versions = (await call("GET", `/api/bots/${bot.id}/versions`)).body.versions;
    expect(versions.map((v: any) => v.version)).toEqual([2, 1]);
    expect(versions[0].changeNote).toBe("Tightened rules");
    expect(versions[1].instructions).toBe("");
  });

  it("does not create a version for a no-op edit or a status-only change", async () => {
    const bot = await createBot();
    await call("PATCH", `/api/bots/${bot.id}`, { name: "Helper" });
    const paused = await call("PATCH", `/api/bots/${bot.id}`, { status: "paused" });
    expect(paused.body.bot.status).toBe("paused");
    expect(paused.body.bot.currentVersion).toBe(1);
    expect((await call("GET", `/api/bots/${bot.id}/versions`)).body.versions).toHaveLength(1);
  });

  it("refuses to activate a bot in Phase 1", async () => {
    const bot = await createBot();
    const res = await call("PATCH", `/api/bots/${bot.id}`, { status: "active" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("activation_not_available");
    expect((await call("GET", `/api/bots/${bot.id}`)).body.bot.status).toBe("disabled");
  });

  it("restore creates a NEW version and never touches permissions", async () => {
    const bot = await createBot({ instructions: "v1 text" });
    await call("PUT", `/api/bots/${bot.id}/permissions/gmail`, { readEnabled: true });
    await call("PATCH", `/api/bots/${bot.id}`, { instructions: "v2 text" });

    const restored = await call("POST", `/api/bots/${bot.id}/versions/1/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.bot.instructions).toBe("v1 text");
    expect(restored.body.bot.currentVersion).toBe(3);

    const versions = (await call("GET", `/api/bots/${bot.id}/versions`)).body.versions;
    expect(versions).toHaveLength(3);
    expect(versions[0].restoredFrom).toBe(1);
    expect(versions[0].changeNote).toBe("Restored from version 1");
    // History is untouched: version 2 still says "v2 text".
    expect(versions[1].instructions).toBe("v2 text");

    const gmail = restored.body.bot.permissions.find((p: any) => p.connector === "gmail");
    expect(gmail.readEnabled).toBe(true); // restore did not reset or change permissions
  });

  it("returns 404 for unknown bots and versions", async () => {
    const bot = await createBot();
    expect((await call("GET", "/api/bots/not-a-uuid")).status).toBe(404);
    expect((await call("GET", "/api/bots/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await call("GET", `/api/bots/${bot.id}/versions/99`)).status).toBe(404);
    expect((await call("POST", `/api/bots/${bot.id}/versions/99/restore`)).status).toBe(404);
  });
});

describe("permissions", () => {
  it("toggling a read permission works and is written to the audit log", async () => {
    const bot = await createBot();
    const on = await call("PUT", `/api/bots/${bot.id}/permissions/gmail`, { readEnabled: true });
    expect(on.status).toBe(200);
    expect(on.body.permissions.find((p: any) => p.connector === "gmail").readEnabled).toBe(true);
    expect(on.body.permissions.find((p: any) => p.connector === "telegram").readEnabled).toBe(false);

    await call("PUT", `/api/bots/${bot.id}/permissions/gmail`, { readEnabled: false });
    const audit = (await call("GET", `/api/bots/${bot.id}/permissions/audit`)).body.audit;
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ connector: "gmail", oldValue: true, newValue: false });
    expect(audit[1]).toMatchObject({ connector: "gmail", oldValue: false, newValue: true });
  });

  it("does not log a change that changes nothing", async () => {
    const bot = await createBot();
    await call("PUT", `/api/bots/${bot.id}/permissions/gmail`, { readEnabled: false });
    expect((await call("GET", `/api/bots/${bot.id}/permissions/audit`)).body.audit).toHaveLength(0);
  });

  it("makes the write policy impossible to change", async () => {
    const bot = await createBot();
    for (const writePolicy of ["allowed", "never", "auto", true]) {
      const res = await call("PUT", `/api/bots/${bot.id}/permissions/gmail`, {
        readEnabled: true,
        writePolicy,
      });
      expect(res.status).toBe(400);
    }
    const perms = (await call("GET", `/api/bots/${bot.id}/permissions`)).body.permissions;
    for (const p of perms) {
      expect(p.readEnabled).toBe(false);
      expect(p.writePolicy).toBe("approval_required");
    }
  });

  it("rejects unknown connectors and bad bodies", async () => {
    const bot = await createBot();
    expect((await call("PUT", `/api/bots/${bot.id}/permissions/slack`, { readEnabled: true })).status).toBe(404);
    expect((await call("PUT", `/api/bots/${bot.id}/permissions/gmail`, { readEnabled: "yes" })).status).toBe(400);
    expect((await call("PUT", `/api/bots/${bot.id}/permissions/gmail`, {})).status).toBe(400);
  });
});

describe("duplicate and archive", () => {
  it("a duplicate copies content only: disabled, version 1, all permissions OFF", async () => {
    const bot = await createBot({ instructions: "Do things" });
    await call("PUT", `/api/bots/${bot.id}/permissions/browser`, { readEnabled: true });
    await call("PATCH", `/api/bots/${bot.id}`, { status: "paused" });

    const copy = (await call("POST", `/api/bots/${bot.id}/duplicate`)).body.bot;
    expect(copy.id).not.toBe(bot.id);
    expect(copy.name).toBe("Helper (copy)");
    expect(copy.instructions).toBe("Do things");
    expect(copy.status).toBe("disabled");
    expect(copy.currentVersion).toBe(1);
    expect(copy.permissions.every((p: any) => p.readEnabled === false)).toBe(true);
  });

  it("archiving hides a bot, disables it, blocks edits, and can be undone", async () => {
    const bot = await createBot();
    await call("PATCH", `/api/bots/${bot.id}`, { status: "paused" });

    const archived = (await call("DELETE", `/api/bots/${bot.id}`)).body.bot;
    expect(archived.archived).toBe(true);
    expect(archived.status).toBe("disabled");

    expect((await call("GET", "/api/bots")).body.bots).toHaveLength(0);
    expect((await call("GET", "/api/bots?includeArchived=true")).body.bots).toHaveLength(1);

    expect((await call("PATCH", `/api/bots/${bot.id}`, { name: "Nope" })).status).toBe(409);
    expect((await call("PUT", `/api/bots/${bot.id}/permissions/gmail`, { readEnabled: true })).status).toBe(409);
    expect((await call("POST", `/api/bots/${bot.id}/versions/1/restore`)).status).toBe(409);

    const back = (await call("POST", `/api/bots/${bot.id}/unarchive`)).body.bot;
    expect(back.archived).toBe(false);
    expect((await call("GET", "/api/bots")).body.bots).toHaveLength(1);
  });
});

describe("request bodies", () => {
  it("accepts an empty body sent with a JSON content type (e.g. duplicate)", async () => {
    const bot = await createBot();
    const res = await app.inject({
      method: "POST",
      url: `/api/bots/${bot.id}/duplicate`,
      headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE, "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(201);
  });

  it("rejects malformed JSON with a 400, not a crash", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/bots",
      headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE, "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
  });

  it("treats a missing body on create as invalid input", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/bots",
      headers: { [CLIENT_HEADER]: CLIENT_HEADER_VALUE, "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("request protection", () => {
  it("rejects changes without the client header", async () => {
    const res = await app.inject({ method: "POST", url: "/api/bots", payload: { name: "Sneaky" } });
    expect(res.statusCode).toBe(403);
    expect((await call("GET", "/api/bots")).body.bots).toHaveLength(0);
  });

  it("rejects a no-body POST without the header (cross-site form style requests)", async () => {
    const bot = await createBot();
    const res = await app.inject({ method: "POST", url: `/api/bots/${bot.id}/duplicate` });
    expect(res.statusCode).toBe(403);
  });

  it("rejects requests addressed to a foreign host name (DNS rebinding)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/bots", headers: { host: "evil.example.com" } });
    expect(res.statusCode).toBe(403);
    const ok = await app.inject({ method: "GET", url: "/api/bots", headers: { host: "127.0.0.1:3000" } });
    expect(ok.statusCode).toBe(200);
  });

  it("only gives CORS approval to the dashboard origin", async () => {
    const withDashboard = await buildApp({ dbPath: ":memory:", dashboardOrigins: ["http://localhost:5173"] });
    try {
      const good = await withDashboard.inject({
        method: "OPTIONS",
        url: "/api/bots",
        headers: {
          origin: "http://localhost:5173",
          "access-control-request-method": "POST",
          "access-control-request-headers": CLIENT_HEADER,
        },
      });
      expect(good.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
      const bad = await withDashboard.inject({
        method: "OPTIONS",
        url: "/api/bots",
        headers: {
          origin: "https://evil.example.com",
          "access-control-request-method": "POST",
          "access-control-request-headers": CLIENT_HEADER,
        },
      });
      expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    } finally {
      await withDashboard.close();
    }
  });
});

describe("database-level safety rules (cannot be broken even by buggy code)", () => {
  function seed() {
    const db = openDatabase(":memory:");
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO bots (id, name, created_at, updated_at) VALUES ('b1', 'Bot', ?, ?)",
    ).run(now, now);
    db.prepare("INSERT INTO bot_permissions (bot_id, connector, updated_at) VALUES ('b1', 'gmail', ?)").run(now);
    return { db, now };
  }

  it("refuses any write policy other than approval_required", () => {
    const { db } = seed();
    expect(() =>
      db.prepare("UPDATE bot_permissions SET write_policy = 'allowed' WHERE bot_id = 'b1'").run(),
    ).toThrow();
    expect(() =>
      db.prepare("INSERT INTO bot_permissions (bot_id, connector, write_policy, updated_at) VALUES ('b1','telegram','allowed','x')").run(),
    ).toThrow();
  });

  it("defaults read permission to OFF", () => {
    const { db } = seed();
    const row = db.prepare("SELECT read_enabled FROM bot_permissions WHERE bot_id = 'b1'").get();
    expect(row?.["read_enabled"]).toBe(0);
  });

  it("refuses to edit or delete history, audit rows, or bots", () => {
    const { db, now } = seed();
    db.prepare(
      `INSERT INTO bot_versions (bot_id, version, name, role, personality, instructions, responsibilities, runtime, created_at)
       VALUES ('b1', 1, 'Bot', '', '', '', '[]', 'builtin', ?)`,
    ).run(now);
    db.prepare(
      "INSERT INTO permission_audit (bot_id, connector, field, old_value, new_value, created_at) VALUES ('b1','gmail','read_enabled',0,1,?)",
    ).run(now);

    expect(() => db.prepare("UPDATE bot_versions SET name = 'x'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM bot_versions").run()).toThrow(/append-only/);
    expect(() => db.prepare("UPDATE permission_audit SET new_value = 0").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM permission_audit").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM bots").run()).toThrow(/archive/);
  });

  it("applies migrations only once", () => {
    const { db } = seed();
    const rows = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
    expect(rows.map((r) => r["version"])).toEqual(["001_init.sql", "002_llm.sql", "003_chat.sql", "004_delegation.sql", "005_automation.sql", "006_approvals_vault.sql", "007_devices.sql", "008_owner_free_models.sql", "009_inbound.sql", "010_push.sql", "011_manager.sql", "012_skills_tools.sql", "013_pc_agent.sql", "014_workflows.sql", "015_integrations.sql", "016_memory.sql", "017_groups.sql"]);
  });
});
