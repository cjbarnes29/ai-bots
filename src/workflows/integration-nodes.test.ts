import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ConnectorDefinition } from "../connectors/types.js";
import { switchOn } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const sent: any[] = [];
const behaviour = { failWith: null as string | null };
const telegram: ConnectorDefinition = {
  id: "telegram",
  label: "Telegram",
  actions: {
    send_message: {
      kind: "write",
      description: "Send a message",
      args: z.strictObject({ chat: z.string().min(1), text: z.string().min(1) }),
      summarize: (a) => `Send "${a["text"]}" to ${a["chat"]}`,
      execute: async (a) => {
        if (behaviour.failWith) throw new Error(behaviour.failWith);
        sent.push(a);
        return `sent #${sent.length}`;
      },
    },
    read_messages: {
      kind: "read",
      description: "Read messages",
      args: z.strictObject({}),
      summarize: () => "Read recent messages",
      execute: async () => "Sam says: hello",
    },
  },
};

let t: TestApp;
let botId: string;
beforeEach(async () => {
  sent.length = 0;
  behaviour.failWith = null;
  t = await createTestApp({ connectors: [telegram] });
  const ref = await setupGeminiModel(t);
  botId = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Messenger", model: ref }))).body.bot.id;
});
afterEach(async () => {
  await t.app.close();
  vi.unstubAllEnvs();
});

const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, label: id, x: 0, y: 0, ...extra });
const edge = (from: string, to: string) => ({ id: `${from}-${to}`, from, to, when: "always" });
const graph = (box: Record<string, unknown>) => ({ nodes: [node("start", "trigger", { kind: "manual" }), node("act", "integration", { botId, ...box }), node("after", "set", { value: "got: {{act}}" }), node("end", "end")], edges: [edge("start", "act"), edge("act", "after"), edge("after", "end")] });
const make = async (g: unknown) => {
  const w = (await t.call("POST", "/api/workflows", { name: "Outside", graph: g })).body.workflow;
  return w;
};
const run = async (id: string, input = "hello") => {
  const res = await t.call("POST", `/api/workflows/${id}/run`, { input });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  await t.app.workflows.idle();
  return res.body.run.id as string;
};
const view = async (runId: string) => (await t.call("GET", `/api/workflows/runs/${runId}`)).body.run as any;
const step = (r: any, id: string) => r.steps.find((s: any) => s.nodeId === id);
const pending = async () => (await t.call("GET", "/api/approvals?status=pending")).body.approvals as any[];
/** The clock normally calls tick(); in tests we call it, then let the run finish. */
const settle = async () => {
  t.app.workflows.tick();
  await t.app.workflows.idle();
};

describe("an outside action as a workflow box", () => {
  it("a WRITE never runs by itself: the run waits, an approval request exists, nothing was sent", async () => {
    const w = await make(graph({ connector: "telegram", action: "send_message", args: { chat: "sam", text: "Hi {{input}}" } }));
    const id = await run(w.id);
    const r = await view(id);
    expect(r.status).toBe("waiting");
    expect(step(r, "act")).toMatchObject({ status: "waiting", refKind: "approval" });
    expect(sent).toHaveLength(0);
    const [req] = await pending();
    expect(req).toMatchObject({ connector: "telegram", action: "send_message", botId, summary: 'Send "Hi hello" to sam' });
    expect(req.id).toBe(step(r, "act").refId);
  });

  it("approving on the Approvals page runs it once, and the workflow continues with its result", async () => {
    const w = await make(graph({ connector: "telegram", action: "send_message", args: { chat: "sam", text: "Hi" } }));
    const id = await run(w.id);
    const [req] = await pending();
    expect((await t.call("POST", `/api/approvals/${req.id}/approve`)).status).toBe(200);
    expect(sent).toHaveLength(1);
    await settle();
    const r = await view(id);
    expect(r.status).toBe("completed");
    expect(step(r, "act")).toMatchObject({ status: "completed", output: "sent #1" });
    expect(step(r, "after").output).toBe("got: sent #1");
    await settle();
    expect(sent).toHaveLength(1); // never twice
  });

  it("a decision on the Approvals page lets the run continue at once (no waiting for the clock)", async () => {
    const w = await make(graph({ connector: "telegram", action: "send_message", args: { chat: "sam", text: "Hi" } }));
    const id = await run(w.id);
    const [req] = await pending();
    await t.call("POST", `/api/approvals/${req.id}/approve`);
    await t.app.workflows.idle(); // no manual tick(): the approve route told the workflow engine
    expect((await view(id)).status).toBe("completed");
  });

  it("denying makes the box fail with the reason and the run fails; nothing was sent", async () => {
    const w = await make(graph({ connector: "telegram", action: "send_message", args: { chat: "sam", text: "Hi" } }));
    const id = await run(w.id);
    const [req] = await pending();
    await t.call("POST", `/api/approvals/${req.id}/deny`, {});
    await settle();
    const r = await view(id);
    expect(r.status).toBe("failed");
    expect(step(r, "act").error).toMatch(/approval was denied/);
    expect(step(r, "after").status).toBe("skipped");
    expect(sent).toHaveLength(0);
  });

  it("an approved action that fails fails the box with its error", async () => {
    behaviour.failWith = "Telegram refused the token";
    const w = await make(graph({ connector: "telegram", action: "send_message", args: { chat: "sam", text: "Hi" } }));
    const id = await run(w.id);
    const [req] = await pending();
    await t.call("POST", `/api/approvals/${req.id}/approve`);
    await settle();
    const r = await view(id);
    expect(r.status).toBe("failed");
    expect(step(r, "act").error).toMatch(/Telegram refused the token/);
  });

  it("the checkpoint buttons can NOT approve an outside action (no way around the gate)", async () => {
    const w = await make(graph({ connector: "telegram", action: "send_message", args: { chat: "sam", text: "Hi" } }));
    const id = await run(w.id);
    const res = await t.call("POST", `/api/workflows/runs/${id}/steps/act/approve`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("needs_approval");
    expect(sent).toHaveLength(0);
    expect(((await t.call("GET", "/api/workflows")).body.waiting as any[]).length).toBe(0);
    expect((await t.call("GET", "/api/approvals?status=pending")).body.approvals).toHaveLength(1);
  });

  it("a READ needs the agent's own read permission: refused without it, runs at once with it", async () => {
    const w = await make(graph({ connector: "telegram", action: "read_messages", args: {} }));
    const first = await view(await run(w.id));
    expect(first.status).toBe("failed");
    expect(step(first, "act").error).toMatch(/reading is not switched on/);
    await t.call("PUT", `/api/bots/${botId}/permissions/telegram`, { readEnabled: true });
    const second = await view(await run(w.id));
    expect(second.status).toBe("completed");
    expect(step(second, "act").output).toBe("Sam says: hello");
  });

  it("the pause switch for outside actions still applies", async () => {
    await t.call("PUT", `/api/bots/${botId}/permissions/telegram`, { readEnabled: true });
    await t.call("PUT", "/api/external/pause", { paused: true });
    const w = await make(graph({ connector: "telegram", action: "read_messages", args: {} }));
    const r = await view(await run(w.id));
    expect(r.status).toBe("failed");
    expect(step(r, "act").error).toMatch(/paused/);
  });

  it("a box that already asked for an outside action is never retried automatically or by hand", async () => {
    const w = await make(graph({ connector: "telegram", action: "send_message", args: { chat: "sam", text: "Hi" } }));
    const id = await run(w.id);
    const [req] = await pending();
    await t.call("POST", `/api/approvals/${req.id}/deny`, {});
    await settle();
    const retry = await t.call("POST", `/api/workflows/runs/${id}/steps/act/retry`);
    expect(retry.status).toBe(409);
    expect(retry.body.error).toBe("cannot_repeat");
  });

  it("the editor's checks explain an action that does not exist, and the problem blocks nothing silently", async () => {
    const check = await t.call("POST", "/api/workflows/validate", { graph: graph({ connector: "telegram", action: "teleport", args: {} }) });
    expect((check.body.problems as any[]).map((p) => p.message).join(" ")).toMatch(/not an outside action that exists/);
    const shape = await t.call("POST", "/api/workflows", { name: "Bad", graph: graph({ connector: "Tele Gram!", action: "x", args: {} }) });
    expect(shape.status).toBe(400);
    const tooMany = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]));
    expect((await t.call("POST", "/api/workflows", { name: "Bad2", graph: graph({ connector: "telegram", action: "send_message", args: tooMany }) })).status).toBe(400);
  });

  it("the capability registry knows the workflow depends on the connector and its agent", async () => {
    const w = await make(graph({ connector: "telegram", action: "send_message", args: { chat: "sam", text: "Hi" } }));
    const cap = ((await t.call("GET", "/api/capabilities")).body.capabilities as any[]).find((c) => c.id === `workflow:${w.id}`);
    expect(cap.group).toBe("workflow");
    // the fake connector is registered and "ready", so the workflow is not blocked by it
    expect(["unverified", "needs_setup", "available"]).toContain(cap.state);
    await t.call("PATCH", `/api/bots/${botId}`, { status: "paused" });
    const after = ((await t.call("GET", "/api/capabilities")).body.capabilities as any[]).find((c) => c.id === `workflow:${w.id}`);
    expect(after.missing.join(" ")).toMatch(/Messenger/);
  });
});
