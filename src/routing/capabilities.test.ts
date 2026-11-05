import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { ScriptedProvider, makeCaller, modelInfo } from "../llm/test-helpers.js";
import { capabilitiesOf, meets } from "./capabilities.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
describe("capability facts", () => {
  it("never guesses: unknown is the default, and a requirement needs a confirmed yes", () => {
    const plain = capabilitiesOf({ modelId: "llama-3.1-8b-instant", contextWindow: 131072 });
    expect(plain).toMatchObject({ text: "yes", image_input: "unknown", tool_calling: "unknown", structured_output: "unknown", audio_output: "unknown", long_context: "yes", coding: "unknown" });
    expect(capabilitiesOf({ modelId: "tiny", contextWindow: 8192 }).long_context).toBe("no");
    expect(capabilitiesOf({ modelId: "qwen-coder-7b", contextWindow: null }).coding).toBe("yes");
    expect(capabilitiesOf({ modelId: "gemini-2.5-flash", contextWindow: null })).toMatchObject({ image_input: "yes", vision: "yes", audio_input: "yes", long_context: "yes" });
  });
  it("a capability this app cannot use yet is never met, even when the model has it", () => {
    const r = meets({ modelId: "gemini-2.5-flash", contextWindow: 1_000_000 }, ["image_input"]);
    expect(r.ok).toBe(false);
    expect(r.missing[0]).toMatch(/not usable by this app yet/);
    expect(meets({ modelId: "llama-3.1-8b", contextWindow: 131072 }, ["long_context", "text"]).ok).toBe(true);
    expect(meets({ modelId: "llama-3.1-8b", contextWindow: null }, ["long_context"]).missing[0]).toMatch(/not confirmed/);
    expect(meets({ modelId: "x", contextWindow: 4096 }, ["long_context"]).missing[0]).toMatch(/not supported/);
  });
});

describe("capability-aware automatic routing", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  afterEach(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });
  async function start() {
    vi.stubEnv("GEMINI_API_KEY", "AIzaSyFAKEKEYFORTESTSONLY0123456789");
    vi.stubEnv("GROQ_API_KEY", "gsk_FAKEKEYFORTESTSONLY0123456789ab");
    const clock = { t: new Date(2026, 5, 15, 12, 0, 0).getTime() };
    const providers: Record<string, ScriptedProvider> = { gemini: new ScriptedProvider(), groq: new ScriptedProvider(), ollama: new ScriptedProvider(), openrouter: new ScriptedProvider(), omniroute: new ScriptedProvider() };
    providers["gemini"]!.models = [modelInfo("gemini-2.5-flash", { contextWindow: 1_000_000 } as any)];
    providers["groq"]!.models = [modelInfo("small-8b", { contextWindow: 8192 } as any), modelInfo("big-70b", { contextWindow: 131072 } as any)];
    app = await buildApp({ dbPath: ":memory:",
    verification: "off", connectors: [], clock: () => clock.t, sleep: async (ms) => void (clock.t += ms), providerFactory: (_p, plugin) => providers[plugin.id]!, routingDefaults: { autoAssignNewBots: false } });
    const call = makeCaller(app);
    for (const id of ["gemini", "groq"]) await call("PATCH", `/api/llm/providers/${id}`, { freeConfirmed: true, enabled: true });
    await call("POST", "/api/llm/routing/refresh-all");
    for (const m of (await call("GET", "/api/llm/models")).body.models as any[]) await call("PATCH", `/api/llm/models/${m.id}`, { enabled: true });
    return { call, providers };
  }

  it("shows each model's capability facts in the model list", async () => {
    const { call } = await start();
    const models = (await call("GET", "/api/llm/models")).body.models as any[];
    const g = models.find((m) => m.modelId === "gemini-2.5-flash");
    expect(g.capabilities).toMatchObject({ text: "yes", image_input: "yes", long_context: "yes" });
    expect(models.find((m) => m.modelId === "small-8b").capabilities.long_context).toBe("no");
  });

  it("only offers models confirmed for the requirement; nothing eligible means no model is tried", async () => {
    const { providers } = await start();
    const router = (app as any).modelRouter;
    expect(router.candidates("general").map((c: any) => c.ref).sort()).toEqual(["gemini/gemini-2.5-flash", "groq/big-70b", "groq/small-8b"]);
    expect(router.candidates("general", undefined, ["long_context"]).map((c: any) => c.ref).sort()).toEqual(["gemini/gemini-2.5-flash", "groq/big-70b"]);
    expect(router.candidates("general", undefined, ["image_input"])).toEqual([]);
    const before = providers["gemini"]!.calls.length + providers["groq"]!.calls.length;
    await expect(router.complete({ botId: null, conversationId: null, modelRef: "auto/general", messages: [{ role: "user", content: "look at this picture" }], temperature: 0, maxOutputTokens: 50, require: ["image_input"] })).rejects.toThrow(/This task needs: picture input/);
    expect(providers["gemini"]!.calls.length + providers["groq"]!.calls.length).toBe(before);
  });
});
