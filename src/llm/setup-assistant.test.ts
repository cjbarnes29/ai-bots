import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LlmError } from "./errors.js";
import { OK_RESULT, modelInfo, switchOn } from "./test-helpers.js";
import { FAKE_GEMINI_KEY, createTestApp, type TestApp } from "../test-app.js";

/**
 * Backend pieces behind the easy setup wizard and AI setup assistant (2026-11-04). Every provider here is the scripted fake: no request
 * leaves the test.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.app.close();
  vi.unstubAllEnvs();
});

async function geminiWith(models: string[]) {
  vi.stubEnv("GEMINI_API_KEY", FAKE_GEMINI_KEY);
  t.provider.models = models.map((id) => modelInfo(id));
  await t.call("PATCH", "/api/llm/providers/gemini", { freeConfirmed: true, enabled: true });
  const list = (await t.call("POST", "/api/llm/providers/gemini/refresh-models")).body.models as any[];
  for (const m of list) await t.call("PATCH", `/api/llm/models/${m.id}`, { enabled: true });
  return list;
}
const provider = async (id: string) => ((await t.call("GET", "/api/llm/providers")).body.providers as any[]).find((p) => p.id === id);

describe("the shown provider status follows real requests, not only 'Test connection'", () => {
  it("a provider-level failure replaces 'connected', and the next success restores it", async () => {
    await geminiWith(["gemini-2.5-flash"]);
    const bot = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "B", model: "gemini/gemini-2.5-flash" }))).body.bot;
    expect((await provider("gemini")).status).toBe("connected");

    t.provider.script.push(new LlmError("auth_failed", "The provider rejected the API key."));
    expect((await t.call("POST", `/api/bots/${bot.id}/chat`, { message: "hi" })).status).toBe(502);
    const failed = await provider("gemini");
    expect(failed.status).toBe("auth_failed");
    expect(failed.statusMessage).toMatch(/last request failed/i);
    expect(JSON.stringify(failed)).not.toContain(FAKE_GEMINI_KEY);

    t.provider.script.push(OK_RESULT);
    expect((await t.call("POST", `/api/bots/${bot.id}/chat`, { message: "hi" })).status).toBe(200);
    expect((await provider("gemini")).status).toBe("connected");
  });

  it("a model-level problem (one model missing) does not mark the whole provider as failing", async () => {
    await geminiWith(["gemini-2.5-flash"]);
    const bot = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "B", model: "gemini/gemini-2.5-flash" }))).body.bot;
    t.provider.script.push(new LlmError("model_not_found", "The provider does not know that model."));
    await t.call("POST", `/api/bots/${bot.id}/chat`, { message: "hi" });
    expect((await provider("gemini")).status).toBe("connected");
  });
});

describe("AI setup assistant: first choice per kind of task, default model for new bots", () => {
  it("the owner's first choice leads for that kind of task; the others stay behind it as fallbacks", async () => {
    await geminiWith(["gemini-2.5-pro", "gemini-2.5-flash"]);
    const before = (await t.call("GET", "/api/llm/routing")).body.preview.general.map((m: any) => m.ref);
    const last = before.at(-1);
    const res = await t.call("PUT", "/api/llm/routing", { preferred: { general: last } });
    expect(res.status).toBe(200);
    const after = res.body.preview.general.map((m: any) => m.ref);
    expect(after[0]).toBe(last);
    expect(after).toHaveLength(before.length); // nothing removed: the rest remain as fallbacks
  });

  it("when the first choice fails, the next model answers (fallback)", async () => {
    await geminiWith(["gemini-2.5-pro", "gemini-2.5-flash"]);
    await t.call("PUT", "/api/llm/routing", { preferred: { general: "gemini/gemini-2.5-flash" } });
    const bot = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "B", model: "auto/general" }))).body.bot;
    t.provider.script.push(new LlmError("model_not_found", "gone"), OK_RESULT);
    const res = await t.call("POST", `/api/bots/${bot.id}/chat`, { message: "hi" });
    expect(res.status).toBe(200);
    expect(t.provider.calls.map((c) => c.model)).toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]);
  });

  it("refuses unknown, blocked or automatic values as a first choice, and unknown default models", async () => {
    await geminiWith(["gemini-2.5-flash"]);
    expect((await t.call("PUT", "/api/llm/routing", { preferred: { general: "gemini/nope" } })).status).toBe(400);
    expect((await t.call("PUT", "/api/llm/routing", { preferred: { coding: "auto/general" } })).status).toBe(400);
    expect((await t.call("PUT", "/api/llm/routing", { defaultModel: "groq/unknown" })).status).toBe(400);
    expect((await t.call("PUT", "/api/llm/routing", { preferred: { light: "x" }, surprise: 1 })).status).toBe(400);
  });

  it("new bots get the chosen default model (still created switched off with every permission off)", async () => {
    await geminiWith(["gemini-2.5-flash"]);
    await t.call("PUT", "/api/llm/routing", { autoAssignNewBots: true, defaultModel: "gemini/gemini-2.5-flash" });
    const bot = (await t.call("POST", "/api/bots", { name: "New" })).body.bot;
    expect(bot.model).toBe("gemini/gemini-2.5-flash");
    expect(bot.status).toBe("disabled");
    expect(bot.permissions.every((p: any) => p.readEnabled === false)).toBe(true);
    await t.call("PUT", "/api/llm/routing", { defaultModel: null });
    expect((await t.call("POST", "/api/bots", { name: "Auto" })).body.bot.model).toBe("auto/general");
  });
});

describe("the wizard's test chat", () => {
  it("sends ONE short message to the chosen model through every normal check, and records the usage", async () => {
    const [m] = await geminiWith(["gemini-2.5-flash"]);
    t.provider.script.push({ ...OK_RESULT, text: "Hello! The connection works." });
    const res = await t.call("POST", `/api/llm/models/${m.id}/try`, { message: "Say hello" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reply: "Hello! The connection works.", providerId: "gemini", modelId: "gemini-2.5-flash" });
    expect(t.provider.calls).toHaveLength(1);
    expect(t.provider.calls[0]!.maxOutputTokens).toBeLessThanOrEqual(200);
    expect((await t.call("GET", "/api/llm/usage?days=1")).body.usage.today.requests).toBe(1);
  });

  it("obeys the pause switch, refuses empty or long messages and unknown models", async () => {
    const [m] = await geminiWith(["gemini-2.5-flash"]);
    expect((await t.call("POST", `/api/llm/models/${m.id}/try`, { message: "" })).status).toBe(400);
    expect((await t.call("POST", `/api/llm/models/${m.id}/try`, { message: "x".repeat(501) })).status).toBe(400);
    expect((await t.call("POST", "/api/llm/models/99999/try", { message: "hi" })).status).toBe(404);
    await t.call("PUT", "/api/llm/pause", { paused: true });
    expect((await t.call("POST", `/api/llm/models/${m.id}/try`, { message: "hi" })).body.error).toBe("llm_paused");
    expect(t.provider.calls).toHaveLength(0);
  });
});

describe("a switched-off bot is never offered as a teammate", () => {
  it("delegation offers only teammates that are switched on", async () => {
    await geminiWith(["gemini-2.5-flash"]);
    const mk = async (name: string) => (await switchOn(t.call, await t.call("POST", "/api/bots", { name, model: "gemini/gemini-2.5-flash" }))).body.bot;
    const lead = await mk("Lead");
    const on = await mk("OnMate");
    const off = await mk("OffMate");
    await t.call("PATCH", `/api/bots/${off.id}`, { status: "disabled" });
    await t.call("PUT", `/api/bots/${lead.id}/delegation`, { targetBotIds: [on.id, off.id] });
    t.provider.script.push(OK_RESULT);
    const task = (await t.call("POST", `/api/bots/${lead.id}/tasks`, { instruction: "Plan it" })).body.task;
    await vi.waitFor(async () => expect((await t.call("GET", `/api/tasks/${task.id}`)).body.task.status).toBe("completed"), { timeout: 3000, interval: 20 });
    const system = String(t.provider.calls[0]!.messages[0]!.content);
    expect(system).toContain("OnMate");
    expect(system).not.toContain("OffMate");
  });
});
