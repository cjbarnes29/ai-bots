import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OK_RESULT, switchOn } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// SIMULATED provider only: a scripted fake model answers every call. No real AI, no network.
const reply = (text: string) => ({ ...OK_RESULT, text, inputTokens: 10, outputTokens: 5 });
const opts = (...titles: string[]) => reply(JSON.stringify({ options: titles.map((t) => ({ title: t, details: `Details of ${t}`, pros: "Fast", cons: "Risky" })) }));
const views = (...v: object[]) => reply(JSON.stringify({ views: v }));
const REASON = "The Dubai market is crowded and our budget is small, so margins would suffer badly.";
const AGREE = "A smaller pilot answers my worry about margins, so I now back this option fully.";

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
const mkBot = async (name: string, role: string, responsibilities: string[]) => (await switchOn(t.call, await t.call("POST", "/api/bots", { name, role, responsibilities, model: ref }))).body.bot as any;
const get = async (id: string) => (await t.call("GET", `/api/decisions/${id}`)).body.decision;
const settle = () => vi.waitFor(async () => expect(((await t.call("GET", "/api/tasks")).body.tasks as any[]).every((x) => ["completed", "failed", "cancelled"].includes(x.status))).toBe(true), { timeout: 3000, interval: 20 });

/** Researcher proposes options 1-2, Writer options 3-4. */
async function board() {
  const researcher = await mkBot("Researcher", "Market research", ["Research competitors and markets"]);
  const writer = await mkBot("Writer", "Copywriting", ["Write proposals and marketing copy"]);
  t.provider.script.push(opts("Start with Dubai", "Start with Abu Dhabi"), opts("Write a short pitch", "Write a full proposal"));
  const draft = (await t.call("POST", "/api/decisions/inquire", { question: "Which market should we research and which proposal should we write first?", botIds: [researcher.id, writer.id] })).body.draft;
  const id = (await t.call("POST", "/api/decisions", { draftId: draft.draftId })).body.decision.id;
  return { id, researcher, writer };
}
const back = (n = 1) => views({ option: n, stance: "support", reasoning: "Dubai has the largest pool of businesses that need better websites." });
const against = (n = 1) => views({ option: n, stance: "oppose", reasoning: REASON });

describe("collaborate first, escalate what stays unresolved", () => {
  it("stops as soon as the bots agree; the outcome is recorded; nothing is chosen or approved", async () => {
    const { id } = await board();
    const before = t.provider.calls.length;
    t.provider.script.push(back(1), back(1)); // both back option 1 in round 1
    const r = await t.call("POST", `/api/decisions/${id}/collaborate`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ rounds: 1, outcome: "consensus" });
    expect(r.body.consensus).toMatchObject({ state: "consensus", optionTitle: "Start with Dubai", missing: [] });
    expect(t.provider.calls.length - before).toBe(2); // one round = one call per bot, and no second round was started
    expect(r.body.decision).toMatchObject({ status: "open", chosenOptionId: null });
    const notes = r.body.decision.history.filter((h: any) => h.action === "note");
    expect(JSON.stringify(notes)).toContain("consensus");
  });

  it("a reconsidered view in round two can reach agreement; the first round alone was a disagreement", async () => {
    const { id } = await board();
    t.provider.script.push(back(1), against(1)); // round 1: Researcher backs, Writer opposes
    t.provider.script.push(views({ option: 1, stance: "support", reasoning: "A support view of my own proposal, kept." }), views({ option: 1, stance: "support", reasoning: AGREE }));
    const r = await t.call("POST", `/api/decisions/${id}/collaborate`);
    expect(r.body).toMatchObject({ rounds: 2, outcome: "consensus" });
    expect(r.body.consensus.supporters.sort()).toEqual(["Researcher", "Writer"]);
  });

  it("an objection that is still there after the last round is escalated to the owner and recorded; there is no third round and no fabricated consensus", async () => {
    const { id } = await board();
    t.provider.script.push(back(1), against(1), views({ option: 1, stance: "support", reasoning: "Still convinced after reading the concern." }), views({ option: 1, stance: "oppose", reasoning: REASON }));
    const r = await t.call("POST", `/api/decisions/${id}/collaborate`);
    expect(r.body).toMatchObject({ rounds: 2, outcome: "escalated_to_owner" });
    expect(r.body.consensus.state).toBe("unresolved");
    expect(r.body.consensus.objectors.map((o: any) => o.bot)).toContain("Writer");
    expect(r.body.consensus.recommendation.reason).toMatch(/not a decision/);
    expect(r.body.decision.status).toBe("open");
    // asking again does not start more rounds and does not repeat the history entry
    const calls = t.provider.calls.length;
    const again = await t.call("POST", `/api/decisions/${id}/collaborate`);
    expect(again.body.rounds).toBe(0);
    expect(t.provider.calls.length).toBe(calls);
    const notes = (await get(id)).history.filter((h: any) => h.action === "note" && JSON.stringify(h.detail).includes("escalated_to_owner"));
    expect(notes).toHaveLength(1);
  });

  it("silence is not agreement: before any view there is no consensus, and a bot that gave no usable view blocks it", async () => {
    const { id } = await board();
    expect((await t.call("GET", `/api/decisions/${id}/consensus`)).body.consensus.state).toBe("unresolved");
    t.provider.script.push(back(1), reply("not json at all"));
    await t.call("POST", `/api/decisions/${id}/review`);
    const after = (await t.call("GET", `/api/decisions/${id}/consensus`)).body.consensus;
    expect(after.state).not.toBe("consensus");
    expect(after.supporters).not.toContain("Writer");
  });

  it("the consensus check never chooses or approves for the owner", async () => {
    const { id } = await board();
    t.provider.script.push(back(1), back(1));
    await t.call("POST", `/api/decisions/${id}/collaborate`);
    expect((await get(id)).chosenOptionId).toBeNull();
    expect((await t.call("POST", `/api/decisions/${id}/approve`)).status).toBe(409); // nothing chosen yet
  });
});

describe("the owner's edited instructions: versions, approval of an exact version, and what the bot was really told", () => {
  async function editedAndApproved() {
    const { id, researcher } = await board();
    const d = await get(id);
    const opt = d.options[0];
    expect((await t.call("PATCH", `/api/decisions/${id}/options/${opt.id}`, { details: "Research Dubai only, use public sources only." })).status).toBe(200);
    expect((await t.call("PATCH", `/api/decisions/${id}/options/${opt.id}`, { details: "Research Dubai only, public sources only, report in 5 bullet points." })).status).toBe(200);
    await t.call("PATCH", `/api/decisions/${id}`, { ownerNote: "PRIVATE COMMENT: I am nervous about the budget." });
    await t.call("PUT", `/api/decisions/${id}/choice`, { optionId: opt.id });
    t.provider.script.push(reply("Done: five bullet points written."));
    const approve = await t.call("POST", `/api/decisions/${id}/approve`, { assignments: [{ botId: researcher.id, duty: "Keep to the budget the owner set." }] });
    expect(approve.status).toBe(200);
    await settle();
    return { id, optId: opt.id, researcher };
  }

  it("keeps the original wording, adds each edit as its own version with the exact change, and approval names the version", async () => {
    const { id, optId } = await editedAndApproved();
    const v = (await t.call("GET", `/api/decisions/${id}/options/${optId}/versions`)).body;
    expect(v.versions).toHaveLength(3);
    expect(v.versions[0]).toMatchObject({ version: 1, by: "bot", botName: "Researcher" });
    expect(v.versions[0].text.details).toBe("Details of Start with Dubai"); // the original is preserved
    expect(v.versions[1].changes).toEqual([{ field: "details", before: "Details of Start with Dubai", after: "Research Dubai only, use public sources only." }]);
    expect(v.versions[2]).toMatchObject({ version: 3, by: "owner" });
    expect(new Set(v.versions.map((x: any) => x.hash)).size).toBe(3);
    expect(v.approved).toMatchObject({ optionId: optId, version: 3, hash: v.versions[2].hash });
  });

  it("an approved decision keeps its wording: editing it afterwards is refused", async () => {
    const { id, optId } = await editedAndApproved();
    const r = await t.call("PATCH", `/api/decisions/${id}/options/${optId}`, { details: "Sneaky change after approval" });
    expect(r.status).toBe(409);
    expect((await t.call("GET", `/api/decisions/${id}/options/${optId}/versions`)).body.versions).toHaveLength(3);
  });

  it("the executing bot received the approved wording and the owner's duty, never the original text and never a private comment; the result is recorded", async () => {
    const { id, researcher } = await editedAndApproved();
    const exec = (await t.call("GET", `/api/decisions/${id}/execution`)).body.execution;
    expect(exec).toHaveLength(1);
    const e = exec[0];
    expect(e.botId).toBe(researcher.id);
    expect(e.instructionSent).toContain("Research Dubai only, public sources only, report in 5 bullet points.");
    expect(e.instructionSent).toContain("Keep to the budget the owner set.");
    expect(e.instructionSent).not.toContain("Details of Start with Dubai");
    expect(e.instructionSent).not.toContain("PRIVATE COMMENT");
    expect(e.matchesApprovedVersion).toBe(true);
    expect(e.approvedVersion).toBe(3);
    expect(e).toMatchObject({ status: "completed", result: "Done: five bullet points written." });
    // the same words really reached the model, and the private comment did not
    expect(JSON.stringify(t.provider.calls.at(-1)!.messages)).toContain("report in 5 bullet points");
    expect(JSON.stringify(t.provider.calls.at(-1)!.messages)).not.toContain("PRIVATE COMMENT");
    expect((await get(id)).reports.some((r: any) => r.kind === "done")).toBe(true);
  });
});
