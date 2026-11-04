import http from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../test-app.js";
import { createGithubConnector, createNotionConnector } from "./integrations.js";
import { createTelegramConnector } from "./telegram.js";
import type { ConnectorDefinition } from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const TOKEN = "fake-token-SECRETVALUE-0123456789";

/** A pretend service: counts how often it was really asked, and can be told how to answer. */
function fakeService(id: ConnectorDefinition["id"], mode: { verify?: "ok" | "leak" | "slow" | "none" }) {
  const calls = { verify: 0 };
  const def: ConnectorDefinition = {
    id,
    label: `Fake ${id}`,
    secrets: [{ name: `${String(id).toUpperCase()}_FAKE_TOKEN`, description: "a pretend token" }],
    notReady: (ctx) => (ctx.secret(`${String(id).toUpperCase()}_FAKE_TOKEN`) ? null : "paste the pretend token first."),
    ...(mode.verify === "none"
      ? {}
      : {
          verify: async (ctx: { secret(n: string): string | null }) => {
            calls.verify++;
            if (mode.verify === "leak") throw new Error(`The service rejected the token ${ctx.secret(`${String(id).toUpperCase()}_FAKE_TOKEN`)} (status 401)`);
            return { ok: true as const, summary: "Pretend account answered", account: "me" };
          },
        }),
    actions: {
      look: { kind: "read", description: "Look", args: z.strictObject({}), summarize: () => "Look", execute: async () => "seen" },
      change: { kind: "write", description: "Change", args: z.strictObject({}), summarize: () => "Change", execute: async () => "changed" },
    },
  };
  return { def, calls };
}

let t: TestApp;
afterEach(async () => {
  await t?.app.close();
});

const save = (id: string) => t.call("PUT", `/api/vault/${id.toUpperCase()}_FAKE_TOKEN`, { value: TOKEN });
const entry = async (id: string) => ((await t.call("GET", "/api/integrations")).body.integrations as any[]).find((e) => e.id === id);

describe("Integrations catalog and Test connection", () => {
  it("lists each service with what it can do, and never returns a secret value", async () => {
    const gh = fakeService("github", { verify: "ok" });
    t = await createTestApp({ connectors: [gh.def] });
    const res = await t.call("GET", "/api/integrations");
    expect(res.status).toBe(200);
    const e = await entry("github");
    expect(e).toMatchObject({ label: "Fake github", status: "not_set_up", testable: true, lastCheckAt: null, lastUsedAt: null });
    expect(e.notReady).toMatch(/paste the pretend token/);
    expect(e.actions.map((a: any) => `${a.name}:${a.kind}`).sort()).toEqual(["change:write", "look:read"]);
    expect(e.secrets).toEqual([{ name: "GITHUB_FAKE_TOKEN", description: "a pretend token", saved: false }]);
    await save("github");
    expect((await entry("github")).secrets[0].saved).toBe(true);
    expect(JSON.stringify((await t.call("GET", "/api/integrations")).body)).not.toContain(TOKEN);
  });

  it("saved credentials alone are 'ready', never 'verified': only a successful check says verified", async () => {
    const gh = fakeService("github", { verify: "ok" });
    t = await createTestApp({ connectors: [gh.def] });
    await save("github");
    expect((await entry("github")).status).toBe("ready");
    expect(gh.calls.verify).toBe(0);
    const res = await t.call("POST", "/api/integrations/github/verify");
    expect(res.body).toMatchObject({ result: "verified", summary: "Pretend account answered", account: "me" });
    const e = await entry("github");
    expect(e).toMatchObject({ status: "verified", lastCheckOk: true, lastCheckText: "Pretend account answered" });
    expect(e.lastCheckAt).toEqual(expect.any(String));
    const kinds = ((await t.call("GET", "/api/audit?limit=50")).body.events as any[]).map((x) => x.kind);
    expect(kinds).toContain("integration.verified");
  });

  it("a service that is not set up is not called at all; the reason is plain", async () => {
    const gh = fakeService("github", { verify: "ok" });
    t = await createTestApp({ connectors: [gh.def] });
    const res = await t.call("POST", "/api/integrations/github/verify");
    expect(res.body).toMatchObject({ result: "failed", reason: "not_configured" });
    expect(res.body.message).toMatch(/Not set up yet: paste the pretend token/);
    expect(gh.calls.verify).toBe(0);
    expect((await entry("github")).status).toBe("not_set_up");
  });

  it("a failed check is shown as failed, with the secret removed from the answer and from the log", async () => {
    const gh = fakeService("github", { verify: "leak" });
    t = await createTestApp({ connectors: [gh.def] });
    await save("github");
    const res = await t.call("POST", "/api/integrations/github/verify");
    expect(res.body.result).toBe("failed");
    expect(res.body.message).toContain("[redacted]");
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
    expect(JSON.stringify((await t.call("GET", "/api/audit?limit=100")).body)).not.toContain(TOKEN);
    expect(await entry("github")).toMatchObject({ status: "failed", lastCheckOk: false });
  });

  it("a service with no safe check says 'not testable' and stays 'ready': it is never claimed to be verified", async () => {
    const n8n = fakeService("n8n", { verify: "none" });
    t = await createTestApp({ connectors: [n8n.def] });
    await save("n8n");
    const res = await t.call("POST", "/api/integrations/n8n/verify");
    expect(res.body.result).toBe("not_testable");
    expect(await entry("n8n")).toMatchObject({ status: "ready", testable: false, lastCheckAt: null });
  });

  it("the outside-actions pause switch also stops connection tests; an unknown service is a clear 404", async () => {
    const gh = fakeService("github", { verify: "ok" });
    t = await createTestApp({ connectors: [gh.def] });
    await save("github");
    await t.call("PUT", "/api/external/pause", { paused: true });
    const res = await t.call("POST", "/api/integrations/github/verify");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("external_paused");
    expect(gh.calls.verify).toBe(0);
    expect((await t.call("POST", "/api/integrations/nope/verify")).status).toBe(404);
  });

  it("shows which agents may use a service, from the same permission rule the approval gate uses", async () => {
    const gh = fakeService("github", { verify: "ok" });
    t = await createTestApp({ connectors: [gh.def] });
    const a = (await t.call("POST", "/api/bots", { name: "Alpha" })).body.bot;
    await t.call("POST", "/api/bots", { name: "Beta" });
    expect((await entry("github")).agents).toEqual([]);
    await t.call("PUT", `/api/bots/${a.id}/integrations`, { connectors: ["github"] });
    expect((await entry("github")).agents).toEqual([{ id: a.id, name: "Alpha" }]);
  });

  it("the PC, documents and memory services are controlled elsewhere, so no per-agent list is claimed", async () => {
    t = await createTestApp({ connectors: [], includeMemory: true });
    expect((await entry("memory")).agents).toBeNull();
    const res = await t.call("POST", "/api/integrations/memory/verify");
    expect(res.body.result).toBe("verified");
    expect(res.body.summary).toMatch(/Nothing to sign in to/);
  });
});

/** The real verify() of each connector, against a pretend internet on this PC. */
describe("each connector's own check", () => {
  async function server(handler: (url: string, headers: http.IncomingHttpHeaders) => [number, unknown]) {
    const seen: { url: string; auth?: string }[] = [];
    const s = http.createServer((req, res) => {
      seen.push({ url: req.url ?? "", ...(req.headers.authorization ? { auth: req.headers.authorization } : {}) });
      const [status, body] = handler(req.url ?? "", req.headers);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    return { base: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, seen, close: () => new Promise<void>((r) => s.close(() => r())) };
  }

  it("GitHub asks for the signed-in user, and a rejected token is said plainly", async () => {
    const s = await server((url) => (url === "/user" ? [200, { login: "octo" }] : [404, {}]));
    const c = createGithubConnector(s.base);
    expect(await c.verify!({ secret: () => "github_pat_x" })).toMatchObject({ ok: true, summary: "GitHub accepted the token for octo", account: "octo" });
    expect(s.seen[0]).toEqual({ url: "/user", auth: "Bearer github_pat_x" });
    await s.close();
    const bad = await server(() => [401, { message: "Bad credentials" }]);
    await expect(createGithubConnector(bad.base).verify!({ secret: () => "github_pat_x" })).rejects.toThrow();
    await bad.close();
  });

  it("Notion asks who the integration is", async () => {
    const s = await server((url) => (url === "/users/me" ? [200, { name: "Workforce" }] : [404, {}]));
    expect(await createNotionConnector(s.base).verify!({ secret: () => "ntn_x" })).toMatchObject({ ok: true, summary: "Notion accepted the secret for Workforce" });
    await s.close();
  });

  it("Telegram asks getMe and never puts the token in a failure message", async () => {
    const s = await server((url) => (url.endsWith("/getMe") ? [200, { ok: true, result: { username: "workforce_bot" } }] : [404, {}]));
    const token = "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ-0123456";
    expect(await createTelegramConnector(s.base).verify!({ secret: () => token })).toMatchObject({ ok: true, account: "workforce_bot" });
    await s.close();
    const bad = await server(() => [401, { ok: false, description: "Unauthorized" }]);
    const err = await createTelegramConnector(bad.base).verify!({ secret: () => token }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(token);
    await bad.close();
  });
});
