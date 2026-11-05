import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/database.js";
import { LlmError } from "../llm/errors.js";
import { OK_RESULT } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { TaskEngine } from "./engine.js";
import { TaskRepository } from "./repository.js";
import { switchOn } from "../llm/test-helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
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

const block = (to: string, task: string) => "```delegate\n" + JSON.stringify({ to, task }) + "\n```";
const reply = (text: string) => ({ ...OK_RESULT, text, inputTokens: 10, outputTokens: 5 });
const mkBot = async (name: string, extra: Record<string, unknown> = {}) =>
  (await switchOn(t.call, await t.call("POST", "/api/bots", { name, model: ref, ...extra }))).body.bot as any;
const allow = (botId: string, ...ids: string[]) => t.call("PUT", `/api/bots/${botId}/delegation`, { targetBotIds: ids });
const submit = (botId: string, instruction = "Do the thing") => t.call("POST", `/api/bots/${botId}/tasks`, { instruction });
const FINAL = ["completed", "failed", "cancelled"];
async function finished(taskId: string): Promise<any> {
  let tree: any;
  await vi.waitFor(
    async () => {
      tree = (await t.call("GET", `/api/tasks/${taskId}`)).body;
      expect(FINAL).toContain(tree.task.status);
    },
    { timeout: 3000, interval: 10 },
  );
  return tree;
}
const run = async (botId: string, instruction?: string) => finished((await submit(botId, instruction)).body.task.id);
const system = (callIndex: number) => t.provider.calls[callIndex]!.messages[0]!.content;
const kinds = (tree: any) => tree.events.map((e: any) => e.kind);

describe("a task with no delegation", () => {
  it("runs one bot, records the result, usage and events", async () => {
    const a = await mkBot("Manager");
    t.provider.script.push(reply("Done: 42"));
    const res = await submit(a.id, "What is 6 x 7?");
    expect(res.status).toBe(202);
    expect(res.body.task).toMatchObject({ status: "pending", depth: 0, assigneeName: "Manager", requestedBy: "user", requestedByName: "You" });

    const tree = await finished(res.body.task.id);
    expect(tree.task).toMatchObject({ status: "completed", result: "Done: 42", llmCalls: 1, inputTokens: 10, outputTokens: 5, children: [] });
    expect(tree.totals).toEqual({ tasks: 1, llmCalls: 1, inputTokens: 10, outputTokens: 5 });
    expect(kinds(tree)).toEqual(["created", "started", "completed"]);

    const sent = t.provider.calls[0]!;
    expect(system(0)).toContain("Manager");
    expect(system(0)).not.toContain("Teamwork"); // nobody to delegate to, so the bot is not told about it
    expect(sent.messages[1]).toEqual({ role: "user", content: "Task from the user:\nWhat is 6 x 7?" });
    expect(Object.keys(sent).sort()).toEqual(["maxOutputTokens", "messages", "model", "temperature", "timeoutMs"]); // no tools

    const usage = (await t.call("GET", "/api/llm/usage")).body.usage;
    expect(usage.byBot).toEqual([{ botId: a.id, botName: "Manager", requests: 1, tokens: 15 }]);
  });

  it("lists tasks, newest first, with their chain totals", async () => {
    const a = await mkBot("Manager");
    await run(a.id, "first");
    await run(a.id, "second");
    const list = (await t.call("GET", "/api/tasks")).body.tasks;
    expect(list.map((x: any) => x.instruction)).toEqual(["second", "first"]);
    expect(list[0]).toMatchObject({ chainTasks: 1, chainLlmCalls: 1 });
  });
});

describe("delegating to a teammate", () => {
  it("hands work over, returns the teammate's answer to the first bot, and logs everything", async () => {
    const manager = await mkBot("Manager", { role: "Leads the team" });
    const researcher = await mkBot("Researcher", { role: "Finds facts" });
    await allow(manager.id, researcher.id);
    t.provider.script.push(
      reply(`I need facts first.\n${block("Researcher", "Find two facts about solar panels.")}`),
      reply("Fact 1. Fact 2."),
      reply("Final report using the facts."),
    );

    const tree = await run(manager.id, "Write a report on solar panels");
    expect(tree.task).toMatchObject({ status: "completed", result: "Final report using the facts.", llmCalls: 2 });
    expect(tree.task.children).toHaveLength(1);
    const child = tree.task.children[0];
    expect(child).toMatchObject({
      status: "completed",
      result: "Fact 1. Fact 2.",
      depth: 1,
      assigneeName: "Researcher",
      requestedBy: manager.id,
      requestedByName: "Manager",
      instruction: "Find two facts about solar panels.",
      llmCalls: 1,
    });
    expect(tree.totals).toMatchObject({ tasks: 2, llmCalls: 3 });
    expect(kinds(tree)).toEqual(["created", "started", "delegated", "started", "completed", "completed"]);

    // What each model actually saw:
    expect(t.provider.calls).toHaveLength(3);
    expect(system(0)).toContain("Teamwork");
    expect(system(0)).toContain("- Researcher: Finds facts");
    expect(system(1)).not.toContain("Teamwork"); // the Researcher has no teammates
    expect(t.provider.calls[1]!.messages[1]!.content).toBe("Manager asked you to do this task:\nFind two facts about solar panels.");
    const third = t.provider.calls[2]!.messages;
    expect(third.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(third[3]!.content).toContain("### Researcher\nFact 1. Fact 2.");
    expect(third[3]!.content).toContain("Do not delegate again");

    // Every call is attributed to the bot that made it.
    const usage = (await t.call("GET", "/api/llm/usage")).body.usage;
    expect(Object.fromEntries(usage.byBot.map((b: any) => [b.botName, b.requests]))).toEqual({ Manager: 2, Researcher: 1 });
  });

  it("never sends tools to any model during a chain", async () => {
    const a = await mkBot("A");
    const b = await mkBot("B");
    await allow(a.id, b.id);
    t.provider.script.push(reply(block("B", "help")), reply("b"), reply("a"));
    await run(a.id);
    for (const call of t.provider.calls) {
      expect(Object.keys(call).sort()).toEqual(["maxOutputTokens", "messages", "model", "temperature", "timeoutMs"]);
      expect(JSON.stringify(call)).not.toMatch(/"tools?"|"functions?"|tool_choice/);
    }
  });

  it("matches teammate names ignoring capital letters and spaces", async () => {
    const a = await mkBot("A");
    const b = await mkBot("Researcher");
    await allow(a.id, b.id);
    t.provider.script.push(reply(block("  researcher ", "go")), reply("done"), reply("final"));
    const tree = await run(a.id);
    expect(tree.task.children).toHaveLength(1);
  });

  it("cuts a very long teammate answer before the first bot sees it", async () => {
    const a = await mkBot("A");
    const b = await mkBot("B");
    await allow(a.id, b.id);
    t.provider.script.push(reply(block("B", "write a lot")), reply("x".repeat(5000)), reply("final"));
    const tree = await run(a.id);
    expect(tree.task.children[0].result).toHaveLength(5000); // the full answer is kept on the task
    const seen = t.provider.calls[2]!.messages[3]!.content;
    expect(seen).toContain("[Cut: longer than 3,000 characters.]");
    expect(seen.length).toBeLessThan(3600);
  });

  it("a teammate's reply cannot trigger more delegation than its own allow-list permits", async () => {
    const a = await mkBot("A");
    const b = await mkBot("B");
    const c = await mkBot("C");
    await allow(a.id, b.id); // B may NOT delegate to C
    t.provider.script.push(reply(block("B", "help")), reply(block("C", "sneaky")), reply("b final"), reply("a final"));
    const tree = await run(a.id);
    expect(tree.task.status).toBe("completed");
    expect(tree.task.children[0].children).toEqual([]);
    expect(tree.events.some((e: any) => e.kind === "delegation_rejected" && /not one of your allowed teammates/.test(e.detail))).toBe(true);
    expect(c.id).toBeTruthy();
  });
});

describe("nobody may delegate by default", () => {
  it("rejects a request from a bot with no allowed teammates and tells it why", async () => {
    const a = await mkBot("A");
    await mkBot("B");
    t.provider.script.push(reply(block("B", "please help")), reply("I did it myself."));
    const tree = await run(a.id);
    expect(tree.task).toMatchObject({ status: "completed", result: expect.stringMatching(/^I did it myself\.\n\n--- What the platform recorded \(not written by the AI\) ---\n- .*rejected and not done/), children: [] });
    expect(system(0)).not.toContain("Teamwork");
    const secondPrompt = t.provider.calls[1]!.messages[3]!.content;
    expect(secondPrompt).toContain('REJECTED: "B" is not one of your allowed teammates');
    expect(kinds(tree)).toContain("delegation_rejected");
  });

  it("an archived teammate is no longer offered and cannot be used", async () => {
    const a = await mkBot("A");
    const b = await mkBot("B");
    await allow(a.id, b.id);
    await t.call("DELETE", `/api/bots/${b.id}`);
    t.provider.script.push(reply(block("B", "help")), reply("fine"));
    const tree = await run(a.id);
    expect(system(0)).not.toContain("Teamwork");
    expect(tree.task.children).toEqual([]);
  });

  it("a teammate without a model, or using OpenClaw, is not offered", async () => {
    const a = await mkBot("A");
    const noModel = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "NoModel" }))).body.bot;
    const claw = await mkBot("Claw", { runtime: "openclaw" });
    await allow(a.id, noModel.id, claw.id);
    t.provider.script.push(reply("alone"));
    await run(a.id);
    expect(system(0)).not.toContain("Teamwork");
  });
});

describe("safeguards", () => {
  it("stops loops: a bot cannot hand work back to someone already in the chain", async () => {
    const a = await mkBot("A");
    const b = await mkBot("B");
    await allow(a.id, b.id);
    await allow(b.id, a.id);
    t.provider.script.push(reply(block("B", "help me")), reply(block("A", "back to you")), reply("b final"), reply("a final"));
    const tree = await run(a.id);
    expect(tree.task.status).toBe("completed");
    expect(system(1)).not.toContain("Teamwork"); // A is already in the chain, so B is not even offered it
    expect(t.provider.calls[2]!.messages[3]!.content).toMatch(/REJECTED: that would create a loop: A is already part of this chain/);
    expect(tree.task.children[0].children).toEqual([]);
    expect(tree.totals.tasks).toBe(2);
  });

  it("limits how deep a chain can go (2 levels by default)", async () => {
    const [a, b, c, d] = [await mkBot("A"), await mkBot("B"), await mkBot("C"), await mkBot("D")] as any[];
    await allow(a.id, b.id);
    await allow(b.id, c.id);
    await allow(c.id, d.id);
    t.provider.script.push(
      reply(block("B", "step 1")),
      reply(block("C", "step 2")),
      reply(block("D", "step 3")),
      reply("c final"),
      reply("b final"),
      reply("a final"),
    );
    const tree = await run(a.id);
    expect(tree.task.status).toBe("completed");
    const cNode = tree.task.children[0].children[0];
    expect(cNode).toMatchObject({ assigneeName: "C", depth: 2, children: [] });
    expect(system(2)).not.toContain("Teamwork"); // C is at the limit, so it is not offered teammates
    expect(t.provider.calls[3]!.messages[3]!.content).toMatch(/REJECTED: the limit of 2 levels of delegation was reached/);
    expect(tree.totals.tasks).toBe(3);
  });

  it("limits how many teammates one task may use (3 by default)", async () => {
    const a = await mkBot("A");
    const team = [await mkBot("B"), await mkBot("C"), await mkBot("D"), await mkBot("E")];
    await allow(a.id, ...team.map((m) => m.id));
    t.provider.script.push(
      reply(["B", "C", "D", "E"].map((n) => block(n, `job for ${n}`)).join("\n")),
      reply("b"),
      reply("c"),
      reply("d"),
      reply("a final"),
    );
    const tree = await run(a.id);
    expect(tree.task.children.map((c: any) => c.assigneeName)).toEqual(["B", "C", "D"]);
    expect(t.provider.calls).toHaveLength(5); // E never ran
    expect(t.provider.calls[4]!.messages[3]!.content).toMatch(/E\nREJECTED: you may delegate to at most 3 teammates per task/);
  });

  it("limits the tasks in a chain", async () => {
    await t.call("PUT", "/api/delegation/limits", { maxTasksPerChain: 2 });
    const a = await mkBot("A");
    const b = await mkBot("B");
    const c = await mkBot("C");
    await allow(a.id, b.id, c.id);
    t.provider.script.push(reply(block("B", "x") + "\n" + block("C", "y")), reply("b"), reply("final"));
    const tree = await run(a.id);
    expect(tree.totals.tasks).toBe(2);
    expect(t.provider.calls[2]!.messages[3]!.content).toMatch(/REJECTED: this chain already has the maximum of 2 tasks/);
  });

  it("limits the model calls in a chain, and refuses a delegation that would not leave room to finish", async () => {
    await t.call("PUT", "/api/delegation/limits", { maxLlmCallsPerChain: 2 });
    const a = await mkBot("A");
    const b = await mkBot("B");
    await allow(a.id, b.id);
    t.provider.script.push(reply(block("B", "help")), reply("a final"));
    const tree = await run(a.id);
    expect(tree.task).toMatchObject({ status: "completed", result: expect.stringMatching(/^a final\n\n--- What the platform recorded/), llmCalls: 2, children: [] });
    expect(t.provider.calls[1]!.messages[3]!.content).toMatch(/REJECTED: the budget of 2 model calls for this chain would be exceeded/);
  });

  it("hands back the raw material (instead of failing) when the call budget runs out before the final write-up", async () => {
    await t.call("PUT", "/api/delegation/limits", { maxLlmCallsPerChain: 4 });
    const [a, b, c] = [await mkBot("A"), await mkBot("B"), await mkBot("C")] as any[];
    await allow(a.id, b.id);
    await allow(b.id, c.id);
    t.provider.script.push(reply(block("B", "go")), reply(block("C", "go deeper")), reply("c-result"), reply("b-result"));
    const tree = await run(a.id);
    expect(t.provider.calls).toHaveLength(4);
    expect(tree.task.status).toBe("completed");
    expect(tree.task.result).toContain("b-result");
    expect(tree.task.result).toMatch(/budget for this task ran out/);
    expect(kinds(tree)).toContain("limit");
  });

  it("every limit is re-checked from the dashboard settings, so turning delegation off (depth 0) stops it", async () => {
    await t.call("PUT", "/api/delegation/limits", { maxDepth: 0 });
    const a = await mkBot("A");
    const b = await mkBot("B");
    await allow(a.id, b.id);
    t.provider.script.push(reply(block("B", "help")), reply("alone"));
    const tree = await run(a.id);
    expect(system(0)).not.toContain("Teamwork");
    expect(tree.task.children).toEqual([]);
    expect(t.provider.calls[1]!.messages[3]!.content).toMatch(/levels of delegation/);
  });

  it("the usual limits still apply inside a chain (free-only gate, per-bot limits)", async () => {
    await t.call("PUT", "/api/llm/limits", { botDailyRequests: 1 });
    const a = await mkBot("A");
    const b = await mkBot("B");
    await allow(a.id, b.id);
    t.provider.script.push(reply(block("B", "help")), reply("b answer"), reply("never used"));
    const tree = await run(a.id);
    // A used its one request for the first step, so its final step was blocked by A's daily limit.
    expect(tree.task).toMatchObject({ status: "failed", errorCode: "llm_limit_exceeded" });
    expect(tree.task.errorMessage).toMatch(/Daily \(this bot\) request limit reached \(1\/1\)/);
    expect(tree.task.children[0].status).toBe("completed");
    expect(t.provider.calls).toHaveLength(2);
  });

  it("the pause switch stops new tasks, and stops a chain already under way", async () => {
    const a = await mkBot("A");
    await t.call("PUT", "/api/llm/pause", { paused: true });
    const blocked = await submit(a.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe("llm_paused");
    await t.call("PUT", "/api/llm/pause", { paused: false });

    const b = await mkBot("B");
    await allow(a.id, b.id);
    t.provider.script.push(reply(block("B", "help")), async () => {
      await t.call("PUT", "/api/llm/pause", { paused: true }); // paused while B is working
      return reply("b answer");
    });
    const tree = await run(a.id);
    expect(tree.task).toMatchObject({ status: "failed", errorCode: "llm_paused" });
    expect(t.provider.calls).toHaveLength(2);
  });
});

describe("when something goes wrong", () => {
  it("a failing teammate does not fail the first bot: it is told, and finishes", async () => {
    const a = await mkBot("A");
    const b = await mkBot("B");
    await allow(a.id, b.id);
    t.provider.script.push(reply(block("B", "help")), new LlmError("auth_failed", "The provider rejected the API key."), reply("a final"));
    await t.call("PUT", "/api/llm/limits", { retries: 0 });
    const tree = await run(a.id);
    expect(tree.task).toMatchObject({ status: "completed", result: expect.stringMatching(/^a final\n\n--- What the platform recorded \(not written by the AI\) ---\n- .* did not finish the work handed to it/) });
    expect(tree.task.children[0]).toMatchObject({ status: "failed", errorCode: "llm_auth_failed" });
    expect(t.provider.calls[2]!.messages[3]!.content).toContain("FAILED: The provider rejected the API key.");
    expect(kinds(tree)).toContain("failed");
  });

  it("a failing first bot fails the task with a clear reason", async () => {
    const a = await mkBot("A");
    await t.call("PUT", "/api/llm/limits", { retries: 0 });
    t.provider.script.push(new LlmError("auth_failed", "The provider rejected the API key."));
    const tree = await run(a.id);
    expect(tree.task).toMatchObject({ status: "failed", errorCode: "llm_auth_failed", errorMessage: "The provider rejected the API key.", llmCalls: 1 });
  });

  it("refuses a task for a bot that cannot run, with a reason", async () => {
    const noModel = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "NoModel" }))).body.bot;
    expect((await submit(noModel.id)).body.error).toBe("bot_not_active"); // a bot without a model cannot be switched on
    const paused = await mkBot("Paused");
    await t.call("PATCH", `/api/bots/${paused.id}`, { status: "paused" });
    expect((await submit(paused.id)).body.message).toMatch(/paused/);
    const claw = await mkBot("Claw", { runtime: "openclaw" });
    expect((await submit(claw.id)).body.error).toBe("runtime_not_installed");
    const old = await mkBot("Old");
    await t.call("DELETE", `/api/bots/${old.id}`);
    expect((await submit(old.id)).body.error).toBe("bot_archived");
    expect((await submit("00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await submit("nope")).status).toBe(404);
    expect((await t.call("GET", "/api/tasks")).body.tasks).toEqual([]); // nothing was created
  });

  it("validates the instruction", async () => {
    const a = await mkBot("A");
    expect((await submit(a.id, "   ")).body.error).toBe("empty_instruction");
    const long = await submit(a.id, "x".repeat(4001));
    expect(long.status).toBe(413);
    expect((await t.call("POST", `/api/bots/${a.id}/tasks`, { instruction: "ok", model: "x" })).status).toBe(400);
    expect((await t.call("POST", `/api/bots/${a.id}/tasks`, {})).status).toBe(400);
    expect((await submit(a.id, "x".repeat(4000))).status).toBe(202);
  });

  it("unknown or non-root task ids give 404", async () => {
    const a = await mkBot("A");
    const b = await mkBot("B");
    await allow(a.id, b.id);
    t.provider.script.push(reply(block("B", "x")), reply("b"), reply("a"));
    const tree = await run(a.id);
    expect((await t.call("GET", "/api/tasks/00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await t.call("GET", "/api/tasks/nope")).status).toBe(404);
    expect((await t.call("GET", `/api/tasks/${tree.task.children[0].id}`)).status).toBe(404);
    expect((await t.call("POST", `/api/tasks/${tree.task.children[0].id}/cancel`)).status).toBe(404);
  });
});

describe("cancelling and queueing", () => {
  it("cancelling stops the chain: nothing more is sent to any model", async () => {
    const a = await mkBot("A");
    const b = await mkBot("B");
    await allow(a.id, b.id);
    let release!: () => void;
    t.provider.script.push(
      () => new Promise((resolve) => (release = () => resolve(reply(block("B", "help"))))),
      reply("b"),
      reply("a"),
    );
    const id = (await submit(a.id)).body.task.id;
    await vi.waitFor(() => expect(t.provider.calls).toHaveLength(1));
    const cancelled = await t.call("POST", `/api/tasks/${id}/cancel`);
    expect(cancelled.body.task.status).toBe("cancelled");
    release();
    const tree = await finished(id);
    await new Promise((r) => setTimeout(r, 50));
    expect(tree.task).toMatchObject({ status: "cancelled", children: [] });
    expect(t.provider.calls).toHaveLength(1); // the delegation to B never happened
    expect(kinds((await t.call("GET", `/api/tasks/${id}`)).body)).toContain("cancelled");
  });

  it("cancelling a finished task changes nothing", async () => {
    const a = await mkBot("A");
    t.provider.script.push(reply("done"));
    const tree = await run(a.id);
    const res = await t.call("POST", `/api/tasks/${tree.task.id}/cancel`);
    expect(res.body.task.status).toBe("completed");
  });

  it("runs one chain at a time, in order", async () => {
    const a = await mkBot("A");
    let release!: () => void;
    t.provider.script.push(() => new Promise((resolve) => (release = () => resolve(reply("first")))), reply("second"));
    const first = (await submit(a.id, "one")).body.task.id;
    const second = (await submit(a.id, "two")).body.task.id;
    await vi.waitFor(() => expect(t.provider.calls).toHaveLength(1));
    expect((await t.call("GET", `/api/tasks/${second}`)).body.task.status).toBe("pending");
    expect(t.provider.calls).toHaveLength(1);
    release();
    expect((await finished(first)).task.result).toBe("first");
    expect((await finished(second)).task.result).toBe("second");
    expect(t.provider.calls.map((c) => c.messages[1]!.content)).toEqual(["Task from the user:\none", "Task from the user:\ntwo"]);
  });

  it("marks tasks cut off by a restart as failed instead of leaving them 'running' forever", () => {
    const db = openDatabase(":memory:");
    const now = new Date().toISOString();
    db.prepare("INSERT INTO bots (id, name, created_at, updated_at) VALUES ('b1', 'Bot', ?, ?)").run(now, now);
    const insert = db.prepare(
      "INSERT INTO tasks (id, root_id, parent_id, assignee_bot_id, requested_by, instruction, depth, status, created_at) VALUES (?, ?, NULL, 'b1', 'user', 'x', 0, ?, ?)",
    );
    insert.run("t-running", "t-running", "running", now);
    insert.run("t-pending", "t-pending", "pending", now);
    insert.run("t-done", "t-done", "completed", now);
    const repo = new TaskRepository(db);
    new TaskEngine({ tasks: repo, getBot: () => ({}) as any, llm: {} as any }).recoverInterrupted();
    expect(repo.getTask("t-running")).toMatchObject({ status: "failed", errorCode: "interrupted" });
    expect(repo.getTask("t-pending")).toMatchObject({ status: "failed", errorCode: "interrupted" });
    expect(repo.getTask("t-done")?.status).toBe("completed");
    expect(repo.listEvents("t-running")[0]).toMatchObject({ kind: "failed" });
  });

  it("tasks and their log can never be deleted or rewritten", () => {
    const db = openDatabase(":memory:");
    const now = new Date().toISOString();
    db.prepare("INSERT INTO bots (id, name, created_at, updated_at) VALUES ('b1', 'Bot', ?, ?)").run(now, now);
    db.prepare("INSERT INTO tasks (id, root_id, assignee_bot_id, requested_by, instruction, depth, status, created_at) VALUES ('t', 't', 'b1', 'user', 'x', 0, 'pending', ?)").run(now);
    db.prepare("INSERT INTO task_events (task_id, root_id, kind, detail, created_at) VALUES ('t', 't', 'created', '{}', ?)").run(now);
    db.prepare("INSERT INTO delegation_audit (bot_id, target_bot_id, action, created_at) VALUES ('b1', 'b1', 'allowed', ?)").run(now);
    expect(() => db.prepare("DELETE FROM tasks").run()).toThrow(/cannot be deleted/);
    expect(() => db.prepare("UPDATE task_events SET kind = 'x'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM task_events").run()).toThrow(/append-only/);
    expect(() => db.prepare("UPDATE delegation_audit SET action = 'removed'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM delegation_audit").run()).toThrow(/append-only/);
    expect(() => db.prepare("INSERT INTO bot_delegation_targets (bot_id, target_bot_id) VALUES ('b1', 'b1')").run()).toThrow(); // no self-delegation
  });
});

describe("choosing who a bot may delegate to", () => {
  it("starts empty for every bot", async () => {
    const a = await mkBot("A");
    const res = await t.call("GET", `/api/bots/${a.id}/delegation`);
    expect(res.body).toEqual({ targets: [], audit: [] });
  });

  it("saves the allow-list, shows it, and logs every change", async () => {
    const a = await mkBot("A");
    const b = await mkBot("B", { role: "Helper" });
    const c = await mkBot("C");
    const first = await allow(a.id, b.id, c.id);
    expect(first.status).toBe(200);
    expect(first.body.targets.map((x: any) => x.name)).toEqual(["B", "C"]);
    expect(first.body.targets[0]).toMatchObject({ role: "Helper", archived: false });

    await allow(a.id, c.id); // remove B
    await allow(a.id, c.id); // no change: nothing logged
    const { audit, targets } = (await t.call("GET", `/api/bots/${a.id}/delegation`)).body;
    expect(targets.map((x: any) => x.name)).toEqual(["C"]);
    expect(audit.map((x: any) => [x.targetName, x.action])).toEqual([["B", "removed"], ["C", "allowed"], ["B", "allowed"]]);
  });

  it("ignores duplicates and rejects bad lists", async () => {
    const a = await mkBot("A");
    const b = await mkBot("B");
    expect((await allow(a.id, b.id, b.id)).body.targets).toHaveLength(1);
    expect((await allow(a.id, a.id)).body.error).toBe("invalid_teammate"); // not itself
    expect((await allow(a.id, "00000000-0000-4000-8000-000000000000")).body.error).toBe("invalid_teammate");
    expect((await t.call("PUT", `/api/bots/${a.id}/delegation`, { targetBotIds: ["nope"] })).status).toBe(400);
    expect((await t.call("PUT", `/api/bots/${a.id}/delegation`, { targetBotIds: [], extra: 1 })).status).toBe(400);
    expect((await t.call("PUT", `/api/bots/${a.id}/delegation`, {})).status).toBe(400);
    expect((await t.call("GET", "/api/bots/nope/delegation")).status).toBe(404);
  });

  it("an archived bot cannot be newly added, and an archived bot's own team cannot be edited", async () => {
    const a = await mkBot("A");
    const b = await mkBot("B");
    await t.call("DELETE", `/api/bots/${b.id}`);
    expect((await allow(a.id, b.id)).body.error).toBe("invalid_teammate");
    const c = await mkBot("C");
    await allow(a.id, c.id);
    await t.call("DELETE", `/api/bots/${c.id}`);
    expect((await allow(a.id, c.id)).status).toBe(200); // already on the list: may stay
    await t.call("DELETE", `/api/bots/${a.id}`);
    expect((await allow(a.id)).body.error).toBe("bot_archived");
  });

  it("changes need the client header, and delegating never changes a bot's permissions", async () => {
    const a = await mkBot("A");
    const b = await mkBot("B");
    const noHeader = await t.app.inject({ method: "PUT", url: `/api/bots/${a.id}/delegation`, payload: { targetBotIds: [b.id] } });
    expect(noHeader.statusCode).toBe(403);
    await allow(a.id, b.id);
    t.provider.script.push(reply(block("B", "x")), reply("b"), reply("a"));
    await run(a.id);
    const after = (await t.call("GET", `/api/bots/${a.id}`)).body.bot;
    expect(after.permissions.every((p: any) => p.readEnabled === false && p.writePolicy === "approval_required")).toBe(true);
    expect((await t.call("GET", `/api/bots/${a.id}/permissions/audit`)).body.audit).toEqual([]);
  });
});

describe("delegation limits", () => {
  it("starts at the safe defaults", async () => {
    const res = await t.call("GET", "/api/delegation/limits");
    expect(res.body.limits).toEqual({ maxDepth: 2, maxSubtasksPerTask: 3, maxTasksPerChain: 5, maxLlmCallsPerChain: 8, maxInstructionChars: 4000, maxParallelChains: 1 });
    expect(res.body.defaults).toEqual(res.body.limits);
  });

  it("can be changed within the hard ceilings, and reset", async () => {
    expect((await t.call("PUT", "/api/delegation/limits", { maxDepth: 3, maxLlmCallsPerChain: 12 })).body.limits).toMatchObject({ maxDepth: 3, maxLlmCallsPerChain: 12, maxTasksPerChain: 5 });
    expect((await t.call("PUT", "/api/delegation/limits", { maxDepth: 5 })).status).toBe(400);
    expect((await t.call("PUT", "/api/delegation/limits", { maxLlmCallsPerChain: 31 })).status).toBe(400);
    expect((await t.call("PUT", "/api/delegation/limits", { maxSubtasksPerTask: 0 })).status).toBe(400);
    expect((await t.call("PUT", "/api/delegation/limits", { maxDepth: 1.5 })).status).toBe(400);
    expect((await t.call("PUT", "/api/delegation/limits", { somethingElse: 1 })).status).toBe(400);
    expect((await t.call("POST", "/api/delegation/limits/reset")).body.limits.maxDepth).toBe(2);
  });
});
