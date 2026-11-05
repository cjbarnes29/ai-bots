import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmError } from "../llm/errors.js";
import { OK_RESULT, switchOn } from "../llm/test-helpers.js";
import { buildSystemPrompt } from "../runtimes/prompt.js";
import { createTestApp, setupGeminiModel, setupOllamaModel, type TestApp } from "../test-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
let t: TestApp;
let ref: string;
beforeEach(async () => {
  t = await createTestApp();
  ref = await setupGeminiModel(t);
});
afterEach(async () => {
  await t.app.close();
  vi.unstubAllEnvs();
});

async function makeBot(extra: Record<string, unknown> = {}) {
  const res = await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Scout", model: ref, ...extra }));
  expect(res.status).toBe(201);
  return res.body.bot as any;
}
const chat = (botId: string, message: string, conversationId?: string) =>
  t.call("POST", `/api/bots/${botId}/chat`, { message, ...(conversationId ? { conversationId } : {}) });

describe("a conversation", () => {
  it("sends the message to the bot's model and returns and stores the reply", async () => {
    const bot = await makeBot();
    t.provider.script.push({ ...OK_RESULT, text: "Hello, human!", inputTokens: 40, outputTokens: 7 });
    const res = await chat(bot.id, "  Hello bot  ");
    expect(res.status).toBe(200);
    expect(res.body.userMessage).toMatchObject({ role: "user", content: "Hello bot", botVersion: 1 });
    expect(res.body.assistantMessage).toMatchObject({
      role: "assistant",
      content: "Hello, human!",
      providerId: "gemini",
      modelId: "gemini-test",
      inputTokens: 40,
      outputTokens: 7,
      tokensEstimated: false,
    });
    expect(res.body.warning).toBeNull();

    const conversations = (await t.call("GET", `/api/bots/${bot.id}/conversations`)).body.conversations;
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({ id: res.body.conversationId, title: "Hello bot", messageCount: 2 });
    const messages = (await t.call("GET", `/api/bots/${bot.id}/conversations/${res.body.conversationId}/messages`)).body.messages;
    expect(messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
  });

  it("remembers earlier messages in the same conversation", async () => {
    const bot = await makeBot();
    const first = await chat(bot.id, "My name is Sam");
    await chat(bot.id, "What is my name?", first.body.conversationId);
    const sent = t.provider.calls[1]!.messages;
    expect(sent.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(sent[1]!.content).toBe("My name is Sam");
    expect(sent[3]!.content).toBe("What is my name?");
  });

  it("starts fresh when no conversation is given", async () => {
    const bot = await makeBot();
    await chat(bot.id, "one");
    await chat(bot.id, "two");
    expect(t.provider.calls[1]!.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect((await t.call("GET", `/api/bots/${bot.id}/conversations`)).body.conversations).toHaveLength(2);
  });

  it("sends at most the last 20 messages of history", async () => {
    await t.call("PUT", "/api/llm/limits", {
      botRequestsPerMinute: 1000,
      botDailyRequests: 1000,
      botMonthlyRequests: 1000,
      providerRequestsPerMinute: 1000,
      globalDailyRequests: 1000,
      globalMonthlyRequests: 1000,
    });
    await t.call("PATCH", "/api/llm/providers/gemini", { dailyRequestCap: 1000 });
    const bot = await makeBot();
    let conversationId: string | undefined;
    for (let i = 1; i <= 15; i++) {
      conversationId = (await chat(bot.id, `message ${i}`, conversationId)).body.conversationId;
    }
    const last = t.provider.calls[14]!.messages;
    expect(last[0]!.role).toBe("system");
    expect(last).toHaveLength(1 + 20 + 1); // system + 20 history + the new message
    expect(last.at(-1)!.content).toBe("message 15");
    expect(last[1]!.content).toBe("message 5"); // the oldest messages were dropped
  });

  it("stores nothing when the model call fails, and the conversation is not created", async () => {
    const bot = await makeBot();
    t.provider.script.push(new LlmError("auth_failed", "The provider rejected the API key."));
    const res = await chat(bot.id, "Hello");
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: "llm_auth_failed" });
    expect((await t.call("GET", `/api/bots/${bot.id}/conversations`)).body.conversations).toHaveLength(0);
  });

  it("keeps an existing conversation intact when a later message fails", async () => {
    const bot = await makeBot();
    const first = await chat(bot.id, "Hello");
    t.provider.script.push(new LlmError("auth_failed", "bad"));
    expect((await chat(bot.id, "Again", first.body.conversationId)).status).toBe(502);
    const messages = (await t.call("GET", `/api/bots/${bot.id}/conversations/${first.body.conversationId}/messages`)).body.messages;
    expect(messages).toHaveLength(2);
  });

  it("records which version of the bot answered", async () => {
    const bot = await makeBot();
    await t.call("PATCH", `/api/bots/${bot.id}`, { instructions: "Be brief." });
    const res = await chat(bot.id, "Hi");
    expect(res.body.assistantMessage.botVersion).toBe(2);
  });
});

describe("the bot's own settings reach the model", () => {
  it("builds the prompt from role, personality, responsibilities and instructions", async () => {
    const bot = await makeBot({
      role: "Email triage assistant",
      personality: "Calm and concise",
      responsibilities: ["Sort the inbox", "Flag urgent mail"],
      instructions: "Never guess a sender.",
    });
    await chat(bot.id, "Hi");
    const system = t.provider.calls[0]!.messages[0]!;
    expect(system.role).toBe("system");
    for (const text of ["Scout", "Email triage assistant", "Calm and concise", "- Sort the inbox", "- Flag urgent mail", "Never guess a sender."]) {
      expect(system.content).toContain(text);
    }
    expect(system.content).toContain("You have no tools");
  });

  it("uses the bot's temperature and max tokens, or the defaults", async () => {
    const custom = await makeBot({ temperature: 1.4, maxOutputTokens: 300 });
    const plain = await makeBot({ name: "Plain" });
    await chat(custom.id, "Hi");
    await chat(plain.id, "Hi");
    expect(t.provider.calls[0]).toMatchObject({ temperature: 1.4, maxOutputTokens: 300, model: "gemini-test" });
    expect(t.provider.calls[1]).toMatchObject({ temperature: 0.7, maxOutputTokens: 1024 });
  });

  it("each bot uses its own provider and model", async () => {
    const local = await setupOllamaModel(t);
    const cloudBot = await makeBot();
    const localBot = await makeBot({ name: "Local", model: local });
    await chat(cloudBot.id, "Hi");
    await chat(localBot.id, "Hi");
    expect(t.provider.calls.map((c) => c.model)).toEqual(["gemini-test", "llama3.1:8b"]);
    const usage = (await t.call("GET", "/api/llm/usage")).body.usage;
    expect(usage.byModel.map((m: any) => `${m.providerId}/${m.modelId}`).sort()).toEqual(["gemini/gemini-test", "ollama/llama3.1:8b"]);
  });

  it("a long prompt drops the oldest history first instead of failing", async () => {
    await t.call("PUT", "/api/llm/limits", { maxPromptTokens: 700, botRequestsPerMinute: 1000, providerRequestsPerMinute: 1000 });
    const bot = await makeBot();
    let conversationId: string | undefined;
    for (let i = 1; i <= 4; i++) {
      conversationId = (await chat(bot.id, `${i}: ${"word ".repeat(300)}`, conversationId)).body.conversationId;
    }
    const sent = t.provider.calls[3]!.messages;
    expect(sent.at(-1)!.content.startsWith("4:")).toBe(true);
    expect(sent.length).toBeLessThan(8); // history was trimmed to fit
    expect(sent[1]!.role).toBe("user"); // and never starts with an assistant message
  });
});

describe("no tools, no actions", () => {
  it("never sends tools to the model, even when every permission is granted", async () => {
    const bot = await makeBot();
    for (const c of ["gmail", "telegram", "browser"]) {
      await t.call("PUT", `/api/bots/${bot.id}/permissions/${c}`, { readEnabled: true });
    }
    await chat(bot.id, "Please read my email and send a reply");
    const sent = t.provider.calls[0]!;
    expect(Object.keys(sent).sort()).toEqual(["maxOutputTokens", "messages", "model", "temperature", "timeoutMs"]);
    expect(JSON.stringify(sent)).not.toMatch(/"tools?"|"functions?"|tool_choice/);
    // Permissions are exactly as the user set them. Chatting did not change them.
    const after = (await t.call("GET", `/api/bots/${bot.id}`)).body.bot;
    expect(after.permissions.filter((p: any) => p.readEnabled)).toHaveLength(3);
    expect(after.permissions.every((p: any) => p.writePolicy === "approval_required")).toBe(true);
    expect((await t.call("GET", `/api/bots/${bot.id}/permissions/audit`)).body.audit).toHaveLength(3);
  });

  it("works with every permission OFF (the default)", async () => {
    const bot = await makeBot();
    expect(bot.permissions.every((p: any) => !p.readEnabled)).toBe(true);
    expect((await chat(bot.id, "Hi")).status).toBe(200);
  });

  it("ignores a tool request from the model and says so", async () => {
    const bot = await makeBot();
    t.provider.script.push({ ...OK_RESULT, text: "", toolCallsIgnored: true });
    const res = await chat(bot.id, "Send an email");
    expect(res.status).toBe(200);
    expect(res.body.assistantMessage.content).toMatch(/Tools are disabled/);
  });

  it("the system prompt tells the model it has no tools", () => {
    const prompt = buildSystemPrompt({ name: "A", role: "", personality: "", instructions: "", responsibilities: [] });
    expect(prompt).toMatch(/no tools/);
    expect(prompt).not.toMatch(/Your role|Your personality|Your instructions|Your responsibilities/);
  });
});

describe("who can chat, and when", () => {
  // Replaces "works whatever the bot's status" (2026-11-04): a bot answers only while it is switched on.
  it("only a switched-on bot answers; switched off or paused it refuses before anything is stored or sent", async () => {
    const bot = (await t.call("POST", "/api/bots", { name: "Scout", model: ref })).body.bot;
    expect(bot.status).toBe("disabled");
    const off = await chat(bot.id, "Hi");
    expect(off.status).toBe(409);
    expect(off.body.error).toBe("bot_not_active");
    expect(off.body.message).toMatch(/switched off/);
    expect((await t.call("GET", `/api/bots/${bot.id}/conversations`)).body.conversations).toHaveLength(0);

    expect((await t.call("PATCH", `/api/bots/${bot.id}`, { status: "active" })).status).toBe(200);
    expect((await chat(bot.id, "Hi")).status).toBe(200);

    await t.call("PATCH", `/api/bots/${bot.id}`, { status: "paused" });
    const paused = await chat(bot.id, "Hi again");
    expect(paused.status).toBe(409);
    expect(paused.body.message).toMatch(/paused/);
    expect(t.provider.calls).toHaveLength(1); // only the one message sent while it was on
  });

  it("a bot without a model cannot be switched on, so it cannot chat, and nothing is sent", async () => {
    const bot = (await t.call("POST", "/api/bots", { name: "NoModel" })).body.bot;
    expect((await t.call("PATCH", `/api/bots/${bot.id}`, { status: "active" })).body.error).toBe("model_required");
    const res = await chat(bot.id, "Hi");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("bot_not_active");
    expect(t.provider.calls).toHaveLength(0);
  });

  it("the central check also stops a run that bypasses the chat page (a task for a bot switched off afterwards)", async () => {
    const bot = await makeBot();
    await t.call("PATCH", `/api/bots/${bot.id}`, { status: "disabled" });
    const res = await t.call("POST", `/api/bots/${bot.id}/tasks`, { instruction: "Do it" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("bot_not_active");
    expect(t.provider.calls).toHaveLength(0);
  });

  it("refuses archived bots, unknown bots, empty and oversized messages", async () => {
    const bot = await makeBot();
    expect((await chat("00000000-0000-4000-8000-000000000000", "Hi")).status).toBe(404);
    expect((await chat("nope", "Hi")).status).toBe(404);
    expect((await chat(bot.id, "   ")).status).toBe(400);
    const tooLong = await chat(bot.id, "x".repeat(8001));
    expect(tooLong.status).toBe(413);
    expect(tooLong.body.error).toBe("message_too_long");
    expect((await chat(bot.id, "x".repeat(8000))).status).toBe(200);
    await t.call("DELETE", `/api/bots/${bot.id}`);
    expect((await chat(bot.id, "Hi")).body.error).toBe("bot_archived");
  });

  it("rejects extra fields and conversations that belong to another bot", async () => {
    const a = await makeBot();
    const b = await makeBot({ name: "Other" });
    const conv = (await chat(a.id, "Hi")).body.conversationId;
    expect((await chat(b.id, "Hi", conv)).status).toBe(404);
    expect((await t.call("POST", `/api/bots/${a.id}/chat`, { message: "Hi", model: "x" })).status).toBe(400);
    expect((await t.call("GET", `/api/bots/${b.id}/conversations/${conv}/messages`)).status).toBe(404);
    expect((await t.call("GET", `/api/bots/${a.id}/conversations/not-a-uuid/messages`)).status).toBe(404);
  });

  it("explains a bot that uses OpenClaw, which is not installed", async () => {
    const bot = await makeBot({ runtime: "openclaw" });
    const res = await chat(bot.id, "Hi");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("runtime_not_installed");
    expect(t.provider.calls).toHaveLength(0);
  });

  it("the built-in runtime has tools permanently disabled", async () => {
    const { BuiltInRuntime } = await import("../runtimes/builtin.js");
    const { OpenClawRuntime } = await import("../runtimes/openclaw.js");
    expect(new BuiltInRuntime({} as any).toolsEnabled).toBe(false);
    expect(new OpenClawRuntime().toolsEnabled).toBe(false);
  });
});

describe("limits and policy show up clearly in chat", () => {
  it("a reached limit gives a 429 with the reason, and the message is not stored", async () => {
    await t.call("PUT", "/api/llm/limits", { botDailyRequests: 1 });
    const bot = await makeBot();
    await chat(bot.id, "one");
    const res = await chat(bot.id, "two");
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("llm_limit_exceeded");
    expect(res.body.message).toMatch(/Daily \(this bot\) request limit reached \(1\/1\)/);
    expect((await t.call("GET", `/api/bots/${bot.id}/conversations`)).body.conversations).toHaveLength(1);
  });

  it("the pause switch stops chat", async () => {
    const bot = await makeBot();
    await t.call("PUT", "/api/llm/pause", { paused: true });
    const res = await chat(bot.id, "Hi");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("llm_paused");
    expect(t.provider.calls).toHaveLength(0);
  });

  it("switching the model off in Settings stops chat with an explanation", async () => {
    const bot = await makeBot();
    const model = (await t.call("GET", "/api/llm/models")).body.models[0];
    await t.call("PATCH", `/api/llm/models/${model.id}`, { enabled: false });
    const res = await chat(bot.id, "Hi");
    expect(res.body.error).toBe("llm_blocked_by_policy");
    expect(res.body.message).toMatch(/switched off/);
  });

  it("a provider that reports a cost is blocked, and the user is warned", async () => {
    const bot = await makeBot();
    t.provider.script.push({ ...OK_RESULT, costReportedMicro: 900 });
    const res = await chat(bot.id, "Hi");
    expect(res.status).toBe(200);
    expect(res.body.warning).toMatch(/blocked automatically/);
    const second = await chat(bot.id, "Again");
    expect(second.body.error).toBe("llm_blocked_by_policy");
  });

  it("usage is recorded per bot", async () => {
    const bot = await makeBot();
    await chat(bot.id, "Hi");
    const usage = (await t.call("GET", "/api/llm/usage")).body.usage;
    expect(usage.byBot).toEqual([{ botId: bot.id, botName: "Scout", requests: 1, tokens: 15 }]);
  });

  it("messages and conversations cannot be edited or deleted", async () => {
    const bot = await makeBot();
    await chat(bot.id, "Hi");
    // Reach the database through the repository's own connection is not possible from here,
    // so check the migration's rules directly:
    const { openDatabase } = await import("../db/database.js");
    const db = openDatabase(":memory:");
    const now = new Date().toISOString();
    db.prepare("INSERT INTO bots (id, name, created_at, updated_at) VALUES ('b', 'B', ?, ?)").run(now, now);
    db.prepare("INSERT INTO conversations (id, bot_id, title, created_at) VALUES ('c', 'b', 't', ?)").run(now);
    db.prepare("INSERT INTO chat_messages (conversation_id, role, content, bot_version, created_at) VALUES ('c', 'user', 'x', 1, ?)").run(now);
    expect(() => db.prepare("UPDATE chat_messages SET content = 'y'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM chat_messages").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM conversations").run()).toThrow(/cannot be deleted/);
  });
});
