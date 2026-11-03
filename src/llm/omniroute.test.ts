import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { makeCaller } from "./test-helpers.js";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible.js";
import { classifyOmniRouteModel, isRoutingModelId, omniRoutePlugin } from "./plugins/omniroute.js";
import { redactKnownSecrets } from "./plugins/index.js";
import { LlmError } from "./errors.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const KEY = "omni-test-key-0123456789abcdefXYZ";
const FREE = "Free-Prov/Llama-3.3-70B:Instruct"; // mixed case, slash and colon: must be kept exactly

const zero = { prompt: "0", completion: "0" };
const baseModels = () => [
  { id: FREE, name: "Llama 3.3 70B (free)", owned_by: "free-prov", pricing: zero },
  { id: "paid/gpt-x", owned_by: "paid", pricing: { prompt: "0.000002", completion: "0.00001" } },
  { id: "mystery/unknown-price", owned_by: "mystery" },
  { id: "half/one-sided", pricing: { prompt: "0" } },
  { id: "auto", owned_by: "omniroute", pricing: zero },
  { id: "my-combo", owned_by: "combo", pricing: zero },
  { id: "fast/best-of-three", pricing: zero },
  { id: "free-prov/embed-text-1", pricing: zero },
];

/** A pretend OmniRoute on this PC: OpenAI-compatible, needs the key, records every request, and can misbehave. */
async function startFakeOmniRoute() {
  const seen: { method: string; url: string; auth?: string | undefined; body: any }[] = [];
  const mode = {
    models: baseModels() as any[],
    chatStatus: 200,
    chatError: "",
    reply: "Hello from OmniRoute",
    cost: undefined as number | undefined,
    delayMs: 0,
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      seen.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
      const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(payload));
      };
      if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: { message: `Invalid API key (got ${req.headers.authorization})` } });
      if (req.method === "GET" && req.url === "/v1/models") return send(200, { object: "list", data: mode.models });
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        setTimeout(() => {
          if (mode.chatStatus !== 200) return send(mode.chatStatus, { error: { message: mode.chatError || "failure" } }, mode.chatStatus === 429 ? { "retry-after": "1" } : {});
          send(200, {
            choices: [{ message: { role: "assistant", content: mode.reply }, finish_reason: "stop" }],
            usage: { prompt_tokens: 12, completion_tokens: 6, ...(mode.cost !== undefined ? { cost: mode.cost } : {}) },
          });
        }, mode.delayMs);
        return;
      }
      send(404, { error: { message: "not found" } });
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  const chats = () => seen.filter((s) => s.url === "/v1/chat/completions");
  return { url: `http://127.0.0.1:${port}/v1`, seen, chats, mode, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe("OmniRoute: what counts as a free, explicit model", () => {
  const info = (id: string, over: Record<string, unknown> = {}) => ({ id, displayName: id, contextWindow: null, priceInput: 0, priceOutput: 0, ...over });

  it("allows only an explicit model that OmniRoute itself lists at price 0 for input AND output", () => {
    expect(classifyOmniRouteModel(info("prov/model-a")).status).toBe("verified_free");
    expect(classifyOmniRouteModel(info("prov/model-a", { priceInput: null })).status).toBe("blocked");
    expect(classifyOmniRouteModel(info("prov/model-a", { priceOutput: null })).status).toBe("blocked");
    expect(classifyOmniRouteModel(info("prov/model-a", { priceInput: 0.000001 })).status).toBe("blocked");
    expect(classifyOmniRouteModel(info("prov/model-a", { priceOutput: 0.000001 })).status).toBe("blocked");
    expect(classifyOmniRouteModel(info("prov/model-a:free", { priceInput: null, priceOutput: null })).status).toBe("blocked"); // a ":free" name proves nothing here
    expect(classifyOmniRouteModel(info("prov/model-a", { ownedBy: "combo" })).status).toBe("blocked");
  });

  it.each(["auto", "Auto", "omniroute/auto", "my-combo", "free-combo-1", "fallback", "a,b", "a|b", "smart-router", "best", "cheapest", "provider/any", "omniroute/gpt-4", "round-robin", "load_balance"])(
    "refuses the routing-style name %s even at price 0",
    (id) => {
      expect(isRoutingModelId(id)).toBe(true);
      expect(classifyOmniRouteModel(info(id)).status).toBe("blocked");
    },
  );

  it.each(["gc/gemini-2.5-flash", "free-prov/Llama-3.3-70B:Instruct", "openai/gpt-4o-mini", "kiro/claude-sonnet-4.5", "autoglm/phone"])("does not mistake the ordinary name %s for routing", (id) => {
    expect(isRoutingModelId(id)).toBe(false);
  });

  it("defaults: this PC's address, the vault key name, a daily cap, and a cloud-style key and limits", () => {
    expect(omniRoutePlugin).toMatchObject({ id: "omniroute", kind: "cloud", defaultBaseUrl: "http://127.0.0.1:20128/v1", apiKeyEnv: "OMNIROUTE_API_KEY", defaultDailyRequestCap: 40 });
  });
});

describe("OmniRoute through the whole app (pretend OmniRoute on this PC)", () => {
  let om: Awaited<ReturnType<typeof startFakeOmniRoute>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let call: ReturnType<typeof makeCaller>;
  beforeEach(async () => {
    om = await startFakeOmniRoute();
    app = await buildApp({ dbPath: ":memory:", connectors: [], sleep: async () => undefined });
    call = makeCaller(app);
  });
  afterEach(async () => {
    await app.close();
    await om.close();
  });

  const saveKey = (value = KEY) => call("PUT", "/api/vault/OMNIROUTE_API_KEY", { value });
  const point = () => call("PATCH", "/api/llm/providers/omniroute", { baseUrl: om.url });
  const provider = async () => ((await call("GET", "/api/llm/providers")).body.providers as any[]).find((p) => p.id === "omniroute");
  const models = async () => (await call("GET", "/api/llm/models?providerId=omniroute")).body.models as any[];
  const connect = async () => {
    await saveKey();
    await point();
    expect((await call("PATCH", "/api/llm/providers/omniroute", { enabled: true })).status).toBe(200);
  };
  const refresh = () => call("POST", "/api/llm/providers/omniroute/refresh-models");
  const enable = async (modelId = FREE) => {
    const m = (await models()).find((x) => x.modelId === modelId)!;
    return call("PATCH", `/api/llm/models/${m.id}`, { enabled: true });
  };
  const readyBot = async () => {
    await connect();
    await refresh();
    await enable();
    return (await call("POST", "/api/bots", { name: "Gate", model: `omniroute/${FREE}` })).body.bot as any;
  };
  const chat = (botId: string, message = "hi") => call("POST", `/api/bots/${botId}/chat`, { message });

  describe("connecting", () => {
    it("shows the default address, uses a vault key, and never returns the key", async () => {
      expect(await provider()).toMatchObject({ baseUrl: "http://127.0.0.1:20128/v1", keyEnv: "OMNIROUTE_API_KEY", keyConfigured: false, baseUrlEditable: true, dailyRequestCap: 40, enabled: false });
      await saveKey();
      expect((await provider()).keyConfigured).toBe(true);
      for (const url of ["/api/llm/providers", "/api/llm/models", "/api/llm/status", "/api/vault", "/api/audit?limit=100", "/api/external/status"]) {
        expect((await app.inject({ method: "GET", url })).body).not.toContain(KEY);
      }
    });

    it("the address can be changed, but only to this PC", async () => {
      expect((await point()).body.provider.baseUrl).toBe(om.url);
      expect((await call("PATCH", "/api/llm/providers/omniroute", { baseUrl: "https://example.com/v1" })).status).toBe(400);
      expect((await call("PATCH", "/api/llm/providers/omniroute", { baseUrl: "http://192.168.1.20:20128/v1" })).status).toBe(400);
      expect((await provider()).baseUrl).toBe(om.url);
    });

    it("connection test: no key, wrong key, then success; the test makes no chat call", async () => {
      await point();
      expect((await call("POST", "/api/llm/providers/omniroute/test")).body.provider).toMatchObject({ status: "key_missing" });
      await saveKey("a-wrong-key-0000000000");
      const wrong = (await call("POST", "/api/llm/providers/omniroute/test")).body.provider;
      expect(wrong.status).toBe("auth_failed");
      expect(JSON.stringify(wrong)).not.toContain("a-wrong-key-0000000000");
      await saveKey();
      expect((await call("POST", "/api/llm/providers/omniroute/test")).body.provider).toMatchObject({ status: "connected", statusMessage: expect.stringContaining("7 models") });
      expect(om.chats()).toHaveLength(0);
    });

    it("says so when OmniRoute is not running", async () => {
      await saveKey();
      await om.close();
      await point();
      expect((await call("POST", "/api/llm/providers/omniroute/test")).body.provider.status).toBe("unreachable");
      om.close = async () => undefined;
    });
  });

  describe("model discovery", () => {
    it("lists models with their ids exactly as returned; only explicit price-0 models are usable, the rest show why they are blocked", async () => {
      await connect();
      expect((await refresh()).status).toBe(200);
      const list = await models();
      expect(list.map((m) => m.modelId).sort()).toEqual([FREE, "paid/gpt-x", "mystery/unknown-price", "half/one-sided", "auto", "my-combo", "fast/best-of-three"].sort());
      const by = (id: string) => list.find((m) => m.modelId === id)!;
      expect(by(FREE)).toMatchObject({ ref: `omniroute/${FREE}`, displayName: "Llama 3.3 70B (free)", freeStatus: "verified_free", availability: "available", providerName: "OmniRoute (gateway)" });
      expect(by(FREE).freeSource).toMatch(/price 0.*free-prov/);
      for (const id of ["paid/gpt-x", "mystery/unknown-price", "half/one-sided", "auto", "my-combo", "fast/best-of-three"]) {
        expect(by(id)).toMatchObject({ freeStatus: "blocked", callable: false });
        expect(by(id).freeSource).toMatch(/^Blocked:/);
      }
      expect(by("paid/gpt-x").freeSource).toMatch(/not free/);
      expect(by("mystery/unknown-price").freeSource).toMatch(/did not list a price/);
    });

    it("blocked models cannot be switched on or given to a bot", async () => {
      await connect();
      await refresh();
      for (const id of ["paid/gpt-x", "mystery/unknown-price", "auto", "my-combo"]) {
        expect((await enable(id)).status).toBe(409);
        const res = await call("POST", "/api/bots", { name: `B-${id.length}`, model: `omniroute/${id}` });
        expect(res.status).toBeGreaterThanOrEqual(400);
      }
    });

    it("refreshing keeps bots, enabled choices and ids; models that disappear become unavailable and come back later", async () => {
      const bot = await readyBot();
      om.mode.models = om.mode.models.filter((m) => m.id !== FREE);
      await refresh();
      expect((await models()).find((m) => m.modelId === FREE)).toMatchObject({ availability: "removed", enabled: true, callable: false });
      const refused = await chat(bot.id);
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(refused.body)).toMatch(/no longer lists/);
      expect(om.chats()).toHaveLength(0);
      expect((await call("GET", `/api/bots/${bot.id}`)).body.bot.model).toBe(`omniroute/${FREE}`); // the bot keeps its choice
      om.mode.models = baseModels();
      await refresh();
      expect((await models()).find((m) => m.modelId === FREE)).toMatchObject({ availability: "available", enabled: true, callable: true });
      expect((await chat(bot.id)).status).toBe(200);
    });

    it("a model that later shows a price is switched off and can no longer be called", async () => {
      const bot = await readyBot();
      om.mode.models = baseModels().map((m) => (m.id === FREE ? { ...m, pricing: { prompt: "0.000001", completion: "0.000002" } } : m));
      await refresh();
      expect((await models()).find((m) => m.modelId === FREE)).toMatchObject({ freeStatus: "blocked", enabled: false, callable: false });
      expect((await chat(bot.id)).status).toBeGreaterThanOrEqual(400);
      expect(om.chats()).toHaveLength(0);
    });

    it("a model that later loses its price is blocked too (unknown is not free)", async () => {
      const bot = await readyBot();
      om.mode.models = baseModels().map((m) => (m.id === FREE ? { id: m.id } : m));
      await refresh();
      expect((await models()).find((m) => m.modelId === FREE)).toMatchObject({ freeStatus: "blocked", callable: false });
      expect((await chat(bot.id)).status).toBeGreaterThanOrEqual(400);
      expect(om.chats()).toHaveLength(0);
    });

    it("a failed refresh reports the problem and leaves the catalog and bots alone", async () => {
      const bot = await readyBot();
      await saveKey("rotated-wrong-key-00000000");
      const res = await refresh();
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect((await models()).find((m) => m.modelId === FREE)).toMatchObject({ enabled: true, availability: "available" });
      expect((await call("GET", `/api/bots/${bot.id}`)).body.bot.model).toBe(`omniroute/${FREE}`);
    });
  });

  describe("chatting through OmniRoute", () => {
    it("sends only the chosen model id, the messages and the limits, with the key as a Bearer header: no tools, fallbacks or routing", async () => {
      const bot = await readyBot();
      const res = await chat(bot.id, "hello there");
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).toContain("Hello from OmniRoute");
      const [sent] = om.chats();
      expect(sent!.auth).toBe(`Bearer ${KEY}`);
      expect(Object.keys(sent!.body).sort()).toEqual(["max_tokens", "messages", "model", "stream", "temperature"]);
      expect(sent!.body.model).toBe(FREE);
      expect(sent!.body.stream).toBe(false);
      expect(JSON.stringify((await call("GET", "/api/llm/usage")).body)).toContain("omniroute");
    });

    it.each([
      [429, `slow down, key ${KEY} is limited`, /too many requests/],
      [500, "upstream exploded", /HTTP 500/],
      [404, "model not found", /does not know that model/],
      [402, "payment required", /only uses free models/],
      [400, `bad thing with ${KEY}`, /refused the request/],
    ])("a %i answer becomes a friendly error, with the key removed from anything shown", async (status, message, expected) => {
      const bot = await readyBot();
      om.mode.chatStatus = status;
      om.mode.chatError = message;
      const res = await chat(bot.id);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(res.body)).toMatch(expected);
      expect(JSON.stringify(res.body)).not.toContain(KEY);
      expect(JSON.stringify((await call("GET", "/api/audit?limit=100")).body)).not.toContain(KEY);
    });

    it("a wrong or revoked key is reported without echoing it", async () => {
      const bot = await readyBot();
      await saveKey("revoked-key-0000000000000000");
      const res = await chat(bot.id);
      expect(JSON.stringify(res.body)).toMatch(/rejected the API key/);
      expect(JSON.stringify(res.body)).not.toContain("revoked-key-0000000000000000");
    });

    it("a model that reports a cost is switched off automatically", async () => {
      const bot = await readyBot();
      om.mode.cost = 0.002;
      await chat(bot.id);
      expect((await models()).find((m) => m.modelId === FREE)).toMatchObject({ enabled: false, callable: false });
      const after = om.chats().length;
      expect((await chat(bot.id)).status).toBeGreaterThanOrEqual(400);
      expect(om.chats()).toHaveLength(after);
    });

    it("the daily request cap applies: the call over the cap never reaches OmniRoute", async () => {
      const bot = await readyBot();
      await call("PATCH", "/api/llm/providers/omniroute", { dailyRequestCap: 1 });
      expect((await chat(bot.id)).status).toBe(200);
      const second = await chat(bot.id);
      expect(second.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(second.body)).toMatch(/Daily OmniRoute|limit/i);
      expect(om.chats()).toHaveLength(1);
    });

    it("the cap cannot be removed for the gateway, and the pause switch stops everything", async () => {
      const bot = await readyBot();
      expect((await call("PATCH", "/api/llm/providers/omniroute", { dailyRequestCap: null })).status).toBe(400);
      await call("PUT", "/api/llm/pause", { paused: true });
      expect((await chat(bot.id)).status).toBeGreaterThanOrEqual(400);
      expect(om.chats()).toHaveLength(0);
    });

    it("switching the provider off stops calls; there is no way to turn free-only off", async () => {
      const bot = await readyBot();
      await call("PATCH", "/api/llm/providers/omniroute", { enabled: false });
      expect((await chat(bot.id)).status).toBeGreaterThanOrEqual(400);
      expect(om.chats()).toHaveLength(0);
      expect((await call("PATCH", "/api/llm/providers/omniroute", { freeOnly: false })).status).toBe(400);
    });
  });

  it("the adapter times out cleanly when OmniRoute is too slow", async () => {
    om.mode.delayMs = 400;
    const provider = new OpenAiCompatibleProvider({ baseUrl: om.url, apiKey: KEY, plugin: omniRoutePlugin, redact: redactKnownSecrets });
    const err = await provider.complete({ model: FREE, messages: [{ role: "user", content: "x" }], temperature: 0.5, maxOutputTokens: 50, timeoutMs: 80 }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.llmCode).toBe("timeout");
  });
});
