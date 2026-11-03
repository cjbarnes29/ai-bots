import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LlmError } from "../llm/errors.js";
import { OK_RESULT } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const fence = "```";
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

let t: TestApp;
let ref: string;
beforeEach(async () => {
  t = await createTestApp({ connectors: [connector as any] });
  ref = await setupGeminiModel(t);
});
afterEach(async () => {
  await t.app.close();
  vi.unstubAllEnvs();
});
const overview = async () => (await t.call("GET", "/api/monitor/overview")).body;
const settle = () => vi.waitFor(async () => expect(((await t.call("GET", "/api/tasks")).body.tasks as any[]).every((x) => ["completed", "failed", "cancelled"].includes(x.status))).toBe(true), { timeout: 3000, interval: 10 });

describe("the monitoring overview", () => {
  it("starts quiet: zero everything, nothing needs attention", async () => {
    const o = await overview();
    expect(o).toMatchObject({
      bots: { total: 0, active: 0, archived: 0 },
      tasks: { running: 0, completed24h: 0, failed24h: 0 },
      approvals: { pending: 0 },
      ai: { callsToday: 0, errorsToday: 0, paused: false },
      automation: { schedulesOn: 0, triggersOn: 0, paused: false },
      devices: { remoteEnabled: false, paired: 0 },
      attention: [],
      activity: [],
    });
  });

  it("counts bots, finished and failed tasks, AI calls and tokens, and lists them in the feed", async () => {
    const bot = (await t.call("POST", "/api/bots", { name: "Worker", model: ref })).body.bot;
    await t.call("POST", `/api/bots/${bot.id}/tasks`, { instruction: "Do the thing" });
    await settle();
    t.provider.script.push(new LlmError("provider_unavailable", "down", { retryable: false }));
    await t.call("POST", `/api/bots/${bot.id}/tasks`, { instruction: "This one breaks" });
    await settle();
    const o = await overview();
    expect(o.bots.total).toBe(1);
    expect(o.tasks).toMatchObject({ running: 0, completed24h: 1, failed24h: 1 });
    expect(o.ai.callsToday).toBe(2);
    expect(o.ai.errorsToday).toBe(1);
    expect(o.ai.tokensToday).toBe(15);
    const texts = o.attention.map((a: any) => a.text);
    expect(texts).toEqual(expect.arrayContaining(["1 task failed in the last 24 hours", "1 AI call failed today"]));
    expect(o.attention.find((a: any) => a.text.includes("task failed")).level).toBe("error");
    const feed = o.activity.map((a: any) => a.summary);
    expect(feed.some((s: string) => s.includes('Worker: completed "Do the thing"'))).toBe(true);
    expect(feed.some((s: string) => s.includes('Worker: failed "This one breaks"'))).toBe(true);
    expect(o.activity.every((a: any, i: number, arr: any[]) => i === 0 || arr[i - 1].at >= a.at)).toBe(true);
  });

  it("shows a waiting approval first in 'needs attention' and in the feed, and updates when it is decided", async () => {
    const bot = (await t.call("POST", "/api/bots", { name: "Sender", model: ref })).body.bot;
    t.provider.script.push({ ...OK_RESULT, text: `${fence}action\n${JSON.stringify({ connector: "telegram", action: "send_message", args: { chat: "sam", text: "Hi" } })}\n${fence}` }, OK_RESULT);
    await t.call("POST", `/api/bots/${bot.id}/tasks`, { instruction: "Say hi" });
    await settle();
    let o = await overview();
    expect(o.approvals.pending).toBe(1);
    expect(o.attention[0]).toMatchObject({ level: "warn", text: "1 action is waiting for your approval", link: "/approvals" });
    expect(o.activity.some((a: any) => a.kind === "approval" && a.summary.includes("waiting for you"))).toBe(true);
    const [req] = (await t.call("GET", "/api/approvals?status=pending")).body.approvals;
    await t.call("POST", `/api/approvals/${req.id}/approve`);
    o = await overview();
    expect(o.approvals).toMatchObject({ pending: 0, executed24h: 1 });
    expect(o.attention.some((a: any) => a.text.includes("waiting for your approval"))).toBe(false);
    expect(o.activity.some((a: any) => a.kind === "approval" && a.summary.includes("executed") && a.summary.includes("(by owner)"))).toBe(true);
  });

  it("reports the three pause switches", async () => {
    await t.call("PUT", "/api/llm/pause", { paused: true });
    await t.call("PUT", "/api/external/pause", { paused: true });
    await t.call("PUT", "/api/automation/pause", { paused: true });
    const o = await overview();
    expect(o.ai.paused && o.automation.paused).toBe(true);
    expect(o.attention.map((a: any) => a.text)).toEqual(expect.arrayContaining(["All AI calls are paused", "All outside actions are paused", "Automation is paused"]));
    expect(o.activity.some((a: any) => a.kind === "security" && a.summary.startsWith("external.paused"))).toBe(true);
  });

  it("counts schedules that are switched on (new ones start off)", async () => {
    const bot = (await t.call("POST", "/api/bots", { name: "Auto", model: ref })).body.bot;
    const made = await t.call("POST", "/api/schedules", { name: "Every hour", botId: bot.id, instruction: "x", kind: "interval", intervalMinutes: 60 });
    expect(made.status).toBe(201);
    expect((await overview()).automation.schedulesOn).toBe(0); // created OFF
    await t.call("PATCH", `/api/schedules/${made.body.schedule.id}`, { enabled: true });
    expect((await overview()).automation.schedulesOn).toBe(1);
  });

  it("never contains a secret value", async () => {
    await t.call("PUT", "/api/vault/GROQ_API_KEY", { value: "gsk_SUPERSECRETVALUE0123456789abcdef" });
    const o = JSON.stringify(await overview());
    expect(o).not.toContain("SUPERSECRET");
    expect(o).toContain("vault.set GROQ_API_KEY");
  });

  it("is read-only: it accepts no changes", async () => {
    expect((await t.call("POST", "/api/monitor/overview", {})).status).toBe(404);
  });
});
