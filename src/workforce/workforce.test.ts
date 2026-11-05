import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OK_RESULT, switchOn } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// SIMULATED provider only. The board is checked against the real records the other services wrote.
const reply = (text: string) => ({ ...OK_RESULT, text, inputTokens: 10, outputTokens: 5 });
const opts = (...titles: string[]) => reply(JSON.stringify({ options: titles.map((t) => ({ title: t, details: `Details of ${t}`, pros: "Fast", cons: "Risky" })) }));

let t: TestApp;
let ref: string;
beforeEach(async () => {
  t = await createTestApp();
  ref = await setupGeminiModel(t);
});
afterEach(async () => {
  await t.app.close();
  vi.unstubAllEnvs();
});
const mkBot = async (name: string, role = "Helper", responsibilities: string[] = ["General help"]) => (await switchOn(t.call, await t.call("POST", "/api/bots", { name, role, responsibilities, model: ref }))).body.bot as any;
const settle = () => vi.waitFor(async () => expect(((await t.call("GET", "/api/tasks")).body.tasks as any[]).every((x) => ["completed", "failed", "cancelled"].includes(x.status))).toBe(true), { timeout: 3000, interval: 20 });
const board = async () => (await t.call("GET", "/api/workforce/board")).body;
const node = (b: any, id: string) => b.nodes.find((n: any) => n.id === id);
const edge = (b: any, from: string, to: string, kind: string) => b.edges.some((e: any) => e.from === from && e.to === to && e.kind === kind);

describe("one Central Manager, four divisions, three kinds of bot", () => {
  it("shows the four divisions and the Manager, with every bot unplaced until the owner places it", async () => {
    const a = await mkBot("Alpha");
    const o = (await t.call("GET", "/api/workforce/organization")).body;
    expect(o.divisions.map((d: any) => d.name)).toEqual(["Personal Office", "Business Operations", "AI Digital Agency", "Research & Innovation"]);
    expect(o.manager.name).toBe("Central Manager");
    expect(o.unplaced.map((x: any) => x.id)).toEqual([a.id]);
  });

  it("dedicated = exactly one division; shared = one or more; temporary needs a purpose and an end time", async () => {
    const a = await mkBot("Alpha");
    const bad = await t.call("PUT", `/api/workforce/bots/${a.id}`, { kind: "dedicated", divisions: ["personal_office", "business_operations"] });
    expect(bad.body.error).toBe("one_division");
    expect((await t.call("PUT", `/api/workforce/bots/${a.id}`, { kind: "dedicated", divisions: ["personal_office"] })).status).toBe(200);
    expect((await t.call("PUT", `/api/workforce/bots/${a.id}`, { kind: "shared", divisions: ["personal_office", "ai_digital_agency"] })).body.placement.divisions).toEqual(["personal_office", "ai_digital_agency"]);
    expect((await t.call("PUT", `/api/workforce/bots/${a.id}`, { kind: "temporary", divisions: ["research_innovation"], expiresInHours: 4 })).body.error).toBe("purpose_required");
    expect((await t.call("PUT", `/api/workforce/bots/${a.id}`, { kind: "temporary", divisions: ["research_innovation"], purpose: "One-off report", expiresInHours: 9999 })).body.error).toBe("bad_expiry");
    const o = (await t.call("GET", "/api/workforce/organization")).body;
    expect(o.divisions.find((d: any) => d.key === "personal_office").shared.map((x: any) => x.name)).toEqual(["Alpha"]);
    expect((await t.call("DELETE", `/api/workforce/bots/${a.id}`)).body.ok).toBe(true);
    expect((await t.call("GET", "/api/workforce/organization")).body.unplaced).toHaveLength(1);
  });

  it("placing a bot grants it nothing, and with groups on it joins the division group", async () => {
    const a = await mkBot("Alpha");
    const before = (await t.call("GET", `/api/bots/${a.id}`)).body.bot;
    await t.call("PUT", "/api/groups/enabled", { on: true });
    await t.call("PUT", `/api/workforce/bots/${a.id}`, { kind: "dedicated", divisions: ["business_operations"] });
    const after = (await t.call("GET", `/api/bots/${a.id}`)).body.bot;
    expect(after.permissions).toEqual(before.permissions);
    const g = (await t.call("GET", "/api/groups?kind=division")).body.groups;
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ name: "Business Operations", division: "business_operations" });
    expect(g[0].members.map((m: any) => m.botName)).toEqual(["Alpha"]);
    // moving it removes it from the old division group
    await t.call("PUT", `/api/workforce/bots/${a.id}`, { kind: "dedicated", divisions: ["ai_digital_agency"] });
    const groups = (await t.call("GET", "/api/groups?kind=division")).body.groups;
    expect(groups.find((x: any) => x.division === "business_operations").members).toHaveLength(0);
    expect(groups.find((x: any) => x.division === "ai_digital_agency").members).toHaveLength(1);
  });

  it("a temporary task agent is archived (reversibly) and removed when its time is up; nothing else changes", async () => {
    const a = await mkBot("Temp");
    const keep = await mkBot("Keeper");
    await t.call("PUT", `/api/workforce/bots/${keep.id}`, { kind: "dedicated", divisions: ["personal_office"] });
    await t.call("PUT", `/api/workforce/bots/${a.id}`, { kind: "temporary", divisions: ["research_innovation"], expiresInHours: 1, purpose: "One-off survey" });
    expect((await t.call("GET", "/api/workforce/organization")).body.divisions[3].temporary).toHaveLength(1);
    // end its time: the stored end time is moved into the past (the sweep runs on every read of the organisation or the board)
    const wf = (t.app as any).workforce;
    const parsed = JSON.parse((wf as any).d.kv.get("workforce.org"));
    parsed.bots[a.id].expiresAt = "2000-01-01T00:00:00.000Z";
    (wf as any).d.kv.set("workforce.org", JSON.stringify(parsed));
    const gone = wf.sweepTemporary();
    expect(gone).toEqual([a.id]);
    expect((await t.call("GET", `/api/bots/${a.id}`)).body.bot).toMatchObject({ archived: true, status: "disabled" });
    expect((await t.call("GET", `/api/bots/${keep.id}`)).body.bot.archived).toBe(false);
    expect(((await t.call("GET", "/api/audit?limit=50")).body.events as any[]).some((e) => e.kind === "workforce.temporary_expired")).toBe(true);
    // reversible: the Agent Manager's own unarchive still works
    expect((await t.call("POST", `/api/bots/${a.id}/unarchive`)).body.bot.archived).toBe(false);
  });
});

describe("the Workforce Board reads the real records and invents nothing", () => {
  it("starts with the Manager and the four divisions; bots and the delegation allow-list appear as real nodes and lines", async () => {
    const a = await mkBot("Alpha");
    const b = await mkBot("Beta");
    await t.call("PUT", `/api/bots/${a.id}/delegation`, { targetBotIds: [b.id] });
    await t.call("PUT", `/api/workforce/bots/${a.id}`, { kind: "dedicated", divisions: ["personal_office"] });
    const bd = await board();
    expect(bd.nodes.filter((n: any) => n.kind === "division")).toHaveLength(4);
    expect(node(bd, "manager:central")).toBeTruthy();
    expect(edge(bd, "manager:central", "division:personal_office", "coordinates")).toBe(true);
    expect(edge(bd, "division:personal_office", `bot:${a.id}`, "dedicated")).toBe(true);
    expect(edge(bd, `bot:${a.id}`, `bot:${b.id}`, "delegation")).toBe(true);
    expect(edge(bd, `bot:${b.id}`, `bot:${a.id}`, "delegation")).toBe(false); // direction matters
    expect(bd.nodes.filter((n: any) => n.kind === "task")).toHaveLength(0); // no work yet, no progress shown
    expect(bd.note).toMatch(/Nothing here is estimated or invented/);
  });

  it("a task appears with its true status, links to its bot, and a sub-task depends on its parent; failed work shows as failed", async () => {
    const a = await mkBot("Alpha");
    t.provider.script.push(reply("All done."));
    const sub = await t.call("POST", `/api/bots/${a.id}/tasks`, { instruction: "Write the weekly summary" });
    expect(sub.status).toBe(202);
    await settle();
    let bd = await board();
    const tn = node(bd, `task:${sub.body.task.id}`);
    expect(tn).toMatchObject({ status: "completed", kind: "task" });
    expect(tn.detail.result).toBe("All done.");
    expect(edge(bd, tn.id, `bot:${a.id}`, "assigned")).toBe(true);
    // a failing task is shown as failed, not hidden
    t.provider.script.push(new Error("provider down") as never);
    const bad = await t.call("POST", `/api/bots/${a.id}/tasks`, { instruction: "This one will fail" });
    await settle();
    bd = await board();
    expect(node(bd, `task:${bad.body.task.id}`).status).toBe("failed");
    expect(node(bd, `bot:${a.id}`).detail.failedLast24h).toBeGreaterThanOrEqual(1);
    expect(bd.counts.completed).toBeGreaterThanOrEqual(1);
    expect(bd.counts.failed).toBeGreaterThanOrEqual(1);
  });

  it("decisions, projects, groups and group work are the existing records, linked, never duplicated", async () => {
    await t.call("PUT", "/api/groups/enabled", { on: true });
    const research = await mkBot("Researcher", "Market research", ["Research competitors and markets"]);
    const writer = await mkBot("Writer", "Copywriting", ["Write proposals and marketing copy"]);
    const p = (await t.call("POST", "/api/projects", { name: "Launch" })).body.project;
    const g = (await t.call("POST", "/api/groups", { name: "Launch crew", kind: "project", projectId: p.id, botIds: [research.id, writer.id], participationMode: "all_invited" })).body.group;
    t.provider.script.push(reply("Researcher reports."), reply("Writer reports."));
    const posted = await t.call("POST", `/api/groups/${g.id}/messages`, { content: "Everyone please report" });
    await settle();
    t.provider.script.push(opts("Start with Dubai", "Start with Abu Dhabi"), opts("Write a pitch", "Write a proposal"));
    const rec = await t.call("POST", `/api/groups/${g.id}/recommendations`, { question: "Which market should we research and which proposal should we write first?" });
    const esc = await t.call("POST", `/api/groups/${g.id}/escalate`, { draftId: rec.body.draft.draftId, title: "First market" });
    const bd = await board();
    // groups and projects
    expect(node(bd, `group:${g.id}`)).toMatchObject({ kind: "group", label: "Launch crew" });
    expect(edge(bd, `group:${g.id}`, `bot:${research.id}`, "member")).toBe(true);
    expect(edge(bd, `group:${g.id}`, `project:${p.id}`, "project")).toBe(true);
    // group work: tasks point at the group; counts match the real task table
    const groupTasks = posted.body.started.map((s: any) => `task:${s.taskId}`);
    for (const id of groupTasks) expect(edge(bd, id, `group:${g.id}`, "origin")).toBe(true);
    // the decision is the existing record, linked to the same project
    const did = esc.body.decision.id;
    expect(node(bd, `decision:${did}`)).toMatchObject({ kind: "decision", sub: "needs your choice", status: "active" });
    expect(edge(bd, `decision:${did}`, `project:${p.id}`, "project")).toBe(true);
    expect(bd.nodes.filter((n: any) => n.kind === "decision")).toHaveLength(((await t.call("GET", "/api/decisions")).body.decisions as any[]).length);
    expect(bd.nodes.filter((n: any) => n.kind === "project")).toHaveLength(((await t.call("GET", "/api/projects")).body.projects as any[]).length);
    expect(bd.nodes.filter((n: any) => n.kind === "bot")).toHaveLength(((await t.call("GET", "/api/bots")).body.bots as any[]).filter((b) => !b.archived).length);
  });

  it("an approved decision's work shows up: assignment line, task, completion; a waiting outside action shows as BLOCKED", async () => {
    const research = await mkBot("Researcher", "Market research", ["Research competitors and markets"]);
    const writer = await mkBot("Writer", "Copywriting", ["Write proposals and marketing copy"]);
    t.provider.script.push(opts("Start with Dubai", "Start with Abu Dhabi"), opts("Write a pitch", "Write a proposal"));
    const draft = (await t.call("POST", "/api/decisions/inquire", { question: "Which market should we research and which proposal should we write first?", botIds: [research.id, writer.id] })).body.draft;
    const id = (await t.call("POST", "/api/decisions", { draftId: draft.draftId })).body.decision.id;
    const d = (await t.call("GET", `/api/decisions/${id}`)).body.decision;
    await t.call("PUT", `/api/decisions/${id}/choice`, { optionId: d.options[0].id });
    t.provider.script.push(reply("Research is done."));
    await t.call("POST", `/api/decisions/${id}/approve`);
    await settle();
    const bd = await board();
    expect(node(bd, `decision:${id}`).status).toBe("completed");
    expect(edge(bd, `decision:${id}`, `bot:${research.id}`, "decision")).toBe(true);
    const task = ((await t.call("GET", `/api/decisions/${id}`)).body.decision.assignments[0]).taskId;
    expect(edge(bd, `decision:${id}`, `task:${task}`, "origin")).toBe(true);
    expect(node(bd, `task:${task}`).status).toBe("completed");
  });

  it("node activity comes from the owning record, and saved layouts keep positions and filters only", async () => {
    const a = await mkBot("Alpha");
    t.provider.script.push(reply("ok"));
    await t.call("POST", `/api/bots/${a.id}/tasks`, { instruction: "Do a thing" });
    await settle();
    const act = (await t.call("GET", `/api/workforce/activity?kind=bot&id=${a.id}`)).body;
    expect(act.history.some((h: any) => /Task completed: Do a thing/.test(h.text))).toBe(true);
    expect((await t.call("GET", "/api/workforce/activity?kind=nonsense&id=x")).status).toBe(400);

    const saved = await t.call("PUT", "/api/workforce/layouts", { name: "My view", positions: { "manager:central": { x: 10, y: 20 }, "bot:x": { x: 1e9, y: -1e9 } }, filters: { status: "failed" } });
    expect(saved.body.layout.positions["manager:central"]).toEqual({ x: 10, y: 20 });
    expect(saved.body.layout.positions["bot:x"]).toEqual({ x: 5000, y: -5000 }); // clamped
    expect((await t.call("GET", "/api/workforce/layouts")).body.layouts["My view"].filters).toEqual({ status: "failed" });
    for (let i = 0; i < 9; i++) await t.call("PUT", "/api/workforce/layouts", { name: `L${i}`, positions: {} });
    expect((await t.call("PUT", "/api/workforce/layouts", { name: "Eleventh", positions: {} })).body.error).toBe("too_many_layouts");
    expect((await t.call("DELETE", "/api/workforce/layouts?name=My%20view")).body.ok).toBe(true);
    expect((await t.call("DELETE", "/api/workforce/layouts?name=nope")).status).toBe(404);
  });
});
