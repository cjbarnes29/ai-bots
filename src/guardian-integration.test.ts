import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ConnectorDefinition } from "./connectors/types.js";
import { GuardianCore } from "./guardian/core.js";
import { Journal } from "./guardian/journal.js";
import { newLeaseKey } from "./guardian/lease.js";
import { hashPassphrase } from "./guardian/passphrase.js";
import { ProcessTreeGuard, type ProcessTable } from "./guardian/process-tree.js";
import { createGuardianServer } from "./guardian/server.js";
import { GuardianLink } from "./guardian-link.js";
import { OK_RESULT } from "./llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "./test-app.js";
import { switchOn } from "./llm/test-helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const PASS = "correct horse battery staple";
const reply = (text: string) => ({ ...OK_RESULT, text, inputTokens: 10, outputTokens: 5 });
const act = (connector: string, action: string, args: Record<string, unknown> = {}) => "```action\n" + JSON.stringify({ connector, action, args }) + "\n```";
const PROOF = "x-awp-proof";

function fakeTelegram() {
  const sent: any[] = [];
  const connector: ConnectorDefinition = {
    id: "telegram",
    label: "Telegram",
    secrets: [{ name: "TELEGRAM_BOT_TOKEN", description: "Telegram bot token" }],
    actions: {
      send_message: {
        kind: "write",
        description: "Send a Telegram message",
        args: z.strictObject({ chat: z.string().min(1).max(50), text: z.string().min(1).max(500) }),
        summarize: (a) => `Send "${a["text"]}" to ${a["chat"]}`,
        execute: async (a) => {
          sent.push(a);
          return "sent #1";
        },
      },
    },
  };
  return { connector, sent };
}

/** A real Guardian (real server, real link) with fake processes, so nothing real is ever stopped. */
async function startGuardian(dir: string) {
  const clock = { t: Date.parse("2026-11-04T09:00:00Z") };
  const table: ProcessTable = { snapshot: async () => ({ listenerPid: null, procs: [] }), kill: () => false };
  const journal = new Journal(join(dir, "journal.jsonl"), () => clock.t);
  writeFileSync(join(dir, "passphrase.json"), JSON.stringify(hashPassphrase(PASS)));
  const core = new GuardianCore({ dir, now: () => clock.t, journal, tree: new ProcessTreeGuard(table, 1), vm: null, net: null, presence: null, presenceRequired: false, leaseKey: newLeaseKey() });
  const server = createGuardianServer({ core, journal, allowedOrigins: [] });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const link = new GuardianLink(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  await link.refresh();
  return {
    core,
    link,
    clock,
    close: () => new Promise<void>((done) => server.close(() => done())),
    /** Resumes if needed and returns a fresh 10-minute decision-window token (the owner typing the passphrase). */
    async resume(): Promise<string> {
      const first = (await core.handle({ cmd: "resume", passphrase: PASS })) as { ok: true; token?: string };
      const r = first.token ? first : ((await core.handle({ cmd: "proof", passphrase: PASS })) as { ok: true; token: string });
      await link.refresh();
      return r.token as string;
    },
  };
}

/** The test app, but every call carries the owner proof (so setup steps that are owner-only really are done "as the owner"). */
function owner(t: TestApp, token: string): TestApp {
  const call = async (method: string, url: string, payload?: unknown) => {
    const res = await t.app.inject({ method: method as any, url, payload: payload as object, headers: { "x-awp-client": "dashboard", [PROOF]: token } });
    return { status: res.statusCode, body: res.body ? res.json() : undefined };
  };
  return { ...t, call } as TestApp;
}

describe("owner actions and the Guardian (blocker A: a script on this PC must not be able to act as the owner)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "guardian-int-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function pendingApproval(t: TestApp, tg: ReturnType<typeof fakeTelegram>, headers: Record<string, string> = {}) {
    const setupAs = headers[PROOF] ? owner(t, headers[PROOF]) : t;
    const ref = await setupGeminiModel(setupAs);
    const call = (method: any, url: string, body?: unknown) => t.app.inject({ method, url, payload: body as object, headers: { "x-awp-client": "dashboard", ...headers } });
    const bot = (await call("POST", "/api/bots", { name: "Helper", model: ref })).json().bot;
    expect((await call("PATCH", `/api/bots/${bot.id}`, { status: "active" })).statusCode).toBe(200); // switched on, as on its Details tab
    t.provider.script.push(reply(act("telegram", "send_message", { chat: "sam", text: "Hello Sam" })), reply("asked"));
    expect((await call("POST", `/api/bots/${bot.id}/tasks`, { instruction: "Tell Sam hello" })).statusCode).toBe(202);
    await vi.waitFor(async () => expect(((await call("GET", "/api/approvals?status=pending")).json().approvals as any[]).length).toBe(1), { timeout: 3000, interval: 20 });
    return { call, id: ((await call("GET", "/api/approvals?status=pending")).json().approvals as any[])[0].id as string, bot };
  }

  it("TODAY, with no Guardian configured: anything that sends the dashboard header can approve its own request (S-13 stays open until a Guardian is configured)", async () => {
    const tg = fakeTelegram();
    const t = await createTestApp({ connectors: [tg.connector] });
    try {
      await t.call("PUT", "/api/vault/TELEGRAM_BOT_TOKEN", { value: "TELEGRAM-TOKEN-0123456789abcdef" });
      const { call, id } = await pendingApproval(t, tg);
      // exactly what a Node script run through the PC agent would send: the local address and the dashboard header
      const res = await call("POST", `/api/approvals/${id}/approve`);
      expect(res.statusCode).toBe(200);
      expect(tg.sent).toHaveLength(1); // the "outside action" ran
    } finally {
      await t.app.close();
    }
  });

  it("WITH a Guardian: the same request is refused, the action does not run, and the refusal is logged", async () => {
    const g = await startGuardian(dir);
    await g.resume();
    const tg = fakeTelegram();
    const t = await createTestApp({ connectors: [tg.connector], guardian: g.link });
    try {
      // the vault write itself is an owner change, so it needs the proof too
      const proof = await g.resume();
      expect((await t.app.inject({ method: "PUT", url: "/api/vault/TELEGRAM_BOT_TOKEN", payload: { value: "TELEGRAM-TOKEN-0123456789abcdef" }, headers: { "x-awp-client": "dashboard" } })).statusCode).toBe(403);
      expect((await t.app.inject({ method: "PUT", url: "/api/vault/TELEGRAM_BOT_TOKEN", payload: { value: "TELEGRAM-TOKEN-0123456789abcdef" }, headers: { "x-awp-client": "dashboard", [PROOF]: proof } })).statusCode).toBe(200);

      const { call: asOwner, id } = await pendingApproval(t, tg, { [PROOF]: proof });
      const call = (method: any, url: string, body?: unknown) => t.app.inject({ method, url, payload: body as object, headers: { "x-awp-client": "dashboard" } }); // a script: header only
      void asOwner;
      const attempt = await call("POST", `/api/approvals/${id}/approve`);
      expect(attempt.statusCode).toBe(403);
      expect(attempt.json().error).toBe("proof_required");
      expect(tg.sent).toHaveLength(0);
      for (const bad of ["", "not-a-real-token-at-all", "A".repeat(43)]) expect((await call("POST", `/api/approvals/${id}/approve`, undefined)).statusCode).toBe(403), expect((await t.app.inject({ method: "POST", url: `/api/approvals/${id}/approve`, headers: { "x-awp-client": "dashboard", [PROOF]: bad } })).statusCode).toBe(403);
      expect((await call("GET", "/api/audit?limit=100")).json().events.some((e: any) => e.kind === "owner_proof.refused")).toBe(true);

      // with the real proof the owner can approve, and the action runs once
      const ok = await t.app.inject({ method: "POST", url: `/api/approvals/${id}/approve`, headers: { "x-awp-client": "dashboard", [PROOF]: proof } });
      expect(ok.statusCode).toBe(200);
      expect(tg.sent).toHaveLength(1);
    } finally {
      await t.app.close();
      await g.close();
    }
  });

  it("the proof stops working after 10 minutes, and after any pause", async () => {
    const g = await startGuardian(dir);
    const proof = await g.resume();
    const t = await createTestApp({ guardian: g.link });
    try {
      const put = (token: string) => t.app.inject({ method: "PUT", url: "/api/vault/SOME_KEY", payload: { value: "abcdefghij" }, headers: { "x-awp-client": "dashboard", [PROOF]: token } });
      expect([200, 400, 404].includes((await put(proof)).statusCode)).toBe(true); // accepted by the proof check (the vault may reject the name itself)
      expect((await put(proof)).statusCode).not.toBe(403);
      g.clock.t += 10 * 60_000;
      expect((await put(proof)).statusCode).toBe(403);
      const second = await g.resume(); // already RUN: resume is a no-op and gives no new window
      void second;
      const fresh = ((await g.core.handle({ cmd: "proof", passphrase: PASS })) as any).token as string;
      expect((await put(fresh)).statusCode).not.toBe(403);
      await g.core.handle({ cmd: "pause" });
      expect((await put(fresh)).statusCode).toBe(403);
    } finally {
      await t.app.close();
      await g.close();
    }
  });

  it("stopping directions never need the proof: deny, stop a program, and pausing outside actions", async () => {
    const g = await startGuardian(dir);
    await g.resume();
    const tg = fakeTelegram();
    const t = await createTestApp({ connectors: [tg.connector], guardian: g.link });
    try {
      const h = { "x-awp-client": "dashboard" };
      expect((await t.app.inject({ method: "PUT", url: "/api/external/pause", payload: { paused: true }, headers: h })).statusCode).toBe(200);
      expect((await t.app.inject({ method: "PUT", url: "/api/external/pause", payload: { paused: false }, headers: h })).statusCode).toBe(403); // switching ON again needs the proof
      expect((await t.app.inject({ method: "PUT", url: "/api/llm/pause", payload: { paused: true }, headers: h })).statusCode).toBe(200);
      expect((await t.app.inject({ method: "POST", url: "/api/pc/stop", headers: h })).statusCode).toBe(200);
    } finally {
      await t.app.close();
      await g.close();
    }
  });

  it("reads are not affected, and the status page works without a proof", async () => {
    const g = await startGuardian(dir);
    const t = await createTestApp({ guardian: g.link });
    try {
      const status = (await t.app.inject({ method: "GET", url: "/api/guardian/status" })).json();
      expect(status).toMatchObject({ configured: true, reachable: true, state: "PAUSED", protectsOwnerActions: true });
      expect((await t.app.inject({ method: "GET", url: "/api/bots" })).statusCode).toBe(200);
    } finally {
      await t.app.close();
      await g.close();
    }
  });
});

describe("PAUSE blocks new work and stops running work at a safe point", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "guardian-int-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("refuses to start a task while PAUSED, STOPPED or LOCKED, and starts again only after the owner resumes", async () => {
    const g = await startGuardian(dir);
    const t = await createTestApp({ guardian: g.link });
    try {
      const ref = await setupGeminiModel(owner(t, await g.resume())); // set up as the owner, then pause again
      const bot = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Helper", model: ref }))).body.bot;
      const start = () => t.call("POST", `/api/bots/${bot.id}/tasks`, { instruction: "Say hello" });
      await g.core.handle({ cmd: "pause" });
      await g.link.refresh();
      const blocked = await start();
      expect(blocked.status).toBe(409);
      expect(blocked.body.error).toBe("guardian_paused");
      expect(blocked.body.message).toMatch(/Only the owner|owner resumes/i);
      await g.resume();
      t.provider.script.push(reply("hello"));
      expect((await start()).status).toBe(202);
      await g.core.handle({ cmd: "stop" });
      await g.link.refresh();
      expect((await start()).body.error).toBe("guardian_paused");
      await g.core.handle({ cmd: "lockdown" });
      await g.link.refresh();
      expect((await start()).body.error).toBe("guardian_paused");
    } finally {
      await t.app.close();
      await g.close();
    }
  });

  it("a running task stops at its next safe point and says why (it is not silently continued)", async () => {
    const g = await startGuardian(dir);
    await g.resume();
    const tg = fakeTelegram();
    const t = await createTestApp({ connectors: [tg.connector], guardian: g.link });
    try {
      const ref = await setupGeminiModel(owner(t, await g.resume()));
      const bot = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Helper", model: ref }))).body.bot;
      // the model's answer asks for an outside action; the owner's Guardian pauses while the model is still "thinking"
      t.provider.script.push(async () => {
        await g.core.handle({ cmd: "pause" });
        await g.link.refresh();
        return reply(act("telegram", "send_message", { chat: "sam", text: "Hello" }));
      });
      const task = (await t.call("POST", `/api/bots/${bot.id}/tasks`, { instruction: "Tell Sam" })).body.task;
      await vi.waitFor(async () => expect((await t.call("GET", `/api/tasks/${task.id}`)).body.task.status).toBe("failed"), { timeout: 3000, interval: 20 });
      const done = (await t.call("GET", `/api/tasks/${task.id}`)).body.task;
      expect(done.errorCode).toBe("guardian_paused");
      expect(done.errorMessage).toMatch(/Stopped at a safe point/);
      expect((await t.call("GET", "/api/approvals?status=pending")).body.approvals).toHaveLength(0); // the outside action was never even requested
      expect(tg.sent).toHaveLength(0);
    } finally {
      await t.app.close();
      await g.close();
    }
  });

  it("schedules are skipped while paused (not counted as failures) and no task is created", async () => {
    const g = await startGuardian(dir);
    await g.resume();
    const t = await createTestApp({ guardian: g.link });
    try {
      const ref = await setupGeminiModel(owner(t, await g.resume()));
      const bot = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Helper", model: ref }))).body.bot;
      const proof = await g.resume();
      const mk = await t.app.inject({ method: "POST", url: "/api/schedules", payload: { name: "Every 15", botId: bot.id, instruction: "Summarise", kind: "interval", intervalMinutes: 15 }, headers: { "x-awp-client": "dashboard", [PROOF]: proof } });
      expect(mk.statusCode).toBe(201);
      const sched = mk.json().schedule;
      expect((await t.app.inject({ method: "PATCH", url: `/api/schedules/${sched.id}`, payload: { enabled: true }, headers: { "x-awp-client": "dashboard", [PROOF]: proof } })).statusCode).toBe(200);
      await g.core.handle({ cmd: "pause" });
      await g.link.refresh();
      t.clock.t += 20 * 60_000;
      t.app.automation.tick();
      await new Promise((r) => setTimeout(r, 100));
      expect((await t.call("GET", "/api/tasks")).body.tasks).toHaveLength(0);
      expect((await t.call("GET", `/api/schedules/${sched.id}`)).body.schedule.consecutiveFailures).toBe(0);
    } finally {
      await t.app.close();
      await g.close();
    }
  });

  it("an approval cannot be executed while paused, and stays pending for later", async () => {
    const g = await startGuardian(dir);
    await g.resume();
    const tg = fakeTelegram();
    const t = await createTestApp({ connectors: [tg.connector], guardian: g.link });
    try {
      const proof = await g.resume();
      const H = { "x-awp-client": "dashboard", [PROOF]: proof };
      await t.app.inject({ method: "PUT", url: "/api/vault/TELEGRAM_BOT_TOKEN", payload: { value: "TELEGRAM-TOKEN-0123456789abcdef" }, headers: H });
      const ref = await setupGeminiModel(owner(t, await g.resume()));
      const bot = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Helper", model: ref }))).body.bot;
      t.provider.script.push(reply(act("telegram", "send_message", { chat: "sam", text: "Hello" })), reply("asked"));
      await t.call("POST", `/api/bots/${bot.id}/tasks`, { instruction: "Tell Sam" });
      await vi.waitFor(async () => expect((await t.call("GET", "/api/approvals?status=pending")).body.approvals).toHaveLength(1), { timeout: 3000, interval: 20 });
      const id = (await t.call("GET", "/api/approvals?status=pending")).body.approvals[0].id;
      await g.core.handle({ cmd: "pause" });
      await g.link.refresh();
      const res = await t.app.inject({ method: "POST", url: `/api/approvals/${id}/approve`, headers: H });
      expect([403, 409]).toContain(res.statusCode); // refused: the proof ended with the pause, and the hold would refuse anyway
      expect(tg.sent).toHaveLength(0);
      const proof2 = await g.resume();
      const ok = await t.app.inject({ method: "POST", url: `/api/approvals/${id}/approve`, headers: { "x-awp-client": "dashboard", [PROOF]: proof2 } });
      expect(ok.statusCode).toBe(200);
      expect(tg.sent).toHaveLength(1);
    } finally {
      await t.app.close();
      await g.close();
    }
  });

  it("fails CLOSED when the Guardian stops answering", async () => {
    const g = await startGuardian(dir);
    await g.resume();
    expect(g.link.held()).toBeNull();
    const dead = new GuardianLink("http://127.0.0.1:9", { staleMs: 1 }); // nothing listens on port 9
    let current: GuardianLink = g.link;
    const gate = { held: () => current.held(), checkProof: (x: string) => current.checkProof(x), view: () => current.view() };
    const t = await createTestApp({ guardian: gate });
    try {
      const ref = await setupGeminiModel(owner(t, await g.resume()));
      const bot = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "Helper", model: ref }))).body.bot;
      current = dead; // the Guardian "disappears"
      const res = await t.call("POST", `/api/bots/${bot.id}/tasks`, { instruction: "Say hello" });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/not responding/);
    } finally {
      await t.app.close();
      await g.close();
    }
  });
  it("Decisions: with a Guardian, choosing, approving, rejecting and starting work from THIS PC need the owner proof; asking for options does not (the phone rule is separate, D-063)", async () => {
    const g = await startGuardian(dir);
    await g.resume();
    const t = await createTestApp({ guardian: g.link });
    try {
      const proof = await g.resume();
      const id = "00000000-0000-4000-8000-000000000001"; // no such decision: the owner-proof check comes BEFORE the lookup
      const call = (method: any, url: string, body?: unknown, headers: Record<string, string> = {}) => t.app.inject({ method, url, payload: body as object, headers: { "x-awp-client": "dashboard", ...headers } });
      const acts: [string, string, unknown][] = [
        ["PUT", `/api/decisions/${id}/choice`, { optionId: null }],
        ["POST", `/api/decisions/${id}/approve`, {}],
        ["POST", `/api/decisions/${id}/reject`, {}],
        ["POST", `/api/decisions/${id}/assignments/some-bot/start`, undefined],
        ["POST", `/api/decisions/${id}/assignments/some-bot/repair`, undefined],
      ];
      for (const [m, u, b] of acts) {
        const without = await call(m, u, b);
        expect([m, u, without.statusCode, without.json().error]).toEqual([m, u, 403, "proof_required"]);
        const withProof = await call(m, u, b, { [PROOF]: proof });
        expect(withProof.statusCode, `${m} ${u} with the proof must get past the guard`).not.toBe(403);
      }
      // Asking the agents for options and listing are not owner-proof acts (they only read or draft).
      const inquire = await call("POST", "/api/decisions/inquire", { question: "short" });
      expect(inquire.statusCode).toBe(400);
      expect(inquire.json().error).toBe("question_too_short");
      expect((await call("GET", "/api/decisions")).statusCode).toBe(200);
    } finally {
      await t.app.close();
      await g.close();
    }
  });
});
