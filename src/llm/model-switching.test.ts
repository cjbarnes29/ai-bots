import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildApp } from "../app.js";
import type { ConnectorDefinition } from "../connectors/types.js";
import { OpenAiCompatibleProvider } from "./providers/openai-compatible.js";
import { redactKnownSecrets } from "./plugins/index.js";
import { defaultHandler, makeCaller, startFakeProviderServer, switchOn, type FakeHandler, type FakeServer, type RecordedRequest } from "./test-helpers.js";

/**
 * Model-switching conformance: the SAME bot scenarios, run through the real HTTP adapter, the real router, the real task engine, the real approval gate
 * and the real Decisions service, against fake providers whose "models" behave differently on purpose:
 *   gemma-3-27b-it          rejects the system role (HTTP 400), chatty replies, JSON inside prose and code fences, and CLAIMS success after an action was only sent for approval
 *   llama-3.3-70b-versatile well behaved
 *   broken-8b-instant       ignores formats (prose instead of JSON, an invalid action block) and claims success anyway
 * What this proves is the APPLICATION-LEVEL contract: the same identity, instructions, history and permissions reach every model, an unusable structured reply is
 * never accepted (the next model gets the request), the permission and approval rules decide the same way whichever model wrote the request, and the record of
 * what happened is written by the platform. It does NOT prove anything about real models: no real provider is contacted here (board NV-3).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const SIGNOFF = "ZETA-7";
const matrix: Record<string, Record<string, string>> = {};
const record = (dimension: string, model: string, outcome: string) => ((matrix[dimension] ??= {})[model] = outcome);

type Persona = "gemma" | "good" | "broken";
const PERSONA_OF: Record<string, Persona> = { "gemma-3-27b-it": "gemma", "llama-3.3-70b-versatile": "good", "broken-8b-instant": "broken" };
const actionJson = { connector: "telegram", action: "send_message", args: { chat: "sam", text: "hello" } };
const readJson = { connector: "telegram", action: "read_messages", args: {} };
const OPTIONS = { options: [{ title: "Start in Dubai", details: "Largest market", pros: "Demand", cons: "Competition" }, { title: "Start in Abu Dhabi", details: "Fewer rivals", pros: "Access", cons: "Smaller" }] };

/** What a model of each kind would answer, judged only from what the request actually contained (so a lost instruction shows up as a wrong answer). */
function simulate(persona: Persona, messages: { role: string; content: string }[]): string {
  const all = messages.map((m) => m.content).join("\n");
  const last = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
  const name = /You are "([^"]+)"/.exec(all)?.[1] ?? "nobody";
  const sign = new RegExp(`Always sign off with (\\S+?)\\.`).exec(all)?.[1] ?? "";
  const codeword = /Project codeword is (\w+)/.exec(all)?.[1] ?? "unknown";
  const feedback = last.startsWith("Here is what happened");
  if (/OPTIONS, not for action/.test(all)) {
    if (persona === "good") return JSON.stringify(OPTIONS);
    if (persona === "gemma") return `Of course! Here are my thoughts:\n\n\`\`\`json\n${JSON.stringify(OPTIONS, null, 2)}\n\`\`\`\nLet me know if you need more.`;
    return "I think you should consider many things before deciding.";
  }
  if (feedback) {
    if (persona === "good") return `The message is waiting for approval. ${sign}`;
    return `All done, the message was sent! ${sign}`; // gemma and broken both claim success whatever the feedback said
  }
  if (last.includes("TASK:SEND") || last.includes("TASK:READ")) {
    const block = last.includes("TASK:SEND") ? actionJson : readJson;
    if (persona === "good") return `Sending.\n\`\`\`action\n${JSON.stringify(block)}\n\`\`\``;
    if (persona === "gemma") return `Sure! Here you go:\n\n\`\`\`action\n${JSON.stringify(block, null, 2)}\n\`\`\`\nHope that helps!`;
    return "```action\n{connector: telegram, action: send_message\n```\nDone! I sent it.";
  }
  if (last.includes("REPLY-IDENTITY")) return `I am ${name}. ${sign}`;
  if (last.includes("REPLY-CODEWORD")) return `The codeword is ${codeword}. ${sign}`;
  return `ack ${sign}`;
}

const personaHandler = (modelsListed: string[], mode: { fail: string | null; rejectSystem: Set<string> }): FakeHandler => (req: RecordedRequest) => {
  if (req.method === "GET" && req.url.endsWith("/models")) return { body: { data: modelsListed.map((id) => ({ id })) } };
  const model = String(req.body?.model);
  const messages = (req.body?.messages ?? []) as { role: string; content: string }[];
  if (mode.fail === model) return { status: 500, body: { error: { message: "boom" } } };
  if (mode.rejectSystem.has(model) && messages.some((m) => m.role === "system" || m.role === "developer")) {
    return { status: 400, body: { error: { message: `Developer instruction is not enabled for models/${model}` } } };
  }
  return { body: { model, choices: [{ message: { role: "assistant", content: simulate(PERSONA_OF[model] ?? "good", messages) }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 8 } } };
};

const executions: any[] = [];
const telegram: ConnectorDefinition = {
  id: "telegram",
  label: "Telegram",
  secrets: [{ name: "TELEGRAM_BOT_TOKEN", description: "Telegram bot token" }],
  actions: {
    send_message: { kind: "write", description: "Send a Telegram message", args: z.strictObject({ chat: z.string(), text: z.string() }), summarize: (a) => `Send "${a["text"]}" to ${a["chat"]}`, execute: async (a) => (executions.push(a), "sent") },
    read_messages: { kind: "read", description: "Read Telegram messages", args: z.strictObject({}), summarize: () => "Read messages", execute: async () => (executions.push("read"), "messages") },
  },
};

let A: FakeServer; // provider "gemini"
let B: FakeServer; // provider "groq"
let app: Awaited<ReturnType<typeof buildApp>>;
let call: ReturnType<typeof makeCaller>;
const mode = { fail: null as string | null, rejectSystem: new Set<string>(["gemma-3-27b-it"]) };

beforeEach(async () => {
  mode.fail = null;
  A = await startFakeProviderServer(personaHandler(["gemma-3-27b-it"], mode));
  B = await startFakeProviderServer(personaHandler(["llama-3.3-70b-versatile", "broken-8b-instant"], mode));
  executions.length = 0;
  vi.stubEnv("GEMINI_API_KEY", "AIzaSyFAKEKEYFORTESTSONLY0123456789");
  vi.stubEnv("GROQ_API_KEY", "gsk_FAKEKEYFORTESTSONLY0123456789ab");
  const clock = { t: new Date(2026, 5, 15, 12, 0, 0).getTime() };
  app = await buildApp({
    dbPath: ":memory:",
    verification: "off",
    connectors: [telegram],
    clock: () => clock.t,
    sleep: async (ms) => void (clock.t += ms),
    routingDefaults: { autoAssignNewBots: false },
    providerFactory: (_p, plugin) =>
      new OpenAiCompatibleProvider({ baseUrl: plugin.id === "gemini" ? A.baseUrl : B.baseUrl, apiKey: "test-key-123456789", plugin, redact: redactKnownSecrets }),
  });
  call = makeCaller(app);
  for (const id of ["gemini", "groq"]) await call("PATCH", `/api/llm/providers/${id}`, { freeConfirmed: true, enabled: true });
  await call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000 });
  await call("PUT", "/api/llm/routing", { providerOrder: ["gemini", "groq"], maxAttempts: 3 });
  await call("POST", "/api/llm/routing/refresh-all");
  await call("PUT", "/api/vault/TELEGRAM_BOT_TOKEN", { value: "TELEGRAM-TOKEN-0123456789abcdef" });
});
afterEach(async () => {
  await app.close();
  await A.close();
  await B.close();
  vi.unstubAllEnvs();
});
afterAll(() => {
  console.log("\nMODEL CONFORMANCE MATRIX (fake providers, application-level behaviour)\n" + JSON.stringify(matrix, null, 1));
});

const MODELS = { gemma: "gemini/gemma-3-27b-it", llama: "groq/llama-3.3-70b-versatile", broken: "groq/broken-8b-instant" } as const;
const mkBot = async (name: string, model: string, instructions = `Always sign off with ${SIGNOFF}.`, extra: object = {}) =>
  (await switchOn(call, await call("POST", "/api/bots", { name, model, instructions, role: "Research", responsibilities: ["Research markets"], ...extra }))).body.bot as any;
const settle = () => vi.waitFor(async () => expect(((await call("GET", "/api/tasks")).body.tasks as any[]).every((x) => ["completed", "failed", "cancelled"].includes(x.status))).toBe(true), { timeout: 4000, interval: 10 });
async function runTask(botId: string, instruction: string): Promise<any> {
  const res = await call("POST", `/api/bots/${botId}/tasks`, { instruction });
  expect(res.status).toBe(202);
  await settle();
  return (await call("GET", `/api/tasks/${res.body.task.id}`)).body;
}
const pending = async () => (await call("GET", "/api/approvals?status=pending")).body.approvals as any[];
const prefer = async (ref: string) => { const r = await call("PUT", "/api/llm/routing", { preferred: { general: ref } }); if (r.status !== 200) throw new Error("prefer failed: " + JSON.stringify(r.body)); return r; };

describe("1. connectivity: both providers are reached through the real adapter", () => {
  it("test-connection succeeds for both, models are discovered, and both are switched on and callable", async () => {
    expect((await call("POST", "/api/llm/providers/gemini/test")).body.provider).toMatchObject({ status: "connected" });
    expect((await call("POST", "/api/llm/providers/groq/test")).body.provider).toMatchObject({ status: "connected" });
    const models = (await call("GET", "/api/llm/models")).body.models as any[];
    const ready = models.filter((m) => m.enabled && m.callable).map((m) => m.ref).sort();
    expect(ready).toEqual(expect.arrayContaining([MODELS.gemma, MODELS.llama, MODELS.broken]));
    record("connectivity", "all", "2 providers connected, 3 models callable");
  });
});

describe("2. automatic switching keeps the bot the same", () => {
  it("when the first model fails, the next one answers the SAME request: same identity, instructions and history; the answerer is reported", async () => {
    const bot = await mkBot("Scout", "auto/general");
    await prefer(MODELS.gemma);
    const first = await call("POST", `/api/bots/${bot.id}/chat`, { message: "REPLY-IDENTITY" });
    expect(first.status).toBe(200);
    expect(first.body.assistantMessage).toMatchObject({ providerId: "gemini", modelId: "gemma-3-27b-it" });
    expect(first.body.assistantMessage.content).toBe(`I am Scout. ${SIGNOFF}`);
    const conversationId = first.body.conversationId;

    mode.fail = "gemma-3-27b-it"; // the first choice now fails
    const second = await call("POST", `/api/bots/${bot.id}/chat`, { message: "REPLY-IDENTITY again", conversationId });
    expect(second.status).toBe(200);
    expect(second.body.assistantMessage).toMatchObject({ providerId: "groq", modelId: "llama-3.3-70b-versatile" });
    expect(second.body.assistantMessage.content).toBe(`I am Scout. ${SIGNOFF}`); // same identity and the same rule, from a different model

    // what each model was actually sent
    const toGemma = A.requests.filter((r) => r.method === "POST").at(-1)!.body.messages as any[];
    const toLlama = B.requests.filter((r) => r.method === "POST").at(-1)!.body.messages as any[];
    expect(toLlama[0].role).toBe("system");
    expect(toGemma.some((m) => m.role === "system")).toBe(false); // folded for the model that cannot take it
    const llamaSystem = toLlama[0].content as string;
    expect(toGemma[0].content).toContain(llamaSystem); // the complete instructions, word for word, inside the first user turn
    expect(toGemma[0].content.endsWith(toLlama[1].content)).toBe(true); // then the owner's own first message, unchanged
    expect(toGemma.slice(1)).toEqual(toLlama.slice(2)); // and the rest of the conversation is identical
    expect(toLlama.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]); // the history reached the fallback intact
    // the instruction order and the permanent-versus-temporary rule reached both models, in the same words
    for (const text of [llamaSystem, toGemma[0].content as string]) {
      expect(text).toContain("Instruction order (highest first):");
      expect(text).toContain("It becomes permanent only when the owner saves it in your configuration.");
    }
    expect(llamaSystem.indexOf("Ground rules:")).toBeLessThan(llamaSystem.indexOf("Instruction order"));
    record("switching", "gemma -> llama", "same name, rule and history; answerer reported");
  });

  it("when every model fails the answer is an error that names what was tried, never a made-up reply; an explicit model is never silently replaced", async () => {
    const auto = await mkBot("Auto", "auto/general");
    const fixed = await mkBot("Fixed", MODELS.gemma);
    mode.fail = "gemma-3-27b-it";
    const explicit = await call("POST", `/api/bots/${fixed.id}/chat`, { message: "hi" });
    expect(explicit.status).toBeGreaterThanOrEqual(500);
    expect(B.requests.filter((r) => r.method === "POST")).toHaveLength(0); // the other provider was not contacted
    record("explicit model", "gemma", "fails clearly, not re-routed");
    await prefer(MODELS.gemma);
    const sink = new Set([mode.fail]);
    void sink;
    // make the fallbacks fail too
    B.setHandler(() => ({ status: 500, body: { error: { message: "boom" } } }));
    const all = await call("POST", `/api/bots/${auto.id}/chat`, { message: "hi" });
    expect(all.status).toBe(502);
    expect(all.body.message).toMatch(/No model could answer\. Tried: gemini\/gemma-3-27b-it/);
  });
});

describe("3. instruction adherence: the same rules reach every model", () => {
  it.each([["gemma", MODELS.gemma], ["llama", MODELS.llama]])("%s follows the bot's identity, the owner's rule and the project context", async (key, model) => {
    const project = (await call("POST", "/api/projects", { name: "Kite", instructions: "Project codeword is KITE." })).body.project;
    const bot = await mkBot("Scout", model);
    const r = await call("POST", `/api/bots/${bot.id}/chat`, { message: "REPLY-CODEWORD", projectId: project.id });
    expect(r.status).toBe(200);
    expect(r.body.assistantMessage.content).toBe(`The codeword is KITE. ${SIGNOFF}`);
    const id = await call("POST", `/api/bots/${bot.id}/chat`, { message: "REPLY-IDENTITY", conversationId: r.body.conversationId });
    expect(id.body.assistantMessage.content).toBe(`I am Scout. ${SIGNOFF}`);
    record("instruction adherence", key, "identity + owner rule + project context all arrived");
  });
});

describe("4. structured output: an unusable reply is never accepted", () => {
  const draftFor = async (botModel: string, first?: string) => {
    const bot = await mkBot("Researcher", botModel);
    if (first) await prefer(first);
    const before = { a: A.requests.filter((r) => r.method === "POST").length, b: B.requests.filter((r) => r.method === "POST").length };
    const res = await call("POST", "/api/decisions/inquire", { question: "Which market should we research first?", botIds: [bot.id] });
    const after = { a: A.requests.filter((r) => r.method === "POST").length, b: B.requests.filter((r) => r.method === "POST").length };
    return { res, bot, called: { gemma: after.a - before.a, groq: after.b - before.b } };
  };

  it("JSON inside prose and a code fence is understood (gemma), clean JSON works (llama)", async () => {
    const g = await draftFor(MODELS.gemma);
    expect(g.res.body.draft.bots[0].options.map((o: any) => o.title)).toEqual(["Start in Dubai", "Start in Abu Dhabi"]);
    const l = await draftFor(MODELS.llama);
    expect(l.res.body.draft.bots[0].options).toHaveLength(2);
    record("structured output", "gemma", "fenced JSON in prose accepted");
    record("structured output", "llama", "clean JSON accepted");
  });

  it("a model that ignores the format fails a bot with an explicit model, with a clear reason and NO silent switch", async () => {
    const { res, called } = await draftFor(MODELS.broken);
    expect(res.body.draft.bots[0].options).toEqual([]);
    expect(res.body.draft.bots[0].problem).toMatch(/did not answer in the required form/);
    expect(called).toEqual({ gemma: 0, groq: 1 });
    record("structured output", "broken", "rejected with a reason, not retried elsewhere (explicit model)");
  });

  it("with automatic routing the same bad reply moves the request to the next model, which answers it", async () => {
    const { res, called } = await draftFor("auto/general", MODELS.broken);
    expect(res.body.draft.bots[0].problem).toBeNull();
    expect(res.body.draft.bots[0].options).toHaveLength(2);
    // the preferred (broken) model on the second provider was asked first and its reply was refused; the other provider's model then answered the same request
    expect(B.requests.filter((r) => r.method === "POST").map((r) => r.body.model)).toEqual(["broken-8b-instant"]);
    expect(A.requests.filter((r) => r.method === "POST").map((r) => r.body.model)).toEqual(["gemma-3-27b-it"]);
    expect(called).toEqual({ gemma: 1, groq: 1 });
    record("structured output", "broken -> next", "contract failure switched models automatically");
  });

  it("when no model produces the form, the error says so and lists what was tried", async () => {
    B.setHandler((req) => (req.method === "GET" ? { body: { data: [{ id: "llama-3.3-70b-versatile" }, { id: "broken-8b-instant" }] } } : { body: { model: req.body.model, choices: [{ message: { role: "assistant", content: "no json here" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } } }));
    A.setHandler((req) => (req.method === "GET" ? { body: { data: [{ id: "gemma-3-27b-it" }] } } : { body: { model: req.body.model, choices: [{ message: { role: "assistant", content: "still no json" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } } }));
    const { res } = await draftFor("auto/general");
    expect(res.body.draft.bots[0].problem).toMatch(/No model could answer\. Tried: .*bad_output/);
    expect(res.body.draft.bots[0].options).toEqual([]);
  });
});

describe("5. tool calls (the text action protocol) and permission enforcement are the same for every model", () => {
  it.each([["gemma", MODELS.gemma], ["llama", MODELS.llama]])("%s: a write request becomes ONE pending approval with the same arguments; nothing is executed", async (key, model) => {
    const bot = await mkBot("Marketer", model);
    const task = await runTask(bot.id, "TASK:SEND tell Sam hello");
    const list = await pending();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ connector: "telegram", action: "send_message", args: { chat: "sam", text: "hello" }, status: "pending" });
    expect(executions).toEqual([]);
    expect(task.task.status).toBe("completed");
    record("tool call + approval", key, "1 pending approval, args identical, nothing executed");
  });

  it("a model that CLAIMS success is contradicted by the platform's own record in the task result", async () => {
    const bot = await mkBot("Marketer", MODELS.gemma);
    const task = await runTask(bot.id, "TASK:SEND tell Sam hello");
    const result = task.task.result as string;
    expect(result).toContain("All done, the message was sent!"); // the model's words are kept
    expect(result).toMatch(/--- What the platform recorded \(not written by the AI\) ---\n- telegram\.send_message: WAITING for the owner's approval\. It has NOT happened\./);
    expect(executions).toEqual([]);
    record("truthful result", "gemma", "claimed success; platform record says WAITING / NOT happened");
  });

  it("a malformed action block does nothing, creates no approval, and the result says it was not done even though the model said 'Done!'", async () => {
    const bot = await mkBot("Marketer", MODELS.broken);
    const task = await runTask(bot.id, "TASK:SEND tell Sam hello");
    expect(await pending()).toEqual([]);
    expect(executions).toEqual([]);
    expect(task.task.result).toContain("An outside action request was not valid and nothing was done");
    record("tool call + approval", "broken", "malformed block: nothing done, recorded as not done");
  });

  it.each([["gemma", MODELS.gemma], ["llama", MODELS.llama]])("%s: a read the bot has no permission for is refused the same way; granting the permission changes the outcome for both", async (key, model) => {
    const bot = await mkBot("Reader", model);
    const denied = await runTask(bot.id, "TASK:READ messages");
    expect(executions).toEqual([]);
    expect(denied.task.result).toMatch(/--- What the platform recorded[^]*telegram\.read_messages: NOT done/);
    await call("PUT", `/api/bots/${bot.id}/permissions/telegram`, { readEnabled: true });
    const allowed = await runTask(bot.id, "TASK:READ messages");
    expect(executions).toEqual(["read"]);
    expect(allowed.task.result).not.toMatch(/telegram\.read_messages: NOT done/);
    record("permission enforcement", key, "denied without permission, allowed after the owner's switch");
  });
});

describe("6. task completion: a failure is a failure", () => {
  it("a model error makes the task failed (never completed) and nothing is invented", async () => {
    const bot = await mkBot("Worker", MODELS.llama);
    B.setHandler(() => ({ status: 500, body: { error: { message: "boom" } } }));
    const task = await runTask(bot.id, "do something");
    expect(task.task.status).toBe("failed");
    expect(task.task.result).toBeNull();
    expect(task.task.errorMessage).toMatch(/HTTP 500/);
    record("task completion", "llama", "provider error -> task FAILED with the reason");
  });

  it("a finished task on either model is completed with the model's text", async () => {
    for (const [key, model] of [["gemma", MODELS.gemma], ["llama", MODELS.llama]] as const) {
      const bot = await mkBot(`W-${key}`, model);
      const task = await runTask(bot.id, "REPLY-IDENTITY");
      expect(task.task).toMatchObject({ status: "completed", result: `I am W-${key}. ${SIGNOFF}` });
      record("task completion", key, "completed with the model's text");
    }
  });
});

describe("7. what the app cannot rely on is reported, not assumed", () => {
  it("native tool calling and pictures are not used by this app, so a requirement for them is refused with the reason", async () => {
    const { meets } = await import("../routing/capabilities.js");
    const r = meets({ modelId: "llama-3.3-70b-versatile", contextWindow: null }, ["tool_calling", "structured_output"]);
    expect(r.ok).toBe(false);
    expect(r.missing.join(" ")).toMatch(/tool calling is not usable by this app yet/);
    expect(r.missing.join(" ")).toMatch(/structured \(JSON\) output is not confirmed/);
    record("capabilities", "all", "native tool calling unused; JSON output enforced by contract, not assumed from the model name");
  });
});
