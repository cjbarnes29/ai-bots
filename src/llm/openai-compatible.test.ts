import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LlmError } from "./errors.js";
import { geminiPlugin } from "./plugins/gemini.js";
import { redactKnownSecrets } from "./plugins/index.js";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible.js";
import { startFakeProviderServer, defaultHandler, type FakeServer } from "./test-helpers.js";
import type { CompletionRequest } from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
let server: FakeServer;
beforeAll(async () => {
  server = await startFakeProviderServer();
});
afterAll(async () => {
  await server.close();
});

const REQUEST: CompletionRequest = {
  model: "fake-model-1",
  messages: [
    { role: "system", content: "You are a test bot." },
    { role: "user", content: "Hi" },
  ],
  temperature: 0.4,
  maxOutputTokens: 200,
  timeoutMs: 2000,
};

function provider(overrides: { apiKey?: string | null; baseUrl?: string; plugin?: any } = {}) {
  return new OpenAiCompatibleProvider({
    baseUrl: overrides.baseUrl ?? server.baseUrl,
    apiKey: overrides.apiKey === undefined ? "test-key-123456" : overrides.apiKey,
    plugin: overrides.plugin ?? { normalizeModelId: (id: string) => id, isTextModel: () => true },
    redact: redactKnownSecrets,
  });
}

async function failure(p: Promise<unknown>): Promise<LlmError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(LlmError);
    return err as LlmError;
  }
  throw new Error("expected the call to fail");
}

function reset() {
  server.requests.length = 0;
  server.setHandler(defaultHandler);
}

describe("what is sent to the provider", () => {
  it("sends only model, messages, temperature, max_tokens and stream=false", async () => {
    reset();
    await provider().complete(REQUEST);
    const sent = server.requests[0]!;
    expect(sent.method).toBe("POST");
    expect(sent.url).toBe("/v1/chat/completions");
    expect(Object.keys(sent.body).sort()).toEqual(["max_tokens", "messages", "model", "stream", "temperature"]);
    expect(sent.body).toMatchObject({ model: "fake-model-1", temperature: 0.4, max_tokens: 200, stream: false });
    expect(sent.body.messages).toEqual(REQUEST.messages);
  });

  it("never sends tools, functions, fallback model lists or routing options", async () => {
    reset();
    await provider().complete(REQUEST);
    const text = JSON.stringify(server.requests[0]!.body);
    for (const forbidden of ["tools", "tool_choice", "functions", "function_call", "models", "route", "provider", "transforms", "plugins"]) {
      expect(text).not.toContain(`"${forbidden}"`);
    }
  });

  it("sends the key as a Bearer token, and no Authorization header when there is no key", async () => {
    reset();
    await provider({ apiKey: "test-key-123456" }).complete(REQUEST);
    expect(server.requests[0]!.headers["authorization"]).toBe("Bearer test-key-123456");
    await provider({ apiKey: null }).complete(REQUEST);
    expect(server.requests[1]!.headers["authorization"]).toBeUndefined();
  });
});

describe("reading replies", () => {
  it("returns the text, token usage and finish reason", async () => {
    reset();
    const result = await provider().complete(REQUEST);
    expect(result).toMatchObject({
      text: "Hello from the fake provider",
      inputTokens: 12,
      outputTokens: 6,
      finishReason: "stop",
      costReportedMicro: null,
      toolCallsIgnored: false,
    });
  });

  it("reports null token counts when the provider leaves usage out", async () => {
    reset();
    server.setHandler(() => ({ body: { choices: [{ message: { content: "hi" }, finish_reason: "stop" }] } }));
    const result = await provider().complete(REQUEST);
    expect(result.inputTokens).toBeNull();
    expect(result.outputTokens).toBeNull();
  });

  it("converts a reported cost to millionths of a dollar", async () => {
    reset();
    server.setHandler(() => ({
      body: { choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.000123 } },
    }));
    expect((await provider().complete(REQUEST)).costReportedMicro).toBe(123);
  });

  it("ignores tool calls: flags them and returns no action", async () => {
    reset();
    server.setHandler(() => ({
      body: {
        choices: [
          {
            message: { content: null, tool_calls: [{ id: "1", type: "function", function: { name: "send_email", arguments: "{}" } }] },
            finish_reason: "tool_calls",
          },
        ],
      },
    }));
    const result = await provider().complete(REQUEST);
    expect(result.toolCallsIgnored).toBe(true);
    expect(result.text).toBe("");
  });

  it("treats an empty reply as an error, and a content-filter stop as 'content_blocked'", async () => {
    reset();
    server.setHandler(() => ({ body: { choices: [{ message: { content: "  " }, finish_reason: "stop" }] } }));
    expect((await failure(provider().complete(REQUEST))).llmCode).toBe("bad_response");

    server.setHandler(() => ({ body: { choices: [{ message: { content: "x" }, finish_reason: "content_filter" }] } }));
    expect((await failure(provider().complete(REQUEST))).llmCode).toBe("content_blocked");
  });

  it("rejects replies that are not JSON or have the wrong shape", async () => {
    reset();
    server.setHandler(() => ({ raw: "<html>oops</html>" }));
    expect((await failure(provider().complete(REQUEST))).llmCode).toBe("bad_response");
    server.setHandler(() => ({ body: { nothing: true } }));
    expect((await failure(provider().complete(REQUEST))).llmCode).toBe("bad_response");
  });
});

describe("error handling", () => {
  const table: [number, string, boolean][] = [
    [401, "auth_failed", false],
    [403, "auth_failed", false],
    [402, "quota_exceeded", false],
    [404, "model_not_found", false],
    [400, "bad_request", false],
    [422, "bad_request", false],
    [408, "timeout", true],
    [429, "rate_limited", true],
    [500, "provider_unavailable", true],
    [503, "provider_unavailable", true],
  ];
  for (const [status, code, retryable] of table) {
    it(`HTTP ${status} becomes '${code}' (retryable: ${retryable})`, async () => {
      reset();
      server.setHandler(() => ({ status, body: { error: { message: "nope" } } }));
      const err = await failure(provider().complete(REQUEST));
      expect(err.llmCode).toBe(code);
      expect(err.retryable).toBe(retryable);
    });
  }

  it("reads the 'Retry-After' hint on a rate limit", async () => {
    reset();
    server.setHandler(() => ({ status: 429, headers: { "retry-after": "3" }, body: {} }));
    expect((await failure(provider().complete(REQUEST))).retryAfterMs).toBe(3000);
  });

  it("tells a used-up daily quota (or 'limit: 0', no free allowance at all) apart from a short per-minute limit", async () => {
    for (const [message, quota] of [
      ["You exceeded your current quota. Quota exceeded for metric generate_content_free_tier_requests, limit: 0, model: gemini-2.5-computer-use-preview", true],
      ["Quota exceeded for metric ... GenerateRequestsPerDayPerProjectPerModel-FreeTier", true],
      ["Resource has been exhausted: daily limit reached", true],
      ["Too many requests, slow down", false],
    ] as const) {
      reset();
      server.setHandler(() => ({ status: 429, body: { error: { message } } }));
      const err = await failure(provider().complete(REQUEST));
      expect(err.llmCode, message).toBe("rate_limited");
      expect(err.quota, message).toBe(quota);
      expect(err.retryable, message).toBe(!quota); // a daily quota is never worth retrying
    }
  });

  it("times out when the provider is too slow", async () => {
    reset();
    server.setHandler(() => ({ delayMs: 400, body: {} }));
    const err = await failure(provider().complete({ ...REQUEST, timeoutMs: 60 }));
    expect(err.llmCode).toBe("timeout");
    expect(err.retryable).toBe(true);
  });

  it("reports a network error when nothing is listening", async () => {
    const dead = await startFakeProviderServer();
    const url = dead.baseUrl;
    await dead.close();
    const err = await failure(provider({ baseUrl: url }).complete(REQUEST));
    expect(err.llmCode).toBe("network");
    expect(err.retryable).toBe(true);
  });

  it("reports a network error when the connection is dropped mid-request", async () => {
    reset();
    server.setHandler(() => ({ destroy: true }));
    expect((await failure(provider().complete(REQUEST))).llmCode).toBe("network");
  });

  it("never lets an API key reach an error message", async () => {
    reset();
    const leaked = "AIzaSyDUMMYKEYFORTESTING1234567890abcd";
    server.setHandler(() => ({
      status: 401,
      body: { error: { message: `API key ${leaked} is invalid. Header was Bearer abcdefghijklmnop123456` } },
    }));
    const err = await failure(provider({ apiKey: leaked }).complete(REQUEST));
    expect(err.message).not.toContain(leaked);
    expect(err.message).not.toContain("abcdefghijklmnop123456");
    expect(err.message).toContain("[redacted]");
  });

  it("REAL-RUN REGRESSION (P-44 run 4): Groq's 'model called a tool' 400 is the model's unusable reply (bad_output, routing tries the next model); other 400s stay bad_request", async () => {
    reset();
    server.setHandler(() => ({ status: 400, body: { error: { message: "Tool choice is none, but model called a tool", type: "invalid_request_error", code: "tool_use_failed" } } }));
    const err = await failure(provider().complete(REQUEST));
    expect(err.llmCode).toBe("bad_output");
    expect(err.message).toMatch(/tried to call a built-in tool, which this app does not offer/);
    server.setHandler(() => ({ status: 400, body: { error: { message: "messages: field required" } } }));
    expect((await failure(provider().complete(REQUEST))).llmCode).toBe("bad_request");
  });

  it("truncates very long provider messages", async () => {
    reset();
    server.setHandler(() => ({ status: 400, body: { error: { message: "x".repeat(5000) } } }));
    const err = await failure(provider().complete(REQUEST));
    expect(err.message.length).toBeLessThan(600);
  });
});

describe("listing models", () => {
  it("lists model ids and reads context size and prices", async () => {
    reset();
    server.setHandler(() => ({
      body: {
        data: [
          { id: "meta-llama/llama-x:free", name: "Llama X (free)", context_length: 8000, pricing: { prompt: "0", completion: "0" } },
          { id: "paid/model", pricing: { prompt: "0.000001", completion: "0.000002" } },
          { id: "no/pricing" },
        ],
      },
    }));
    const models = await provider().listModels(2000);
    expect(models).toHaveLength(3);
    expect(models[0]).toMatchObject({ id: "meta-llama/llama-x:free", displayName: "Llama X (free)", contextWindow: 8000, priceInput: 0, priceOutput: 0 });
    expect(models[1]).toMatchObject({ priceInput: 0.000001, priceOutput: 0.000002 });
    expect(models[2]).toMatchObject({ priceInput: null, priceOutput: null });
  });

  it("applies the provider's id clean-up and text-model filter, and removes duplicates", async () => {
    reset();
    server.setHandler(() => ({
      body: {
        data: [
          { id: "models/gemini-2.0-flash" },
          { id: "models/gemini-2.0-flash" },
          { id: "models/text-embedding-004" },
          { id: "models/imagen-3" },
          { id: "models/gemini-2.5-pro" },
        ],
      },
    }));
    const models = await provider({ plugin: geminiPlugin }).listModels(2000);
    // every listed model is returned (so the registry can record it); the ones that are not chat models are flagged and never reach the catalog
    expect(models.map((m) => [m.id, m.chat])).toEqual([["gemini-2.0-flash", true], ["text-embedding-004", false], ["imagen-3", false], ["gemini-2.5-pro", true]]);
  });

  it("explains a bad key or an unreadable list", async () => {
    reset();
    server.setHandler(() => ({ status: 401, body: {} }));
    expect((await failure(provider().listModels(2000))).llmCode).toBe("auth_failed");
    server.setHandler(() => ({ body: { surprise: 1 } }));
    expect((await failure(provider().listModels(2000))).llmCode).toBe("bad_response");
  });
});
