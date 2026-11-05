import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { LlmError } from "../llm/errors.js";
import { OK_RESULT, ScriptedProvider, makeCaller, modelInfo, switchOn } from "../llm/test-helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// P-40. SIMULATED providers only (scripted fakes behind the real router, model service, limits and usage log). These tests say nothing about
// how the real Groq or Google services behave; the real-provider checks are separate and recorded in docs/MODEL-SWITCHING.md.
let app: Awaited<ReturnType<typeof buildApp>>;
let call: ReturnType<typeof makeCaller>;
let providers: Record<string, ScriptedProvider>;
let clock: { t: number };

async function start() {
  vi.stubEnv("GEMINI_API_KEY", "AIzaSyFAKEKEYFORTESTSONLY0123456789");
  vi.stubEnv("GROQ_API_KEY", "gsk_FAKEKEYFORTESTSONLY0123456789ab");
  clock = { t: new Date(2026, 5, 15, 12, 0, 0).getTime() };
  providers = { gemini: new ScriptedProvider(), groq: new ScriptedProvider(), ollama: new ScriptedProvider(), openrouter: new ScriptedProvider(), omniroute: new ScriptedProvider() };
  providers["groq"]!.models = [modelInfo("llama-3.3-70b-versatile")];
  providers["gemini"]!.models = [modelInfo("gemini-2.5-flash")];
  providers["ollama"]!.models = [];
  app = await buildApp({
    dbPath: ":memory:",
    verification: "off",
    connectors: [],
    clock: () => clock.t,
    sleep: async (ms) => void (clock.t += ms),
    providerFactory: (_p, plugin) => providers[plugin.id]!,
    routingDefaults: { autoAssignNewBots: false },
  });
  call = makeCaller(app);
  for (const id of ["gemini", "groq"]) await call("PATCH", `/api/llm/providers/${id}`, { freeConfirmed: true, enabled: true });
  await call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000 });
  await call("POST", "/api/llm/routing/refresh-all");
  // Groq first, Google second: the "preferred" model is Groq's.
  await call("PUT", "/api/llm/routing", { allowedProviders: ["groq", "gemini"], providerOrder: ["groq", "gemini"], maxAttempts: 3, enabled: true });
}
afterEach(async () => {
  await app?.close();
  vi.unstubAllEnvs();
});
const mkBot = async () => (await switchOn(call, await call("POST", "/api/bots", { name: "Router test", model: "auto/general" }))).body.bot as any;
const reply = (text: string) => ({ ...OK_RESULT, text });
const history = async () => (await call("GET", "/api/llm/routing/history")).body;

describe("automatic switching, context, capabilities, recovery and the record the dashboard shows", () => {
  it("the preferred model answers when it is healthy; the history says so and there is no switch", async () => {
    await start();
    const bot = await mkBot();
    providers["groq"]!.script.push(reply("from groq"));
    const r = await call("POST", `/api/bots/${bot.id}/chat`, { message: "hello" });
    expect(r.body.assistantMessage).toMatchObject({ content: "from groq", providerId: "groq" });
    const h = await history();
    expect(h.current.general).toMatchObject({ ref: "groq/llama-3.3-70b-versatile" });
    expect(h.recent[0]).toMatchObject({ switched: false, answeredBy: "groq/llama-3.3-70b-versatile" });
    expect(h.switches).toEqual([]);
  });

  for (const [why, err] of [
    ["rate limit", new LlmError("rate_limited", "slow down", { retryable: true })],
    ["timeout", new LlmError("timeout", "no answer in time", { retryable: true })],
    ["outage", new LlmError("provider_unavailable", "down", { retryable: true })],
  ] as const) {
    it(`switches to the next model on a ${why}, records the switch, and the reply says which model answered`, async () => {
      await start();
      const bot = await mkBot();
      // the model service retries a passing problem itself first (limits.retries); only then does routing switch
      for (let i = 0; i < 4; i++) providers["groq"]!.script.push(err);
      providers["gemini"]!.script.push(reply("from gemini"));
      const r = await call("POST", `/api/bots/${bot.id}/chat`, { message: "hello" });
      expect(r.status).toBe(200);
      expect(r.body.assistantMessage).toMatchObject({ content: "from gemini", providerId: "gemini", modelId: "gemini-2.5-flash" });
      const h = await history();
      expect(h.recent[0]).toMatchObject({ switched: true, answeredBy: "gemini/gemini-2.5-flash", botId: bot.id });
      expect(h.recent[0].attempts).toEqual([{ ref: "groq/llama-3.3-70b-versatile", outcome: err.llmCode }, { ref: "gemini/gemini-2.5-flash", outcome: "answered" }]);
      expect(h.current.general.ref).toBe("gemini/gemini-2.5-flash");
      expect(h.switches[0].detail).toMatchObject({ answeredBy: "gemini/gemini-2.5-flash" }); // persisted in the audit log
      // the usage log has both the failed and the answered request
      const usage = JSON.stringify((await call("GET", "/api/llm/usage?days=1")).body.usage);
      expect(usage).toMatch(/groq/);
      expect(usage).toMatch(/gemini/);
    });
  }

  it("the conversation so far reaches the fallback model unchanged", async () => {
    await start();
    const bot = await mkBot();
    providers["groq"]!.script.push(reply("My name is noted: you are Carla."));
    const first = await call("POST", `/api/bots/${bot.id}/chat`, { message: "Remember: my name is Carla." });
    const cid = first.body.conversationId;
    providers["groq"]!.script.push(new LlmError("rate_limited", "slow down", { retryable: true }));
    providers["gemini"]!.script.push(reply("Your name is Carla."));
    const second = await call("POST", `/api/bots/${bot.id}/chat`, { message: "What is my name?", conversationId: cid });
    expect(second.body.assistantMessage.providerId).toBe("gemini");
    const sent = providers["gemini"]!.calls.at(-1)!.messages.map((m) => `${m.role}:${m.content}`);
    expect(sent).toEqual(expect.arrayContaining(["user:Remember: my name is Carla.", "assistant:My name is noted: you are Carla.", "user:What is my name?"]));
    // the failed attempt got exactly the same conversation
    expect(providers["groq"]!.calls.at(-1)!.messages).toEqual(providers["gemini"]!.calls.at(-1)!.messages);
  });

  it("returns to the preferred model once its rest after a rate limit is over", async () => {
    await start();
    const bot = await mkBot();
    providers["groq"]!.script.push(new LlmError("rate_limited", "slow down", { retryable: true, retryAfterMs: 60_000 } as any));
    providers["gemini"]!.script.push(reply("gemini while groq rests"), reply("gemini again"));
    await call("POST", `/api/bots/${bot.id}/chat`, { message: "one" });
    // while the preferred model rests it is not even tried
    const groqCalls = providers["groq"]!.calls.length;
    await call("POST", `/api/bots/${bot.id}/chat`, { message: "two" });
    expect(providers["groq"]!.calls.length).toBe(groqCalls);
    expect((await history()).current.general.ref).toBe("gemini/gemini-2.5-flash");
    // after the rest, the preferred model is first again and answers
    clock.t += 30 * 60_000;
    providers["groq"]!.script.push(reply("groq is back"));
    const back = await call("POST", `/api/bots/${bot.id}/chat`, { message: "three" });
    expect(back.body.assistantMessage).toMatchObject({ content: "groq is back", providerId: "groq" });
    const h = await history();
    expect(h.current.general.ref).toBe("groq/llama-3.3-70b-versatile");
    expect(h.recent[0]).toMatchObject({ switched: false });
  });

  it("a fallback must have the capability the task needs: a model without it is never used, and the error says so", async () => {
    await start();
    // only Google's model is confirmed to handle long inputs; Groq's is "unknown" (no context size listed)
    for (let i = 0; i < 4; i++) providers["gemini"]!.script.push(new LlmError("provider_unavailable", "down", { retryable: true }));
    const input = { botId: null, conversationId: null, modelRef: "auto/general", messages: [{ role: "user" as const, content: "long text" }], temperature: 0.2, maxOutputTokens: 50, require: ["long_context" as const] };
    await expect((app as any).modelRouter.complete(input)).rejects.toThrow(/No model could answer\. Tried: gemini\/gemini-2\.5-flash \(provider_unavailable\)/);
    expect(providers["groq"]!.calls).toHaveLength(0); // never used as a fallback for a task it is not confirmed to handle
    const h = await history();
    expect(h.recent[0]).toMatchObject({ switched: true, answeredBy: null });
  });

  it("never switches around limits that apply to everything, and never to a paid model", async () => {
    await start();
    const bot = await mkBot();
    await call("PUT", "/api/llm/limits", { botDailyRequests: 1 });
    providers["groq"]!.script.push(reply("ok"));
    await call("POST", `/api/bots/${bot.id}/chat`, { message: "one" });
    const before = providers["groq"]!.calls.length + providers["gemini"]!.calls.length;
    expect((await call("POST", `/api/bots/${bot.id}/chat`, { message: "two" })).status).toBe(429);
    expect(providers["groq"]!.calls.length + providers["gemini"]!.calls.length).toBe(before);
    const all = Object.values((await call("GET", "/api/llm/routing")).body.preview as Record<string, { ref: string }[]>).flat();
    expect(all.length).toBeGreaterThan(0);
  });

  it("the history keeps at most 50 decisions, newest first", async () => {
    await start();
    const bot = await mkBot();
    for (let i = 0; i < 55; i++) {
      providers["groq"]!.script.push(reply(`r${i}`));
      await call("POST", `/api/bots/${bot.id}/chat`, { message: `m${i}` });
    }
    const h = await history();
    expect(h.recent).toHaveLength(50);
    expect(Date.parse(h.recent[0].at)).toBeGreaterThanOrEqual(Date.parse(h.recent[49].at));
  });
});
