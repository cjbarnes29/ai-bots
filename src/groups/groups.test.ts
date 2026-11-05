import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OK_RESULT, switchOn } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// SIMULATED provider only: a scripted fake model answers every call. No real AI, no network.
const reply = (text: string) => ({ ...OK_RESULT, text, inputTokens: 10, outputTokens: 5 });
const opts = (...titles: string[]) => reply(JSON.stringify({ options: titles.map((t) => ({ title: t, details: `Details of ${t}`, pros: "Fast", cons: "Risky" })) }));
const views = (...v: object[]) => reply(JSON.stringify({ views: v }));
const REASON = "The Dubai market is crowded and our budget is small, so margins would suffer badly.";

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
const enable = () => t.call("PUT", "/api/groups/enabled", { on: true });
const mkGroup = async (body: object) => (await t.call("POST", "/api/groups", body)).body.group;
const msgs = async (id: string) => (await t.call("GET", `/api/groups/${id}/messages`)).body.messages as any[];
const allowDelegation = (fromId: string, toId: string) => t.call("PUT", `/api/bots/${fromId}/delegation`, { targetBotIds: [toId] });

describe("the switch (NV-15): groups are OFF until the owner turns them on", () => {
  it("is off on a fresh database; every route but /status refuses, nothing is created", async () => {
    expect((await t.call("GET", "/api/groups/status")).body).toMatchObject({ enabled: false });
    for (const [m, u, b] of [["GET", "/api/groups"], ["POST", "/api/groups", { name: "X" }], ["GET", "/api/groups/00000000-0000-4000-8000-000000000001"]] as const) {
      const r = await t.call(m, u, b);
      expect([u, r.status, r.body.error]).toEqual([u, 409, "groups_disabled"]);
    }
    expect((t.app as any).db ? true : true).toBe(true);
    await enable();
    expect((await t.call("GET", "/api/groups")).body.groups).toEqual([]);
  });

  it("the switch and the audit trail", async () => {
    await enable();
    expect((await t.call("GET", "/api/groups/status")).body.enabled).toBe(true);
    await t.call("PUT", "/api/groups/enabled", { on: false });
    expect((await t.call("GET", "/api/groups")).status).toBe(409);
    expect(((await t.call("GET", "/api/audit?limit=50")).body.events as any[]).map((e) => e.kind)).toEqual(expect.arrayContaining(["groups.enabled", "groups.disabled"]));
  });
});

describe("groups, members and responsibilities", () => {
  beforeEach(async () => {
    await enable();
  });

  it("creates, edits, archives and restores a group; names are unique; membership is history, not deletion", async () => {
    const a = await mkBot("Alpha");
    const b = await mkBot("Beta");
    const g = await mkGroup({ name: "Launch team", description: "Ships the launch", botIds: [a.id, b.id], participationMode: "relevant_bot" });
    expect(g.members.map((m: any) => m.botName)).toEqual(["Alpha", "Beta"]);
    expect((await t.call("POST", "/api/groups", { name: "launch TEAM" })).body.error).toBe("name_taken");
    expect((await t.call("PATCH", `/api/groups/${g.id}`, { name: "Launch squad", maxRounds: 3, coordinatorBotId: a.id })).body.group).toMatchObject({ name: "Launch squad", maxRounds: 3, coordinatorBotId: a.id });
    // the coordinator cannot be removed while coordinating (database rule, reported plainly)
    expect((await t.call("DELETE", `/api/groups/${g.id}/members/${a.id}`)).status).toBe(409);
    await t.call("PATCH", `/api/groups/${g.id}`, { coordinatorBotId: null });
    expect((await t.call("DELETE", `/api/groups/${g.id}/members/${a.id}`)).body.group.members.map((m: any) => m.botName)).toEqual(["Beta"]);
    expect((await t.call("DELETE", `/api/groups/${g.id}/members/${a.id}`)).status).toBe(404);
    expect((await t.call("PUT", `/api/groups/${g.id}/archive`, { on: true })).body.group.archived).toBe(true);
    expect((await t.call("GET", "/api/groups")).body.groups).toHaveLength(0);
    expect(((await t.call("GET", "/api/groups?archived=1")).body.groups as any[]).map((x) => x.name)).toEqual(["Launch squad"]);
    expect((await t.call("POST", `/api/groups/${g.id}/members`, { botId: a.id })).status).toBe(409); // archived
    await t.call("PUT", `/api/groups/${g.id}/archive`, { on: false });
    const readd = await t.call("POST", `/api/groups/${g.id}/members`, { botId: a.id, role: "reviewer" });
    expect(readd.body.group.members.find((m: any) => m.botName === "Alpha").role).toBe("reviewer");
    expect(((await t.call("GET", `/api/groups/${g.id}/activity`)).body.events as any[]).map((e) => e.kind)).toEqual(expect.arrayContaining(["member_added", "member_removed", "coordinator_changed"]));
  });

  it("joining a group grants a bot nothing: no permission, no delegation right, no model change", async () => {
    const a = await mkBot("Alpha");
    const before = (await t.call("GET", `/api/bots/${a.id}`)).body.bot;
    const g = await mkGroup({ name: "Team", botIds: [a.id] });
    const after = (await t.call("GET", `/api/bots/${a.id}`)).body.bot;
    expect(after.permissions).toEqual(before.permissions);
    expect(after.model).toBe(before.model);
    expect((await t.call("GET", `/api/bots/${a.id}/delegation`)).body.targets ?? []).toEqual([]);
    expect(g.members).toHaveLength(1);
  });

  it("an archived bot cannot join; at most 12 members; responsibilities are text only and secrets are refused", async () => {
    const a = await mkBot("Alpha");
    const old = await mkBot("Old");
    await t.call("DELETE", `/api/bots/${old.id}`);
    const g = await mkGroup({ name: "Team", botIds: [a.id] });
    expect((await t.call("POST", `/api/groups/${g.id}/members`, { botId: old.id })).body.error).toBe("bot_not_available");
    const withDuty = (await t.call("PUT", `/api/groups/${g.id}/responsibilities`, { botId: a.id, duty: "Owns the weekly report" })).body.group;
    expect(withDuty.members[0].responsibility).toBe("Owns the weekly report");
    await t.call("PUT", `/api/groups/${g.id}/responsibilities`, { botId: a.id, duty: "Owns the monthly report" });
    expect((await t.call("GET", `/api/groups/${g.id}`)).body.group.members[0].responsibility).toBe("Owns the monthly report"); // the newest counts, the older stays in the history
    expect((await t.call("PUT", `/api/groups/${g.id}/responsibilities`, { botId: a.id, duty: "use AIzaSyFAKEKEYFORTESTSONLY0123456789" })).body.error).toBe("has_secret");
    for (let i = 0; i < 11; i++) await t.call("POST", `/api/groups/${g.id}/members`, { botId: (await mkBot(`Filler${i}`)).id });
    expect((await t.call("POST", `/api/groups/${g.id}/members`, { botId: (await mkBot("OneTooMany")).id })).body.error).toBe("group_full");
  });

  it("division and project groups: one group per division; a project group needs a real project", async () => {
    const d = await t.call("POST", "/api/groups", { name: "Personal Office", kind: "division", division: "personal_office" });
    expect(d.status).toBe(201);
    expect(d.body.group).toMatchObject({ kind: "division", division: "personal_office" });
    expect((await t.call("POST", "/api/groups", { name: "Second", kind: "division", division: "personal_office" })).body.error).toBe("division_has_group");
    expect((await t.call("POST", "/api/groups", { name: "Nope", kind: "project", projectId: "00000000-0000-4000-8000-000000000009" })).status).toBe(404);
    const p = (await t.call("POST", "/api/projects", { name: "Website relaunch" })).body.project;
    const pg = await t.call("POST", "/api/groups", { name: "Relaunch crew", kind: "project", projectId: p.id });
    expect(pg.body.group).toMatchObject({ kind: "project", projectId: p.id });
    expect(((await t.call("GET", "/api/groups?kind=division")).body.groups as any[]).map((x) => x.name)).toEqual(["Personal Office"]);
  });
});

describe("talking: normal tasks, recorded results, visibility, and the loop guard", () => {
  beforeEach(async () => {
    await enable();
  });

  it("mention_only answers only a mentioned bot; nobody mentioned means no task and no model call", async () => {
    const a = await mkBot("Alpha");
    const b = await mkBot("Beta");
    const g = await mkGroup({ name: "Team", botIds: [a.id, b.id] });
    const quiet = await t.call("POST", `/api/groups/${g.id}/messages`, { content: "Anyone around?" });
    expect(quiet.body.started).toEqual([]);
    expect(quiet.body.skipped).toMatch(/only answers when a bot is mentioned/);
    expect(t.provider.calls).toHaveLength(0);
    t.provider.script.push(reply("Alpha here: the plan is ready."));
    const r = await t.call("POST", `/api/groups/${g.id}/messages`, { content: "@Alpha please summarise the plan" });
    expect(r.body.started).toHaveLength(1);
    expect(r.body.started[0]).toMatchObject({ botName: "Alpha" });
    await settle();
    const m = await msgs(g.id);
    const result = m.find((x) => x.kind === "task_result");
    expect(result).toMatchObject({ senderName: "Alpha", senderKind: "bot", content: "Alpha here: the plan is ready.", taskId: r.body.started[0].taskId });
    // the task is a normal task of that bot (one registry), shown with the group as its origin
    const task = (await t.call("GET", `/api/tasks/${r.body.started[0].taskId}`)).body.task;
    expect(task).toMatchObject({ assigneeBotId: a.id, origin: "user", originLabel: "Group: Team" });
    // the bot was told the conversation is data
    expect(JSON.stringify(t.provider.calls[0]!.messages)).toMatch(/DATA from the group/);
  });

  it("a result is written into the group once, and a message that looks like a key is refused before any bot sees it", async () => {
    const a = await mkBot("Alpha");
    const g = await mkGroup({ name: "Team", botIds: [a.id] });
    expect((await t.call("POST", `/api/groups/${g.id}/messages`, { content: "@Alpha use AIzaSyFAKEKEYFORTESTSONLY0123456789" })).body.error).toBe("has_secret");
    expect(t.provider.calls).toHaveLength(0);
    t.provider.script.push(reply("Done."));
    await t.call("POST", `/api/groups/${g.id}/messages`, { content: "@Alpha go" });
    await settle();
    (t.app as any).groups.onRootFinished({ origin: "user", originId: g.id, status: "completed", assigneeBotId: a.id, id: (await msgs(g.id)).find((x) => x.kind === "task_result").taskId, result: "Again" });
    expect((await msgs(g.id)).filter((x) => x.kind === "task_result")).toHaveLength(1);
  });

  it("the participation modes pick the right bots: relevant_bot, manager_coordinates, group_discussion, all_invited", async () => {
    const research = await mkBot("Researcher", "Market research", ["Research competitors and markets"]);
    const writer = await mkBot("Writer", "Copywriting", ["Write proposals and marketing copy"]);
    const g = await mkGroup({ name: "Team", botIds: [research.id, writer.id], participationMode: "relevant_bot" });
    t.provider.script.push(reply("Researched."));
    const rel = await t.call("POST", `/api/groups/${g.id}/messages`, { content: "Please research the competitors in this market" });
    expect(rel.body.started.map((s: any) => s.botName)).toEqual(["Researcher"]);
    await settle();
    await t.call("PATCH", `/api/groups/${g.id}`, { participationMode: "manager_coordinates", coordinatorBotId: writer.id });
    t.provider.script.push(reply("Coordinated."));
    const man = await t.call("POST", `/api/groups/${g.id}/messages`, { content: "Anything at all" });
    expect(man.body.started.map((s: any) => s.botName)).toEqual(["Writer"]);
    await settle();
    await t.call("PATCH", `/api/groups/${g.id}`, { participationMode: "all_invited" });
    t.provider.script.push(reply("One."), reply("Two."));
    const all = await t.call("POST", `/api/groups/${g.id}/messages`, { content: "Everybody please report" });
    expect(all.body.started.map((s: any) => s.botName).sort()).toEqual(["Researcher", "Writer"]);
    await settle();
    // an observer never speaks
    await t.call("PUT", `/api/groups/${g.id}/members/${writer.id}/role`, { role: "observer" }).then((r) => expect(r.status).toBe(409)); // still the coordinator
    await t.call("PATCH", `/api/groups/${g.id}`, { coordinatorBotId: null });
    await t.call("PUT", `/api/groups/${g.id}/members/${writer.id}/role`, { role: "observer" });
    t.provider.script.push(reply("Only me."));
    const obs = await t.call("POST", `/api/groups/${g.id}/messages`, { content: "Everybody please report again" });
    expect(obs.body.started.map((s: any) => s.botName)).toEqual(["Researcher"]);
    await settle();
  });

  it("a direct message to one bot is not shown to the other bots, but the owner sees it", async () => {
    const a = await mkBot("Alpha");
    const b = await mkBot("Beta");
    const g = await mkGroup({ name: "Team", botIds: [a.id, b.id], participationMode: "all_invited" });
    t.provider.script.push(reply("Alpha acknowledges the private note."));
    await t.call("POST", `/api/groups/${g.id}/messages`, { content: "SECRET-PLAN: keep this between us", directToBotId: a.id });
    await settle();
    t.provider.script.push(reply("A."), reply("B."));
    t.provider.calls.length = 0;
    await t.call("POST", `/api/groups/${g.id}/messages`, { content: "Now everyone: status?" });
    await settle();
    const sawBy = (name: string) => t.provider.calls.filter((c) => JSON.stringify(c.messages).includes(`You are \\"${name}\\"`)).map((c) => JSON.stringify(c.messages));
    expect(sawBy("Alpha").join("")).toContain("SECRET-PLAN");
    expect(sawBy("Beta").join("")).not.toContain("SECRET-PLAN");
    expect((await msgs(g.id)).some((m) => m.content.includes("SECRET-PLAN") && m.visibility === "direct")).toBe(true);
  });

  it("loop guard: after one owner message at most max_rounds bot turns; a bot's text mentioning a colleague starts nothing", async () => {
    const a = await mkBot("Alpha");
    const b = await mkBot("Beta");
    const g = await mkGroup({ name: "Team", botIds: [a.id, b.id], participationMode: "all_invited", maxRounds: 1 });
    t.provider.script.push(reply("Alpha says: @Beta please answer me!"), reply("Beta says: @Alpha please answer me!"));
    const r = await t.call("POST", `/api/groups/${g.id}/messages`, { content: "Everyone, go" });
    expect(r.body.started.filter((s: any) => s.taskId)).toHaveLength(1);
    expect(r.body.started.find((s: any) => s.blocked).blocked).toMatch(/limit of 1 bot turns/);
    await settle();
    expect(t.provider.calls).toHaveLength(1); // the mention inside Alpha's answer did not start Beta
    expect(((await t.call("GET", `/api/groups/${g.id}/activity`)).body.events as any[]).some((e) => e.kind === "blocked_loop")).toBe(true);
    // a new owner message starts a new allowance
    t.provider.script.push(reply("Next."));
    const again = await t.call("POST", `/api/groups/${g.id}/messages`, { content: "@Alpha once more" });
    expect(again.body.started[0].taskId).toBeTruthy();
    await settle();
  });

  it("a paused group and a missing group refuse; a switched-off bot is not asked", async () => {
    const a = await mkBot("Alpha");
    const g = await mkGroup({ name: "Team", botIds: [a.id], participationMode: "all_invited" });
    await t.call("PATCH", `/api/groups/${g.id}`, { paused: true });
    expect((await t.call("POST", `/api/groups/${g.id}/messages`, { content: "hello" })).body.error).toBe("group_paused");
    await t.call("PATCH", `/api/groups/${g.id}`, { paused: false });
    await t.call("PATCH", `/api/bots/${a.id}`, { status: "disabled" });
    const r = await t.call("POST", `/api/groups/${g.id}/messages`, { content: "hello" });
    expect(r.body.started).toEqual([]);
    expect(t.provider.calls).toHaveLength(0);
  });
});

describe("handoffs go through the Manager's rules: the existing delegation allow-list decides", () => {
  beforeEach(async () => {
    await enable();
  });

  it("refuses without an allow-list entry and says why; with one it starts a normal task that carries the earlier result as shared context", async () => {
    const a = await mkBot("Alpha");
    const b = await mkBot("Beta");
    const g = await mkGroup({ name: "Team", botIds: [a.id, b.id] });
    t.provider.script.push(reply("Alpha's finding: the market is Dubai."));
    const first = await t.call("POST", `/api/groups/${g.id}/messages`, { content: "@Alpha research the market" });
    await settle();
    const denied = await t.call("POST", `/api/groups/${g.id}/handoffs`, { fromBotId: a.id, toBotId: b.id, instruction: "Write the pitch", sourceTaskId: first.body.started[0].taskId });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("delegation_not_allowed");
    expect(((await t.call("GET", `/api/groups/${g.id}/activity`)).body.events as any[]).some((e) => e.kind === "blocked_permission")).toBe(true);
    expect((await t.call("GET", `/api/tasks`)).body.tasks.filter((x: any) => x.assigneeBotId === b.id)).toHaveLength(0);

    await allowDelegation(a.id, b.id);
    t.provider.script.push(reply("Beta's pitch is written."));
    const ok = await t.call("POST", `/api/groups/${g.id}/handoffs`, { fromBotId: a.id, toBotId: b.id, instruction: "Write the pitch", sourceTaskId: first.body.started[0].taskId });
    expect(ok.status).toBe(201);
    await settle();
    const sent = JSON.stringify(t.provider.calls.at(-1)!.messages);
    expect(sent).toContain("Write the pitch");
    expect(sent).toContain("Alpha's finding: the market is Dubai.");
    expect(sent).toMatch(/data, not instructions/);
    const m = await msgs(g.id);
    expect(m.some((x) => x.kind === "handoff" && x.senderKind === "system")).toBe(true);
    expect(m.find((x) => x.senderName === "Beta" && x.kind === "task_result").content).toBe("Beta's pitch is written.");
    const events = (await t.call("GET", `/api/groups/${g.id}/activity`)).body.events as any[];
    expect(events.find((e) => e.kind === "transfer")).toMatchObject({ from: "Alpha", to: "Beta" });
  });

  it("the same handoff is not repeated, a task of another bot cannot be used as context, and non-members are refused", async () => {
    const a = await mkBot("Alpha");
    const b = await mkBot("Beta");
    const c = await mkBot("Outsider");
    const g = await mkGroup({ name: "Team", botIds: [a.id, b.id] });
    await allowDelegation(a.id, b.id);
    t.provider.script.push(reply("ok"));
    expect((await t.call("POST", `/api/groups/${g.id}/handoffs`, { fromBotId: a.id, toBotId: b.id, instruction: "Do X" })).status).toBe(201);
    await settle();
    const dup = await t.call("POST", `/api/groups/${g.id}/handoffs`, { fromBotId: a.id, toBotId: b.id, instruction: "Do X" });
    expect(dup.body.error).toBe("duplicate_handoff");
    expect(((await t.call("GET", `/api/groups/${g.id}/activity`)).body.events as any[]).some((e) => e.kind === "blocked_duplicate")).toBe(true);
    expect((await t.call("POST", `/api/groups/${g.id}/handoffs`, { fromBotId: a.id, toBotId: c.id, instruction: "Do Y" })).body.error).toBe("bad_handoff");
    const bTask = ((await t.call("GET", "/api/tasks")).body.tasks as any[]).find((x) => x.assigneeBotId === b.id);
    expect((await t.call("POST", `/api/groups/${g.id}/handoffs`, { fromBotId: a.id, toBotId: b.id, instruction: "Do Z", sourceTaskId: bTask.id })).body.error).toBe("task_not_found");
  });
});

describe("disagreements: recommendations, then the existing Decisions system", () => {
  beforeEach(async () => {
    await enable();
  });

  it("members offer options, the group sends them to the owner as a decision, the Manager's loop runs, and what stays unresolved is recorded for the owner", async () => {
    const research = await mkBot("Researcher", "Market research", ["Research competitors and markets"]);
    const writer = await mkBot("Writer", "Copywriting", ["Write proposals and marketing copy"]);
    const p = (await t.call("POST", "/api/projects", { name: "Launch" })).body.project;
    const g = await mkGroup({ name: "Launch crew", kind: "project", projectId: p.id, botIds: [research.id, writer.id] });
    t.provider.script.push(opts("Start with Dubai", "Start with Abu Dhabi"), opts("Write a short pitch", "Write a full proposal"));
    const rec = await t.call("POST", `/api/groups/${g.id}/recommendations`, { question: "Which market should we research and which proposal should we write first?" });
    expect(rec.status).toBe(200);
    expect(rec.body.draft.bots.map((b: any) => b.botName).sort()).toEqual(["Researcher", "Writer"]);
    const esc = await t.call("POST", `/api/groups/${g.id}/escalate`, { draftId: rec.body.draft.draftId, title: "First market and proposal" });
    expect(esc.status).toBe(201);
    const id = esc.body.decision.id;
    expect(esc.body.decision.project?.id).toBe(p.id); // the existing Projects record is reused
    expect(((await t.call("GET", `/api/groups/${g.id}/activity`)).body.events as any[]).find((e) => e.kind === "escalate").detail.decisionId).toBe(id);
    expect((await msgs(g.id)).some((m) => m.kind === "escalation")).toBe(true);
    // the Manager's loop: the bots disagree and keep disagreeing, so it goes to the owner
    const back = views({ option: 1, stance: "support", reasoning: "Dubai has the largest pool of businesses that need better websites." });
    const against = views({ option: 1, stance: "oppose", reasoning: REASON });
    t.provider.script.push(back, against, back, against);
    const col = await t.call("POST", `/api/decisions/${id}/collaborate`);
    expect(col.body).toMatchObject({ rounds: 2, outcome: "escalated_to_owner" });
    expect(col.body.decision.status).toBe("open"); // still the owner's to choose
    // only members can be asked
    const out = await mkBot("Outsider", "Research", ["Research things"]);
    expect((await t.call("POST", `/api/groups/${g.id}/recommendations`, { question: "Which market should we research first?", botIds: [out.id] })).body.error).toBe("not_members");
  });
});
