import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestApp, FAKE_GEMINI_KEY, type TestApp } from "../test-app.js";
import { ollamaPlugin } from "./plugins/ollama.js";
import { modelInfo } from "./test-helpers.js";
import { PROFILES, PROFILE_DATE } from "./profiles.js";
import { PLUGINS } from "./plugins/index.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
let t: TestApp;
afterEach(async () => {
  await t?.app.close();
  vi.unstubAllEnvs();
});

describe("provider profiles", () => {
  it("every provider has a dated profile, and nothing in this app can send images or tools yet", () => {
    for (const p of PLUGINS) {
      const prof = PROFILES[p.id];
      expect(prof, p.id).toBeDefined();
      expect(prof!.verifiedOn).toBe(PROFILE_DATE);
      expect(prof!.inThisApp).toEqual({ vision: false, toolCalling: false });
    }
  });

  it("models Ollama runs on its own servers are never free", () => {
    for (const id of ["gpt-oss:120b-cloud", "qwen3-coder:480b-cloud", "x:cloud", "deepseek-v4.1-flash-cloud"]) {
      expect(ollamaPlugin.classifyModel(modelInfo(id)).status, id).toBe("blocked");
    }
    for (const id of ["llama3.2:3b", "qwen3.8:27b", "cloudy-model:7b", "lfm3-vl:2b"]) {
      expect(ollamaPlugin.classifyModel(modelInfo(id)).status, id).toBe("verified_free");
    }
  });

  it("the providers API carries the profile, the app's own quota and the application-automation switch (off by default)", async () => {
    t = await createTestApp();
    const list = (await t.call("GET", "/api/llm/providers")).body.providers as any[];
    const gemini = list.find((p) => p.id === "gemini");
    expect(gemini.profile.costClass).toBe("free_with_limits");
    expect(gemini.appAutomation).toBe(false);
    expect(gemini.quota).toMatchObject({ dailyCap: 50, requestsToday: 0, exhausted: false });
    expect(JSON.stringify(list)).not.toContain(FAKE_GEMINI_KEY);
  });

  it("a provider can be allowed for application automation only while it is switched on, and switching it off removes the permission", async () => {
    t = await createTestApp();
    vi.stubEnv("GEMINI_API_KEY", FAKE_GEMINI_KEY);
    const refused = await t.call("PATCH", "/api/llm/providers/gemini", { appAutomation: true });
    expect(refused.status).toBe(409);
    await t.call("PATCH", "/api/llm/providers/gemini", { freeConfirmed: true, enabled: true });
    expect((await t.call("PATCH", "/api/llm/providers/gemini", { appAutomation: true })).body.provider.appAutomation).toBe(true);
    expect((await t.call("PATCH", "/api/llm/providers/gemini", { enabled: false })).body.provider.appAutomation).toBe(false);
  });
});
