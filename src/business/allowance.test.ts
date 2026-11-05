import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OK_RESULT, switchOn } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import type { HttpResponse } from "./audit.js";
import type { TransportSpec } from "./netfetch.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// SIMULATED model, map and websites. Added after the second real run sent ONE map request more than the owner had approved:
// the owner's approved NUMBER of outside requests is now enforced by the platform itself, counted down as each request starts.
const fence = "```";
const act = (action: string, args: Record<string, unknown> = {}) => `${fence}action\n${JSON.stringify({ connector: "business", action, args })}\n${fence}`;
const reply = (text: string) => ({ ...OK_RESULT, text, inputTokens: 10, outputTokens: 5 });
const GOOD = (n: string) => `<!doctype html><html lang="en"><head><title>${n} in Dubai</title><meta name="description" content="${n}: friendly local service in Dubai with clear prices and opening hours."><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${"<p>We serve customers across Dubai. </p>".repeat(30)}© ${new Date().getFullYear()}</body></html>`;
const MAP = { elements: Array.from({ length: 5 }, (_, i) => ({ type: "node", id: i + 1, lat: 25.2, lon: 55.2, tags: { name: `Gym ${i + 1}`, leisure: "fitness_centre", website: `https://gym${i + 1}.example.ae`, phone: "+971 4 000 0000" } })) };

function fakeNet() {
  const calls = { post: 0, hosts: [] as string[] };
  return {
    calls,
    net: {
      post: async () => (calls.post++, { status: 200, text: JSON.stringify(MAP) }),
      lookup: async () => [{ address: "93.184.216.34", family: 4 }],
      sleep: async () => undefined,
      transport: async (spec: TransportSpec): Promise<HttpResponse> => {
        calls.hosts.push(spec.hostname);
        return { status: 200, headers: { "content-type": "text/html" }, body: Buffer.from(GOOD(spec.hostname)), ms: 100, tls: { authorized: true, validTo: "Jan  1 00:00:00 2028 GMT" } };
      },
    },
  };
}

describe("the approved NUMBER of outside requests is enforced by the platform", () => {
  let t: TestApp;
  let dir: string;
  let fx: ReturnType<typeof fakeNet>;
  let botId: string;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "bw-allow-"));
    fx = fakeNet();
    t = await createTestApp({ connectors: [], includeBusiness: true, businessDir: join(dir, "leads"), businessNet: fx.net });
    const ref = await setupGeminiModel(t);
    await t.call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000 });
    botId = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Scout", model: ref }))).body.bot.id;
    await t.call("PUT", `/api/bots/${botId}/permissions/browser`, { readEnabled: true });
  });
  afterEach(async () => {
    await t.app.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
  const ask = async (...blocks: string[]) => {
    const before = t.provider.calls.length;
    t.provider.script.push(reply(blocks.join("\n")), reply("done"));
    await t.call("POST", `/api/bots/${botId}/tasks`, { instruction: "Do it" });
    await vi.waitFor(async () => expect(((await t.call("GET", "/api/tasks")).body.tasks as any[]).every((x) => ["completed", "failed"].includes(x.status))).toBe(true), { timeout: 3000, interval: 10 });
    return JSON.stringify(t.provider.calls.slice(before).map((c) => c.messages));
  };
  const count = async (service: string) => ((await t.call("GET", "/api/audit?limit=300")).body.events as any[]).filter((e) => e.kind === "business.external_request" && e.detail?.service === service).length;

  it("a second map search is refused after the approved one, with the reason, and nothing is sent", async () => {
    await t.call("PUT", "/api/business/external", { enabled: true, allowance: { map: 1, website: 0 } });
    expect(await ask(act("find_businesses", { market: "AE", region: "Dubai", category: "fitness", limit: 5 }))).toMatch(/Batch B-/);
    expect(fx.calls.post).toBe(1);
    const second = await ask(act("find_businesses", { market: "AE", region: "Dubai", category: "food", limit: 5 }));
    expect(second).toMatch(/number of map requests the owner approved for this session is used up/);
    expect(fx.calls.post).toBe(1); // the platform stopped it BEFORE the request
    expect(await count("map")).toBe(1);
    expect((await t.call("GET", "/api/business/status")).body.usage.allowance).toEqual({ map: 0, website: 0 });
  });

  it("website checks stop at the approved number even when they run in parallel", async () => {
    await t.call("PUT", "/api/business/external", { enabled: true, allowance: { map: 1, website: 2 } });
    const found = await ask(act("find_businesses", { market: "AE", region: "Dubai", category: "fitness", limit: 5 }));
    const batch = /(B-[0-9a-f]{8})/.exec(found)![1]!;
    const out = await ask(act("audit_batch", { batchId: batch }));
    expect(fx.calls.hosts).toHaveLength(2); // five sites were queued; exactly two requests left this machine
    expect(await count("website")).toBe(2);
    expect(out).toMatch(/approved for this session is used up|stopped/i);
  });

  it("without an allowance only the daily limits apply, and the allowance can be raised by the owner only through the owner route", async () => {
    await t.call("PUT", "/api/business/external", { enabled: true });
    await ask(act("find_businesses", { market: "AE", region: "Dubai", category: "fitness", limit: 5 }));
    await ask(act("find_businesses", { market: "AE", region: "Dubai", category: "food", limit: 5 }));
    expect(fx.calls.post).toBe(2);
    await t.call("PUT", "/api/business/external", { enabled: true, allowance: { map: 1 } });
    await ask(act("find_businesses", { market: "AE", region: "Dubai", category: "beauty", limit: 5 }));
    expect(fx.calls.post).toBe(3);
    expect(((await t.call("GET", "/api/audit?limit=100")).body.events as any[]).some((e) => e.kind === "business.allowance_set")).toBe(true);
  });
});
