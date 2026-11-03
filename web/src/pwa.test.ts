// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */
const pub = (f: string) => join(__dirname, "..", "public", f);

describe("installable app (PWA)", () => {
  const manifest = JSON.parse(readFileSync(pub("manifest.webmanifest"), "utf8"));

  it("has what Android and desktop browsers need to offer 'Install app'", () => {
    expect(manifest).toMatchObject({ display: "standalone", start_url: "/", scope: "/" });
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    const sizes = manifest.icons.map((i: any) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
  });

  it("every icon file exists and is a real PNG of the stated size", () => {
    for (const icon of manifest.icons) {
      const bytes = readFileSync(pub(icon.src.replace(/^\//, "")));
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      const [w] = String(icon.sizes).split("x").map(Number);
      expect(bytes.readUInt32BE(16)).toBe(w);
      expect(bytes.readUInt32BE(20)).toBe(w);
    }
  });

  it("the page links the manifest", () => {
    const html = readFileSync(join(__dirname, "..", "index.html"), "utf8");
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('name="theme-color"');
  });
});

describe("the service worker", () => {
  /** Runs sw.js in a bare sandbox and lets us fire a fetch event at it. */
  function load() {
    const listeners: Record<string, (e: any) => void> = {};
    const cached = new Map<string, unknown>();
    const self = {
      location: { origin: "http://127.0.0.1:5173" },
      addEventListener: (type: string, fn: (e: any) => void) => (listeners[type] = fn),
      skipWaiting: () => Promise.resolve(),
      clients: { claim: () => Promise.resolve() },
    };
    const caches = {
      open: async () => ({ add: async () => undefined, put: async (r: any, v: unknown) => void cached.set(r.url, v) }),
      match: async (r: any) => cached.get(typeof r === "string" ? r : r.url),
      keys: async () => [],
      delete: async () => true,
    };
    vm.runInNewContext(readFileSync(pub("sw.js"), "utf8"), { self, caches, URL, fetch: async () => ({ ok: true, clone: () => ({}) }) });
    const fire = (url: string, over: Record<string, unknown> = {}) => {
      let responded = false;
      listeners["fetch"]!({ request: { method: "GET", url, mode: "cors", ...over }, respondWith: () => (responded = true) });
      return responded;
    };
    return { fire, cached };
  }

  it("never intercepts or stores anything under /api/ (bot data, approvals, secrets)", () => {
    const { fire, cached } = load();
    expect(fire("http://127.0.0.1:5173/api/vault")).toBe(false);
    expect(fire("http://127.0.0.1:5173/api/approvals?status=pending")).toBe(false);
    expect(fire("http://127.0.0.1:5173/api/bots", { method: "POST" })).toBe(false);
    expect(cached.size).toBe(0);
  });

  it("ignores other websites and anything that changes data", () => {
    const { fire } = load();
    expect(fire("https://example.com/assets/x.js")).toBe(false);
    expect(fire("http://127.0.0.1:5173/assets/x.js", { method: "POST" })).toBe(false);
  });

  it("serves the page shell and its fingerprinted build files", () => {
    const { fire } = load();
    expect(fire("http://127.0.0.1:5173/approvals", { mode: "navigate" })).toBe(true);
    expect(fire("http://127.0.0.1:5173/assets/index-abc123.js")).toBe(true);
    expect(fire("http://127.0.0.1:5173/random.txt")).toBe(false);
  });
});
