import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/database.js";
import { OK_RESULT, switchOn } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { locate } from "./locate.js";
import { suggest } from "./suggestions.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The AI Assistant's lookup, editing levels, refusals and suggestions. Fictional data and a SCRIPTED FAKE model only. */
const NOW = new Date("2026-11-06T12:00:00Z").getTime();
const day = (n: number, h = 10) => new Date(Date.UTC(2026, 10, 6 - n, h)).toISOString();

function world() {
  const db = openDatabase(":memory:");
  const bot = (name: string, role: string, status = "active") => {
    const id = randomUUID();
    db.prepare("INSERT INTO bots (id, name, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, name, role, status, day(30), day(30));
    return id;
  };
  const researcher = bot("Atlas", "Research agent: finds facts and sources");
  const writer = bot("Quill", "Writes copy");
  const project = (name: string, created: string, description = "") => {
    const id = randomUUID();
    db.prepare("INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, name, description, created, created);
    return id;
  };
  const p1 = project("Bakery website", day(10), "A site for the bakery");
  const p2 = project("Cafe menu", day(3), "Menu redesign");
  const p3 = project("Tea shop launch", day(1), "");
  const wf = (name: string, at: string) => {
    const id = randomUUID();
    db.prepare("INSERT INTO workflows (id, name, version, graph, created_at, updated_at) VALUES (?, ?, 1, '{}', ?, ?)").run(id, name, at, at);
    return id;
  };
  const w1 = wf("Weekly report", day(5));
  const w2 = wf("Customer follow-up", day(1, 14)); // yesterday
  const task = (botId: string, text: string, status: string, at: string, err: string | null = null) => {
    const id = randomUUID();
    db.prepare("INSERT INTO tasks (id, root_id, assignee_bot_id, requested_by, instruction, depth, status, error_message, created_at, finished_at) VALUES (?, ?, ?, 'user', ?, 0, ?, ?, ?, ?)").run(id, id, botId, text, status, err, at, at);
    return id;
  };
  const tFailed = task(writer, "Write the newsletter", "failed", day(0, 9), "Model unavailable");
  const tDone = task(researcher, "Collect competitor prices", "completed", day(2));
  const approval = (botId: string, summary: string, status: string, at: string) => {
    const id = randomUUID();
    db.prepare("INSERT INTO approval_requests (id, bot_id, connector, action, summary, args_json, args_hash, status, created_at, expires_at) VALUES (?, ?, 'documents', 'create_docx', ?, '{}', 'h', ?, ?, ?)").run(id, botId, summary, status, at, day(-5));
    return id;
  };
  const a1 = approval(writer, "Create the file price-list.csv", "pending", day(0, 8));
  approval(writer, "Create the file old.csv", "executed", day(4));
  const conv = randomUUID();
  db.prepare("INSERT INTO conversations (id, bot_id, title, created_at) VALUES (?, ?, 'Menu ideas', ?)").run(conv, writer, day(1));
  const doc = randomUUID();
  db.prepare("INSERT INTO knowledge_docs (id, title, filename, mime, ext, size, sha256, status, scope, created_at, updated_at) VALUES (?, 'Supplier price list', 'prices.csv', 'text/csv', 'csv', 10, 'x', 'ready', 'global', ?, ?)").run(doc, day(2), day(2));
  return { db, researcher, writer, p1, p2, p3, w1, w2, tFailed, tDone, a1, conv, doc };
}
const L = (w: ReturnType<typeof world>, text: string) => locate(w.db, text, NOW);

describe("locate and open", () => {
  it("opens the latest project (by real id) and says what it found", () => {
    const w = world();
    const r = L(w, "Open my latest project");
    expect(r).toMatchObject({ handled: true, resolution: "single", openNow: true, entity: "project" });
    expect(r.candidates[0]).toMatchObject({ kind: "project", id: w.p3, title: "Tea shop launch" });
    expect(r.message).toContain("Tea shop launch");
  });
  it("finds yesterday's workflow by date", () => {
    const w = world();
    const r = L(w, "Find yesterday's workflow");
    expect(r.resolution).toBe("single");
    expect(r.candidates[0]).toMatchObject({ kind: "workflow", id: w.w2 });
    expect(r.understood).toContain("yesterday");
    expect(r.openNow).toBe(false); // "find" lists; "open" opens
  });
  it("locates an agent by what it does", () => {
    const w = world();
    const r = L(w, "locate my research agent");
    expect(r.candidates.map((c) => c.id)).toEqual([w.researcher]);
    expect(r.candidates[0]).toMatchObject({ kind: "agent", title: "Atlas" });
  });
  it("shows pending approvals only", () => {
    const w = world();
    const r = L(w, "show pending approvals");
    expect(r.entity).toBe("approval");
    expect(r.candidates.map((c) => c.id)).toEqual([w.a1]);
    expect(r.resolution).toBe("single");
  });
  it("lists several matches and asks which, and reports a missing resource plainly", () => {
    const w = world();
    const many = L(w, "show projects about the");
    expect(many.handled).toBe(true);
    const some = L(w, "open the project menu");
    expect(some.candidates[0]).toMatchObject({ id: w.p2 });
    const multi = L(w, "show my projects");
    expect(multi.resolution).toBe("multiple");
    expect(multi.candidates).toHaveLength(3);
    expect(multi.openNow).toBe(false);
    expect(multi.message).toMatch(/Which one/);
    const none = L(w, "open the project zebra");
    expect(none).toMatchObject({ handled: true, resolution: "none", candidates: [] });
    expect(none.message).toContain('could not find a project matching "zebra"');
    expect(L(w, "open my latest workflow named nothing-like-it").resolution).toBe("none");
  });
  it("finds tasks by state, conversations, documents and sections of the app", () => {
    const w = world();
    expect(L(w, "open my last failed task").candidates[0]).toMatchObject({ kind: "task", id: w.tFailed });
    expect(L(w, "find the conversation about menu").candidates[0]).toMatchObject({ kind: "conversation", id: w.conv, botId: w.writer });
    expect(L(w, "find the supplier document").candidates[0]).toMatchObject({ kind: "document", id: w.doc });
    w.db.prepare("INSERT INTO knowledge_chunks (doc_id, idx, text) VALUES (?, 0, ?)").run(w.doc, "The refund window is thirty days");
    w.db.prepare("INSERT INTO knowledge_fts (text, doc_id, chunk_id) VALUES (?, ?, 1)").run("The refund window is thirty days", w.doc);
    expect(L(w, "find the document about refund window").candidates[0]).toMatchObject({ kind: "document", id: w.doc }); // by what it says, when its name does not match
    expect(L(w, "open the documents about supplier prices").candidates[0]).toMatchObject({ kind: "document", id: w.doc }); // filler words like "about" are not part of the name
    expect(L(w, "open ai models").candidates[0]).toMatchObject({ kind: "page", to: "/models" });
    expect(L(w, "go to creative studio").candidates[0]).toMatchObject({ kind: "page", to: "/creative" });
    expect(L(w, "open integrations").candidates[0]).toMatchObject({ kind: "page", to: "/integrations" });
    expect(L(w, "show the knowledge center").candidates[0]).toMatchObject({ to: "/knowledge" });
  });
  it("leaves ordinary conversation alone, and treats the text only as data", () => {
    const w = world();
    expect(L(w, "How do I write a good project plan for a bakery with many different suppliers and customers please").handled).toBe(false);
    expect(L(w, "Tell me a joke").handled).toBe(false);
    expect(L(w, "hello there").handled).toBe(false);
    const evil = L(w, "show projects '); DROP TABLE projects; --");
    expect(w.db.prepare("SELECT COUNT(*) AS n FROM projects").get()).toEqual({ n: 3 });
    expect(evil.candidates).toEqual([]);
    expect(L(w, "show 100% _ projects").candidates.length).toBeLessThanOrEqual(3); // % and _ are plain characters, never wildcards
  });
  it("skips archived and deleted things", () => {
    const w = world();
    w.db.prepare("UPDATE projects SET archived = 1 WHERE id = ?").run(w.p3);
    w.db.prepare("UPDATE projects SET deleted_at = ? WHERE id = ?").run(day(0), w.p2);
    const r = L(w, "open my latest project");
    expect(r.candidates[0]).toMatchObject({ id: w.p1 });
  });
});

describe("suggestions", () => {
  it("come from real records and point somewhere", () => {
    const w = world();
    const s = suggest(w.db, NOW);
    const ids = s.map((x) => x.id);
    expect(ids).toContain("approvals-pending");
    expect(ids).toContain("tasks-failed");
    expect(s.find((x) => x.id === "tasks-failed")?.to).toBe(`/tasks/${w.tFailed}`);
    expect(s.find((x) => x.id.startsWith("project-nodesc"))?.ask).toContain("Tea shop launch");
    expect(s[0]!.severity).toBe("high");
    expect(ids).toContain("agent-nomodel-" + w.researcher);
  });
  it("suggests an automation for a task given three times, and nothing when all is quiet", () => {
    const w = world();
    for (let i = 0; i < 3; i++) {
      const id = randomUUID();
      w.db.prepare("INSERT INTO tasks (id, root_id, assignee_bot_id, requested_by, instruction, depth, status, created_at) VALUES (?, ?, ?, 'user', 'Summarise the daily sales', 0, 'completed', ?)").run(id, id, w.writer, day(i + 1));
    }
    expect(suggest(w.db, NOW).map((x) => x.kind)).toContain("automation");
    const quiet = openDatabase(":memory:");
    expect(suggest(quiet, NOW).map((x) => x.id)).toEqual(["docs-none"]);
  });
});

/* ---------------- editing levels, through the real app ---------------- */
let t: TestApp;
afterEach(async () => {
  await t?.app.close();
  vi.unstubAllEnvs();
});
async function boot() {
  t = await createTestApp({ includeMemory: true });
  await t.call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000, providerRequestsPerMinute: 1000 });
  const ref = await setupGeminiModel(t);
  const bot = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Atlas", role: "Research", instructions: "Find facts.", model: ref }))).body.bot as any;
  return { bot };
}
const say = async (text: string) => (await t.call("POST", "/api/assistant/interpret", { text })).body as any;
const reply = (o: unknown) => ({ ...OK_RESULT, text: JSON.stringify(o), inputTokens: 10, outputTokens: 10 });

describe("safe actions: done at once, logged, undoable", () => {
  it("renames a project and undoes it; refuses to undo over newer work", async () => {
    await boot();
    const p = (await t.call("POST", "/api/projects", { name: "Old name" })).body.project;
    const r = await say('rename project "Old name" to "New name"');
    expect(r).toMatchObject({ kind: "action", handled: true });
    expect(r.action).toMatchObject({ level: "safe", status: "applied", undoable: true, before: { name: "Old name" }, after: { name: "New name" } });
    expect((await t.call("GET", `/api/projects/${p.id}`)).body.project.name).toBe("New name");
    expect(r.message).toMatch(/^Done:/);
    // changed again by hand -> undo would overwrite newer work -> refused
    await t.call("PATCH", `/api/projects/${p.id}`, { name: "Hand edit" });
    expect((await t.call("POST", `/api/assistant/actions/${r.action.id}/undo`)).status).toBe(409);
    // a clean undo
    const r2 = await say("rename project Hand edit to Again");
    expect((await t.call("POST", `/api/assistant/actions/${r2.action.id}/undo`)).body.message).toMatch(/^Undone/);
    expect((await t.call("GET", `/api/projects/${p.id}`)).body.project.name).toBe("Hand edit");
    expect((await t.call("GET", "/api/assistant/actions")).body.actions.map((a: any) => a.status)).toEqual(expect.arrayContaining(["applied", "undone"]));
  });

  it("organises documents: tags, category, folder, collection, title; every change keeps the old value", async () => {
    await boot();
    const doc = (await t.call("POST", "/api/knowledge/docs", { filename: "Supplier prices.txt", contentBase64: Buffer.from("tea 4 coffee 6").toString("base64") })).body.document;
    const col = (await t.call("POST", "/api/knowledge/collections", { name: "Suppliers" })).body.collection;
    expect((await say("tag document Supplier prices with pricing, uae")).action.after.tags).toEqual(["pricing", "uae"]);
    expect((await say("add tag urgent to document Supplier prices")).action.after.tags).toEqual(["pricing", "uae", "urgent"]);
    expect((await say("categorize document Supplier prices as Costs")).action.status).toBe("applied");
    expect((await say("move document Supplier prices to folder 2026")).action.status).toBe("applied");
    expect((await say("move document Supplier prices to collection Suppliers")).action.status).toBe("applied");
    const renamed = await say("rename document Supplier prices to Price list");
    expect(renamed.action.status).toBe("applied");
    expect((await t.call("GET", `/api/knowledge/docs/${doc.id}`)).body.doc).toMatchObject({ title: "Price list", category: "Costs", folder: "2026", collectionId: col.id, tags: ["pricing", "uae", "urgent"] });
    await t.call("POST", `/api/assistant/actions/${renamed.action.id}/undo`);
    expect((await t.call("GET", `/api/knowledge/docs/${doc.id}`)).body.doc.title).toBe("Supplier prices");
  });

  it("handles a missing or ambiguous target without changing anything", async () => {
    await boot();
    await t.call("POST", "/api/projects", { name: "Cafe one" });
    await t.call("POST", "/api/projects", { name: "Cafe two" });
    const amb = await say("rename project Cafe to Shop");
    expect(amb.choices).toEqual(expect.arrayContaining(["Cafe one", "Cafe two"]));
    expect(amb.action).toBeUndefined();
    const miss = await say("rename project Nothing to Shop");
    expect(miss.message).toMatch(/could not find a project/);
    expect((await t.call("GET", "/api/assistant/actions")).body.actions).toEqual([]);
    // a secret-looking value is not stored
    const sec = await say("rename project Cafe one to AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q");
    expect(sec.message).toMatch(/key or password/);
  });
});

describe("review actions: proposed only; applied after the owner confirms; the old text is kept", () => {
  it("improves an agent's instructions as a new version", async () => {
    const { bot } = await boot();
    t.provider.script = [reply({ instructions: "Find verified facts, cite each source, and say when something is uncertain." })];
    const r = await say("improve the instructions of agent Atlas");
    expect(r.action).toMatchObject({ level: "review", status: "proposed", before: { instructions: "Find facts." } });
    expect(r.message).toMatch(/only proposed|nothing has changed/i);
    // not applied yet
    expect((await t.call("GET", `/api/bots/${bot.id}`)).body.bot.instructions).toBe("Find facts.");
    const done = await t.call("POST", `/api/assistant/actions/${r.action.id}/confirm`);
    expect(done.status).toBe(200);
    expect(done.body.message).toMatch(/^Applied/);
    const now = (await t.call("GET", `/api/bots/${bot.id}`)).body.bot;
    expect(now.instructions).toContain("verified facts");
    expect(now.currentVersion).toBe(bot.currentVersion + 1); // a new version; the old text lives on in history
    // undo puts the old text back (as another version, history is never rewritten)
    const undo = await t.call("POST", `/api/assistant/actions/${r.action.id}/undo`);
    expect(undo.status).toBe(200);
    expect((await t.call("GET", `/api/bots/${bot.id}`)).body.bot.instructions).toBe("Find facts.");
    // a proposal can be rejected, and a rejected one never applies
    t.provider.script = [reply({ instructions: "Something else entirely." })];
    const r2 = await say("improve instructions for Atlas");
    await t.call("POST", `/api/assistant/actions/${r2.action.id}/reject`);
    expect((await t.call("POST", `/api/assistant/actions/${r2.action.id}/confirm`)).status).toBe(409);
    expect((await t.call("GET", `/api/bots/${bot.id}`)).body.bot.instructions).toBe("Find facts.");
  });

  it("the drafting prompts carry the lessons of the real-model run (no role copying, no 'verify from memory', answer from sources, no guessing a purpose)", async () => {
    const { bot } = await boot();
    t.provider.script = [reply({ instructions: "You answer from the sources you are given." })];
    await say("improve the instructions of agent Atlas");
    const rewrite = JSON.stringify(t.provider.calls.at(-1)!.messages);
    for (const s of ["second person", "do not copy it into the instructions", "answer only from the sources it is given", "say plainly when they do not contain the answer", "do not let it claim that it verified anything"]) expect(rewrite, s).toContain(s);
    await t.call("POST", "/api/projects", { name: "Cafe" });
    t.provider.script = [reply({ description: "A project named Cafe with nothing linked yet." })];
    await say("write a description for project Cafe");
    expect(JSON.stringify(t.provider.calls.at(-1)!.messages)).toContain("Do not guess the purpose of the project");
    void bot;
  });

  it("refuses to apply a proposal if the item changed after it was made, and discards a draft with a secret or a new link", async () => {
    const { bot } = await boot();
    t.provider.script = [reply({ instructions: "Better text." })];
    const r = await say("improve instructions of Atlas");
    await t.call("PATCH", `/api/bots/${bot.id}`, { instructions: "Edited by hand meanwhile." });
    expect((await t.call("POST", `/api/assistant/actions/${r.action.id}/confirm`)).status).toBe(409);
    t.provider.script = [reply({ instructions: "Use AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q to log in." })];
    const bad = await say("improve instructions of Atlas");
    expect(bad.message).toMatch(/discarded/);
    expect(bad.action).toBeUndefined();
  });

  it("drafts a project description for review, and says plainly when the model fails", async () => {
    await boot();
    const p = (await t.call("POST", "/api/projects", { name: "Cafe" })).body.project;
    t.provider.script = [reply({ description: "Plans and tracks the launch of the cafe." })];
    const r = await say("write a description for project Cafe");
    expect(r.action).toMatchObject({ level: "review", status: "proposed" });
    expect((await t.call("GET", `/api/projects/${p.id}`)).body.project.description).toBe("");
    await t.call("POST", `/api/assistant/actions/${r.action.id}/confirm`);
    expect((await t.call("GET", `/api/projects/${p.id}`)).body.project.description).toContain("launch of the cafe");
    t.provider.script = [{ ...OK_RESULT, text: "not json at all", inputTokens: 1, outputTokens: 1 }];
    const fail = await say("improve description of project Cafe");
    expect(fail.message).toMatch(/could not draft/);
    expect(fail.action).toBeUndefined();
  });
});

describe("restricted requests are refused and logged; the assistant has no path to do them", () => {
  const requests = [
    "delete the project Cafe",
    "delete all documents",
    "permanently remove my agent Atlas",
    "approve the pending approval",
    "approve all pending requests",
    "grant Atlas permission to modify files",
    "give Atlas access to my folders",
    "change permissions for Atlas",
    "send an email to my customers",
    "publish the website",
    "deploy the app",
    "buy a subscription",
    "purchase more credits",
    "install the update",
    "create an account for Sam",
    "turn off the guardian",
    "please delete everything",
    "can you send this to the client",
  ];
  it.each(requests)("refuses: %s", async (text) => {
    await boot();
    const p = (await t.call("POST", "/api/projects", { name: "Cafe" })).body.project;
    const before = JSON.stringify([(await t.call("GET", "/api/projects")).body, (await t.call("GET", "/api/bots")).body]);
    const r = await say(text);
    expect(r).toMatchObject({ kind: "action", handled: true });
    expect(r.message).toMatch(/I will not do that myself/);
    expect(r.action).toBeUndefined();
    expect(r.link?.to).toBeTruthy();
    // nothing changed
    expect(JSON.stringify([(await t.call("GET", "/api/projects")).body, (await t.call("GET", "/api/bots")).body])).toBe(before);
    expect((await t.call("GET", `/api/projects/${p.id}`)).status).toBe(200);
    // and the refusal is in the log, as refused
    const log = (await t.call("GET", "/api/assistant/actions")).body.actions;
    expect(log[0]).toMatchObject({ level: "restricted", status: "refused" });
  });
  it.each(["give me a summary of the project", "text summary of my week please", "call it a day", "message me later about this idea", "order the list by date", "empty states in the design", "accept my thanks", "format this as a table", "reset my expectations"])("does not hijack ordinary chat: %s", async (text) => {
    await boot();
    const r = await say(text);
    expect(r.handled).toBe(false);
    expect((await t.call("GET", "/api/assistant/actions")).body.actions).toEqual([]);
  });
  it("the confirm route cannot be used to make a restricted action happen, and unknown ids are 404", async () => {
    await boot();
    const r = await say("delete the project Cafe");
    expect(r.action).toBeUndefined();
    const log = (await t.call("GET", "/api/assistant/actions")).body.actions;
    expect((await t.call("POST", `/api/assistant/actions/${log[0].id}/confirm`)).status).toBe(409);
    expect((await t.call("POST", `/api/assistant/actions/${log[0].id}/undo`)).status).toBe(409);
    expect((await t.call("POST", "/api/assistant/actions/not-a-uuid/confirm")).status).toBe(404);
  });
});

describe("interpretation order and answers from real data", () => {
  it("navigates, explains failures, summarises, and passes ordinary chat through", async () => {
    await boot();
    const p = (await t.call("POST", "/api/projects", { name: "Website" })).body.project;
    expect(await say("open my latest project")).toMatchObject({ kind: "locate", openNow: true, candidates: [{ id: p.id }] });
    expect((await say("why did my last task fail")).message).toMatch(/no failed task/);
    expect((await say("what's the status")).kind).toBe("overview");
    expect((await say("what's the status")).message).toMatch(/active agent/);
    expect((await say("Tell me a story about a dragon")).handled).toBe(false);
  });
});
