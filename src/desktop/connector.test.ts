import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuardianGate } from "../guardian-link.js";
import { OK_RESULT } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { FakeBridge, node, type FakeWin } from "./fake-bridge.js";
import type { Launcher } from "./engine.js";
import { switchOn } from "../llm/test-helpers.js";

/* MOCKED tests of the desktop connector (approval, permissions, privacy of screen text). A pretend Windows is used: no real window is involved. */
/* eslint-disable @typescript-eslint/no-explicit-any */
const fence = "```";
const act = (action: string, args: Record<string, unknown>) => `${fence}action\n${JSON.stringify({ connector: "desktop", action, args })}\n${fence}`;
const PROOF = "good-proof-token";

let t: TestApp;
let dir: string;
let bridge: FakeBridge;
let launches: number;
let guardHeld: string | null;
let appId: string;
let ref: string;

const guardian: GuardianGate = {
  held: () => guardHeld,
  checkProof: async (x) => x === PROOF,
  view: () => ({ configured: true, url: "x", reachable: true, state: "RUN", reason: null, held: guardHeld, tier: "A", passphraseSet: true, presence: null, protectsOwnerActions: true }),
};
const world = (pid: number): FakeWin => ({
  handle: pid * 10,
  title: "Notes",
  className: "Window",
  nodes: [node("0", "Edit", "Notes", { value: "", valueLength: 0, patterns: ["Value"] }), node("1", "Button", "Compute", { automationId: "compute" }), node("2", "Text", "Result", { value: "Result: none", valueLength: 12 })],
});
const launcher: Launcher = () => {
  launches += 1;
  const pid = 4000 + launches;
  bridge.worlds.set(pid, [world(pid)]);
  return { pid, kill: () => undefined, exited: () => false };
};

beforeEach(async () => {
  guardHeld = null;
  launches = 0;
  dir = mkdtempSync(join(tmpdir(), "awp-dc-"));
  const exe = join(dir, "notes.exe");
  writeFileSync(exe, "x");
  bridge = new FakeBridge();
  bridge.onInvoke = (_pid, win, n) => {
    if (n.automationId === "compute") win.nodes.find((x) => x.name === "Result")!.value = "Result: 42";
  };
  t = await createTestApp({
    connectors: [],
    includePc: true,
    includeDesktop: true,
    guardian,
    desktop: { bridge, launcher, privateDir: join(dir, "private"), sleep: async (ms) => void (t && (t.clock.t += ms)) },
    accessTesting: {
      hashFile: () => "h1",
      discover: async () => ({ installed: [{ name: "Notes", version: "1", publisher: "Acme", location: dir, icon: `${exe},0` }], procs: [], services: [], startup: [], tasks: [], sigs: [{ path: exe, signer: "CN=Acme" }] }),
    },
  });
  ref = await asOwner(() => setupGeminiModel(t));
  await asOwner(async () => {
    await t.call("POST", "/api/access/applications/scan", {});
    appId = ((await t.call("GET", "/api/access/applications")).body.apps as any[])[0].id;
  });
});
afterEach(async () => {
  await t.app.close();
  vi.unstubAllEnvs();
});

/** Owner acts on this PC need the passphrase proof once a Guardian is configured: the dashboard header carries it. */
async function asOwner<T>(fn: () => Promise<T>): Promise<T> {
  const original = t.app.inject.bind(t.app) as (o: any) => Promise<any>;
  (t.app as any).inject = (o: any) => original({ ...o, headers: { ...(o.headers ?? {}), "x-awp-proof": PROOF } });
  try {
    return await fn();
  } finally {
    (t.app as any).inject = original;
  }
}
const approveApp = (caps: string[]) => asOwner(() => t.call("PUT", `/api/access/applications/${appId}`, { level: "approved", capabilities: caps }));
const mkBot = (grants: string[]) =>
  asOwner(async () => {
    const bot = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Desk", model: ref }))).body.bot as any;
    await t.call("PUT", "/api/llm/limits", { botRequestsPerMinute: 1000 });
    await t.call("PUT", `/api/bots/${bot.id}/pc`, { grants });
    return bot;
  });
const runTask = async (botId: string, ...blocks: string[]) => {
  t.provider.calls.length = 0;
  t.provider.script.push({ ...OK_RESULT, text: blocks.join("\n") }, { ...OK_RESULT, text: "done" });
  await t.call("POST", `/api/bots/${botId}/tasks`, { instruction: "Do it" });
  await vi.waitFor(async () => expect(((await t.call("GET", "/api/tasks")).body.tasks as any[]).every((x) => ["completed", "failed"].includes(x.status))).toBe(true), { timeout: 4000, interval: 10 });
  return t.provider.calls[1]?.messages[3]?.content as string | undefined;
};
const pending = async () => (await t.call("GET", "/api/approvals?status=pending")).body.approvals as any[];
const approve = (id: string) => asOwner(() => t.call("POST", `/api/approvals/${id}/approve`));
const plan = (extra: Record<string, unknown> = {}) => ({ steps: [{ do: "launch", app: appId }, { do: "click", target: { name: "Compute" }, expect: { control: { name: "Result" }, valueEquals: "Result: 42" } }, { do: "read", target: { name: "Result" } }], ...extra });

describe("the desktop connector", () => {
  it("lists only the applications the owner approved, so the worker knows which one it may name", async () => {
    const bot = await mkBot(["read"]);
    expect(await runTask(bot.id, act("list_applications", {}))).toMatch(/No application is approved/);
    await approveApp(["open", "view"]);
    const told = await runTask(bot.id, act("list_applications", {}));
    expect(told).toContain(appId);
    expect(told).toMatch(/may: open, view/);
  });

  it("a plan always waits for the owner, who sees every step; refusing runs nothing", async () => {
    await approveApp(["open", "view", "control"]);
    const bot = await mkBot(["read", "execute"]);
    await runTask(bot.id, act("run_steps", plan()));
    const p = await pending();
    expect(p).toHaveLength(1);
    expect(p[0].summary).toMatch(/Start the approved application/);
    expect(p[0].summary).toMatch(/Click "Compute"/);
    expect(launches).toBe(0);
    await asOwner(() => t.call("POST", `/api/approvals/${p[0].id}/deny`));
    expect(launches).toBe(0);
  });

  it("an approved plan runs, and the result says what was proven", async () => {
    await approveApp(["open", "view", "control"]);
    const bot = await mkBot(["read", "execute"]);
    await runTask(bot.id, act("run_steps", plan()));
    const p = (await pending())[0];
    const r = await approve(p.id);
    expect(launches).toBe(1);
    const text = JSON.stringify(r.body);
    expect(text).toMatch(/expected_state_confirmed/);
    expect(text).toMatch(/Session: s[0-9a-f]{12}/);
  });

  it("marks irreversible plans in the approval and refuses them without allowDestructive", async () => {
    await approveApp(["open", "view", "control", "close"]);
    const bot = await mkBot(["read", "execute"]);
    const told = await runTask(bot.id, act("run_steps", { steps: [{ do: "launch", app: appId }, { do: "close_window", discard: true }] }));
    expect(told ?? "").toMatch(/allowDestructive/);
    expect(await pending()).toHaveLength(0);
    // with the flag it is sent, and the approval text says it is irreversible
    await runTask(bot.id, act("run_steps", { allowDestructive: true, steps: [{ do: "launch", app: appId }, { do: "close_window", discard: true }] }));
    expect((await pending())[0].summary).toMatch(/IRREVERSIBLE/);
  });

  it("holds back text read from the screen when the worker's model is not on this PC, unless the owner allows it", async () => {
    await approveApp(["open", "view", "control"]);
    const bot = await mkBot(["read", "execute"]);
    await runTask(bot.id, act("run_steps", plan()));
    const r1 = await approve((await pending())[0].id);
    expect(JSON.stringify(r1.body)).toContain("withheld");
    expect(String(r1.body.approval.result)).not.toContain("Result: 42");
    // the owner switches it on (owner-only, needs the proof); the same plan then returns the text
    expect((await t.call("PUT", "/api/desktop/settings", { cloudScreenText: true })).status).toBe(403);
    expect((await asOwner(() => t.call("PUT", "/api/desktop/settings", { cloudScreenText: true }))).status).toBe(200);
    await runTask(bot.id, act("run_steps", plan()));
    const r2 = await approve((await pending())[0].id);
    expect(String(r2.body.approval.result)).toContain("Result: 42");
  });

  it("a bot without the PC permission cannot ask at all", async () => {
    await approveApp(["open"]);
    const bot = await mkBot(["read"]);
    const told = await runTask(bot.id, act("run_steps", plan()));
    expect(told ?? "").toMatch(/does not have the PC "execute" permission/);
    expect(await pending()).toHaveLength(0);
  });

  it("is not available while the Guardian holds everything", async () => {
    await approveApp(["open"]);
    const bot = await mkBot(["read", "execute"]);
    guardHeld = "the Windows session is locked";
    await runTask(bot.id, act("list_applications", {}));
    expect(launches).toBe(0);
    const status = (await t.call("GET", "/api/external/status")).body.connectors.find((c: any) => c.id === "desktop");
    expect(status.notReady).toMatch(/Guardian holds/);
  });

  it("reports its status and record without exposing content", async () => {
    await approveApp(["open", "view", "control"]);
    const bot = await mkBot(["read", "execute"]);
    await runTask(bot.id, act("run_steps", plan()));
    await approve((await pending())[0].id);
    const status = (await t.call("GET", "/api/desktop/status")).body;
    expect(status.engine).toMatchObject({ uia: true, ocr: true });
    const log = (await t.call("GET", "/api/desktop/log")).body.events as any[];
    expect(log.map((e) => e.kind)).toEqual(expect.arrayContaining(["desktop.launch", "desktop.step"]));
  });
});
