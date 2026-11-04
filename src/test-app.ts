/* Test-only helper: builds the whole app with a scripted fake provider and a controllable clock. */
import type { FastifyInstance } from "fastify";
import { vi } from "vitest";
import { buildApp } from "./app.js";
import type { GoogleUrls } from "./connectors/gmail.js";
import type { ConnectorDefinition } from "./connectors/types.js";
import { ScriptedProvider, makeCaller, modelInfo } from "./llm/test-helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface TestApp {
  app: FastifyInstance;
  provider: ScriptedProvider;
  /** A fake clock. Change `clock.t` to jump in time. */
  clock: { t: number };
  /** Every wait the retry logic asked for (the fake sleep also advances the clock). */
  sleeps: number[];
  call: ReturnType<typeof makeCaller>;
}

export const FAKE_GEMINI_KEY = "AIzaSyFAKEKEYFORTESTSONLY0123456789";

export async function createTestApp(options: { connectors?: ConnectorDefinition[]; googleUrls?: GoogleUrls; remoteHosts?: string[]; dashboardDir?: string; pushAllowHost?: (host: string) => boolean } = {}): Promise<TestApp> {
  const provider = new ScriptedProvider();
  const clock = { t: new Date(2026, 5, 15, 12, 0, 0).getTime() };
  const sleeps: number[] = [];
  const app = await buildApp({
    dbPath: ":memory:",
    // Older tests expect a new bot to have NO model until one is chosen; routing tests switch automatic assignment back on.
    routingDefaults: { autoAssignNewBots: false },
    managerPollMs: 5,
    connectors: options.connectors ?? [], // tests never get a real connector unless they ask for one
    ...(options.googleUrls ? { googleUrls: options.googleUrls } : {}),
    ...(options.remoteHosts ? { remoteHosts: options.remoteHosts } : {}),
    ...(options.pushAllowHost ? { pushAllowHost: options.pushAllowHost } : {}),
    ...(options.dashboardDir ? { dashboardDir: options.dashboardDir } : {}),
    providerFactory: () => provider,
    clock: () => clock.t,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.t += ms;
    },
  });
  return { app, provider, clock, sleeps, call: makeCaller(app) };
}

/** Makes Gemini usable: key present, confirmed, enabled, one model listed and switched on. Returns "gemini/<id>". */
export async function setupGeminiModel(t: TestApp, modelId = "gemini-test"): Promise<string> {
  vi.stubEnv("GEMINI_API_KEY", FAKE_GEMINI_KEY);
  t.provider.models = [modelInfo(modelId)];
  expectOk(await t.call("PATCH", "/api/llm/providers/gemini", { freeConfirmed: true, enabled: true }));
  const refreshed = await t.call("POST", "/api/llm/providers/gemini/refresh-models");
  expectOk(refreshed);
  const model = refreshed.body.models.find((m: any) => m.modelId === modelId);
  expectOk(await t.call("PATCH", `/api/llm/models/${model.id}`, { enabled: true }));
  return `gemini/${modelId}`;
}

/** Makes the local provider usable with one installed model. Returns "ollama/<id>". */
export async function setupOllamaModel(t: TestApp, modelId = "llama3.1:8b"): Promise<string> {
  t.provider.models = [modelInfo(modelId)];
  expectOk(await t.call("PATCH", "/api/llm/providers/ollama", { enabled: true }));
  const refreshed = await t.call("POST", "/api/llm/providers/ollama/refresh-models");
  expectOk(refreshed);
  const model = refreshed.body.models.find((m: any) => m.modelId === modelId);
  expectOk(await t.call("PATCH", `/api/llm/models/${model.id}`, { enabled: true }));
  return `ollama/${modelId}`;
}

function expectOk(res: { status: number; body: any }): void {
  if (res.status >= 400) throw new Error(`Setup call failed (${res.status}): ${JSON.stringify(res.body)}`);
}
