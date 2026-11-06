import { afterEach, describe, expect, it, vi } from "vitest";
import { OK_RESULT, switchOn } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The project hub is a read-only view. Everything runs against a SCRIPTED FAKE provider; nothing real is contacted. */
let t: TestApp;
afterEach(async () => {
  await t?.app.close();
  vi.unstubAllEnvs();
});

async function setup() {
  t = await createTestApp({ includePc: true, includeMemory: true });
  await t.call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000, providerRequestsPerMinute: 1000 });
  const ref = await setupGeminiModel(t);
  const mk = async (name: string) => (await switchOn(t.call, await t.call("POST", "/api/bots", { name, role: "", model: ref }))).body.bot as any;
  return { mk };
}
async function runTask(botId: string, instruction: string, projectId?: string): Promise<any> {
  const res = await t.call("POST", `/api/bots/${botId}/tasks`, { instruction, ...(projectId ? { projectId, saveToWorkspace: false } : {}) });
  expect(res.status).toBe(202);
  return vi.waitFor(async () => {
    const task = (await t.call("GET", `/api/tasks/${res.body.task.id}`)).body.task;
    expect(["completed", "failed"]).toContain(task.status);
    return task;
  }, { timeout: 5000, interval: 10 });
}

describe("project hub", () => {
  it("derives agents, tasks and progress from the project's links, and a plain project is empty", async () => {
    const { mk } = await setup();
    t.provider.script = [{ ...OK_RESULT, text: "done", inputTokens: 5, outputTokens: 5 }];
    const bot = await mk("Researcher");
    const project = (await t.call("POST", "/api/projects", { name: "Website" })).body.project;
    const empty = (await t.call("GET", `/api/projects/${project.id}/hub`)).body;
    expect(empty.agents).toEqual([]);
    expect(empty.progress.total).toBe(0);
    expect(empty.attention).toEqual([]);

    const task = await runTask(bot.id, "Collect competitor names", project.id);
    const hub = (await t.call("GET", `/api/projects/${project.id}/hub`)).body;
    expect(hub.project.name).toBe("Website");
    expect(hub.tasks.map((x: any) => x.id)).toContain(task.id);
    expect(hub.agents).toHaveLength(1);
    expect(hub.agents[0]).toMatchObject({ botId: bot.id, name: "Researcher", tasks: 1 });
    expect(hub.progress.total).toBe(hub.tasks.length);
  });

  it("answers what a task is connected to, and refuses unknown ids and kinds", async () => {
    const { mk } = await setup();
    const bot = await mk("Writer");
    const project = (await t.call("POST", "/api/projects", { name: "Brochure" })).body.project;
    const task = await runTask(bot.id, "Draft the intro", project.id);
    const rel = (await t.call("GET", `/api/related/task/${task.id}`)).body;
    expect(rel.project).toEqual({ id: project.id, name: "Brochure" });
    expect(rel.bot).toEqual({ id: bot.id, name: "Writer" });
    const loose = await runTask(bot.id, "A task outside any project");
    expect((await t.call("GET", `/api/related/task/${loose.id}`)).body.project).toBeNull();
    expect((await t.call("GET", "/api/related/task/does-not-exist")).status).toBe(404);
    expect((await t.call("GET", "/api/related/secret/abc")).status).toBe(404);
    expect((await t.call("GET", "/api/projects/not-a-uuid/hub")).status).toBe(404);
    expect((await t.call("GET", "/api/projects/00000000-0000-4000-8000-000000000000/hub")).status).toBe(404);
  });

  it("lists the projects an agent takes part in", async () => {
    const { mk } = await setup();
    const bot = await mk("Analyst");
    const project = (await t.call("POST", "/api/projects", { name: "Market" })).body.project;
    expect((await t.call("GET", `/api/bots/${bot.id}/projects`)).body.projects).toEqual([]);
    await runTask(bot.id, "Look at prices", project.id);
    const list = (await t.call("GET", `/api/bots/${bot.id}/projects`)).body.projects;
    expect(list).toEqual([{ id: project.id, name: "Market", via: ["task"] }]);
  });

  it("changes nothing: reading the hub writes no row", async () => {
    const { mk } = await setup();
    const bot = await mk("Reader");
    const project = (await t.call("POST", "/api/projects", { name: "Quiet" })).body.project;
    const task = await runTask(bot.id, "x", project.id);
    const snap = async () => JSON.stringify([(await t.call("GET", `/api/projects/${project.id}`)).body, (await t.call("GET", "/api/approvals")).body, (await t.call("GET", `/api/tasks/${task.id}`)).body.task]);
    const before = await snap();
    expect(before.length).toBeGreaterThan(50);
    await t.call("GET", `/api/projects/${project.id}/hub`);
    await t.call("GET", `/api/bots/${bot.id}/projects`);
    await t.call("GET", `/api/related/task/${task.id}`);
    expect(await snap()).toEqual(before);
  });
});

describe("global search", () => {
  const search = async (q: string) => (await t.call("GET", `/api/search?q=${encodeURIComponent(q)}`)).body as { hits: { kind: string; id: string; title: string; botId?: string }[]; tooShort: boolean };

  it("finds projects, agents and tasks by name, and keeps what each hit needs to open it", async () => {
    const { mk } = await setup();
    const bot = await mk("Bakery Writer");
    const project = (await t.call("POST", "/api/projects", { name: "Bakery website" })).body.project;
    const task = await runTask(bot.id, "Write the bakery home page", project.id);
    const found = await search("bakery");
    expect(found.hits.map((h) => h.kind)).toEqual(expect.arrayContaining(["agent", "project", "task"]));
    expect(found.hits.find((h) => h.kind === "task")?.id).toBe(task.id);
    expect(found.hits.find((h) => h.kind === "project")?.id).toBe(project.id);
  });

  it("ignores too-short queries and treats % and _ as plain characters", async () => {
    const { mk } = await setup();
    await mk("Alpha");
    expect(await search("a")).toMatchObject({ hits: [], tooShort: true });
    expect((await search("%%")).hits).toEqual([]);
    expect((await search("A_")).hits).toEqual([]);
  });

  it("searches titles only: message text is never searched, archived projects are skipped", async () => {
    const { mk } = await setup();
    const bot = await mk("Quiet");
    t.provider.script = [{ ...OK_RESULT, text: "the zebra secret", inputTokens: 5, outputTokens: 5 }];
    const first = await t.call("POST", `/api/bots/${bot.id}/chat`, { message: "hello there" });
    await t.call("POST", `/api/bots/${bot.id}/chat`, { message: "tell me about giraffes", conversationId: first.body.conversationId });
    expect((await search("giraffes")).hits).toEqual([]);
    expect((await search("zebra")).hits).toEqual([]);
    const p = (await t.call("POST", "/api/projects", { name: "Old launch" })).body.project;
    expect((await search("launch")).hits).toHaveLength(1);
    await t.call("PUT", `/api/projects/${p.id}/archive`, { on: true });
    expect((await search("launch")).hits).toEqual([]);
  });

  it("opens a conversation through its agent", async () => {
    const { mk } = await setup();
    const bot = await mk("Helper");
    const chat = await t.call("POST", `/api/bots/${bot.id}/chat`, { message: "plan the menu" });
    const hit = (await search("plan the menu")).hits.find((h) => h.kind === "conversation");
    expect(hit?.botId).toBe(bot.id);
    expect(hit?.id).toBe(chat.body.conversationId);
  });
});
