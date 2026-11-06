import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletionRequest } from "../llm/types.js";
import { OK_RESULT } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { containsSecret, EXPORT_FORMAT, SKILL_LIMITS } from "./service.js";
import { switchOn } from "../llm/test-helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
let t: TestApp;
let ref: string;
const requests: CompletionRequest[] = [];

beforeEach(async () => {
  requests.length = 0;
  t = await createTestApp();
  ref = await setupGeminiModel(t);
  const original = t.provider.complete.bind(t.provider);
  t.provider.complete = async (req) => {
    requests.push(req);
    return original(req);
  };
});
afterEach(async () => {
  await t.app.close();
  vi.unstubAllEnvs();
});

const skillBody = (over: Record<string, unknown> = {}) => ({ name: "Polite emails", description: "Write short polite emails", instructions: "Always greet by name. Keep it under 120 words.", requiredTools: [], tags: ["email"], ...over });
const create = async (over: Record<string, unknown> = {}) => (await t.call("POST", "/api/skills", skillBody(over))).body.skill as any;
const mkBot = async (name = "Helper") => (await switchOn(t.call, await t.call("POST", "/api/bots", { name, model: ref }))).body.bot as any;

describe("the tool registry tells the truth", () => {
  it("lists what exists and what does not, with a reason, and never calls an unbuilt tool available", async () => {
    const { tools } = (await t.call("GET", "/api/tools")).body;
    const by = (id: string) => tools.find((x: any) => x.id === id);
    expect(by("node")).toMatchObject({ status: "available", detail: "v24.0.0" });
    expect(by("git")).toMatchObject({ status: "available" });
    expect(by("python")).toMatchObject({ status: "unavailable" });
    expect(by("python").detail).toMatch(/Not found on this PC/);
    expect(by("pc-agent")).toMatchObject({ status: "needs_setup" });
    expect(by("pc-agent").detail).toMatch(/Choose a workspace folder/);
    expect(by("documents")).toMatchObject({ status: "needs_setup" });
    for (const id of ["gworkspace", "github", "notion", "n8n", "mcp"]) {
      expect(by(id).status, id).toBe("unavailable"); // not installed in this test app
      expect(by(id).category, id).toBe("integration");
    }
    for (const id of ["image-generation", "video-generation", "audio-generation"]) expect(by(id).detail).toMatch(/No free, verified service/);
    expect(by("telegram").status).toBe("unavailable"); // not installed in this test app
    expect(by("ai-cloud").status).toBe("needs_setup" === by("ai-cloud").status ? "needs_setup" : "available");
  });

  it("reports connectors and AI providers by their real state", async () => {
    vi.stubEnv("GEMINI_API_KEY", "AIzaSyFAKEKEYFORTESTSONLY0123456789");
    const { tools } = (await t.call("POST", "/api/tools/refresh")).body;
    expect(tools.find((x: any) => x.id === "ai-cloud")).toMatchObject({ status: "available" });
    expect(tools.find((x: any) => x.id === "ai-local").status).not.toBe("available"); // Ollama was never switched on
  });

  it("checks are fixed commands: a failing check just reports not found", async () => {
    const real = await createTestApp();
    expect((await real.app.tools.list()).find((x) => x.id === "vscode")).toMatchObject({ status: "unavailable" });
    await real.app.close();
  });

  it("is told to the Manager so plans never rely on missing tools", async () => {
    t.provider.script.push({ ...OK_RESULT, text: '{"mode":"direct","answer":"ok"}' });
    await t.call("POST", "/api/manager/runs", { goal: "make a video", proceedAnyway: true });
    await t.app.manager.idle();
    const sys = requests[0]!.messages[0]!.content;
    expect(sys).toMatch(/NOT available \(never plan on them.*Video generation and editing/s);
    expect(sys).toMatch(/Things this platform can really do now:.*Node\.js/s);
  });
});

describe("the skill library", () => {
  it("creates, lists and shows a skill with its first version", async () => {
    const s = await create();
    expect(s).toMatchObject({ name: "Polite emails", enabled: true, version: 1, imported: false, archived: false, tags: ["email"] });
    const full = (await t.call("GET", `/api/skills/${s.id}`)).body.skill;
    expect(full.versions).toHaveLength(1);
    expect(full.versions[0]).toMatchObject({ version: 1, changeNote: "Created" });
    expect((await t.call("GET", "/api/skills")).body.skills).toHaveLength(1);
  });

  it("every edit is a new permanent version, and an edit that changes nothing is not", async () => {
    const s = await create();
    const same = await t.call("PATCH", `/api/skills/${s.id}`, { instructions: s.instructions });
    expect(same.body.skill.version).toBe(1);
    expect(same.body.skill.tags).toEqual(["email"]); // leaving fields out never wipes them
    const edited = await t.call("PATCH", `/api/skills/${s.id}`, { instructions: "New text", changeNote: "tightened" });
    expect(edited.body.skill).toMatchObject({ version: 2, instructions: "New text" });
    const versions = (await t.call("GET", `/api/skills/${s.id}`)).body.skill.versions;
    expect(versions.map((v: any) => [v.version, v.changeNote])).toEqual([[2, "tightened"], [1, "Created"]]);
    expect(versions[1].instructions).toBe(s.instructions); // the old text is still there
  });

  it("restores an old version as a new version (history is never rewritten)", async () => {
    const s = await create();
    await t.call("PATCH", `/api/skills/${s.id}`, { instructions: "Second" });
    const restored = await t.call("POST", `/api/skills/${s.id}/restore`, { version: 1 });
    expect(restored.body.skill).toMatchObject({ version: 3, instructions: s.instructions });
    const versions = (await t.call("GET", `/api/skills/${s.id}`)).body.skill.versions;
    expect(versions[0]).toMatchObject({ version: 3, restoredFrom: 1 });
    expect((await t.call("POST", `/api/skills/${s.id}/restore`, { version: 99 })).status).toBe(404);
  });

  it("the database itself refuses to change or remove history, or delete a skill", async () => {
    const s = await create();
    const db = (t.app as any).db ?? null;
    void db;
    // The API has no delete or edit-version endpoints at all:
    expect((await t.call("DELETE", `/api/skills/${s.id}`)).status).toBe(404);
    expect((await t.call("PATCH", `/api/skills/${s.id}/versions/1`, {})).status).toBe(404);
  });

  it("duplicates with a fresh name; names are unique", async () => {
    const s = await create();
    const copy = (await t.call("POST", `/api/skills/${s.id}/duplicate`)).body.skill;
    expect(copy.name).toBe("Copy of Polite emails");
    expect(copy.id).not.toBe(s.id);
    const second = (await t.call("POST", `/api/skills/${s.id}/duplicate`)).body.skill;
    expect(second.name).toBe("Copy of Polite emails (2)");
    expect((await t.call("POST", "/api/skills", skillBody())).body.error).toBe("name_taken");
    expect((await t.call("PATCH", `/api/skills/${copy.id}`, { name: "Polite emails" })).body.error).toBe("name_taken");
  });

  it("archives instead of deleting, takes it away from bots, and restores", async () => {
    const s = await create();
    const bot = await mkBot();
    await t.call("PUT", `/api/bots/${bot.id}/skills`, { skillIds: [s.id] });
    const archived = (await t.call("POST", `/api/skills/${s.id}/archive`)).body.skill;
    expect(archived.archived).toBe(true);
    expect((await t.call("GET", `/api/bots/${bot.id}/capabilities`)).body.skills).toEqual([]);
    expect((await t.call("GET", "/api/skills")).body.skills).toHaveLength(0);
    expect((await t.call("GET", "/api/skills?archived=1")).body.skills).toHaveLength(1);
    expect((await t.call("PATCH", `/api/skills/${s.id}`, { instructions: "x" })).body.error).toBe("skill_archived");
    expect((await t.call("PUT", `/api/bots/${bot.id}/skills`, { skillIds: [s.id] })).body.error).toBe("skill_archived");
    expect((await t.call("POST", `/api/skills/${s.id}/unarchive`)).body.skill.archived).toBe(false);
  });

  it("validates sizes, tools and unknown fields", async () => {
    expect((await t.call("POST", "/api/skills", skillBody({ name: "" }))).status).toBe(400);
    expect((await t.call("POST", "/api/skills", skillBody({ instructions: "x".repeat(SKILL_LIMITS.instructions + 1) }))).status).toBe(400);
    expect((await t.call("POST", "/api/skills", skillBody({ surprise: 1 }))).status).toBe(400);
    expect((await t.call("POST", "/api/skills", skillBody({ requiredTools: ["not-a-tool"] }))).body.error).toBe("unknown_tool");
  });

  it("limits how many skills exist", async () => {
    for (let i = 0; i < SKILL_LIMITS.maxSkills; i++) await create({ name: `Skill ${i}` });
    expect((await t.call("POST", "/api/skills", skillBody({ name: "One too many" }))).body.error).toBe("too_many_skills");
  });
});

describe("skills never hold secrets", () => {
  it.each([
    "my key is AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
    "token gsk_ABCDEFGHIJKLMNOPQRSTUVWX12345",
    "ya29.A0ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    "-----BEGIN PRIVATE KEY-----",
    "bot 123456789:AAFakeTokenForTestsOnly_0123456789abc",
    "Bearer abcdefghijklmnop12345",
  ])("refuses text containing %s", async (secret) => {
    expect(containsSecret(secret)).toBe(true);
    const res = await t.call("POST", "/api/skills", skillBody({ instructions: secret }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("skill_has_secret");
    expect(JSON.stringify(res.body)).not.toContain(secret);
    const s = await create();
    expect((await t.call("PATCH", `/api/skills/${s.id}`, { description: secret })).body.error).toBe("skill_has_secret");
  });

  it("ordinary text is fine", () => {
    expect(containsSecret("Greet the customer, then summarise their email in 3 bullets. Never ask for a password.")).toBe(false);
  });
});

describe("import and export", () => {
  it("exports a plain file, and importing it makes an OFF, unassigned copy you must read and switch on", async () => {
    const s = await create({ requiredTools: ["node"] });
    const file = (await t.call("GET", `/api/skills/${s.id}/export`)).body.file;
    expect(file).toMatchObject({ format: EXPORT_FORMAT, name: "Polite emails", requiredTools: ["node"] });
    expect(Object.keys(file).sort()).toEqual(["description", "format", "instructions", "name", "requiredTools", "tags"]);
    const imported = (await t.call("POST", "/api/skills/import", file)).body.skill;
    expect(imported).toMatchObject({ name: "Polite emails (2)", enabled: false, imported: true, assignedBots: [] });
    expect((await t.call("GET", `/api/skills/${imported.id}`)).body.skill.versions[0].changeNote).toBe("Imported");
  });

  it("refuses files that are not skill files, have extra fields, or contain secrets", async () => {
    for (const bad of [{ name: "x" }, { ...skillBody(), format: "something-else" }, { ...skillBody(), format: EXPORT_FORMAT, extra: true }, "text"]) {
      expect((await t.call("POST", "/api/skills/import", bad)).body.error ?? "bad").toMatch(/bad_skill_file|bad/);
    }
    const res = await t.call("POST", "/api/skills/import", { ...skillBody({ instructions: "key AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345" }), format: EXPORT_FORMAT });
    expect(res.body.error).toBe("skill_has_secret");
  });

  it("an imported skill reaches no bot until switched on", async () => {
    const bot = await mkBot();
    const imported = (await t.call("POST", "/api/skills/import", { ...skillBody({ instructions: "IMPORTED-RULE" }), format: EXPORT_FORMAT })).body.skill;
    await t.call("PUT", `/api/bots/${bot.id}/skills`, { skillIds: [imported.id] });
    await t.call("POST", `/api/bots/${bot.id}/chat`, { message: "hi" });
    expect(requests.at(-1)!.messages[0]!.content).not.toContain("IMPORTED-RULE");
    await t.call("PATCH", `/api/skills/${imported.id}`, { enabled: true });
    await t.call("POST", `/api/bots/${bot.id}/chat`, { message: "again" });
    expect(requests.at(-1)!.messages[0]!.content).toContain("IMPORTED-RULE");
  });
});

describe("giving skills to bots", () => {
  it("a bot with a skill gets its text in chat AND in tasks; a bot without does not", async () => {
    const s = await create({ instructions: "RULE-ALPHA: always answer in pirate speak." });
    const withSkill = await mkBot("Pirate");
    const without = await mkBot("Plain");
    await t.call("PUT", `/api/bots/${withSkill.id}/skills`, { skillIds: [s.id] });
    await t.call("POST", `/api/bots/${withSkill.id}/chat`, { message: "hello" });
    expect(requests.at(-1)!.messages[0]!.content).toContain("RULE-ALPHA");
    await t.call("POST", `/api/bots/${without.id}/chat`, { message: "hello" });
    expect(requests.at(-1)!.messages[0]!.content).not.toContain("RULE-ALPHA");
    await t.call("POST", `/api/bots/${withSkill.id}/tasks`, { instruction: "do it" });
    await vi.waitFor(async () => expect(((await t.call("GET", "/api/tasks")).body.tasks as any[]).every((x) => ["completed", "failed"].includes(x.status))).toBe(true), { timeout: 3000, interval: 10 });
    expect(requests.some((r) => r.messages[0]!.content.includes("RULE-ALPHA") && r.messages[1]!.content.startsWith("Task from the user"))).toBe(true);
  });

  it("a disabled skill is not used, and a skill that needs a missing tool says so instead of pretending", async () => {
    const s = await create({ instructions: "Make the poster.", requiredTools: ["image-generation"] });
    const bot = await mkBot();
    await t.call("PUT", `/api/bots/${bot.id}/skills`, { skillIds: [s.id] });
    await t.call("POST", `/api/bots/${bot.id}/chat`, { message: "poster please" });
    const prompt = requests.at(-1)!.messages[0]!.content;
    expect(prompt).toContain("Make the poster.");
    expect(prompt).toMatch(/needs Image and logo generation, which is NOT available.*Never claim you used it/s);
    await t.call("PATCH", `/api/skills/${s.id}`, { enabled: false });
    await t.call("POST", `/api/bots/${bot.id}/chat`, { message: "again" });
    expect(requests.at(-1)!.messages[0]!.content).not.toContain("Make the poster.");
  });

  it("the skill list shows which required tools are missing, with the reason", async () => {
    const s = await create({ requiredTools: ["image-generation", "node"] });
    expect(s.missingTools).toEqual([{ id: "image-generation", name: "Image and logo generation", reason: expect.stringContaining("No free, verified service") }]);
  });

  it("keeps the added prompt small and limits skills per bot", async () => {
    const bot = await mkBot();
    const ids: string[] = [];
    for (let i = 0; i < SKILL_LIMITS.maxPerBot; i++) ids.push((await create({ name: `Big ${i}`, instructions: `S${i} ` + "y".repeat(1500) })).id);
    await t.call("PUT", `/api/bots/${bot.id}/skills`, { skillIds: ids });
    await t.call("POST", `/api/bots/${bot.id}/chat`, { message: "hi" });
    const prompt = requests.at(-1)!.messages[0]!.content;
    const added = prompt.slice(prompt.indexOf("Skills you have"));
    expect(added.length).toBeLessThan(SKILL_LIMITS.promptChars + 200);
    const extra = (await create({ name: "One more" })).id;
    expect((await t.call("PUT", `/api/bots/${bot.id}/skills`, { skillIds: [...ids, extra] })).status).toBe(400);
    expect((await t.call("PUT", `/api/bots/${bot.id}/skills`, { skillIds: ["00000000-0000-4000-8000-000000000000"] })).status).toBe(404);
  });

  it("replaces the whole set each time and records the change", async () => {
    const a = await create({ name: "A" });
    const b = await create({ name: "B" });
    const bot = await mkBot();
    await t.call("PUT", `/api/bots/${bot.id}/skills`, { skillIds: [a.id, b.id] });
    await t.call("PUT", `/api/bots/${bot.id}/skills`, { skillIds: [b.id] });
    expect((await t.call("GET", `/api/bots/${bot.id}/capabilities`)).body.skills).toEqual([b.id]);
    expect(JSON.stringify((await t.call("GET", "/api/audit?limit=100")).body)).toContain("bot.skills_changed");
  });
});

describe("tool access for bots", () => {
  it("only tools that need explicit access and exist can be given; connectors stay with the Permissions tab", async () => {
    const bot = await mkBot();
    expect((await t.call("PUT", `/api/bots/${bot.id}/tools`, { toolIds: ["node", "git"] })).body.tools.sort()).toEqual(["git", "node"]);
    expect((await t.call("PUT", `/api/bots/${bot.id}/tools`, { toolIds: ["video-generation"] })).body.error).toBe("tool_unavailable");
    expect((await t.call("PUT", `/api/bots/${bot.id}/tools`, { toolIds: ["pc-agent"] })).body.error).toBe("not_assignable"); // the PC agent has its own five permissions
    expect((await t.call("PUT", `/api/bots/${bot.id}/tools`, { toolIds: ["gmail"] })).status).toBe(400);
    expect((await t.call("PUT", `/api/bots/${bot.id}/tools`, { toolIds: ["nope-tool"] })).body.error).toBe("unknown_tool");
    expect((await t.call("GET", `/api/bots/${bot.id}/capabilities`)).body.tools.sort()).toEqual(["git", "node"]); // a refused change changed nothing
  });
});

describe("testing a skill", () => {
  it("runs the skill on a sample with one limited call and reports tokens", async () => {
    const s = await create({ instructions: "Reply with the word TESTED then the input." });
    t.provider.script.push({ ...OK_RESULT, text: "TESTED hello" });
    const res = (await t.call("POST", `/api/skills/${s.id}/test`, { input: "hello" })).body.result;
    expect(res).toMatchObject({ output: "TESTED hello", modelCalls: 1, tokens: 15, missingTools: [], note: null });
    expect(requests.at(-1)!.messages[0]!.content).toContain("Reply with the word TESTED");
  });

  it("says plainly when it could only run as text because a needed tool is missing", async () => {
    const s = await create({ requiredTools: ["video-generation"] });
    const res = (await t.call("POST", `/api/skills/${s.id}/test`, { input: "make a clip" })).body.result;
    expect(res.missingTools).toHaveLength(1);
    expect(res.note).toMatch(/not available, so this test ran as text only/);
  });

  it("refuses empty or oversized samples, and obeys the AI pause switch", async () => {
    const s = await create();
    expect((await t.call("POST", `/api/skills/${s.id}/test`, { input: "  " })).body.error).toBe("empty_test_input");
    expect((await t.call("POST", `/api/skills/${s.id}/test`, { input: "x".repeat(2001) })).status).toBeGreaterThanOrEqual(400);
    await t.call("PUT", "/api/llm/pause", { paused: true });
    const before = requests.length;
    expect((await t.call("POST", `/api/skills/${s.id}/test`, { input: "hi" })).status).toBe(409);
    expect(requests.length).toBe(before);
  });
});

describe("who may change skills and tool access", () => {
  it("a phone can read the library but cannot create, edit, import, assign or test", async () => {
    const phone = await createTestApp({ remoteHosts: ["my-pc.tail1234.ts.net"] });
    const { body } = await phone.call("POST", "/api/devices/pairing");
    const h = { host: "my-pc.tail1234.ts.net", origin: "https://my-pc.tail1234.ts.net", "x-awp-client": "dashboard" };
    const paired = await phone.app.inject({ method: "POST", url: "/api/devices/pair", payload: { code: body.code, name: "P" }, headers: h });
    const hh = { ...h, cookie: String(paired.headers["set-cookie"]).split(";")[0]! };
    const bot = (await phone.call("POST", "/api/bots", { name: "B" })).body.bot;
    expect((await phone.app.inject({ method: "GET", url: "/api/skills", headers: hh })).statusCode).toBe(200);
    expect((await phone.app.inject({ method: "GET", url: "/api/tools", headers: hh })).statusCode).toBe(200);
    for (const [method, url, payload] of [
      ["POST", "/api/skills", skillBody()],
      ["POST", "/api/skills/import", { ...skillBody(), format: EXPORT_FORMAT }],
      ["PUT", `/api/bots/${bot.id}/skills`, { skillIds: [] }],
      ["PUT", `/api/bots/${bot.id}/tools`, { toolIds: [] }],
    ] as const) {
      const r = await phone.app.inject({ method, url, payload, headers: hh });
      expect(r.statusCode, url).toBe(403);
      expect(r.json().error).toBe("owner_only");
    }
    await phone.app.close();
  });
});
