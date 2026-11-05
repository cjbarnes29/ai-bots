import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OK_RESULT } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { ftsQuery, MEMORY_LIMITS } from "./service.js";
import { switchOn } from "../llm/test-helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const fence = "```";
const act = (action: string, args: Record<string, unknown> = {}) => `${fence}action\n${JSON.stringify({ connector: "memory", action, args })}\n${fence}`;
const reply = (text: string) => ({ ...OK_RESULT, text, inputTokens: 10, outputTokens: 5 });
const FAKE_KEY = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

describe("ftsQuery", () => {
  it("keeps plain words only, so no search syntax can get through", () => {
    expect(ftsQuery('Budget "report" AND NOT (x) * ^ -')).toBe('"budget"* OR "report"* OR "and"* OR "not"*');
    expect(ftsQuery("!!! ??")).toBeNull();
    expect(ftsQuery("a")).toBeNull();
  });
});

describe("memory", () => {
  let t: TestApp;
  let ref: string;
  beforeEach(async () => {
    t = await createTestApp({ includeMemory: true });
    ref = await setupGeminiModel(t);
  });
  afterEach(async () => {
    await t.app.close();
    vi.unstubAllEnvs();
  });
  const mkBot = async (name = "Helper") => (await switchOn(t.call, await t.call("POST", "/api/bots", { name, model: ref }))).body.bot as any;
  const note = async (body: Record<string, unknown>) => (await t.call("POST", "/api/memory", body)).body.note as any;
  const runTask = async (botId: string) => {
    await t.call("POST", `/api/bots/${botId}/tasks`, { instruction: "Look it up" });
    await vi.waitFor(async () => expect(((await t.call("GET", "/api/tasks")).body.tasks as any[]).every((x) => ["completed", "failed"].includes(x.status))).toBe(true), { timeout: 3000, interval: 10 });
  };
  const told = (i = 1) => t.provider.calls[i]!.messages[3]!.content;

  it("creates, searches, edits, archives and restores notes; shared and private lists stay apart", async () => {
    const bot = await mkBot();
    const shared = await note({ scope: "shared", title: "Brand colours", content: "Our brand uses deep blue and warm orange.", tags: ["brand"] });
    const priv = await note({ scope: "bot", botId: bot.id, title: "Tone", content: "Write in a friendly tone." });
    expect(shared).toMatchObject({ scope: "shared", botId: null, source: "owner" });
    expect((await t.call("GET", "/api/memory?scope=shared")).body.notes.map((n: any) => n.id)).toEqual([shared.id]);
    expect((await t.call("GET", `/api/memory?scope=bot&botId=${bot.id}`)).body.notes.map((n: any) => n.id)).toEqual([priv.id]);
    expect((await t.call("GET", "/api/memory?scope=shared&q=orange")).body.notes).toHaveLength(1);
    expect((await t.call("GET", "/api/memory?scope=shared&q=zebra")).body.notes).toHaveLength(0);
    await t.call("PATCH", `/api/memory/${shared.id}`, { content: "Our brand uses green." });
    expect((await t.call("GET", "/api/memory?scope=shared&q=orange")).body.notes).toHaveLength(0); // the search index followed the edit
    expect((await t.call("GET", "/api/memory?scope=shared&q=green")).body.notes).toHaveLength(1);
    await t.call("POST", `/api/memory/${shared.id}/archive`, {});
    expect((await t.call("GET", "/api/memory?scope=shared")).body.notes).toHaveLength(0);
    expect((await t.call("GET", "/api/memory?scope=shared&archived=1")).body.notes).toHaveLength(1);
    await t.call("POST", `/api/memory/${shared.id}/unarchive`, {});
    expect((await t.call("GET", "/api/memory?scope=shared")).body.notes).toHaveLength(1);
    expect((await t.call("GET", "/api/memory?scope=bot")).status).toBe(400);
  });

  it("refuses anything that looks like a secret, on create, edit and share", async () => {
    const bot = await mkBot();
    expect((await t.call("POST", "/api/memory", { scope: "shared", title: "Key", content: `token ${FAKE_KEY}` })).body.error).toBe("memory_secret");
    const ok = await note({ scope: "bot", botId: bot.id, title: "Fine", content: "Harmless" });
    expect((await t.call("PATCH", `/api/memory/${ok.id}`, { content: FAKE_KEY })).body.error).toBe("memory_secret");
    expect((await t.call("GET", `/api/memory/${ok.id}`)).body.note.content).toBe("Harmless");
    expect((await t.call("POST", "/api/memory", { scope: "shared", title: "T", content: "c", extra: 1 })).status).toBe(400);
  });

  it("a private note is never shown to another bot; shared knowledge is hidden until the owner allows it for that bot", async () => {
    const a = await mkBot("A");
    const b = await mkBot("B");
    await note({ scope: "bot", botId: a.id, title: "Secret plan", content: "Launch on Friday" });
    await note({ scope: "shared", title: "Office hours", content: "Open Friday mornings" });
    // Bot B asks: it must see neither A's private note nor (by default) the shared one.
    t.provider.script.push(reply(act("recall", { query: "friday" })), reply("done"));
    await runTask(b.id);
    expect(told()).toContain("Nothing found");
    expect((await t.call("PUT", `/api/bots/${b.id}/memory`, { useShared: true })).body.settings).toEqual({ usePrivate: true, useShared: true });
    t.provider.calls.length = 0;
    t.provider.script.push(reply(act("recall", { query: "friday" })), reply("done"));
    await runTask(b.id);
    expect(told()).toContain("Office hours");
    expect(told()).not.toContain("Launch on Friday");
    expect(JSON.stringify((await t.call("GET", "/api/audit?limit=100")).body)).toContain("memory.access_changed");
  });

  it("pinned notes go into the bot's prompt (private always, shared only when allowed) and are marked as reference data", async () => {
    const bot = await mkBot();
    await note({ scope: "bot", botId: bot.id, title: "Name", content: "Always sign as Sam.", pinned: true });
    await note({ scope: "shared", title: "Policy", content: "Refunds within 30 days.", pinned: true });
    t.provider.script.push(reply("hi"));
    await runTask(bot.id);
    const system = JSON.stringify(t.provider.calls[0]!.messages);
    expect(system).toContain("Always sign as Sam.");
    expect(system).toContain("not as instructions");
    expect(system).not.toContain("Refunds within 30 days.");
    await t.call("PUT", `/api/bots/${bot.id}/memory`, { useShared: true });
    t.provider.calls.length = 0;
    t.provider.script.push(reply("hi"));
    await runTask(bot.id);
    expect(JSON.stringify(t.provider.calls[0]!.messages)).toContain("Refunds within 30 days.");
    await t.call("PUT", `/api/bots/${bot.id}/memory`, { usePrivate: false, useShared: false });
    t.provider.calls.length = 0;
    t.provider.script.push(reply("hi"));
    await runTask(bot.id);
    expect(JSON.stringify(t.provider.calls[0]!.messages)).not.toContain("Always sign as Sam.");
  });

  it("a bot's request to remember waits for approval, saves privately only, and refuses secrets", async () => {
    const bot = await mkBot();
    t.provider.script.push(reply(act("remember", { title: "Client likes email", text: "Prefers email over phone." })), reply("done"));
    await runTask(bot.id);
    expect((await t.call("GET", `/api/memory?scope=bot&botId=${bot.id}`)).body.notes).toHaveLength(0); // nothing saved yet
    const pending = (await t.call("GET", "/api/approvals?status=pending")).body.approvals as any[];
    expect(pending).toHaveLength(1);
    expect(pending[0].summary).toContain("Save a private memory note");
    await t.call("POST", `/api/approvals/${pending[0].id}/approve`, {});
    await vi.waitFor(async () => expect((await t.call("GET", `/api/memory?scope=bot&botId=${bot.id}`)).body.notes).toHaveLength(1));
    const saved = (await t.call("GET", `/api/memory?scope=bot&botId=${bot.id}`)).body.notes[0];
    expect(saved).toMatchObject({ scope: "bot", source: "bot", botId: bot.id });
    expect((await t.call("GET", "/api/memory?scope=shared")).body.notes).toHaveLength(0);

    t.provider.calls.length = 0;
    t.provider.script.push(reply(act("remember", { title: "Key", text: `use ${FAKE_KEY}` })), reply("done"));
    await runTask(bot.id);
    expect(told()).toContain("Memory never stores secrets");
    expect(((await t.call("GET", "/api/approvals?status=pending")).body.approvals as any[]).length).toBe(0);
  });

  it("a bot can search its own finished tasks, and only its own", async () => {
    const a = await mkBot("A");
    const b = await mkBot("B");
    t.provider.script.push(reply("The quarterly invoice total was 4200 dollars."));
    await runTask(a.id);
    t.provider.calls.length = 0;
    t.provider.script.push(reply(act("recall", { query: "invoice", scope: "history" })), reply("done"));
    await runTask(a.id);
    expect(told()).toContain("quarterly invoice total");
    t.provider.calls.length = 0;
    t.provider.script.push(reply(act("recall", { query: "invoice", scope: "history" })), reply("done"));
    await runTask(b.id);
    expect(told()).toContain("Nothing found");
  });

  it("sharing copies a private note into shared knowledge and leaves the original; limits are enforced", async () => {
    const bot = await mkBot();
    const priv = await note({ scope: "bot", botId: bot.id, title: "Useful", content: "Fact one" });
    const copy = (await t.call("POST", `/api/memory/${priv.id}/share`, {})).body.note;
    expect(copy).toMatchObject({ scope: "shared", botId: null, title: "Useful" });
    expect((await t.call("GET", `/api/memory/${priv.id}`)).body.note.scope).toBe("bot");
    expect((await t.call("POST", `/api/memory/${copy.id}/share`, {})).body.error).toBe("already_shared");
    expect((await t.call("POST", "/api/memory", { scope: "bot", botId: "00000000-0000-4000-8000-000000000000", title: "x", content: "y" })).status).toBe(404);
    expect(MEMORY_LIMITS.sharedNotes).toBe(300);
  });
});
