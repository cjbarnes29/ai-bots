import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createGmailConnector } from "../connectors/gmail.js";
import { openDatabase } from "../db/database.js";
import { OK_RESULT } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { parseRemoteHosts } from "./access.js";
import { DEVICE_LIMITS, PAIRING } from "./devices.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const HOST = "my-pc.tail1234.ts.net";
const fence = "```";

const fakeConnector = (sent: unknown[]) => ({
  id: "telegram" as const,
  label: "Telegram",
  actions: {
    send_message: {
      kind: "write" as const,
      description: "Send",
      args: z.strictObject({ chat: z.string().min(1), text: z.string().min(1) }),
      summarize: (a: Record<string, unknown>) => `Send "${a["text"]}" to ${a["chat"]}`,
      execute: async (a: Record<string, unknown>) => {
        sent.push(a);
        return "sent";
      },
    },
  },
});

let t: TestApp;
let dist: string;
let sent: unknown[];

beforeEach(async () => {
  dist = mkdtempSync(join(tmpdir(), "awp-dist-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>dash</title>");
  writeFileSync(join(dist, "sw.js"), "// sw");
  writeFileSync(join(dist, "assets", "app-abc.js"), "console.log(1)");
  writeFileSync(join(dirnameOf(dist), "awp-secret.txt"), "TOP SECRET");
  sent = [];
  t = await createTestApp({ remoteHosts: [HOST], dashboardDir: dist, connectors: [fakeConnector(sent) as any, createGmailConnector()] });
});
afterEach(async () => {
  await t.app.close();
  vi.unstubAllEnvs();
});
const dirnameOf = (p: string) => join(p, "..");

// ----- helpers -----
const local = t0();
function t0() {
  return (method: any, url: string, payload?: unknown) => t.call(method, url, payload);
}
/** A request as if it came from the phone through Tailscale Serve. */
const remote = async (method: string, url: string, opts: { cookie?: string; body?: unknown; origin?: string | null; headers?: Record<string, string>; host?: string } = {}) => {
  const host = opts.host ?? HOST;
  const res = await t.app.inject({
    method: method as any,
    url,
    headers: {
      host,
      "x-awp-client": "dashboard",
      ...(opts.origin === null ? {} : { origin: opts.origin ?? `https://${host}` }),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.headers ?? {}),
    },
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  let body: any;
  try {
    body = res.body ? res.json() : undefined;
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body, headers: res.headers, raw: res };
};
const pairPhone = async (name = "Pixel") => {
  const { body } = await local("POST", "/api/devices/pairing");
  const res = await remote("POST", "/api/devices/pair", { body: { code: body.code, name } });
  const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
  return { res, cookie, code: body.code as string };
};

describe("who may connect", () => {
  it("this PC works exactly as before", async () => {
    expect((await local("GET", "/api/bots")).status).toBe(200);
    expect((await local("GET", "/api/session")).body).toMatchObject({ mode: "local", paired: null, remoteEnabled: true, remoteHosts: [HOST] });
  });

  it("unknown host names are refused (DNS rebinding), and so are look-alike Tailscale names", async () => {
    for (const host of ["evil.example.com", "my-pc.tail1234.ts.net.evil.com", "other.tail9999.ts.net", "ts.net", "100.64.0.5"]) {
      expect((await remote("GET", "/api/session", { host })).status, host).toBe(403);
    }
  });

  it("remote access is OFF unless a Tailscale name is configured", async () => {
    const off = await createTestApp();
    expect((await off.app.inject({ method: "GET", url: "/api/session", headers: { host: HOST } })).statusCode).toBe(403);
    expect((await off.call("POST", "/api/devices/pairing")).status).toBe(409);
    await off.app.close();
  });

  it("a request under a local name that carries proxy headers is refused (a proxy would be hiding a remote caller)", async () => {
    for (const h of ["x-forwarded-for", "x-forwarded-host", "forwarded", "tailscale-user-login"]) {
      const res = await t.app.inject({ method: "GET", url: "/api/bots", headers: { host: "127.0.0.1:3000", [h]: "100.101.102.103" } });
      expect(res.statusCode, h).toBe(403);
      expect(res.json().error).toBe("proxied_local_host");
    }
  });

  it("only *.ts.net names can be configured", () => {
    expect(parseRemoteHosts("a.b.ts.net, evil.com ,  X.tail1.TS.NET.,localhost,1.2.3.4")).toEqual({ hosts: ["a.b.ts.net", "x.tail1.ts.net"], rejected: ["evil.com", "localhost", "1.2.3.4"] });
    expect(parseRemoteHosts(undefined)).toEqual({ hosts: [], rejected: [] });
  });
});

describe("pairing a phone", () => {
  it("an unpaired phone can see the pages and ask who it is, but the API says it must pair", async () => {
    expect((await remote("GET", "/")).status).toBe(200);
    expect((await remote("GET", "/api/session")).body).toMatchObject({ mode: "remote", paired: false, device: null });
    for (const [m, u] of [["GET", "/api/bots"], ["GET", "/api/approvals"], ["GET", "/api/vault"], ["GET", "/api/devices"], ["POST", "/api/bots"]] as const) {
      const r = await remote(m, u, { body: m === "POST" ? { name: "x" } : undefined });
      expect(r.status, u).toBe(401);
      expect(r.body.error).toBe("device_not_paired");
    }
  });

  it("the PC makes a one-time code; the phone swaps it for a protected cookie; the secret is stored only as a hash", async () => {
    const { res, cookie } = await pairPhone("My Pixel");
    expect(res.status).toBe(200);
    expect(res.body.device.name).toBe("My Pixel");
    const setCookie = String(res.headers["set-cookie"]);
    expect(setCookie).toMatch(/^awp_device=[A-Za-z0-9_-]{40,}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=\d+$/);
    expect(JSON.stringify(res.body)).not.toContain(cookie.split("=")[1]);
    const secret = cookie.split("=")[1]!;
    const dump = JSON.stringify([(await local("GET", "/api/devices")).body, (await local("GET", "/api/audit?limit=200")).body]);
    expect(dump).not.toContain(secret);
    const now = await remote("GET", "/api/session", { cookie });
    expect(now.body).toMatchObject({ mode: "remote", paired: true, device: { name: "My Pixel" } });
  });

  it("the phone can use the dashboard's data once paired, and it is the same data as on the PC", async () => {
    const { cookie } = await pairPhone();
    const created = await remote("POST", "/api/bots", { cookie, body: { name: "From phone" } });
    expect(created.status).toBeLessThan(300);
    const onPc = (await local("GET", "/api/bots")).body.bots.map((b: any) => b.name);
    expect(onPc).toContain("From phone");
    await local("POST", "/api/bots", { name: "From PC" });
    expect((await remote("GET", "/api/bots", { cookie })).body.bots.map((b: any) => b.name)).toEqual(expect.arrayContaining(["From phone", "From PC"]));
  });

  it("a code works once only", async () => {
    const { code } = await pairPhone();
    const again = await remote("POST", "/api/devices/pair", { body: { code, name: "Second" } });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe("pairing_invalid");
  });

  it("a code expires after five minutes", async () => {
    const { body } = await local("POST", "/api/devices/pairing");
    t.clock.t += PAIRING.ttlMs + 1000;
    expect((await remote("POST", "/api/devices/pair", { body: { code: body.code, name: "Late" } })).status).toBe(400);
  });

  it("five wrong guesses destroy the code, even the right one afterwards", async () => {
    const { body } = await local("POST", "/api/devices/pairing");
    for (let i = 0; i < PAIRING.maxWrongGuesses; i++) expect((await remote("POST", "/api/devices/pair", { body: { code: `WRONG${i}XXXXX`, name: "Guess" } })).status).toBe(400);
    expect((await remote("POST", "/api/devices/pair", { body: { code: body.code, name: "Right but late" } })).status).toBe(400);
    expect((await local("GET", "/api/devices")).body.devices).toHaveLength(0);
  });

  it("the code is forgiving about case and dashes but nothing else", async () => {
    const { body } = await local("POST", "/api/devices/pairing");
    const spaced = `${body.code.slice(0, 5).toLowerCase()}-${body.code.slice(5)}`;
    expect((await remote("POST", "/api/devices/pair", { body: { code: spaced, name: "Typed" } })).status).toBe(200);
  });

  it("a phone cannot make a pairing code, and a new code replaces the old one", async () => {
    const { cookie } = await pairPhone();
    expect((await remote("POST", "/api/devices/pairing", { cookie })).status).toBe(403);
    const first = (await local("POST", "/api/devices/pairing")).body.code;
    const second = (await local("POST", "/api/devices/pairing")).body.code;
    expect((await remote("POST", "/api/devices/pair", { body: { code: first, name: "Old" } })).status).toBe(400);
    expect((await remote("POST", "/api/devices/pair", { body: { code: second, name: "New" } })).status).toBe(200);
  });

  it("the link and code are for this one phone: pairing from the PC itself is refused", async () => {
    const { body } = await local("POST", "/api/devices/pairing");
    expect(body.link).toBe(`https://${HOST}/?pair=${body.code}`);
    expect((await local("POST", "/api/devices/pair", { code: body.code, name: "PC" })).status).toBe(409);
  });

  it("at most ten phones, and a name is required", async () => {
    for (let i = 0; i < DEVICE_LIMITS.maxActive; i++) await pairPhone(`Phone ${i}`);
    const { body } = await local("POST", "/api/devices/pairing");
    expect((await remote("POST", "/api/devices/pair", { body: { code: body.code, name: "Eleventh" } })).body.error).toBe("too_many_devices");
  });

  it("change requests from the phone must come from the dashboard itself (Origin) and carry the client header", async () => {
    const { cookie } = await pairPhone();
    expect((await remote("POST", "/api/bots", { cookie, body: { name: "x" }, origin: "https://evil.example.com" })).body.error).toBe("bad_origin");
    expect((await remote("POST", "/api/bots", { cookie, body: { name: "x" }, origin: null })).body.error).toBe("bad_origin");
    const res = await t.app.inject({ method: "POST", url: "/api/bots", payload: { name: "x" }, headers: { host: HOST, origin: `https://${HOST}`, cookie } });
    expect(res.statusCode).toBe(403);
  });
});

describe("revoking and signing out", () => {
  it("the PC revokes a device and its cookie stops working at once", async () => {
    const { cookie } = await pairPhone("Lost phone");
    expect((await remote("GET", "/api/bots", { cookie })).status).toBe(200);
    const [dev] = (await local("GET", "/api/devices")).body.devices;
    expect((await local("DELETE", `/api/devices/${dev.id}`)).body.device.revokedAt).not.toBeNull();
    expect((await remote("GET", "/api/bots", { cookie })).status).toBe(401);
    expect((await local("GET", "/api/devices")).body.devices[0].revokedAt).not.toBeNull(); // stays in the list as history
  });

  it("a phone can sign itself out but cannot revoke or list other devices", async () => {
    const a = await pairPhone("A");
    const b = await pairPhone("B");
    const [devB] = (await local("GET", "/api/devices")).body.devices.filter((d: any) => d.name === "B");
    expect((await remote("DELETE", `/api/devices/${devB.id}`, { cookie: a.cookie })).status).toBe(403);
    expect((await remote("GET", "/api/devices", { cookie: a.cookie })).status).toBe(403);
    const out = await remote("POST", "/api/devices/signout", { cookie: a.cookie });
    expect(out.status).toBe(200);
    expect(String(out.headers["set-cookie"])).toContain("Max-Age=0");
    expect((await remote("GET", "/api/bots", { cookie: a.cookie })).status).toBe(401);
    expect((await remote("GET", "/api/bots", { cookie: b.cookie })).status).toBe(200);
  });

  it("a device unused for 90 days stops working; using it keeps it alive", async () => {
    const { cookie } = await pairPhone();
    t.clock.t += 60 * 86_400_000;
    expect((await remote("GET", "/api/bots", { cookie })).status).toBe(200);
    t.clock.t += 60 * 86_400_000; // 60 days since last use
    expect((await remote("GET", "/api/bots", { cookie })).status).toBe(200);
    t.clock.t += 91 * 86_400_000;
    expect((await remote("GET", "/api/bots", { cookie })).status).toBe(401);
  });

  it("the database itself refuses to delete a device, revive a revoked one, or change a secret", () => {
    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO devices (id, name, token_hash, created_at, created_ms, last_seen_ms) VALUES ('d1','x','h1','t',1,1)").run();
    expect(() => db.prepare("DELETE FROM devices WHERE id = 'd1'").run()).toThrow(/cannot be deleted/);
    expect(() => db.prepare("UPDATE devices SET token_hash = 'h2' WHERE id = 'd1'").run()).toThrow(/cannot be changed/);
    db.prepare("UPDATE devices SET revoked_at = 'now' WHERE id = 'd1'").run();
    expect(() => db.prepare("UPDATE devices SET revoked_at = NULL WHERE id = 'd1'").run()).toThrow(/cannot be revived/);
    db.close();
  });

  it("guessed or malformed cookies do nothing", async () => {
    for (const cookie of ["awp_device=", "awp_device=abc", `awp_device=${"A".repeat(43)}`, `awp_device=${"A".repeat(500)}`, "other=1"]) {
      expect((await remote("GET", "/api/bots", { cookie })).status).toBe(401);
    }
  });
});

describe("what a phone may do", () => {
  let cookie: string;
  beforeEach(async () => {
    cookie = (await pairPhone("Pixel")).cookie;
  });

  it("chat, tasks, bots and approvals work", async () => {
    const ref = await setupGeminiModel(t);
    const bot = (await remote("POST", "/api/bots", { cookie, body: { name: "Helper", model: ref } })).body.bot;
    expect((await remote("PATCH", `/api/bots/${bot.id}`, { cookie, body: { status: "active" } })).status).toBe(200); // switched on, as on its Details tab
    const chat = await remote("POST", `/api/bots/${bot.id}/chat`, { cookie, body: { message: "hello" } });
    expect(chat.status).toBe(200);
    expect(JSON.stringify(chat.body)).toContain(OK_RESULT.text);
    t.provider.script.push({ ...OK_RESULT, text: `${fence}action\n${JSON.stringify({ connector: "telegram", action: "send_message", args: { chat: "sam", text: "Hi Sam" } })}\n${fence}` }, OK_RESULT);
    expect((await remote("POST", `/api/bots/${bot.id}/tasks`, { cookie, body: { instruction: "Tell Sam hi" } })).status).toBeLessThan(300);
    await vi.waitFor(async () => expect((await remote("GET", "/api/approvals?status=pending", { cookie })).body.approvals).toHaveLength(1), { timeout: 3000, interval: 20 });
    expect(sent).toHaveLength(0);
    const [req] = (await remote("GET", "/api/approvals?status=pending", { cookie })).body.approvals;
    // ...and the PC sees the very same request
    expect((await local("GET", "/api/approvals?status=pending")).body.approvals[0].id).toBe(req.id);
    expect((await remote("POST", `/api/approvals/${req.id}/approve`, { cookie })).body.approval.status).toBe("executed");
    expect(sent).toEqual([{ chat: "sam", text: "Hi Sam" }]);
  });

  it("denying from the phone works too, and an item decided on one device cannot be decided again on the other", async () => {
    const ref = await setupGeminiModel(t);
    const bot = (await local("POST", "/api/bots", { name: "Helper", model: ref })).body.bot;
    await local("PATCH", `/api/bots/${bot.id}`, { status: "active" });
    t.provider.script.push({ ...OK_RESULT, text: `${fence}action\n${JSON.stringify({ connector: "telegram", action: "send_message", args: { chat: "sam", text: "x" } })}\n${fence}` }, OK_RESULT);
    await local("POST", `/api/bots/${bot.id}/tasks`, { instruction: "go" });
    await vi.waitFor(async () => expect((await local("GET", "/api/approvals?status=pending")).body.approvals).toHaveLength(1), { timeout: 3000, interval: 20 });
    const [req] = (await local("GET", "/api/approvals?status=pending")).body.approvals;
    expect((await remote("POST", `/api/approvals/${req.id}/deny`, { cookie, body: {} })).body.approval.status).toBe("denied");
    expect((await local("POST", `/api/approvals/${req.id}/approve`)).status).toBe(409);
    expect(sent).toHaveLength(0);
  });

  it.each([
    ["PUT", "/api/vault/GEMINI_API_KEY", { value: "AIzaSyFAKE0123456789012345678901234" }],
    ["DELETE", "/api/vault/GEMINI_API_KEY", undefined],
    ["POST", "/api/devices/pairing", undefined],
    ["POST", "/api/gmail/oauth/start", {}],
    ["POST", "/api/gmail/test-email", { botId: "00000000-0000-4000-8000-000000000000" }],
    ["POST", "/api/integrations/telegram/verify", undefined],
    ["PUT", "/api/business/external", { enabled: true }],
    ["POST", "/api/business/team", {}],
    ["PUT", "/api/business/leads/L-000000000000", { status: "won" }],
    ["PATCH", "/api/llm/providers/ollama", { enabled: true }],
    ["POST", "/api/llm/providers/ollama/refresh-models", undefined],
    ["PATCH", "/api/llm/models/1", { enabled: true }],
    ["PUT", "/api/llm/models/1/owner-verified", { verified: true, iUnderstand: true }],
    ["PUT", "/api/llm/limits", { botRequestsPerMinute: 99 }],
    ["POST", "/api/llm/limits/reset", undefined],
    ["PUT", "/api/delegation/limits", {}],
    ["PUT", "/api/automation/limits", {}],
    ["PUT", "/api/bots/00000000-0000-4000-8000-000000000000/permissions/gmail", { readEnabled: true }],
    ["PUT", "/api/bots/00000000-0000-4000-8000-000000000000/delegation", { targets: [] }],
  ] as const)("a phone cannot do the owner-only change %s %s", async (method, url, body) => {
    const r = await remote(method, url, { cookie, ...(body !== undefined ? { body } : {}) });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("owner_only");
  });

  it("a phone can pause things but only the PC can switch them back on", async () => {
    for (const url of ["/api/llm/pause", "/api/external/pause", "/api/automation/pause"]) {
      expect((await remote("PUT", url, { cookie, body: { paused: true } })).status, url).toBe(200);
      const back = await remote("PUT", url, { cookie, body: { paused: false } });
      expect(back.status, url).toBe(403);
      expect(back.body.error).toBe("owner_only");
      expect((await local("PUT", url, { paused: false })).status, url).toBe(200);
    }
  });

  it("every change made from the phone is written to the security log with the phone's name; reading is not", async () => {
    await remote("GET", "/api/bots", { cookie });
    await remote("POST", "/api/bots", { cookie, body: { name: "Logged" } });
    await remote("PUT", "/api/external/pause", { cookie, body: { paused: true } });
    const events = (await local("GET", "/api/audit?limit=200")).body.events as any[];
    const actions = events.filter((e) => e.kind === "remote.action");
    expect(actions.map((e) => e.detail.route).sort()).toEqual(["/api/bots", "/api/external/pause"]);
    expect(actions.every((e) => e.actor === "device:Pixel" && e.detail.device === "Pixel")).toBe(true);
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["device.pairing_started", "device.paired"]));
  });

  it("a request refused for being owner-only is not logged as an action", async () => {
    await remote("PUT", "/api/vault/GEMINI_API_KEY", { cookie, body: { value: "x" } });
    expect(((await local("GET", "/api/audit?limit=200")).body.events as any[]).some((e) => e.kind === "remote.action")).toBe(false);
  });
});

describe("decisions from a paired phone (D-063: intentional)", () => {
  it("a paired phone may choose, approve, reject and start decision work: these routes are not owner-only; an unpaired phone gets nothing", async () => {
    const { cookie } = await pairPhone("Pixel");
    const id = "00000000-0000-4000-8000-000000000001"; // no such decision: we only test the ACCESS rule, which runs before the lookup
    for (const [m, u, b] of [
      ["PUT", `/api/decisions/${id}/choice`, { optionId: null }],
      ["POST", `/api/decisions/${id}/approve`, {}],
      ["POST", `/api/decisions/${id}/reject`, {}],
      ["POST", `/api/decisions/${id}/assignments/some-bot/start`, undefined],
    ] as const) {
      const r = await remote(m, u, { cookie, ...(b !== undefined ? { body: b } : {}) });
      expect([m, u, r.status, r.body.error]).toEqual([m, u, 404, "decision_not_found"]); // got past the access rules
      const unpaired = await remote(m, u, { ...(b !== undefined ? { body: b } : {}) });
      expect(unpaired.status).toBe(401);
    }
    // what stays owner-only on a phone is unchanged
    expect((await remote("PUT", "/api/inbox/preferences", { cookie, body: { notify: "none" } })).body.error).toBe("owner_only");
    // recording what really happened with an approved request whose outcome was lost (D-125) is an owner act: a paired phone is refused, an unpaired one is not let in
    const reconcile = `/api/approvals/${id}/reconcile`;
    expect((await remote("POST", reconcile, { cookie, body: { outcome: "did_happen" } })).body.error).toBe("owner_only");
    expect((await remote("POST", reconcile, { body: { outcome: "did_happen" } })).status).toBe(401);
    // reading the list stays open
    expect((await remote("GET", "/api/approvals/uncertain", { cookie })).status).toBe(200);
  });
});

describe("serving the dashboard", () => {
  it("serves the page, its build files and the app manifest files with safe headers", async () => {
    const page = await remote("GET", "/approvals");
    expect(page.status).toBe(200);
    expect(page.raw.body).toContain("<title>dash</title>");
    expect(String(page.headers["content-security-policy"])).toContain("default-src 'self'");
    expect(page.headers["x-content-type-options"]).toBe("nosniff");
    const asset = await remote("GET", "/assets/app-abc.js");
    expect(asset.headers["content-type"]).toContain("text/javascript");
    expect(asset.headers["cache-control"]).toContain("immutable");
    expect((await remote("GET", "/sw.js")).headers["cache-control"]).toBe("no-cache");
  });

  it("never serves files outside the dashboard folder, and unknown files or API paths are 404 (not the page)", async () => {
    for (const url of ["/../awp-secret.txt", "/%2e%2e/awp-secret.txt", "/..%2fawp-secret.txt", "/assets/..%5c..%5cawp-secret.txt", "/%00", "/assets/missing.js", "/api/nothing"]) {
      const r = await remote("GET", url, { cookie: undefined });
      expect(r.status, url).toBeGreaterThanOrEqual(400);
      expect(String(r.raw.body)).not.toContain("TOP SECRET");
    }
    expect((await local("GET", "/api/nothing")).status).toBe(404);
  });

  it("the local PC gets the same pages", async () => {
    expect((await t.app.inject({ method: "GET", url: "/", headers: { host: "127.0.0.1:3000" } })).statusCode).toBe(200);
  });
});
