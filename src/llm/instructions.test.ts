import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { redactKnownSecrets } from "./plugins/index.js";
import { foldInstructionsIntoUserTurn, isInstructionRoleRefusal, modelLacksInstructionRole } from "./providers/instructions.js";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible.js";
import { defaultHandler, startFakeProviderServer, type FakeHandler, type FakeServer } from "./test-helpers.js";
import type { CompletionRequest } from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const REFUSAL = { status: 400, body: { error: { message: "Developer instruction is not enabled for models/strict-model", code: 400 } } };

/** A fake provider that behaves like Gemini/Gemma: models named in `strict` refuse any system or developer message. */
const strictHandler = (strict: string[]): FakeHandler => (req) => {
  const roles = ((req.body?.messages ?? []) as any[]).map((m) => m.role);
  if (strict.includes(req.body?.model) && roles.some((r) => r === "system" || r === "developer")) return REFUSAL;
  return defaultHandler(req);
};

let server: FakeServer;
beforeAll(async () => {
  server = await startFakeProviderServer();
});
afterAll(async () => {
  await server.close();
});
const provider = () => new OpenAiCompatibleProvider({ baseUrl: server.baseUrl, apiKey: "test-key-123456", plugin: { normalizeModelId: (i: string) => i, isTextModel: () => true }, redact: redactKnownSecrets });
const SYSTEM = "You are Scout. Never send anything without approval. Stay in the free tier.";
const req = (model: string, extra: Partial<CompletionRequest> = {}): CompletionRequest => ({
  model,
  messages: [
    { role: "system", content: SYSTEM },
    { role: "user", content: "First question" },
    { role: "assistant", content: "First answer" },
    { role: "user", content: "Second question" },
  ],
  temperature: 0.4,
  maxOutputTokens: 200,
  timeoutMs: 2000,
  ...extra,
});
const reset = (h: FakeHandler) => {
  server.requests.length = 0;
  server.setHandler(h);
};

describe("foldInstructionsIntoUserTurn", () => {
  it("keeps every instruction word for word, in order, ahead of the first user turn, and leaves the history alone", () => {
    const out = foldInstructionsIntoUserTurn([
      { role: "system", content: "RULE ONE" },
      { role: "system", content: "RULE TWO" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "again" },
    ]);
    expect(out.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(out[0]!.content).toContain("RULE ONE\n\nRULE TWO");
    expect(out[0]!.content.indexOf("RULE ONE")).toBeLessThan(out[0]!.content.indexOf("hello"));
    expect(out[0]!.content).toMatch(/take priority/);
    expect(out[1]!.content).toBe("hi");
    expect(out[2]!.content).toBe("again");
  });
  it("adds a user turn when there is none, and changes nothing when there are no instructions", () => {
    expect(foldInstructionsIntoUserTurn([{ role: "system", content: "ONLY" }])).toEqual([{ role: "user", content: expect.stringContaining("ONLY") }]);
    const plain = [{ role: "user" as const, content: "x" }];
    expect(foldInstructionsIntoUserTurn(plain)).toBe(plain);
  });
  it("keeps pictures that were already approved on their message", () => {
    const img = { mime: "image/png" as const, dataBase64: "AAAA", sensitivity: "public" as const };
    const out = foldInstructionsIntoUserTurn([{ role: "system", content: "S" }, { role: "user", content: "look", images: [img] }]);
    expect(out[0]!.images).toEqual([img]);
  });
  it("recognises the provider's refusal wording and the Gemma family, and nothing else", () => {
    expect(isInstructionRoleRefusal("Developer instruction is not enabled for models/gemma-3-27b-it")).toBe(true);
    expect(isInstructionRoleRefusal("System instruction is not supported for this model")).toBe(true);
    expect(isInstructionRoleRefusal("Invalid API key")).toBe(false);
    expect(isInstructionRoleRefusal("max_tokens is too large")).toBe(false);
    expect(modelLacksInstructionRole("gemma-3-27b-it")).toBe(true);
    expect(modelLacksInstructionRole("gemini-2.5-flash")).toBe(false);
  });
});

describe("the request sent to a model that has no instruction role (regression: HTTP 400 'Developer instruction is not enabled')", () => {
  it("a model that supports the role still gets a normal system message, untouched", async () => {
    reset(strictHandler(["strict-model"]));
    await provider().complete(req("gemini-2.5-flash"));
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]!.body.messages[0]).toEqual({ role: "system", content: SYSTEM });
  });

  it("a Gemma model is sent the instructions inside the first user turn, with history intact, and succeeds on the first request", async () => {
    reset(strictHandler(["gemma-3-27b-it"]));
    const r = await provider().complete(req("gemma-3-27b-it"));
    expect(r.text).toBe("Hello from the fake provider");
    expect(server.requests).toHaveLength(1);
    const msgs = server.requests[0]!.body.messages as any[];
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(msgs[0].content).toContain(SYSTEM); // complete, word for word
    expect(msgs[0].content).toContain("First question");
    expect(msgs[1].content).toBe("First answer");
    expect(msgs[2].content).toBe("Second question");
  });

  it("an unknown model that refuses the role is retried ONCE with the instructions folded in, then remembered (no second failure)", async () => {
    reset(strictHandler(["strict-model"]));
    const p = provider();
    expect((await p.complete(req("strict-model"))).text).toBe("Hello from the fake provider");
    expect(server.requests).toHaveLength(2);
    expect(server.requests[0]!.body.messages[0].role).toBe("system");
    expect((server.requests[1]!.body.messages as any[]).some((m) => m.role === "system")).toBe(false);
    expect(server.requests[1]!.body.messages[0].content).toContain(SYSTEM);
    await p.complete(req("strict-model"));
    expect(server.requests).toHaveLength(3); // the next call goes straight to the folded form
    expect((server.requests[2]!.body.messages as any[]).some((m) => m.role === "system")).toBe(false);
  });

  it("any other HTTP 400 is still an error and is NOT retried", async () => {
    reset(() => ({ status: 400, body: { error: { message: "max_tokens is too large" } } }));
    await expect(provider().complete(req("gemini-2.5-flash"))).rejects.toThrow(/refused the request \(HTTP 400\).*max_tokens/);
    expect(server.requests).toHaveLength(1);
  });

  it("when the folded request is refused too, the error is reported, not hidden, and only one retry is made", async () => {
    reset(() => REFUSAL);
    await expect(provider().complete(req("strict-model"))).rejects.toThrow(/HTTP 400/);
    expect(server.requests).toHaveLength(2);
  });

  it("tool definitions are unchanged by folding (sent only when the provider declares tool support)", async () => {
    reset(strictHandler(["gemma-3-27b-it"]));
    const withTools = new OpenAiCompatibleProvider({ baseUrl: server.baseUrl, apiKey: "test-key-123456", plugin: { normalizeModelId: (i: string) => i, isTextModel: () => true, capabilities: { toolCalling: true } }, redact: redactKnownSecrets });
    const tool = { name: "lookup", description: "Look something up", parameters: { type: "object", properties: {} } };
    await withTools.complete(req("gemma-3-27b-it", { tools: [tool] }));
    expect(server.requests[0]!.body.tools).toEqual([{ type: "function", function: tool }]);
    expect((server.requests[0]!.body.messages as any[]).some((m) => m.role === "system")).toBe(false);
  });
});
