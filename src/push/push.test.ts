import { createPublicKey, verify } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OK_RESULT } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { PUSH_LIMITS, checkEndpoint, isPushServiceHost } from "./push.js";
import { switchOn } from "../llm/test-helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const fence = "```";
const HOST = "my-pc.tail1234.ts.net";
const connector = {
  id: "telegram" as const,
  label: "Telegram",
  actions: {
    send_message: {
      kind: "write" as const,
      description: "Send",
      args: z.strictObject({ chat: z.string().min(1), text: z.string().min(1) }),
      summarize: (a: Record<string, unknown>) => `Send "${a["text"]}" to ${a["chat"]}`,
      execute: async () => "sent",
    },
  },
};

/** A pretend push service on this PC that records what it receives. */
async function startPushService() {
  const received: { path: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
  const mode = { status: 201 };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received.push({ path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString() });
      res.writeHead(mode.status);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, received, mode, close: () => new Promise<void>((r) => server.close(() => r())) };
}

let t: TestApp;
let ps: Awaited<ReturnType<typeof startPushService>>;
let ref: string;
let botId: string;

beforeEach(async () => {
  ps = await startPushService();
  t = await createTestApp({ connectors: [connector as any], remoteHosts: [HOST], pushAllowHost: (h) => h === "127.0.0.1" });
  ref = await setupGeminiModel(t);
  botId = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Sender", model: ref }))).body.bot.id;
});
afterEach(async () => {
  await t.app.close();
  await ps.close();
  vi.unstubAllEnvs();
});

const subscribe = (path = "/p/1") => t.call("POST", "/api/push/subscribe", { endpoint: `${ps.base}${path}` });
/** The bot asks for an outside action, which waits for approval. */
const makeApproval = async () => {
  t.provider.script.push({ ...OK_RESULT, text: `${fence}action\n${JSON.stringify({ connector: "telegram", action: "send_message", args: { chat: "sam", text: "Hi" } })}\n${fence}` }, OK_RESULT);
  await t.call("POST", `/api/bots/${botId}/tasks`, { instruction: "Say hi" });
  await vi.waitFor(async () => expect(((await t.call("GET", "/api/tasks")).body.tasks as any[]).every((x) => ["completed", "failed"].includes(x.status))).toBe(true), { timeout: 3000, interval: 10 });
};
const jwtParts = (auth: string) => {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(auth)!;
  return { token: m[1]!, key: m[2]! };
};

describe("the signing key", () => {
  it("is made once, is a real P-256 public key, and the private half is only in the encrypted vault", async () => {
    const a = (await t.call("GET", "/api/push/key")).body.publicKey as string;
    const b = (await t.call("GET", "/api/push/key")).body.publicKey as string;
    expect(a).toBe(b);
    const raw = Buffer.from(a, "base64url");
    expect(raw).toHaveLength(65);
    expect(raw[0]).toBe(4);
    const vault = (await t.call("GET", "/api/vault")).body.secrets.find((s: any) => s.name === "PUSH_VAPID_PRIVATE_KEY");
    expect(vault).toMatchObject({ inVault: true });
    expect(JSON.stringify((await t.call("GET", "/api/vault")).body)).not.toContain("MIGHAgEA"); // the start of every stored private key
    expect(JSON.stringify((await t.call("GET", "/api/audit?limit=200")).body)).not.toContain("MIGHAgEA");
  });
});

describe("which addresses may be registered", () => {
  it("the real allow-list accepts the big push services and nothing else", () => {
    for (const h of ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "wns2-par02p.notify.windows.com"]) expect(isPushServiceHost(h), h).toBe(true);
    for (const h of ["fcm.googleapis.com.evil.com", "evil.com", "googleapis.com", "localhost", "127.0.0.1", "169.254.169.254", "notify.windows.com.evil.io", "evilfcm.googleapis.com.example"]) expect(isPushServiceHost(h), h).toBe(false);
  });

  it("refuses anything that is not https on a push service (with the real list)", () => {
    expect(() => checkEndpoint("https://fcm.googleapis.com/fcm/send/abc")).not.toThrow();
    for (const e of ["http://fcm.googleapis.com/x", "https://evil.example.com/x", "https://user:pw@fcm.googleapis.com/x", "file:///etc/passwd", "not a url", "https://127.0.0.1/x", "http://127.0.0.1:3000/api/vault"]) {
      expect(() => checkEndpoint(e), e).toThrow();
    }
  });

  it("the running app refuses other hosts too (the test hook only opens this PC's pretend service)", async () => {
    for (const endpoint of ["https://evil.example.com/x", "http://169.254.169.254/latest", `${ps.base.replace("127.0.0.1", "localhost")}/x`]) {
      expect((await t.call("POST", "/api/push/subscribe", { endpoint })).status, endpoint).toBe(400);
    }
    expect((await subscribe()).status).toBe(200);
  });

  it("a real app (no test hook) refuses a pretend local service", async () => {
    const real = await createTestApp();
    expect((await real.call("POST", "/api/push/subscribe", { endpoint: `${ps.base}/x` })).status).toBe(400);
    await real.app.close();
  });
});

describe("alerts", () => {
  it("one new waiting approval sends one content-free, correctly signed wake-up", async () => {
    await subscribe();
    await makeApproval();
    expect(await t.app.push.tick()).toBe(1);
    expect(ps.received).toHaveLength(1);
    const r = ps.received[0]!;
    expect(r.path).toBe("/p/1");
    expect(r.body).toBe(""); // no content at all
    expect(r.headers["content-length"]).toBe("0");
    expect(r.headers["ttl"]).toBe(String(PUSH_LIMITS.ttlSeconds));
    const { token, key } = jwtParts(String(r.headers["authorization"]));
    expect(key).toBe((await t.call("GET", "/api/push/key")).body.publicKey);
    const [h, c, s] = token.split(".");
    const claims = JSON.parse(Buffer.from(c!, "base64url").toString());
    expect(claims.aud).toBe(ps.base);
    expect(claims.exp * 1000).toBeGreaterThan(t.clock.t);
    expect(claims.exp * 1000).toBeLessThanOrEqual(t.clock.t + 13 * 3600_000);
    const raw = Buffer.from(key, "base64url");
    const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(s!, "base64url"))).toBe(true);
  });

  it("never sends the same approval twice, and never when nothing is waiting or nobody registered", async () => {
    await makeApproval();
    expect(await t.app.push.tick()).toBe(0); // nobody registered yet
    await subscribe();
    expect(await t.app.push.tick()).toBe(0); // that approval was already there before anyone registered
    expect(ps.received).toHaveLength(0);
    t.clock.t += 2 * 60_000;
    await makeApproval();
    expect(await t.app.push.tick()).toBe(1);
    expect(await t.app.push.tick()).toBe(0);
    t.clock.t += 5 * 60_000;
    expect(await t.app.push.tick()).toBe(0);
    expect(ps.received).toHaveLength(1);
  });

  it("at most one alert a minute: a second new approval waits for a later tick", async () => {
    await subscribe();
    await makeApproval();
    await t.app.push.tick();
    t.clock.t += 5_000;
    await makeApproval();
    expect(await t.app.push.tick()).toBe(0);
    expect(ps.received).toHaveLength(1);
    t.clock.t += PUSH_LIMITS.minGapMs;
    expect(await t.app.push.tick()).toBe(1);
    expect(ps.received).toHaveLength(2);
  });

  it("after the approvals are decided there is nothing to alert about", async () => {
    await subscribe();
    await makeApproval();
    const [req] = (await t.call("GET", "/api/approvals?status=pending")).body.approvals;
    await t.call("POST", `/api/approvals/${req.id}/deny`, {});
    expect(await t.app.push.tick()).toBe(0);
    expect(ps.received).toHaveLength(0);
  });

  it("a registration that the push service says is gone (410) is forgotten", async () => {
    await subscribe();
    ps.mode.status = 410;
    await makeApproval();
    await t.app.push.tick();
    expect(t.app.push.count()).toBe(0);
  });

  it("a push service that is down never breaks anything", async () => {
    await subscribe();
    await ps.close();
    await makeApproval();
    expect(await t.app.push.tick()).toBe(0);
    expect(JSON.stringify((await t.call("GET", "/api/audit?limit=100")).body)).toContain("push.failed");
    ps.close = async () => undefined;
  });

  it("does not follow redirects to anywhere else", async () => {
    await subscribe();
    ps.mode.status = 302;
    await makeApproval();
    expect(await t.app.push.tick()).toBe(0);
    expect(ps.received).toHaveLength(1);
  });

  it("the security log records alerts without any address or key", async () => {
    await subscribe("/p/SECRETPATH");
    await makeApproval();
    await t.app.push.tick();
    const log = JSON.stringify((await t.call("GET", "/api/audit?limit=200")).body);
    expect(log).toContain("push.sent");
    expect(log).not.toContain("SECRETPATH");
  });
});

describe("phones", () => {
  const phone = async () => {
    const { body } = await t.call("POST", "/api/devices/pairing");
    const h = { host: HOST, origin: `https://${HOST}`, "x-awp-client": "dashboard" };
    const paired = await t.app.inject({ method: "POST", url: "/api/devices/pair", payload: { code: body.code, name: "Pixel" }, headers: h });
    const cookie = String(paired.headers["set-cookie"]).split(";")[0]!;
    return { headers: { ...h, cookie }, id: paired.json().device.id as string };
  };

  it("a paired phone can switch alerts on and off for itself", async () => {
    const p = await phone();
    const on = await t.app.inject({ method: "POST", url: "/api/push/subscribe", payload: { endpoint: `${ps.base}/phone` }, headers: p.headers });
    expect(on.statusCode).toBe(200);
    expect(t.app.push.count()).toBe(1);
    await makeApproval();
    expect(await t.app.push.tick()).toBe(1);
    const off = await t.app.inject({ method: "POST", url: "/api/push/unsubscribe", payload: { endpoint: `${ps.base}/phone` }, headers: p.headers });
    expect(off.statusCode).toBe(200);
    expect(t.app.push.count()).toBe(0);
  });

  it("an unpaired phone cannot register anything", async () => {
    const res = await t.app.inject({ method: "POST", url: "/api/push/subscribe", payload: { endpoint: `${ps.base}/x` }, headers: { host: HOST, origin: `https://${HOST}`, "x-awp-client": "dashboard" } });
    expect(res.statusCode).toBe(401);
  });

  it("a revoked phone gets no more alerts", async () => {
    const p = await phone();
    await t.app.inject({ method: "POST", url: "/api/push/subscribe", payload: { endpoint: `${ps.base}/phone` }, headers: p.headers });
    await t.call("DELETE", `/api/devices/${p.id}`);
    await makeApproval();
    expect(await t.app.push.tick()).toBe(0);
    expect(ps.received).toHaveLength(0);
  });

  it("too many registrations are refused", async () => {
    for (let i = 0; i < 20; i++) expect((await subscribe(`/p/${i}`)).status).toBe(200);
    expect((await subscribe("/p/overflow")).status).toBe(409);
  });
});
