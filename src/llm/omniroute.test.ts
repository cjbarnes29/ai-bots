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
    /** undefined = answer with the requested model (normal); null = leave the model out; a string = answer as that model. */
    returnModel: undefined as string | null | undefined,
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
          const asked = JSON.parse(raw).model;
          send(200, {
            ...(mode.returnModel === null ? {} : { model: mode.returnModel ?? asked }),
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

describe("OmniRoute: pricing in every format", () => {
  const listed = (extra: Record<string, unknown>) => ({ id: "prov/model-a", displayName: "m", contextWindow: null, priceInput: null, priceOutput: null, ...extra });
  const status = (pricingFields: Record<string, unknown>) => classifyOmniRouteModel(listed({ pricingFields })).status;
  const why = (pricingFields: Record<string, unknown>) => classifyOmniRouteModel(listed({ pricingFields })).source;

  it.each([
    ["OpenRouter style, strings", { "pricing.prompt": "0", "pricing.completion": "0" }],
    ["OpenRouter style, numbers", { "pricing.prompt": 0, "pricing.completion": 0 }],
    ["OpenRouter style with every extra field at zero", { "pricing.prompt": "0", "pricing.completion": "0", "pricing.request": "0", "pricing.image": "0", "pricing.web_search": "0", "pricing.internal_reasoning": "0", "pricing.input_cache_read": "0", "pricing.input_cache_write": "0" }],
    ["input and output", { "pricing.input": 0, "pricing.output": 0 }],
    ["per token at the top level (LiteLLM style)", { input_cost_per_token: 0, output_cost_per_token: 0 }],
    ["per million", { "pricing.input_per_million": "0.0", "pricing.output_per_million": "0.00" }],
    ["camelCase", { inputCostPerToken: 0, outputCostPerToken: 0 }],
    ["scientific zero and a currency label", { "pricing.prompt": "0e0", "pricing.completion": 0, "pricing.currency": "USD", "pricing.unit": "per_token" }],
  ])("verifies free: %s", (_name, fields) => {
    expect(status(fields)).toBe("verified_free");
  });

  it.each([
    ["no pricing at all", {}],
    ["only an input price", { "pricing.prompt": 0 }],
    ["only an output price", { "pricing.completion": "0" }],
    ["a non-zero input price", { "pricing.prompt": "0.0000001", "pricing.completion": 0 }],
    ["a non-zero output price", { "pricing.prompt": 0, "pricing.completion": "0.000001" }],
    ["non-zero request price", { "pricing.prompt": 0, "pricing.completion": 0, "pricing.request": "0.01" }],
    ["non-zero image price", { "pricing.prompt": 0, "pricing.completion": 0, "pricing.image": 0.5 }],
    ["non-zero web search price", { "pricing.prompt": 0, "pricing.completion": 0, "pricing.web_search": "0.014" }],
    ["non-zero reasoning price", { "pricing.prompt": 0, "pricing.completion": 0, "pricing.internal_reasoning": "0.00001" }],
    ["non-zero cache price", { "pricing.prompt": 0, "pricing.completion": 0, "pricing.input_cache_write": "0.000003" }],
    ["a non-zero per-request price at the top level", { "pricing.prompt": 0, "pricing.completion": 0, cost_per_request: 0.002 }],
    ["formats that disagree (zero in one, a price in another)", { "pricing.prompt": 0, "pricing.completion": 0, input_cost_per_token: 0.000001 }],
    ["the word free instead of a number", { "pricing.prompt": "free", "pricing.completion": "free" }],
    ["null prices", { "pricing.prompt": null, "pricing.completion": null }],
    ["an empty string price", { "pricing.prompt": "", "pricing.completion": 0 }],
    ["an unreadable extra field", { "pricing.prompt": 0, "pricing.completion": 0, "pricing.tiers": { a: 1 } }],
    ["a boolean", { "pricing.prompt": false, "pricing.completion": false }],
    ["a negative price", { "pricing.prompt": -1, "pricing.completion": 0 }],
    ["NaN or Infinity", { "pricing.prompt": Number.NaN, "pricing.completion": Number.POSITIVE_INFINITY }],
    ["pricing given as a plain string", { pricing: "free" }],
    ["pricing given as a number", { pricing: 0 }],
    ["only unrelated zero fields", { "pricing.request": 0, "pricing.image": 0 }],
  ])("blocks: %s", (_name, fields) => {
    expect(status(fields as Record<string, unknown>)).toBe("blocked");
    expect(why(fields as Record<string, unknown>)).toMatch(/^Blocked: OmniRoute pricing could not be verified as free/);
  });

  it("explains disagreement and non-zero prices differently", () => {
    expect(why({ "pricing.prompt": 0, "pricing.completion": 0, input_cost_per_token: 0.1 })).toMatch(/disagree/);
    expect(why({ "pricing.prompt": 1, "pricing.completion": 1 })).toMatch(/it has a price/);
  });

  it("the adapter hands the gateway check every price-like field it was sent, untouched", async () => {
    const om = await startFakeOmniRoute();
    try {
      om.mode.models = [{ id: "a/one", pricing: { prompt: "0", completion: "0", image: "0.5", currency: "USD" }, input_cost_per_token: 0, display_price_note: "x", context_length: 8000 }];
      const provider = new OpenAiCompatibleProvider({ baseUrl: om.url, apiKey: KEY, plugin: omniRoutePlugin, redact: redactKnownSecrets });
      const [info] = await provider.listModels(2000);
      expect(info!.pricingFields).toEqual({ "pricing.prompt": "0", "pricing.completion": "0", "pricing.image": "0.5", "pricing.currency": "USD", input_cost_per_token: 0, display_price_note: "x" });
      expect(classifyOmniRouteModel(info!).status).toBe("blocked"); // the image price and the unreadable note both block it
    } finally {
      await om.close();
    }
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
      expect(by(FREE).freeSource).toMatch(/exactly 0 in every price field.*free-prov/);
      for (const id of ["paid/gpt-x", "mystery/unknown-price", "half/one-sided", "auto", "my-combo", "fast/best-of-three"]) {
        expect(by(id)).toMatchObject({ freeStatus: "blocked", callable: false });
        expect(by(id).freeSource).toMatch(/^Blocked:/);
      }
      expect(by("paid/gpt-x").freeSource).toMatch(/it has a price/);
      expect(by("mystery/unknown-price").freeSource).toMatch(/did not list both an input price and an output price/);
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

  describe("you confirm a model that lists no price", () => {
    const UNPRICED = "mystery/unknown-price";
    const confirm = async (modelId: string, verified = true, ack = true) => {
      const m = (await models()).find((x) => x.modelId === modelId)!;
      return call("PUT", `/api/llm/models/${m.id}/owner-verified`, { verified, ...(ack ? { iUnderstand: true } : {}) });
    };
    const find = async (id: string) => (await models()).find((x) => x.modelId === id)!;

    it("only a model whose sole problem is a missing price can be confirmed", async () => {
      await connect();
      await refresh();
      expect(await find(UNPRICED)).toMatchObject({ ownerOverridable: true, ownerVerified: false, freeStatus: "blocked" });
      expect(await find("half/one-sided")).toMatchObject({ ownerOverridable: true });
      for (const id of ["paid/gpt-x", "auto", "my-combo", "fast/best-of-three"]) {
        expect(await find(id)).toMatchObject({ ownerOverridable: false });
        const res = await confirm(id);
        expect(res.status, id).toBe(409);
        expect(res.body.error).toBe("not_overridable");
        expect(await find(id)).toMatchObject({ freeStatus: "blocked", ownerVerified: false });
      }
    });

    it("needs an explicit acknowledgement, and unknown models are refused", async () => {
      await connect();
      await refresh();
      expect((await confirm(UNPRICED, true, false)).status).toBe(400);
      expect(await find(UNPRICED)).toMatchObject({ ownerVerified: false });
      expect((await call("PUT", "/api/llm/models/999999/owner-verified", { verified: true, iUnderstand: true })).status).toBe(404);
    });

    it("once confirmed it is shown as yours, stays OFF until you switch it on, and then works like any other model", async () => {
      await connect();
      await refresh();
      const res = await confirm(UNPRICED);
      expect(res.status).toBe(200);
      expect(res.body.model).toMatchObject({ freeStatus: "free_tier", ownerVerified: true, enabled: false, callable: false });
      expect(res.body.model.freeSource).toMatch(/You confirmed/);
      expect((await enable(UNPRICED)).status).toBe(200);
      const bot = (await call("POST", "/api/bots", { name: "Mine", model: `omniroute/${UNPRICED}` })).body.bot;
      expect((await chat(bot.id)).status).toBe(200);
      expect(om.chats()[0]!.body.model).toBe(UNPRICED);
      expect(JSON.stringify((await call("GET", "/api/audit?limit=100")).body)).toContain("model.owner_free_confirmed");
    });

    it("the confirmation survives a refresh while OmniRoute still lists no price", async () => {
      await connect();
      await refresh();
      await confirm(UNPRICED);
      await enable(UNPRICED);
      await refresh();
      expect(await find(UNPRICED)).toMatchObject({ freeStatus: "free_tier", ownerVerified: true, enabled: true, callable: true });
    });

    it("a price appearing voids it, and it does NOT come back by itself when the price disappears again", async () => {
      await connect();
      await refresh();
      await confirm(UNPRICED);
      await enable(UNPRICED);
      om.mode.models = baseModels().map((m) => (m.id === UNPRICED ? { ...m, pricing: { prompt: "0.000001", completion: "0.000002" } } : m));
      await refresh();
      expect(await find(UNPRICED)).toMatchObject({ freeStatus: "blocked", ownerVerified: false, enabled: false, ownerOverridable: false });
      om.mode.models = baseModels();
      await refresh();
      expect(await find(UNPRICED)).toMatchObject({ freeStatus: "blocked", ownerVerified: false, enabled: false, ownerOverridable: true });
      expect(JSON.stringify((await call("GET", "/api/audit?limit=100")).body)).toContain("model.owner_free_withdrawn");
    });

    it("withdrawing blocks it again at once and stops calls", async () => {
      await connect();
      await refresh();
      await confirm(UNPRICED);
      await enable(UNPRICED);
      const bot = (await call("POST", "/api/bots", { name: "Mine", model: `omniroute/${UNPRICED}` })).body.bot;
      expect((await confirm(UNPRICED, false)).status).toBe(200);
      expect(await find(UNPRICED)).toMatchObject({ freeStatus: "blocked", ownerVerified: false, enabled: false, callable: false });
      expect((await chat(bot.id)).status).toBeGreaterThanOrEqual(400);
      expect(om.chats()).toHaveLength(0);
    });

    it("a confirmed model is still held to the identity rule, the cost rule and the daily cap", async () => {
      await connect();
      await refresh();
      await confirm(UNPRICED);
      await enable(UNPRICED);
      const bot = (await call("POST", "/api/bots", { name: "Mine", model: `omniroute/${UNPRICED}` })).body.bot;
      om.mode.returnModel = "paid/gpt-x";
      expect((await chat(bot.id)).body.error).toBe("llm_model_mismatch");
      expect(await find(UNPRICED)).toMatchObject({ freeStatus: "blocked", ownerVerified: false, enabled: false });
      await refresh();
      expect(await find(UNPRICED)).toMatchObject({ freeStatus: "blocked", ownerVerified: false }); // the mismatch cancelled your confirmation
    });

    it("a reported cost cancels the confirmation", async () => {
      await connect();
      await refresh();
      await confirm(UNPRICED);
      await enable(UNPRICED);
      const bot = (await call("POST", "/api/bots", { name: "Mine", model: `omniroute/${UNPRICED}` })).body.bot;
      om.mode.cost = 0.01;
      await chat(bot.id);
      expect(await find(UNPRICED)).toMatchObject({ freeStatus: "blocked", ownerVerified: false, enabled: false });
    });
  });

  describe("model identity", () => {
    it("accepts a reply that names exactly the requested model", async () => {
      const bot = await readyBot();
      om.mode.returnModel = FREE;
      expect((await chat(bot.id)).status).toBe(200);
    });

    it.each([
      ["a different model", "paid/gpt-x"],
      ["the same model with other letter case", FREE.toLowerCase()],
      ["the same model with extra text", `${FREE}-v2`],
      ["the same model with a trailing space", `${FREE} `],
      ["the model without its provider prefix", "Llama-3.3-70B:Instruct"],
      ["an auto-routing name", "auto"],
      ["an empty name", ""],
    ])("rejects a reply from %s, discards it, and blocks the model", async (_n, answeredAs) => {
      const bot = await readyBot();
      om.mode.returnModel = answeredAs;
      om.mode.reply = "SECRET REPLY FROM THE WRONG MODEL";
      const res = await chat(bot.id);
      expect(res.status).toBe(502);
      expect(res.body.error).toBe("llm_model_mismatch");
      expect(JSON.stringify(res.body)).not.toContain("SECRET REPLY");
      expect(JSON.stringify(res.body)).toContain(FREE);
      expect(om.chats()).toHaveLength(1);
      expect((await models()).find((m) => m.modelId === FREE)).toMatchObject({ freeStatus: "blocked", enabled: false, callable: false });
      expect((await chat(bot.id)).status).toBeGreaterThanOrEqual(400);
      expect(om.chats()).toHaveLength(1); // nothing more was sent to OmniRoute
    });

    it("rejects a reply that does not say which model answered", async () => {
      const bot = await readyBot();
      om.mode.returnModel = null;
      const res = await chat(bot.id);
      expect(res.body.error).toBe("llm_model_mismatch");
      expect(res.body.message).toMatch(/did not say which model answered/);
      expect((await models()).find((m) => m.modelId === FREE)).toMatchObject({ enabled: false, callable: false });
    });

    it("still counts the call and its tokens against the limits, and records why it failed", async () => {
      const bot = await readyBot();
      om.mode.returnModel = "paid/gpt-x";
      await chat(bot.id);
      const usage = JSON.stringify((await call("GET", "/api/llm/usage?days=1")).body);
      expect(usage).toContain("model_mismatch");
      expect(usage).toMatch(/18/); // 12 in + 6 out
    });

    it("a refresh does not quietly re-enable a model that answered as another one", async () => {
      const bot = await readyBot();
      om.mode.returnModel = "paid/gpt-x";
      await chat(bot.id);
      await refresh();
      expect((await models()).find((m) => m.modelId === FREE)).toMatchObject({ enabled: false, callable: false });
    });

    it("the odd model name is shown safely (one line, short)", async () => {
      const bot = await readyBot();
      om.mode.returnModel = "x\n\n" + "y".repeat(500);
      const res = await chat(bot.id);
      expect(res.body.message).not.toContain("\n");
      expect(res.body.message.length).toBeLessThan(400);
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
