import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ConnectorDefinition } from "../connectors/types.js";
import { OK_RESULT, switchOn } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const sent: any[] = [];
const telegram: ConnectorDefinition = {
  id: "telegram",
  label: "Telegram",
  secrets: [{ name: "TELEGRAM_BOT_TOKEN", description: "token" }],
  actions: { send_message: { kind: "write", description: "Send", args: z.strictObject({ chat: z.string(), text: z.string() }), summarize: (a) => `Send "${a["text"]}"`, execute: async (a) => (sent.push(a), "sent") } },
};

let t: TestApp;
let ref: string;
let active = 0;
let maxActive = 0;
const seen: string[] = [];
beforeEach(async () => {
  sent.length = 0;
  active = 0;
  maxActive = 0;
  seen.length = 0;
  t = await createTestApp({ connectors: [telegram] });
  ref = await setupGeminiModel(t);
  await t.call("PUT", "/api/vault/TELEGRAM_BOT_TOKEN", { value: "TELEGRAM-TOKEN-0123456789abcdef" });
  await t.call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000 });
  // A provider that takes real time and remembers how many calls overlapped.
  t.provider.complete = async (req: any) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    const last = String(req.messages.at(-1)?.content ?? "");
    seen.push(last);
    await new Promise((r) => setTimeout(r, 40));
    active -= 1;
    if (/Task from the user:\n.*SEND/.test(last)) return { ...OK_RESULT, text: 'Sending.\n```action\n{"connector": "telegram", "action": "send_message", "args": {"chat": "sam", "text": "hello"}}\n```' };
    if (last.startsWith("Here is what happened")) return { ...OK_RESULT, text: "It is waiting for approval." };
    return { ...OK_RESULT, text: `answer to ${last.slice(-12)}` };
  };
});
afterEach(async () => {
  await t.app.close();
  vi.unstubAllEnvs();
});

const mkBot = async (name: string) => (await switchOn(t.call, await t.call("POST", "/api/bots", { name, model: ref }))).body.bot as any;
const submit = (botId: string, instruction: string) => t.call("POST", `/api/bots/${botId}/tasks`, { instruction });
const allDone = () => vi.waitFor(async () => expect(((await t.call("GET", "/api/tasks")).body.tasks as any[]).every((x) => ["completed", "failed", "cancelled"].includes(x.status))).toBe(true), { timeout: 4000, interval: 10 });
const tasks = async () => (await t.call("GET", "/api/tasks")).body.tasks as any[];

describe("independent chains: sequential by default, parallel only when the owner allows it", () => {
  it("by default chains run one after another (nothing changes for existing setups)", async () => {
    const bots = [await mkBot("A"), await mkBot("B"), await mkBot("C")];
    for (const [i, b] of bots.entries()) await submit(b.id, `job number ${i}`);
    await allDone();
    expect(maxActive).toBe(1);
    expect((await tasks()).every((x) => x.status === "completed")).toBe(true);
    expect((await t.call("GET", "/api/delegation/limits")).body.limits.maxParallelChains).toBe(1);
  });

  it("with parallel chains allowed (and room in the model service) independent chains really overlap, each gets its own answer, nothing runs twice", async () => {
    await t.call("PUT", "/api/delegation/limits", { maxParallelChains: 3 });
    await t.call("PUT", "/api/llm/limits", { maxConcurrentCloud: 4 });
    const bots = [await mkBot("A"), await mkBot("B"), await mkBot("C")];
    for (const [i, b] of bots.entries()) await submit(b.id, `job number ${i}`);
    await allDone();
    expect(maxActive).toBe(3);
    const done = await tasks();
    expect(done.map((x) => x.status)).toEqual(["completed", "completed", "completed"]);
    expect(seen).toHaveLength(3); // exactly one model call per chain
    expect(new Set(done.map((x) => x.result)).size).toBe(3);
    for (const [i, b] of bots.entries()) expect(done.find((x) => x.assigneeBotId === b.id).result).toBe(`answer to job number ${i}`);
  });

  it("parallelism is capped by the model service: a high setting never exceeds its simultaneous-request limit minus one slot kept for chat", async () => {
    await t.call("PUT", "/api/delegation/limits", { maxParallelChains: 6 });
    await t.call("PUT", "/api/llm/limits", { maxConcurrentCloud: 3 });
    const bots = [await mkBot("A"), await mkBot("B"), await mkBot("C"), await mkBot("D")];
    for (const [i, b] of bots.entries()) await submit(b.id, `job number ${i}`);
    await allDone();
    expect(maxActive).toBe(2);
    expect((await tasks()).every((x) => x.status === "completed")).toBe(true);
    // with the service's default (2 at once) a high setting still means one at a time
    seen.length = 0;
    maxActive = 0;
    await t.call("PUT", "/api/llm/limits", { maxConcurrentCloud: 2 });
    for (const [i, b] of bots.slice(0, 2).entries()) await submit(b.id, `second round ${i}`);
    await allDone();
    expect(maxActive).toBe(1);
  });

  it("the setting has hard ceilings and is audited like the other teamwork limits", async () => {
    expect((await t.call("PUT", "/api/delegation/limits", { maxParallelChains: 7 })).status).toBe(400);
    expect((await t.call("PUT", "/api/delegation/limits", { maxParallelChains: 0 })).status).toBe(400);
    expect((await t.call("PUT", "/api/delegation/limits", { maxParallelChains: 6 })).body.limits.maxParallelChains).toBe(6);
    expect((await t.call("POST", "/api/delegation/limits/reset")).body.limits.maxParallelChains).toBe(1);
  });

  it("parallel chains do not duplicate outside actions: three bots each ask once, three separate approvals wait, and nothing is sent", async () => {
    await t.call("PUT", "/api/delegation/limits", { maxParallelChains: 3 });
    await t.call("PUT", "/api/llm/limits", { maxConcurrentCloud: 4 });
    const bots = [await mkBot("A"), await mkBot("B"), await mkBot("C")];
    for (const b of bots) await submit(b.id, "SEND hello to sam");
    await allDone();
    expect(maxActive).toBeGreaterThanOrEqual(2);
    const pending = (await t.call("GET", "/api/approvals?status=pending")).body.approvals as any[];
    expect(pending).toHaveLength(3);
    expect(new Set(pending.map((p) => p.botId)).size).toBe(3);
    expect(new Set(pending.map((p) => p.id)).size).toBe(3);
    expect(sent).toEqual([]); // waiting for the owner, whatever the parallelism
    for (const x of await tasks()) expect(x.result).toMatch(/WAITING for the owner's approval/);
  });

  it("a paused model service stops parallel chains cleanly: they fail with the reason, none is left running", async () => {
    await t.call("PUT", "/api/delegation/limits", { maxParallelChains: 3 });
    await t.call("PUT", "/api/llm/limits", { maxConcurrentCloud: 4 });
    const bots = [await mkBot("A"), await mkBot("B")];
    await t.call("PUT", "/api/llm/pause", { paused: true });
    for (const b of bots) expect((await submit(b.id, "job")).status).toBeGreaterThanOrEqual(400);
    await t.call("PUT", "/api/llm/pause", { paused: false });
    expect(await tasks()).toEqual([]);
  });
});
