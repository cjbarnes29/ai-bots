import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestApp, type TestApp } from "../test-app.js";
import { DISCOVERY_LIMITS, DiscoveryClient, OVERPASS_ENDPOINTS, overpassGetStatus, overpassPost, reachReason } from "./discovery.js";
import { getMarket, resolveCategories, resolveRegion } from "./markets.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// P-37. FAKES ONLY: no request leaves this machine (fetch is replaced by a spy that fails the test if it is ever called).
const MAP = { elements: [{ type: "node", id: 1, lat: 25.2, lon: 55.2, tags: { name: "Gym One", leisure: "fitness_centre" } }] };
const search = () => {
  const ae = getMarket("AE");
  return { market: ae, region: resolveRegion(ae, "Dubai"), categories: resolveCategories("fitness"), limit: 5 };
};
const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(async () => {
    throw new Error("NO REAL NETWORK in these tests");
  });
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe("the fixed list of map services", () => {
  it("has the default service and the proposed mirror, nothing else; neither is marked verified", () => {
    expect(Object.keys(OVERPASS_ENDPOINTS)).toEqual(["main", "kumi"]);
    expect(OVERPASS_ENDPOINTS.main.interpreter).toBe("https://overpass-api.de/api/interpreter");
    expect(OVERPASS_ENDPOINTS.kumi.interpreter).toBe("https://overpass.kumi.systems/api/interpreter");
    expect(OVERPASS_ENDPOINTS.kumi.status).toBe("https://overpass.kumi.systems/api/status");
    expect(Object.values(OVERPASS_ENDPOINTS).every((e) => e.verified === false)).toBe(true);
  });

  it("the real request functions refuse any address that is not on the list, before any network use", async () => {
    await expect(overpassPost("https://evil.example.com/api/interpreter", "data=x")).rejects.toThrow(/Only the map service address/);
    await expect(overpassPost(OVERPASS_ENDPOINTS.kumi.status, "data=x")).rejects.toThrow(/Only the map service address/); // a status URL is not a search URL
    await expect(overpassGetStatus("https://overpass.kumi.systems.evil.test/api/status")).rejects.toThrow(/status address/);
    await expect(overpassGetStatus(OVERPASS_ENDPOINTS.main.interpreter)).rejects.toThrow(/status address/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("timeouts and network failures are named from a fixed vocabulary, with the right time limit", () => {
    expect(reachReason(timeout(), 15_000)).toBe("no answer within 15 seconds");
    expect(reachReason(timeout(), 40_000)).toBe("no answer within 40 seconds");
    expect(reachReason(Object.assign(new Error("x"), { cause: { code: "ENOTFOUND" } }), 1)).toBe("the address could not be looked up (DNS)");
    expect(reachReason(new Error("getaddrinfo secret-detail"), 1)).toBe("");
  });
});

describe("the discovery client uses the chosen service, records its health, and never switches by itself", () => {
  const client = (over: Partial<ConstructorParameters<typeof DiscoveryClient>[0]> = {}) => {
    const calls = { post: [] as string[], get: [] as string[], hosts: [] as string[] };
    let used = 0;
    let clock = 1_000_000;
    const c = new DiscoveryClient({
      post: async (url) => (calls.post.push(url), { status: 200, text: JSON.stringify(MAP) }),
      get: async (url) => (calls.get.push(url), { status: 200, text: "Connected as: 123\nCurrent time: 2026-11-05\n2 slots available now.\n" }),
      allowed: () => true,
      now: () => (clock += 100),
      sleep: async () => undefined,
      usedToday: () => used,
      onRequest: (h) => (calls.hosts.push(h), used++),
      ...over,
    });
    return { c, calls };
  };

  it("searches go to the chosen service only; the cache is kept per service", async () => {
    let ep: (typeof OVERPASS_ENDPOINTS)[keyof typeof OVERPASS_ENDPOINTS] = OVERPASS_ENDPOINTS.main;
    const { c, calls } = client({ endpoint: () => ep });
    await c.find(search());
    ep = OVERPASS_ENDPOINTS.kumi;
    const second = await c.find(search()); // same question, other service: not answered from the first service's cache
    expect(second.fromCache).toBe(false);
    expect(calls.post).toEqual([OVERPASS_ENDPOINTS.main.interpreter, OVERPASS_ENDPOINTS.kumi.interpreter]);
    expect(calls.hosts).toEqual(["overpass-api.de", "overpass.kumi.systems"]);
  });

  it("a failed search on the chosen service is NOT retried on the other one; health records the failure and the reason", async () => {
    const { c, calls } = client({ endpoint: () => OVERPASS_ENDPOINTS.main, post: async (url) => { calls.post.push(url); throw timeout(); } });
    await expect(c.find(search())).rejects.toThrow("Could not reach the map service (no answer within 40 seconds)");
    expect(calls.post).toEqual([OVERPASS_ENDPOINTS.main.interpreter]); // exactly one request, no automatic fallback
    expect(c.health()).toEqual([expect.objectContaining({ endpoint: "main", kind: "search", ok: false, httpStatus: null, reason: "no answer within 40 seconds" })]);
  });

  it("a status check is ONE request to the chosen status page, counts like a map request, and records what came back", async () => {
    const { c, calls } = client({ endpoint: () => OVERPASS_ENDPOINTS.kumi });
    const h = await c.statusCheck();
    expect(calls.get).toEqual([OVERPASS_ENDPOINTS.kumi.status]);
    expect(calls.hosts).toEqual(["overpass.kumi.systems"]);
    expect(h).toMatchObject({ endpoint: "kumi", kind: "status", ok: true, httpStatus: 200, reason: "" });
    expect(h.detail).toBe("Connected as: 123 | Current time: 2026-11-05 | 2 slots available now.");
  });

  it("a status check that times out is recorded (15-second limit), not retried, and does not throw", async () => {
    const { c, calls } = client({ endpoint: () => OVERPASS_ENDPOINTS.kumi, get: async (url) => { calls.get.push(url); throw timeout(); } });
    const h = await c.statusCheck();
    expect(calls.get).toHaveLength(1);
    expect(h).toMatchObject({ ok: false, httpStatus: null, reason: "no answer within 15 seconds" });
  });

  it("a status check obeys the switch and the daily limit before sending anything", async () => {
    const off = client({ allowed: () => false });
    await expect(off.c.statusCheck()).rejects.toThrow(/switched off/);
    const full = client({ usedToday: () => DISCOVERY_LIMITS.maxQueriesPerDay });
    await expect(full.c.statusCheck()).rejects.toThrow(/daily limit/);
    expect(off.calls.get.length + full.calls.get.length).toBe(0);
  });

  it("a status answer is cleaned of control characters and capped", async () => {
    const { c } = client({ get: async () => ({ status: 503, text: "\u0007bad\u0000\n".repeat(200) }) });
    const h = await c.statusCheck();
    expect(h).toMatchObject({ ok: false, httpStatus: 503, reason: "status 503" });
    expect(h.detail.length).toBeLessThanOrEqual(400);
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u0008]/.test(h.detail)).toBe(false);
  });
});

describe("through the app: the owner chooses; allowance and switch apply; no automatic switching", () => {
  let t: TestApp;
  let dir: string;
  let gets: string[];
  let posts: string[];
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "bw-map-"));
    gets = [];
    posts = [];
    t = await createTestApp({
      connectors: [],
      includeBusiness: true,
      businessDir: join(dir, "leads"),
      businessNet: {
        post: async (url: string) => (posts.push(url), { status: 200, text: JSON.stringify(MAP) }),
        get: async (url: string) => (gets.push(url), { status: 200, text: "Connected as: 1\n" }),
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        sleep: async () => undefined,
      } as any,
    });
  });
  afterEach(async () => {
    await t.app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the default stays the main service until the owner chooses another; an unknown name is refused; the choice is audited", async () => {
    expect((await t.call("GET", "/api/business/map")).body).toMatchObject({ selected: "main", health: [] });
    expect((await t.call("PUT", "/api/business/map", { endpoint: "https://evil.example.com" })).status).toBe(400);
    expect((await t.call("PUT", "/api/business/map", { endpoint: "kumi" })).body.selected).toBe("kumi");
    expect(((await t.call("GET", "/api/audit?limit=50")).body.events as any[]).some((e) => e.kind === "business.map_endpoint_selected" && e.detail.endpoint === "kumi")).toBe(true);
    expect(gets).toHaveLength(0); // choosing sends nothing
  });

  it("the status check needs the switch ON and an allowance left, sends exactly ONE request to the chosen service, and then the allowance is used up", async () => {
    await t.call("PUT", "/api/business/map", { endpoint: "kumi" });
    expect((await t.call("POST", "/api/business/map/status-check")).body.message).toMatch(/switched off/);
    await t.call("PUT", "/api/business/external", { enabled: true, allowance: { map: 1, website: 0 } });
    const r = await t.call("POST", "/api/business/map/status-check");
    expect(r.status).toBe(200);
    expect(r.body.health).toMatchObject({ endpoint: "kumi", ok: true, httpStatus: 200 });
    expect(gets).toEqual([OVERPASS_ENDPOINTS.kumi.status]);
    const again = await t.call("POST", "/api/business/map/status-check");
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/approved for this session is used up/);
    expect(gets).toHaveLength(1);
    expect(posts).toHaveLength(0); // no search was made
    expect((await t.call("GET", "/api/business/map")).body.health).toEqual([expect.objectContaining({ endpoint: "kumi", kind: "status", ok: true })]);
  });

  it("choosing the mirror is owner-only on a phone", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("../remote/access.ts", import.meta.url), "utf8");
    expect(src).toMatch(/\/\^\\\/api\\\/business\\\/map\//);
  });
});
