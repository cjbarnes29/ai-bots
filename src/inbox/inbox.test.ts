import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ConnectorDefinition } from "../connectors/types.js";
import { OK_RESULT, switchOn } from "../llm/test-helpers.js";
import { ChatRepository } from "../chat/repository.js";
import { openDatabase } from "../db/database.js";
import { InboxService, type InboxKind } from "./service.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const reply = (text: string) => ({ ...OK_RESULT, text, inputTokens: 10, outputTokens: 5 });
const act = (connector: string, action: string, args: Record<string, unknown> = {}) => "```action\n" + JSON.stringify({ connector, action, args }) + "\n```";
const telegram: ConnectorDefinition = {
  id: "telegram",
  label: "Telegram",
  secrets: [{ name: "TELEGRAM_BOT_TOKEN", description: "Telegram bot token" }],
  actions: {
    send_message: {
      kind: "write",
      description: "Send a Telegram message",
      args: z.strictObject({ chat: z.string().min(1).max(50), text: z.string().min(1).max(500) }),
      summarize: (a) => `Send "${a["text"]}" to ${a["chat"]}`,
      execute: async () => "sent",
    },
  },
};

let t: TestApp;
let ref: string;
beforeEach(async () => {
  t = await createTestApp({ connectors: [telegram] });
  ref = await setupGeminiModel(t);
  await t.call("PUT", "/api/vault/TELEGRAM_BOT_TOKEN", { value: "TELEGRAM-TOKEN-0123456789abcdef" });
});
afterEach(async () => {
  await t.app.close();
  vi.unstubAllEnvs();
});

const mkBot = async (name: string) => (await switchOn(t.call, await t.call("POST", "/api/bots", { name, model: ref }))).body.bot as any;
const settle = () => vi.waitFor(async () => expect(((await t.call("GET", "/api/tasks")).body.tasks as any[]).every((x) => ["completed", "failed", "cancelled"].includes(x.status))).toBe(true), { timeout: 3000, interval: 10 });
async function runTask(botId: string, instruction = "Research the market"): Promise<any> {
  const res = await t.call("POST", `/api/bots/${botId}/tasks`, { instruction });
  expect(res.status).toBe(202);
  await settle();
  return (await t.call("GET", `/api/tasks/${res.body.task.id}`)).body.task;
}
const inbox = async (q = "") => (await t.call("GET", `/api/inbox${q}`)).body;

describe("a bot writes to the inbox only because something real happened", () => {
  it("a finished task creates a message from the task itself, identifies the bot, and counts as unread", async () => {
    const bot = await mkBot("Researcher");
    t.provider.script.push(reply("Found 3 competitors: A, B, C."));
    const task = await runTask(bot.id);
    const box = await inbox();
    expect(box.items).toHaveLength(1);
    expect(box.items[0]).toMatchObject({ botId: bot.id, botName: "Researcher", title: "Updates from Researcher", unread: 1, pinned: false, muted: false, archived: false });
    expect(box.unreadTotal).toBe(1);
    const msgs = (await t.call("GET", `/api/inbox/${box.items[0].conversationId}/messages`)).body.messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ sender: "bot", botId: bot.id, initiated: true, kind: "task_result", importance: "normal", source: { kind: "task", id: task.id } });
    expect(msgs[0].content).toContain("Finished: Research the market");
    expect(msgs[0].content).toContain("Found 3 competitors: A, B, C.");
  });

  it("a failed task is an important message with what went wrong", async () => {
    const bot = await mkBot("Researcher");
    t.provider.script.push(new Error("boom") as any);
    await runTask(bot.id);
    const box = await inbox();
    const msgs = (await t.call("GET", `/api/inbox/${box.items[0].conversationId}/messages`)).body.messages;
    expect(msgs[0]).toMatchObject({ kind: "task_failed", importance: "important" });
    expect(msgs[0].content).toContain("did not finish");
  });

  it("an approval request puts a message in the inbox that shows the summary, never the raw arguments", async () => {
    const bot = await mkBot("Marketer");
    t.provider.script.push(reply(`Posting.\n${act("telegram", "send_message", { chat: "sam", text: "SECRET-ARG-TEXT" })}`), reply("Asked for approval."));
    await runTask(bot.id, "Tell Sam");
    const box = await inbox();
    const msgs = (await t.call("GET", `/api/inbox/${box.items[0].conversationId}/messages`)).body.messages;
    const approval = msgs.find((m: any) => m.kind === "approval_needed");
    expect(approval).toMatchObject({ importance: "important", source: { kind: "approval" } });
    expect(approval.content).toContain("I need your approval");
    expect(approval.content).toContain("Nothing happens until you decide");
    expect(approval.content).not.toContain("args");
    // the real approval exists and is still pending: the message did not decide anything
    expect(((await t.call("GET", "/api/approvals?status=pending")).body.approvals as any[]).map((a) => a.id)).toContain(approval.source.id);
  });

  it("the same event is written once, however often it is reported", async () => {
    const bot = await mkBot("Researcher");
    t.provider.script.push(reply("done"));
    const task = await runTask(bot.id);
    const inboxSvc = (t.app as any).inbox;
    const again = inboxSvc.postFromEvent(bot.id, "task_result", { kind: "task", id: task.id });
    expect(again.status).toBe("duplicate");
    expect(inboxSvc.postFromEvent(bot.id, "task_result", { kind: "task", id: task.id }).status).toBe("duplicate");
    const msgs = (await t.call("GET", `/api/inbox/${(await inbox()).items[0].conversationId}/messages`)).body.messages;
    expect(msgs).toHaveLength(1);
  });

  it("refuses invented events: unknown or other bots' tasks, tasks in the wrong state, made-up kinds and sources", async () => {
    const a = await mkBot("A");
    const b = await mkBot("B");
    t.provider.script.push(reply("done"));
    const task = await runTask(a.id);
    const svc = (t.app as any).inbox;
    expect(svc.postFromEvent(a.id, "task_result", { kind: "task", id: "00000000-0000-0000-0000-000000000000" }).status).toBe("rejected");
    expect(svc.postFromEvent(b.id, "task_result", { kind: "task", id: task.id }).status).toBe("rejected"); // another bot's task
    expect(svc.postFromEvent(a.id, "task_failed", { kind: "task", id: task.id }).status).toBe("rejected"); // it did not fail
    expect(svc.postFromEvent(a.id, "approval_needed", { kind: "task", id: task.id }).reason).toMatch(/cannot come from/);
    expect(svc.postFromEvent(a.id, "note", { kind: "bot_action", id: "x" }).reason).toMatch(/no verified source/);
    expect(svc.postFromEvent(a.id, "report", { kind: "bot_action", id: "x" }).status).toBe("rejected");
    expect(svc.postFromEvent("nobody", "task_result", { kind: "task", id: task.id }).status).toBe("rejected");
    expect(svc.postFromEvent(a.id, "bogus" as any, { kind: "task", id: task.id }).status).toBe("rejected");
    expect((await inbox()).items).toHaveLength(1); // only the real one
  });

  it("there is no way to post a message through the API", async () => {
    const bot = await mkBot("A");
    for (const [m, u] of [["POST", "/api/inbox"], ["POST", `/api/inbox/${bot.id}/messages`], ["PUT", "/api/inbox/messages"], ["POST", "/api/inbox/post"]] as const) {
      expect([404, 400]).toContain((await t.call(m, u, { botId: bot.id, content: "hello" })).status);
    }
    expect((await inbox()).items).toEqual([]);
  });

  it("an empty install has an empty inbox (nothing is invented)", async () => {
    await mkBot("A");
    expect(await inbox()).toEqual({ items: [], unreadTotal: 0, heldBack: 0 });
  });
});

describe("anti-spam: an hourly cap per bot, with nothing lost silently", () => {
  it("holds back messages over the cap, records them, keeps one message per event, and lets the owner raise the cap", async () => {
    const bot = await mkBot("Chatty");
    await t.call("PUT", `/api/inbox/preferences/${bot.id}`, { maxPerHour: 2 });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      t.provider.script.push(reply(`result ${i}`));
      ids.push((await runTask(bot.id, `Job ${i}`)).id);
    }
    const box = await inbox();
    const msgs = (await t.call("GET", `/api/inbox/${box.items[0].conversationId}/messages`)).body.messages;
    expect(msgs).toHaveLength(2);
    expect(box.heldBack).toBe(2);
    const held = (await t.call("GET", "/api/inbox/held-back")).body.heldBack;
    expect(held.map((h: any) => h.sourceId).sort()).toEqual([ids[2], ids[3]].sort());
    expect(held[0].reason).toMatch(/Hourly limit of 2/);
    // reporting a held-back event again does not duplicate the record
    (t.app as any).inbox.postFromEvent(bot.id, "task_result", { kind: "task", id: ids[2] });
    expect((await inbox()).heldBack).toBe(2);
    // an hour later the cap has room again
    t.clock.t += 3_700_000;
    expect((t.app as any).inbox.postFromEvent(bot.id, "task_result", { kind: "task", id: ids[2] }).status).toBe("posted");
  });
});

describe("the owner's view: unread, pin, mute, archive, hide, rename, search, preferences", () => {
  async function withMessage(name = "Researcher", text = "Found 3 competitors") {
    const bot = await mkBot(name);
    t.provider.script.push(reply(text));
    await runTask(bot.id, `${name} job`);
    return { bot, id: (await inbox()).items.find((i: any) => i.botId === bot.id).conversationId as string };
  }

  it("marking read clears the unread count; a new real event makes it unread again", async () => {
    const { bot, id } = await withMessage();
    expect((await inbox()).unreadTotal).toBe(1);
    await t.call("POST", `/api/inbox/${id}/read`);
    expect((await inbox()).unreadTotal).toBe(0);
    expect((await inbox("?view=unread")).items).toHaveLength(0);
    t.provider.script.push(reply("second"));
    await runTask(bot.id, "Another job");
    expect((await inbox()).unreadTotal).toBe(1);
    expect((await inbox("?view=unread")).items).toHaveLength(1);
  });

  it("the owner's own chat turns and the bot's replies to them are not 'unread'", async () => {
    const { bot, id } = await withMessage();
    await t.call("POST", `/api/inbox/${id}/read`);
    t.provider.script.push(reply("Sure, here is more."));
    const r = await t.call("POST", `/api/bots/${bot.id}/chat`, { message: "Tell me more", conversationId: id });
    expect(r.status).toBe(200);
    expect((await inbox()).unreadTotal).toBe(0);
    const msgs = (await t.call("GET", `/api/inbox/${id}/messages`)).body.messages;
    expect(msgs.map((m: any) => [m.sender, m.initiated])).toEqual([["bot", true], ["owner", false], ["bot", false]]);
  });

  it("pinned conversations sort first, and the pinned view lists only them", async () => {
    const one = await withMessage("Alpha");
    const two = await withMessage("Beta");
    expect((await inbox()).items[0].botName).toBe("Beta"); // newest first
    await t.call("PUT", `/api/inbox/${one.id}/pin`, { on: true });
    expect((await inbox()).items.map((i: any) => i.botName)).toEqual(["Alpha", "Beta"]);
    expect((await inbox("?view=pinned")).items.map((i: any) => i.botName)).toEqual(["Alpha"]);
    expect(two.id).not.toBe(one.id);
  });

  it("archive moves a conversation to its own view; hide ('delete') removes it from every list but keeps every message", async () => {
    const { id } = await withMessage();
    await t.call("PUT", `/api/inbox/${id}/archive`, { on: true });
    expect((await inbox()).items).toHaveLength(0);
    expect((await inbox("?view=archived")).items).toHaveLength(1);
    await t.call("PUT", `/api/inbox/${id}/archive`, { on: false });
    await t.call("POST", `/api/inbox/${id}/hide`);
    expect((await inbox()).items).toHaveLength(0);
    expect((await inbox("?view=archived")).items).toHaveLength(0);
    expect((await t.call("GET", `/api/bots/${(await t.call("GET", "/api/bots")).body.bots[0].id}/conversations/${id}/messages`)).body.messages).toHaveLength(1); // history kept
    await t.call("POST", `/api/inbox/${id}/restore`);
    expect((await inbox()).items).toHaveLength(1);
  });

  it("a new real event brings a hidden conversation back, but archived and muted stay as set", async () => {
    const { bot, id } = await withMessage();
    await t.call("PUT", `/api/inbox/${id}/mute`, { on: true });
    await t.call("POST", `/api/inbox/${id}/hide`);
    t.provider.script.push(reply("later"));
    await runTask(bot.id, "Later job");
    const item = (await inbox()).items[0];
    expect(item).toMatchObject({ conversationId: id, muted: true });
  });

  it("rename keeps the original title; titles must be 1 to 120 characters", async () => {
    const { id } = await withMessage();
    expect((await t.call("PUT", `/api/inbox/${id}/rename`, { title: "  Market research  " })).body.title).toBe("Market research");
    const item = (await inbox()).items[0];
    expect(item).toMatchObject({ title: "Market research", originalTitle: "Updates from Researcher" });
    expect((await t.call("PUT", `/api/inbox/${id}/rename`, { title: "   " })).status).toBe(400);
    expect((await t.call("PUT", `/api/inbox/${id}/rename`, { title: "x".repeat(121) })).status).toBe(400);
  });

  it("searches titles, bot names and message text, treating the text as plain text", async () => {
    await withMessage("Alpha", "Pricing table for Dubai");
    await withMessage("Beta", "Nothing about it");
    expect((await inbox("?q=Dubai")).items.map((i: any) => i.botName)).toEqual(["Alpha"]);
    expect((await inbox("?q=beta")).items.map((i: any) => i.botName)).toEqual(["Beta"]);
    expect((await inbox("?q=%25")).items).toHaveLength(0); // a % is not a wildcard
    expect((await inbox("?q=zzz")).items).toHaveLength(0);
  });

  it("notification preferences: defaults, per-bot override and validation", async () => {
    const bot = await mkBot("Researcher");
    expect((await t.call("GET", "/api/inbox/preferences")).body).toMatchObject({ notify: "important", maxPerHour: 6 });
    expect((await t.call("PUT", "/api/inbox/preferences", { maxPerHour: 0 })).status).toBe(400);
    expect((await t.call("PUT", "/api/inbox/preferences", { maxPerHour: 61 })).status).toBe(400);
    expect((await t.call("PUT", "/api/inbox/preferences", { notify: "loud" })).status).toBe(400);
    expect((await t.call("PUT", `/api/inbox/preferences/${bot.id}`, { notify: "all" })).body).toMatchObject({ notify: "all", maxPerHour: 6 });
    expect((await t.call("GET", `/api/inbox/preferences/${bot.id}`)).body).toMatchObject({ notify: "all", own: true });
    expect((await t.call("GET", "/api/inbox/preferences")).body).toMatchObject({ notify: "important" }); // the default is untouched
    expect(((await t.call("GET", "/api/audit?limit=100")).body.events as any[]).some((e) => e.kind === "inbox.preferences")).toBe(true);
  });

  it("an unknown conversation is a 404", async () => {
    for (const [m, u] of [["POST", "/api/inbox/11111111-1111-4111-8111-111111111111/read"], ["GET", "/api/inbox/nope/messages"]] as const) expect((await t.call(m, u)).status).toBe(404);
  });
});

describe("permissions", () => {
  it("changing the notification preferences is owner-only from a phone; reading the inbox and pinning are not", async () => {
    await t.app.close();
    t = await createTestApp({ connectors: [telegram], remoteHosts: ["example.ts.net"] });
    const hit = (method: any, url: string, payload?: object) => t.app.inject({ method, url, headers: { host: "example.ts.net", "x-awp-client": "dashboard", origin: "https://example.ts.net", "content-type": "application/json" }, ...(payload ? { payload } : {}) });
    expect([401, 403]).toContain((await hit("PUT", "/api/inbox/preferences", { maxPerHour: 60 })).statusCode);
    expect((await t.call("GET", "/api/inbox/preferences")).body.maxPerHour).toBe(6);
  });
});


describe("who is alerted (the decision only; it is not wired to phone alerts yet)", () => {
  function unit() {
    const db = openDatabase(":memory:");
    db.exec("INSERT INTO bots (id, name, status, created_at, updated_at) VALUES ('b1','Bot','active','2026-11-05T00:00:00Z','2026-11-05T00:00:00Z')");
    const alerts: any[] = [];
    let n = 0;
    const svc = new InboxService({
      db,
      chat: new ChatRepository(db),
      getBot: () => ({ id: "b1", name: "Bot", archived: false, currentVersion: 1 }) as any,
      audit: { record() {} },
      verifySource: () => ({ ok: true, title: "T", body: "B" }),
      notifier: (a) => void alerts.push(a),
    });
    const post = (kind: InboxKind) => svc.postFromEvent("b1", kind, { kind: kind === "approval_needed" ? "approval" : "task", id: `e${++n}` });
    return { svc, alerts, post };
  }
  it("'important' (the default) alerts for a failure but not a normal result; the alert carries no message text", () => {
    const { alerts, post } = unit();
    post("task_result");
    expect(alerts).toHaveLength(0);
    post("task_failed");
    expect(alerts).toEqual([{ botId: "b1", conversationId: expect.any(String), kind: "task_failed", importance: "important" }]);
  });
  it("'all' alerts for every message and 'none' for none", () => {
    const { svc, alerts, post } = unit();
    svc.setPrefs(null, { notify: "all", maxPerHour: 60 });
    post("task_result");
    expect(alerts).toHaveLength(1);
    svc.setPrefs(null, { notify: "none" });
    post("task_failed");
    expect(alerts).toHaveLength(1);
  });
  it("a muted conversation never alerts, even for an important message", () => {
    const { svc, alerts, post } = unit();
    const first = post("task_result") as any;
    svc.setMuted(first.conversationId, true);
    post("task_failed");
    expect(alerts).toHaveLength(0);
  });
});

describe("a schedule that switches itself off tells the owner once per failure episode", () => {
  it("three failed runs in a row switch it off and put ONE automation_failed message in the inbox, with the reason", async () => {
    const bot = await mkBot("Reporter");
    const sch = (await t.call("POST", "/api/schedules", { name: "Morning report", botId: bot.id, instruction: "Report", kind: "interval", intervalMinutes: 60 })).body.schedule;
    expect((await t.call("PATCH", `/api/schedules/${sch.id}`, { enabled: true })).status).toBe(200);
    for (let i = 0; i < 3; i++) {
      t.provider.script.push(new Error("provider down") as any);
      const r = await t.call("POST", `/api/schedules/${sch.id}/run-now`);
      expect(r.body.outcome.status).toBe("started");
      await settle();
    }
    expect((await t.call("GET", `/api/schedules/${sch.id}`)).body.schedule).toMatchObject({ enabled: false });
    const box = await inbox();
    const msgs = (await t.call("GET", `/api/inbox/${box.items[0].conversationId}/messages`)).body.messages;
    const kinds = msgs.map((m: any) => m.kind);
    expect(kinds.filter((k: string) => k === "automation_failed")).toHaveLength(1);
    const msg = msgs.find((m: any) => m.kind === "automation_failed");
    expect(msg.content).toContain('Schedule "Morning report" was switched off');
    expect(msg.content).toMatch(/failed runs in a row/);
    expect(msg.importance).toBe("important");
  });
});
