import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { INBOUND_LIMITS, parseItems } from "./service.js";
import { switchOn } from "../llm/test-helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** A pretend Telegram whose "recent messages" the test controls, and which counts how often it was read. */
function fakeTelegram(feed: { text: string; reads: number; fail: string | null }) {
  return {
    id: "telegram" as const,
    label: "Telegram",
    actions: {
      read_messages: {
        kind: "read" as const,
        description: "Read",
        args: z.strictObject({}),
        summarize: () => "Read recent Telegram messages",
        execute: async () => {
          feed.reads++;
          if (feed.fail) throw new Error(feed.fail);
          return feed.text;
        },
      },
      send_message: {
        kind: "write" as const,
        description: "Send",
        args: z.strictObject({ chat: z.string(), text: z.string() }),
        summarize: () => "Send",
        execute: async () => "sent",
      },
    },
  };
}

let t: TestApp;
let feed: { text: string; reads: number; fail: string | null };
let botId: string;
const MIN = 60_000;

beforeEach(async () => {
  feed = { text: "No recent messages.", reads: 0, fail: null };
  t = await createTestApp({ connectors: [fakeTelegram(feed) as any] });
  const ref = await setupGeminiModel(t);
  botId = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Reader", model: ref }))).body.bot.id;
});
afterEach(async () => {
  await t.app.close();
  vi.unstubAllEnvs();
});

const allowRead = () => t.call("PUT", `/api/bots/${botId}/permissions/telegram`, { readEnabled: true });
const create = (extra: Record<string, unknown> = {}) => t.call("POST", "/api/inbound", { connector: "telegram", botId, ...extra });
const sources = async () => (await t.call("GET", "/api/inbound")).body.sources as any[];
const enable = (id: string) => t.call("PATCH", `/api/inbound/${id}`, { enabled: true });
const makeTrigger = async () => {
  const trig = (await t.call("POST", "/api/triggers", { name: "On message", source: "event", eventName: "telegram_message", botId, cooldownSeconds: 30 })).body.trigger;
  await t.call("PATCH", `/api/triggers/${trig.id}`, { enabled: true });
  return trig;
};
const tasks = async () => (await t.call("GET", "/api/tasks")).body.tasks as any[];
const settle = () => vi.waitFor(async () => expect((await tasks()).every((x) => ["completed", "failed", "cancelled"].includes(x.status))).toBe(true), { timeout: 3000, interval: 10 });
const poll = async (minutes = 60) => {
  t.clock.t += minutes * MIN;
  return t.app.inbound.tick();
};

describe("setting a source up", () => {
  it("starts OFF, with safe defaults, and one source per bot and connector", async () => {
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body.source).toMatchObject({ connector: "telegram", enabled: false, eventName: "telegram_message", intervalMinutes: 60, botName: "Reader" });
    expect((await create()).status).toBe(409);
  });

  it("refuses to be switched on until the bot is allowed to read that connector", async () => {
    const { id } = (await create()).body.source;
    const res = await enable(id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("read_not_allowed");
    expect((await sources())[0].enabled).toBe(false);
    await allowRead();
    expect((await enable(id)).body.source.enabled).toBe(true);
  });

  it("will not check more often than every 30 minutes, nor accept odd names or connectors", async () => {
    expect((await create({ intervalMinutes: 29 })).status).toBe(400);
    expect((await create({ intervalMinutes: 5 })).status).toBe(400);
    expect((await create({ eventName: "bad name!" })).status).toBe(400);
    expect((await create({ connector: "browser" })).status).toBe(400);
    expect((await t.call("POST", "/api/inbound", { connector: "telegram", botId, secret: "x" })).status).toBe(400);
    expect((await create({ intervalMinutes: 30 })).status).toBe(201);
  });

  it("allows at most five sources", async () => {
    for (let i = 0; i < INBOUND_LIMITS.maxSources; i++) {
      const b = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: `B${i}` }))).body.bot.id;
      expect((await t.call("POST", "/api/inbound", { connector: "telegram", botId: b })).status).toBe(201);
    }
    const extra = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Extra" }))).body.bot.id;
    expect((await t.call("POST", "/api/inbound", { connector: "telegram", botId: extra })).status).toBe(409);
  });

  it("nothing is checked while a source is off", async () => {
    await create();
    await poll();
    expect(feed.reads).toBe(0);
  });
});

describe("checking for messages", () => {
  beforeEach(async () => {
    await allowRead();
  });
  const start = async () => {
    const { id } = (await create()).body.source;
    await enable(id);
    return id as string;
  };

  it("the first check only learns what is already there: old messages never become events", async () => {
    await makeTrigger();
    feed.text = "[chat 1] sam: old message\n[chat 1] ann: older message";
    await start();
    expect(await poll()).toBe(0);
    await settle();
    expect(await tasks()).toHaveLength(0);
    expect(feed.reads).toBe(1);
  });

  it("a new message becomes one event that starts the bot through the trigger, exactly once", async () => {
    await makeTrigger();
    feed.text = "[chat 1] sam: old";
    await start();
    await poll();
    feed.text = "[chat 1] sam: old\n[chat 1] sam: please summarise my day";
    expect(await poll()).toBe(1);
    await settle();
    const list = await tasks();
    expect(list).toHaveLength(1);
    expect(list[0].instruction).toContain("please summarise my day");
    expect(await poll()).toBe(0); // the same message is not turned into an event again
    expect(await tasks()).toHaveLength(1);
  });

  it("waits for the interval between checks", async () => {
    await start();
    await poll(60);
    expect(feed.reads).toBe(1);
    t.clock.t += 30 * MIN;
    await t.app.inbound.tick();
    expect(feed.reads).toBe(1);
    t.clock.t += 31 * MIN;
    await t.app.inbound.tick();
    expect(feed.reads).toBe(2);
  });

  it("at most three new messages per check become events; the rest are noted and dropped", async () => {
    await makeTrigger();
    await start();
    await poll();
    feed.text = Array.from({ length: 8 }, (_, i) => `[chat 1] sam: msg ${i}`).join("\n");
    expect(await poll()).toBe(INBOUND_LIMITS.maxEventsPerPoll);
    const audit = JSON.stringify((await t.call("GET", "/api/audit?limit=100")).body);
    expect(audit).toContain('"dropped":5');
    expect(await poll()).toBe(0);
  });

  it("does nothing while outside actions, automation or AI are paused, and carries on afterwards", async () => {
    await start();
    await poll();
    for (const url of ["/api/external/pause", "/api/automation/pause", "/api/llm/pause"]) {
      await t.call("PUT", url, { paused: true });
      const before = feed.reads;
      await poll();
      expect(feed.reads, url).toBe(before);
      await t.call("PUT", url, { paused: false });
    }
    const before = feed.reads;
    await poll();
    expect(feed.reads).toBe(before + 1);
  });

  it("switches itself off if reading is taken away from the bot", async () => {
    const id = await start();
    await poll();
    await t.call("PUT", `/api/bots/${botId}/permissions/telegram`, { readEnabled: false });
    await poll();
    const s = (await sources()).find((x) => x.id === id);
    expect(s.enabled).toBe(false);
    expect(s.disabledReason).toMatch(/reading is not switched on/);
  });

  it("switches itself off after three failed checks in a row, and an error never reaches the app", async () => {
    const id = await start();
    await poll();
    feed.fail = "Telegram is down";
    await poll();
    await poll();
    expect((await sources())[0]).toMatchObject({ enabled: true, consecutiveFailures: 2 });
    await poll();
    const s = (await sources()).find((x) => x.id === id);
    expect(s).toMatchObject({ enabled: false, consecutiveFailures: 3 });
    expect(s.disabledReason).toMatch(/Telegram is down/);
  });

  it("switching it off and on again starts fresh (no old messages become events)", async () => {
    await makeTrigger();
    const id = await start();
    feed.text = "[chat 1] sam: first";
    await poll();
    await t.call("PATCH", `/api/inbound/${id}`, { enabled: false });
    feed.text = "[chat 1] sam: first\n[chat 1] sam: arrived while off";
    await enable(id);
    expect(await poll()).toBe(0);
    await settle();
    expect(await tasks()).toHaveLength(0);
  });

  it("writes every check to the security log without message text", async () => {
    await start();
    feed.text = "[chat 1] sam: TOP SECRET CONTENT";
    await poll();
    const log = JSON.stringify((await t.call("GET", "/api/audit?limit=100")).body);
    expect(log).toContain("inbound.polled");
    expect(log).not.toContain("TOP SECRET CONTENT");
  });

  it("removing a source forgets what it had seen", async () => {
    const id = await start();
    feed.text = "[chat 1] sam: x";
    await poll();
    expect((await t.call("DELETE", `/api/inbound/${id}`)).status).toBe(200);
    expect(await sources()).toHaveLength(0);
  });
});

describe("reading the lists", () => {
  it("Telegram lines are fingerprinted, Gmail lines use the message id, and 'nothing found' lines are skipped", () => {
    const tg = parseItems("telegram", "[chat 1] sam: hi\nNo recent messages.\n\n[chat 2] ann: yo");
    expect(tg).toHaveLength(2);
    expect(new Set(tg.map((i) => i.key)).size).toBe(2);
    const gm = parseItems("gmail", "[abc123def] Mon | from Sam | Lunch | snippet\nNo messages found.");
    expect(gm).toEqual([{ key: "gmail:abc123def", line: "[abc123def] Mon | from Sam | Lunch | snippet" }]);
  });
});

describe("who may change this", () => {
  it("only the PC: a paired phone cannot create, change or switch on a source", async () => {
    const phone = await createTestApp({ remoteHosts: ["my-pc.tail1234.ts.net"], connectors: [fakeTelegram(feed) as any] });
    const { body } = await phone.call("POST", "/api/devices/pairing");
    const paired = await phone.app.inject({ method: "POST", url: "/api/devices/pair", payload: { code: body.code, name: "P" }, headers: { host: "my-pc.tail1234.ts.net", origin: "https://my-pc.tail1234.ts.net", "x-awp-client": "dashboard" } });
    const cookie = String(paired.headers["set-cookie"]).split(";")[0]!;
    const res = await phone.app.inject({ method: "POST", url: "/api/inbound", payload: { connector: "telegram", botId: "00000000-0000-4000-8000-000000000000" }, headers: { host: "my-pc.tail1234.ts.net", origin: "https://my-pc.tail1234.ts.net", "x-awp-client": "dashboard", cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("owner_only");
    await phone.app.close();
  });
});
