import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LlmError } from "./errors.js";
import { geminiPlugin } from "./plugins/gemini.js";
import { redactKnownSecrets } from "./plugins/index.js";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible.js";
import { stripReasoning } from "./reasoning.js";
import { classifyFailure } from "./registry.js";
import { startFakeProviderServer, type FakeServer } from "./test-helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
describe("stripReasoning (P-28 A)", () => {
  it("leaves a normal reply exactly as it is", () => {
    for (const t of ["Hello there.", "  padded  ", "Two\n\nparagraphs", ""]) {
      const r = stripReasoning(t, "gemma-4-26b-a4b-it");
      expect(r).toEqual({ text: t, removed: false, reasoningOnly: false, incomplete: false });
    }
  });

  it("removes a leading reasoning block and keeps the answer (mixed reply), whatever the tag family", () => {
    expect(stripReasoning("<thought>I should greet.</thought>Hello!", "gemma-4").text).toBe("Hello!");
    expect(stripReasoning("  <think>\nlong\nreasoning\n</think>\n\nThe answer is 4.", "qwen3").text).toBe("The answer is 4.");
    expect(stripReasoning("<thinking>a</thinking><reasoning>b</reasoning>Done.", "x").text).toBe("Done.");
    expect(stripReasoning("<THOUGHT attr=\"1\">x</THOUGHT> Result", "x")).toMatchObject({ text: "Result", removed: true, reasoningOnly: false });
  });

  it("a reply that is nothing but reasoning has no usable answer", () => {
    expect(stripReasoning("<thought>only thinking</thought>", "gemma-4")).toMatchObject({ text: "", removed: true, reasoningOnly: true, incomplete: false });
    expect(stripReasoning("<think>  </think>\n", "x").reasoningOnly).toBe(true);
  });

  it("an incomplete block (cut off) means the whole reply is reasoning", () => {
    expect(stripReasoning("<thought>I am reasoning and the output ended while", "gemma-4")).toMatchObject({ text: "", reasoningOnly: true, incomplete: true });
    expect(stripReasoning("<think>a</think><think>second never closes", "x")).toMatchObject({ text: "", reasoningOnly: true, incomplete: true });
  });

  it("handles nested blocks by depth, not by the first closing tag", () => {
    expect(stripReasoning("<thought>outer <thought>inner</thought> still outer</thought>Final answer.", "x").text).toBe("Final answer.");
    expect(stripReasoning("<think><think>a</think>", "x")).toMatchObject({ reasoningOnly: true, incomplete: true });
  });

  it("does not damage legitimate content that mentions similar tags", () => {
    const html = "To show your thinking in a page use the <think> tag like this: <think>hmm</think>. That is all.";
    expect(stripReasoning(html, "gemma-4")).toEqual({ text: html, removed: false, reasoningOnly: false, incomplete: false }); // not at the start
    const code = "```html\n<thought>x</thought>\n```";
    expect(stripReasoning(code, "x").text).toBe(code);
    expect(stripReasoning("Answer first. <thought>later</thought> more", "x").text).toBe("Answer first. <thought>later</thought> more");
    expect(stripReasoning("An unrelated </think> closing tag in prose.", "llama-3.3-70b").text).toBe("An unrelated </think> closing tag in prose.");
  });

  it("a lone closing tag (reasoning with no opening tag) is recognised only for the model families that print it", () => {
    const raw = "I will compute it step by step. 2+2 is 4.</think>The answer is 4.";
    expect(stripReasoning(raw, "qwen/qwen3.8-27b")).toMatchObject({ text: "The answer is 4.", removed: true });
    expect(stripReasoning(raw, "deepseek-r1-distill-llama-70b").text).toBe("The answer is 4.");
    expect(stripReasoning(raw, "llama-3.3-70b-versatile")).toMatchObject({ text: raw, removed: false });
  });
});

describe("the adapter never records reasoning-only or empty replies as an answer", () => {
  let server: FakeServer;
  beforeAll(async () => {
    server = await startFakeProviderServer();
  });
  afterAll(async () => {
    await server.close();
  });
  afterEach(() => server.requests.splice(0));
  const provider = () => new OpenAiCompatibleProvider({ baseUrl: server.baseUrl, apiKey: "test-key-123456789", plugin: geminiPlugin, redact: redactKnownSecrets });
  const reply = (content: string | null, extra: object = {}) => server.setHandler((req) => (req.method === "GET" ? { body: { data: [] } } : { body: { model: req.body.model, choices: [{ message: { role: "assistant", content, ...extra }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 5 } } }));
  const ask = () => provider().complete({ model: "gemma-4-26b-a4b-it", messages: [{ role: "user", content: "hi" }], temperature: 0.2, maxOutputTokens: 100, timeoutMs: 2000 });

  it("a mixed reply returns the answer and says reasoning was removed", async () => {
    reply("<thought>planning</thought>Hello!");
    expect(await ask()).toMatchObject({ text: "Hello!", reasoningRemoved: true });
  });
  it("a normal reply is untouched", async () => {
    reply("Hello!");
    const r = await ask();
    expect(r.text).toBe("Hello!");
    expect(r.reasoningRemoved).toBeUndefined();
  });
  it("a reasoning-only reply fails with bad_output instead of succeeding", async () => {
    reply("<thought>only thinking, no answer</thought>");
    await expect(ask()).rejects.toMatchObject({ llmCode: "bad_output", message: expect.stringMatching(/only its internal reasoning/) });
  });
  it("an incomplete reasoning block fails with bad_output and says it was cut off", async () => {
    reply("<thought>long reasoning that never ended".repeat(5));
    await expect(ask()).rejects.toMatchObject({ llmCode: "bad_output", message: expect.stringMatching(/cut off/) });
  });
  it("an empty reply is still an error", async () => {
    reply("   ");
    await expect(ask()).rejects.toBeInstanceOf(LlmError);
  });
});

describe("classifyFailure: only a confirmed retirement ever excludes a model (P-28 B)", () => {
  const e = (code: any, opts: any = {}) => new LlmError(code, "x", opts);
  it("sorts every kind of failure", () => {
    expect(classifyFailure(e("rate_limited"))).toBe("rate_limit");
    expect(classifyFailure(e("rate_limited", { quota: true }))).toBe("rate_limit");
    expect(classifyFailure(e("quota_exceeded"))).toBe("rate_limit");
    expect(classifyFailure(e("auth_failed"))).toBe("auth");
    expect(classifyFailure(e("key_missing"))).toBe("auth");
    expect(classifyFailure(e("bad_request"))).toBe("unsupported_request");
    expect(classifyFailure(e("bad_output"))).toBe("bad_output");
    for (const c of ["network", "timeout", "provider_unavailable", "circuit_open"]) expect(classifyFailure(e(c)), c).toBe("temporary");
    expect(classifyFailure(e("model_not_found"))).toBe("other"); // a bare "not found" is NOT a confirmed retirement
    expect(classifyFailure(e("model_not_found", { retired: true }))).toBe("retired");
    expect(classifyFailure(new Error("boom"))).toBe("other");
  });
});

describe("the adapter recognises a CONFIRMED retirement and nothing else", () => {
  let server: FakeServer;
  beforeAll(async () => {
    server = await startFakeProviderServer();
  });
  afterAll(async () => {
    await server.close();
  });
  const fail = (status: number, body: unknown, headers: Record<string, string> = {}) => server.setHandler(() => ({ status, body, headers }));
  const ask = () => new OpenAiCompatibleProvider({ baseUrl: server.baseUrl, apiKey: "test-key-123456789", plugin: geminiPlugin, redact: redactKnownSecrets }).complete({ model: "m", messages: [{ role: "user", content: "hi" }], temperature: 0, maxOutputTokens: 10, timeoutMs: 2000 });
  const outcome = async () => {
    try {
      await ask();
      return null;
    } catch (e) {
      return e as LlmError;
    }
  };

  it("Gemini: HTTP 404 'no longer available to new users' is a retirement", async () => {
    fail(404, [{ error: { code: 404, message: "This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash.", status: "NOT_FOUND" } }]);
    const err = await outcome();
    expect(err).toMatchObject({ llmCode: "model_not_found", retired: true });
  });
  it("Groq: HTTP 400 model_decommissioned is a retirement", async () => {
    fail(400, { error: { message: "The model `llama3-70b-8192` has been decommissioned and is no longer supported. Please refer to https://console.groq.com/docs/deprecations", type: "invalid_request_error", code: "model_decommissioned" } });
    expect(await outcome()).toMatchObject({ llmCode: "model_not_found", retired: true });
  });
  it("a bare 404 / 'model not found' is NOT a confirmed retirement", async () => {
    fail(404, { error: { message: "The model `x` does not exist or you do not have access to it." } });
    expect(await outcome()).toMatchObject({ llmCode: "model_not_found", retired: false });
  });
  it("rate limits, quotas, authentication failures, server errors and unsupported requests are never retirements", async () => {
    const cases: [number, unknown, string, boolean][] = [
      [429, { error: { message: "Quota exceeded for this model per day" } }, "rate_limited", false],
      [401, { error: { message: "API key not valid" } }, "auth_failed", false],
      [403, { error: { message: "model access denied" } }, "auth_failed", false],
      [500, { error: { message: "The model is overloaded" } }, "provider_unavailable", false],
      [503, { error: { message: "model is temporarily unavailable" } }, "provider_unavailable", false],
      [400, { error: { message: "Unsupported parameter: max_tokens is deprecated for this model, use max_completion_tokens" } }, "bad_request", false],
      [400, { error: { message: "Developer instruction is not enabled for models/x" } }, "bad_request", false],
    ];
    for (const [status, body, code, retired] of cases) {
      fail(status, body);
      const err = await outcome();
      expect(err, `${status}`).toMatchObject({ llmCode: code, retired });
    }
  });
});

afterEach(() => vi.useRealTimers());
