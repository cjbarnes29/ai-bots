import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../db/database.js";
import { LlmError } from "../llm/errors.js";
import { OK_RESULT } from "../llm/test-helpers.js";
import { createTestApp, setupGeminiModel, type TestApp } from "../test-app.js";
import { AutomationScheduler } from "./scheduler.js";
import { switchOn } from "../llm/test-helpers.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const MIN = 60_000;
let t: TestApp;
let ref: string;
beforeEach(async () => {
  t = await createTestApp(); // the fake clock starts at 15 June 2026, 12:00 (local time)
  ref = await setupGeminiModel(t);
});
afterEach(async () => {
  await t.app.close();
  vi.unstubAllEnvs();
});

const reply = (text: string) => ({ ...OK_RESULT, text, inputTokens: 10, outputTokens: 5 });
const mkBot = async (name: string, extra: Record<string, unknown> = {}) => (await switchOn(t.call, await t.call("POST", "/api/bots", { name, model: ref, ...extra }))).body.bot as any;
const FINAL = ["completed", "failed", "cancelled"];
/** Waits until every task has finished. */
async function settle() {
  await vi.waitFor(
    async () => {
      const tasks = (await t.call("GET", "/api/tasks")).body.tasks as any[];
      expect(tasks.every((x) => FINAL.includes(x.status))).toBe(true);
    },
    { timeout: 3000, interval: 10 },
  );
}
const tick = () => t.app.automation.tick();
const advance = (minutes: number) => {
  t.clock.t += minutes * MIN;
};
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 5, 15 + dayOffset, h, m, 0, 0).getTime();
const runs = async () => (await t.call("GET", "/api/automation/runs?limit=200")).body.runs as any[];
const tasks = async () => (await t.call("GET", "/api/tasks")).body.tasks as any[];

const newSchedule = (botId: string, extra: Record<string, unknown> = {}) =>
  t.call("POST", "/api/schedules", { name: "Morning summary", botId, instruction: "Summarise the day", kind: "interval", intervalMinutes: 15, ...extra });
const makeSchedule = async (botId: string, extra: Record<string, unknown> = {}) => {
  const res = await newSchedule(botId, extra);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.schedule as any;
};
const enableSchedule = (id: string) => t.call("PATCH", `/api/schedules/${id}`, { enabled: true });
const liveSchedule = async (botId: string, extra: Record<string, unknown> = {}) => {
  const s = await makeSchedule(botId, extra);
  const res = await enableSchedule(s.id);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.schedule as any;
};
const getSchedule = async (id: string) => (await t.call("GET", `/api/schedules/${id}`)).body.schedule as any;

const newTrigger = (botId: string, extra: Record<string, unknown> = {}) =>
  t.call("POST", "/api/triggers", { name: "Inbox helper", source: "event", eventName: "inbox", botId, ...extra });
const makeTrigger = async (botId: string, extra: Record<string, unknown> = {}) => {
  const res = await newTrigger(botId, extra);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.trigger as any;
};
const liveTrigger = async (botId: string, extra: Record<string, unknown> = {}) => {
  const trig = await makeTrigger(botId, extra);
  const res = await t.call("PATCH", `/api/triggers/${trig.id}`, { enabled: true });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.trigger as any;
};
const sendEvent = (name: string, text: string) => t.call("POST", "/api/events", { name, text });

// ======================================================================================
describe("creating schedules", () => {
  it("starts switched OFF, with nothing planned", async () => {
    const bot = await mkBot("Helper");
    const s = await makeSchedule(bot.id);
    expect(s).toMatchObject({ name: "Morning summary", botName: "Helper", kind: "interval", intervalMinutes: 15, enabled: false, nextRunAt: null, lastRunAt: null, consecutiveFailures: 0, disabledReason: null });
    expect((await t.call("GET", "/api/schedules")).body.schedules).toHaveLength(1);
    t.app.automation.tick();
    expect(t.provider.calls).toHaveLength(0);
  });

  it("cannot be created already switched on", async () => {
    const bot = await mkBot("Helper");
    expect((await newSchedule(bot.id, { enabled: true })).status).toBe(400);
  });

  it("supports every-N-minutes, daily and once", async () => {
    const bot = await mkBot("Helper");
    const daily = await makeSchedule(bot.id, { kind: "daily", timeOfDay: "09:30", days: [1, 3, 5], intervalMinutes: undefined });
    expect(daily).toMatchObject({ kind: "daily", timeOfDay: "09:30", days: [1, 3, 5], intervalMinutes: null });
    const once = await makeSchedule(bot.id, { kind: "once", runAt: new Date(at(18, 0)).toISOString(), intervalMinutes: undefined });
    expect(once).toMatchObject({ kind: "once", runAt: new Date(at(18, 0)).toISOString() });
    const all = await makeSchedule(bot.id, { kind: "daily", timeOfDay: "06:00", intervalMinutes: undefined });
    expect(all.days).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("protects your free tier: runs must be at least 15 minutes apart", async () => {
    const bot = await mkBot("Helper");
    const res = await newSchedule(bot.id, { intervalMinutes: 14 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("interval_too_short");
    expect(res.body.message).toMatch(/at least 15 minutes/);
    expect((await newSchedule(bot.id, { intervalMinutes: 15 })).status).toBe(201);
  });

  it("rejects bad input", async () => {
    const bot = await mkBot("Helper");
    const bad: [string, Record<string, unknown>][] = [
      ["a week and a minute", { intervalMinutes: 10_081 }],
      ["zero minutes", { intervalMinutes: 0 }],
      ["fractions", { intervalMinutes: 15.5 }],
      ["empty name", { name: "  " }],
      ["too-long name", { name: "n".repeat(81) }],
      ["empty instruction", { instruction: "" }],
      ["too-long instruction", { instruction: "x".repeat(4001) }],
      ["unknown kind", { kind: "weekly" }],
      ["daily without a time", { kind: "daily", intervalMinutes: undefined }],
      ["daily with a bad time", { kind: "daily", timeOfDay: "25:61", intervalMinutes: undefined }],
      ["daily with no days", { kind: "daily", timeOfDay: "09:00", days: [], intervalMinutes: undefined }],
      ["daily with day 7", { kind: "daily", timeOfDay: "09:00", days: [7], intervalMinutes: undefined }],
      ["once without a time", { kind: "once", intervalMinutes: undefined }],
      ["an extra field", { surprise: 1 }],
    ];
    for (const [label, extra] of bad) {
      const res = await newSchedule(bot.id, extra);
      expect(res.status, label).toBe(400);
    }
    expect((await newSchedule("not-a-uuid")).status).toBe(400);
    expect((await newSchedule("00000000-0000-4000-8000-000000000000")).body.error).toBe("invalid_bot");
    expect((await t.call("GET", "/api/schedules")).body.schedules).toEqual([]);
  });

  it("rejects one-off times that have passed or are more than a year away", async () => {
    const bot = await mkBot("Helper");
    const past = await newSchedule(bot.id, { kind: "once", runAt: new Date(at(11, 0)).toISOString(), intervalMinutes: undefined });
    expect(past.body.error).toBe("run_time_passed");
    const far = await newSchedule(bot.id, { kind: "once", runAt: new Date(at(12, 0, 400)).toISOString(), intervalMinutes: undefined });
    expect(far.body.error).toBe("invalid_schedule");
    expect((await newSchedule(bot.id, { kind: "once", runAt: "not a date", intervalMinutes: undefined })).status).toBe(400);
  });

  it("refuses archived bots, and caps the number of schedules at 20", async () => {
    const old = await mkBot("Old");
    await t.call("DELETE", `/api/bots/${old.id}`);
    expect((await newSchedule(old.id)).body.error).toBe("bot_not_ready");
    const bot = await mkBot("Helper");
    for (let i = 0; i < 20; i++) await makeSchedule(bot.id, { name: `S${i}` });
    expect((await newSchedule(bot.id)).body.error).toBe("too_many_schedules");
  });

  it("changes need the client header", async () => {
    const bot = await mkBot("Helper");
    const res = await t.app.inject({ method: "POST", url: "/api/schedules", payload: { name: "x", botId: bot.id, instruction: "y", kind: "interval", intervalMinutes: 15 } });
    expect(res.statusCode).toBe(403);
  });
});

describe("switching schedules on and off, and editing them", () => {
  it("switching on plans the first run one full interval from now; switching off clears it", async () => {
    const bot = await mkBot("Helper");
    const s = await makeSchedule(bot.id, { intervalMinutes: 30 });
    const on = (await enableSchedule(s.id)).body.schedule;
    expect(on.enabled).toBe(true);
    expect(on.nextRunAt).toBe(new Date(at(12, 30)).toISOString());
    const off = (await t.call("PATCH", `/api/schedules/${s.id}`, { enabled: false })).body.schedule;
    expect(off).toMatchObject({ enabled: false, nextRunAt: null });
  });

  it("a daily schedule is planned for its next time of day", async () => {
    const bot = await mkBot("Helper");
    const morning = await liveSchedule(bot.id, { kind: "daily", timeOfDay: "09:00", intervalMinutes: undefined });
    expect(morning.nextRunAt).toBe(new Date(at(9, 0, 1)).toISOString()); // 12:00 now, so tomorrow
    const afternoon = await liveSchedule(bot.id, { kind: "daily", timeOfDay: "15:00", intervalMinutes: undefined });
    expect(afternoon.nextRunAt).toBe(new Date(at(15, 0)).toISOString());
  });

  it("a bot that cannot take tasks blocks switching on, with the reason", async () => {
    const noModel = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "NoModel" }))).body.bot;
    const s = await makeSchedule(noModel.id);
    const res = await enableSchedule(s.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("bot_not_ready");
    expect(res.body.message).toMatch(/no model/);
    const claw = await mkBot("Claw", { runtime: "openclaw" });
    expect((await enableSchedule((await makeSchedule(claw.id)).id)).body.message).toMatch(/OpenClaw/);
    expect((await getSchedule(s.id)).enabled).toBe(false);
  });

  it("a one-off time that has since passed cannot be switched on", async () => {
    const bot = await mkBot("Helper");
    const s = await makeSchedule(bot.id, { kind: "once", runAt: new Date(at(12, 30)).toISOString(), intervalMinutes: undefined });
    advance(60);
    expect((await enableSchedule(s.id)).body.error).toBe("run_time_passed");
  });

  it("editing the timing re-plans a running schedule; editing the text does not", async () => {
    const bot = await mkBot("Helper");
    const s = await liveSchedule(bot.id, { intervalMinutes: 30 });
    const text = (await t.call("PATCH", `/api/schedules/${s.id}`, { name: "Renamed", instruction: "New words" })).body.schedule;
    expect(text).toMatchObject({ name: "Renamed", instruction: "New words", nextRunAt: s.nextRunAt });
    const retimed = (await t.call("PATCH", `/api/schedules/${s.id}`, { intervalMinutes: 60 })).body.schedule;
    expect(retimed.nextRunAt).toBe(new Date(at(13, 0)).toISOString());
    const toDaily = (await t.call("PATCH", `/api/schedules/${s.id}`, { kind: "daily", timeOfDay: "18:00" })).body.schedule;
    expect(toDaily).toMatchObject({ kind: "daily", timeOfDay: "18:00", intervalMinutes: null, nextRunAt: new Date(at(18, 0)).toISOString() });
  });

  it("validates edits like new schedules", async () => {
    const bot = await mkBot("Helper");
    const s = await liveSchedule(bot.id);
    expect((await t.call("PATCH", `/api/schedules/${s.id}`, { intervalMinutes: 5 })).body.error).toBe("interval_too_short");
    expect((await t.call("PATCH", `/api/schedules/${s.id}`, { kind: "daily" })).status).toBe(400); // a daily schedule needs a time
    expect((await t.call("PATCH", `/api/schedules/${s.id}`, { botId: "00000000-0000-4000-8000-000000000000" })).body.error).toBe("invalid_bot");
    expect((await t.call("PATCH", `/api/schedules/${s.id}`, { surprise: true })).status).toBe(400);
    expect((await getSchedule(s.id)).intervalMinutes).toBe(15); // nothing changed
  });

  it("unknown ids give 404, and a deleted schedule is gone but its history stays", async () => {
    const bot = await mkBot("Helper");
    const s = await liveSchedule(bot.id);
    advance(15);
    tick();
    await settle();
    expect((await t.call("DELETE", `/api/schedules/${s.id}`)).status).toBe(204);
    expect((await t.call("GET", `/api/schedules/${s.id}`)).status).toBe(404);
    expect((await t.call("DELETE", `/api/schedules/${s.id}`)).status).toBe(404);
    expect((await t.call("GET", "/api/schedules/nope")).status).toBe(404);
    expect((await runs()).some((r) => r.sourceName === "Morning summary" && r.status === "started")).toBe(true);
  });
});

describe("running schedules", () => {
  it("does nothing before the planned time, then starts a labelled task and plans the next run", async () => {
    const bot = await mkBot("Helper");
    const s = await liveSchedule(bot.id, { instruction: "Summarise the day" });
    expect(tick()).toBe(0);
    advance(14);
    expect(tick()).toBe(0);
    expect(t.provider.calls).toHaveLength(0);

    advance(1); // 12:15, due
    expect(tick()).toBe(1);
    await settle();
    expect(t.provider.calls).toHaveLength(1);
    expect(t.provider.calls[0]!.messages[1]!.content).toBe('Scheduled task "Morning summary":\nSummarise the day');

    const root = (await tasks())[0];
    expect(root).toMatchObject({ status: "completed", origin: "schedule", originId: s.id, originLabel: "Morning summary", originDepth: 0, requestedByName: "Morning summary" });
    const after = await getSchedule(s.id);
    expect(after.nextRunAt).toBe(new Date(at(12, 30)).toISOString()); // a full interval from NOW
    expect(after.lastRunAt).toBe(new Date(at(12, 15)).toISOString());
    expect((await runs())[0]).toMatchObject({ source: "schedule", sourceName: "Morning summary", status: "started", taskId: root.id });
  });

  it("running the same moment twice does not run twice", async () => {
    const bot = await mkBot("Helper");
    await liveSchedule(bot.id);
    advance(15);
    expect(tick()).toBe(1);
    expect(tick()).toBe(0);
    await settle();
    expect(t.provider.calls).toHaveLength(1);
  });

  it("runs a daily schedule at its time, then again the next day", async () => {
    const bot = await mkBot("Helper");
    const s = await liveSchedule(bot.id, { kind: "daily", timeOfDay: "13:00", intervalMinutes: undefined });
    t.clock.t = at(13, 0);
    expect(tick()).toBe(1);
    await settle();
    expect((await getSchedule(s.id)).nextRunAt).toBe(new Date(at(13, 0, 1)).toISOString());
    t.clock.t = at(13, 0, 1);
    expect(tick()).toBe(1);
    await settle();
    expect(t.provider.calls).toHaveLength(2);
  });

  it("a daily schedule skips the days you did not choose", async () => {
    const bot = await mkBot("Helper");
    // 15 June 2026 is a Monday. Only Wednesdays:
    const s = await liveSchedule(bot.id, { kind: "daily", timeOfDay: "09:00", days: [3], intervalMinutes: undefined });
    expect(s.nextRunAt).toBe(new Date(at(9, 0, 2)).toISOString());
    t.clock.t = at(9, 0, 1); // Tuesday
    expect(tick()).toBe(0);
    t.clock.t = at(9, 0, 2); // Wednesday
    expect(tick()).toBe(1);
    await settle();
  });

  it("a one-off runs once and then switches itself off", async () => {
    const bot = await mkBot("Helper");
    const s = await liveSchedule(bot.id, { kind: "once", runAt: new Date(at(12, 40)).toISOString(), intervalMinutes: undefined });
    t.clock.t = at(12, 40);
    expect(tick()).toBe(1);
    await settle();
    expect(await getSchedule(s.id)).toMatchObject({ enabled: false, nextRunAt: null });
    advance(120);
    expect(tick()).toBe(0);
    expect(t.provider.calls).toHaveLength(1);
  });

  it("never replays missed runs: if the app was off, that occurrence is skipped and logged", async () => {
    const bot = await mkBot("Helper");
    const s = await liveSchedule(bot.id, { intervalMinutes: 15 });
    advance(180); // three hours with the app off
    expect(tick()).toBe(0);
    expect(t.provider.calls).toHaveLength(0);
    expect((await tasks())).toEqual([]);
    expect((await runs())[0]).toMatchObject({ status: "skipped", sourceName: "Morning summary" });
    expect((await runs())[0].reason).toMatch(/Missed.*never replayed/);
    // The next run is planned from now, not for the pile of runs that were missed.
    expect((await getSchedule(s.id)).nextRunAt).toBe(new Date(at(15, 15)).toISOString());
    advance(15);
    expect(tick()).toBe(1);
    await settle();
  });

  it("a one-off that was missed is marked missed and switched off", async () => {
    const bot = await mkBot("Helper");
    const s = await liveSchedule(bot.id, { kind: "once", runAt: new Date(at(12, 30)).toISOString(), intervalMinutes: undefined });
    advance(120);
    expect(tick()).toBe(0);
    expect(await getSchedule(s.id)).toMatchObject({ enabled: false, nextRunAt: null });
    expect((await runs())[0].reason).toMatch(/Missed/);
    expect(t.provider.calls).toHaveLength(0);
  });

  it("a small delay (under 5 minutes) is still fine", async () => {
    const bot = await mkBot("Helper");
    await liveSchedule(bot.id);
    advance(15 + 4);
    expect(tick()).toBe(1);
    await settle();
  });

  it("skips a run if the previous one is still working", async () => {
    const bot = await mkBot("Helper");
    await liveSchedule(bot.id);
    let release!: () => void;
    t.provider.script.push(() => new Promise((resolve) => (release = () => resolve(reply("slow")))));
    advance(15);
    expect(tick()).toBe(1);
    await vi.waitFor(() => expect(t.provider.calls).toHaveLength(1));
    advance(15);
    expect(tick()).toBe(0);
    expect((await runs())[0]).toMatchObject({ status: "skipped", reason: "The previous run is still working." });
    release();
    await settle();
    advance(15);
    expect(tick()).toBe(1);
    await settle();
  });

  it("run-now is a manual test run: it obeys every check, and does not move the schedule", async () => {
    const bot = await mkBot("Helper");
    const s = await makeSchedule(bot.id); // switched OFF
    const res = await t.call("POST", `/api/schedules/${s.id}/run-now`);
    expect(res.body.outcome).toMatchObject({ status: "started" });
    await settle();
    expect(t.provider.calls).toHaveLength(1);
    expect(await getSchedule(s.id)).toMatchObject({ enabled: false, nextRunAt: null });
    expect((await t.call("POST", "/api/schedules/nope/run-now")).status).toBe(404);
  });

  it("a scheduled task can use teammates, exactly like a task you start yourself", async () => {
    const boss = await mkBot("Boss");
    const helper = await mkBot("Helper");
    await t.call("PUT", `/api/bots/${boss.id}/delegation`, { targetBotIds: [helper.id] });
    t.provider.script.push(reply('Asking.\n```delegate\n{"to":"Helper","task":"do it"}\n```'), reply("done"), reply("final"));
    await liveSchedule(boss.id);
    advance(15);
    tick();
    await settle();
    expect(t.provider.calls).toHaveLength(3);
    expect((await tasks())[0]).toMatchObject({ status: "completed", chainTasks: 2, origin: "schedule" });
  });

  it("a failure inside the clock can never crash the app", () => {
    const broken = new AutomationScheduler({ tick: () => { throw new Error("boom"); } } as any);
    expect(broken.tick()).toBe(0);
  });

  it("the clock starts and stops cleanly, and only the real server starts it", () => {
    const scheduler = t.app.automation;
    expect(scheduler.running).toBe(false); // buildApp never starts it
    scheduler.start(1_000_000);
    expect(scheduler.running).toBe(true);
    scheduler.start(1_000_000); // a second start changes nothing
    scheduler.stop();
    expect(scheduler.running).toBe(false);
  });
});

describe("kill switches and limits", () => {
  it("the automation kill switch stops everything, and the missed occurrences are not replayed afterwards", async () => {
    const bot = await mkBot("Helper");
    const s = await liveSchedule(bot.id);
    expect((await t.call("PUT", "/api/automation/pause", { paused: true })).body.paused).toBe(true);
    advance(15);
    expect(tick()).toBe(0);
    expect((await runs())[0]).toMatchObject({ status: "skipped", reason: "Automation is paused." });
    expect(t.provider.calls).toHaveLength(0);
    expect((await getSchedule(s.id)).nextRunAt).toBe(new Date(at(12, 30)).toISOString()); // moved on: no burst when resumed

    expect((await t.call("POST", `/api/schedules/${s.id}/run-now`)).body.outcome.status).toBe("skipped");
    await liveTrigger(bot.id);
    expect((await sendEvent("inbox", "hello")).body.outcomes[0]).toMatchObject({ status: "skipped", reason: "Automation is paused." });

    await t.call("PUT", "/api/automation/pause", { paused: false });
    advance(15);
    expect(tick()).toBe(1);
    await settle();
  });

  it("a pause switch is reported ahead of a trigger's cooldown, so the log shows the real reason", async () => {
    const bot = await mkBot("Helper");
    await liveTrigger(bot.id, { cooldownSeconds: 300 });
    expect((await sendEvent("inbox", "first")).body.outcomes[0].status).toBe("started");
    await settle();
    await t.call("PUT", "/api/automation/pause", { paused: true });
    expect((await sendEvent("inbox", "second")).body.outcomes[0]).toMatchObject({ status: "skipped", reason: "Automation is paused." });
    await t.call("PUT", "/api/automation/pause", { paused: false });
    await t.call("PUT", "/api/llm/pause", { paused: true });
    expect((await sendEvent("inbox", "third")).body.outcomes[0]).toMatchObject({ status: "skipped", reason: "All AI calls are paused." });
    await t.call("PUT", "/api/llm/pause", { paused: false });
    expect((await sendEvent("inbox", "fourth")).body.outcomes[0].reason).toMatch(/Cooling down/); // no pause: the cooldown applies
  });

  it("the AI pause switch also stops automation", async () => {
    const bot = await mkBot("Helper");
    await liveSchedule(bot.id);
    await t.call("PUT", "/api/llm/pause", { paused: true });
    advance(15);
    expect(tick()).toBe(0);
    expect((await runs())[0]).toMatchObject({ status: "skipped", reason: "All AI calls are paused." });
    expect(t.provider.calls).toHaveLength(0);
  });

  it("each schedule is limited to 10 runs a day, and all automation to 20", async () => {
    await t.call("PUT", "/api/automation/limits", { maxRunsPerSourcePerDay: 2, maxRunsPerDay: 3 });
    const bot = await mkBot("Helper");
    const a = await makeSchedule(bot.id, { name: "A" });
    const b = await makeSchedule(bot.id, { name: "B" });
    const runNow = async (id: string) => (await t.call("POST", `/api/schedules/${id}/run-now`)).body.outcome;
    expect((await runNow(a.id)).status).toBe("started");
    await settle();
    advance(1); // keep clear of per-minute limits
    expect((await runNow(a.id)).status).toBe("started");
    await settle();
    advance(1);
    const third = await runNow(a.id);
    expect(third.status).toBe("skipped");
    expect(third.reason).toMatch(/already ran 2 times today/);
    expect((await runNow(b.id)).status).toBe("started"); // B has its own allowance... and uses the 3rd of 3
    await settle();
    advance(1);
    const over = await runNow(b.id);
    expect(over.status).toBe("skipped");
    expect(over.reason).toMatch(/limit of 3 automatic runs per day/);
    expect(t.provider.calls).toHaveLength(3);
  });

  it("daily allowances start fresh the next day", async () => {
    await t.call("PUT", "/api/automation/limits", { maxRunsPerSourcePerDay: 1 });
    const bot = await mkBot("Helper");
    const s = await makeSchedule(bot.id);
    await t.call("POST", `/api/schedules/${s.id}/run-now`);
    await settle();
    expect((await t.call("POST", `/api/schedules/${s.id}/run-now`)).body.outcome.status).toBe("skipped");
    t.clock.t = at(12, 0, 1);
    expect((await t.call("POST", `/api/schedules/${s.id}/run-now`)).body.outcome.status).toBe("started");
    await settle();
  });

  it("the usual AI limits still apply to automatic runs (and count as failures)", async () => {
    await t.call("PUT", "/api/llm/limits", { botDailyRequests: 1 });
    const bot = await mkBot("Helper");
    const s = await liveSchedule(bot.id);
    advance(15);
    tick();
    await settle();
    advance(15);
    tick();
    await settle();
    const [second, first] = await tasks();
    expect(first.status).toBe("completed");
    expect(second).toMatchObject({ status: "failed", errorCode: "llm_limit_exceeded" });
    expect((await getSchedule(s.id)).consecutiveFailures).toBe(1);
    expect(t.provider.calls).toHaveLength(1); // the blocked call never reached the provider
  });

  it("the free-only rule still applies: a model that has been blocked cannot run automatically", async () => {
    const bot = await mkBot("Helper");
    await liveSchedule(bot.id);
    const model = (await t.call("GET", "/api/llm/models")).body.models[0];
    await t.call("PATCH", `/api/llm/models/${model.id}`, { enabled: false });
    advance(15);
    tick();
    await settle();
    expect((await tasks())[0]).toMatchObject({ status: "failed", errorCode: "llm_blocked_by_policy" });
    expect(t.provider.calls).toHaveLength(0);
  });
});

describe("failures", () => {
  it("switches a schedule off after 3 failed runs in a row, and says why", async () => {
    await t.call("PUT", "/api/llm/limits", { retries: 0, breakerFailures: 20 });
    const bot = await mkBot("Helper");
    const s = await liveSchedule(bot.id);
    for (let i = 0; i < 3; i++) {
      t.provider.script.push(new LlmError("auth_failed", "The provider rejected the API key."));
      advance(15);
      tick();
      await settle();
    }
    const dead = await getSchedule(s.id);
    expect(dead).toMatchObject({ enabled: false, nextRunAt: null, consecutiveFailures: 3 });
    expect(dead.disabledReason).toMatch(/Switched off after 3 failed runs in a row.*rejected the API key/);
    advance(60);
    expect(tick()).toBe(0);
    expect(t.provider.calls).toHaveLength(3);
    expect((await runs()).filter((r) => r.status === "failed")).toHaveLength(3);
  });

  it("a success resets the count", async () => {
    await t.call("PUT", "/api/llm/limits", { retries: 0, breakerFailures: 20 });
    const bot = await mkBot("Helper");
    const s = await liveSchedule(bot.id);
    const fail = () => t.provider.script.push(new LlmError("auth_failed", "bad key"));
    for (const outcome of ["fail", "fail", "ok", "fail", "fail"]) {
      if (outcome === "fail") fail();
      advance(15);
      tick();
      await settle();
    }
    expect(await getSchedule(s.id)).toMatchObject({ enabled: true, consecutiveFailures: 2 });
  });

  it("switching a schedule back on gives it a fresh start", async () => {
    await t.call("PUT", "/api/llm/limits", { retries: 0, breakerFailures: 20 });
    const bot = await mkBot("Helper");
    const s = await liveSchedule(bot.id);
    for (let i = 0; i < 3; i++) {
      t.provider.script.push(new LlmError("auth_failed", "bad key"));
      advance(15);
      tick();
      await settle();
    }
    const again = (await enableSchedule(s.id)).body.schedule;
    expect(again).toMatchObject({ enabled: true, consecutiveFailures: 0, disabledReason: null });
  });

  it("a run that cannot even start (the bot was archived) is logged as failed, and counts", async () => {
    const bot = await mkBot("Helper");
    const s = await liveSchedule(bot.id);
    await t.call("DELETE", `/api/bots/${bot.id}`);
    advance(15);
    expect(tick()).toBe(0);
    const [latest] = await runs();
    expect(latest).toMatchObject({ status: "failed", sourceName: "Morning summary" });
    expect(latest.reason).toMatch(/archived/);
    expect((await getSchedule(s.id)).consecutiveFailures).toBe(1);
  });

  it("a failing schedule does not stop other schedules from running", async () => {
    await t.call("PUT", "/api/llm/limits", { retries: 0 });
    const good = await mkBot("Good");
    const bad = await mkBot("Bad");
    await liveSchedule(bad.id, { name: "Bad one" });
    await liveSchedule(good.id, { name: "Good one" });
    await t.call("DELETE", `/api/bots/${bad.id}`);
    advance(15);
    expect(tick()).toBe(1);
    await settle();
    expect((await tasks()).map((x) => x.originLabel)).toEqual(["Good one"]);
  });
});

// ======================================================================================
describe("triggers: setting them up", () => {
  it("start switched OFF, with a friendly default message and a 5 minute cooldown", async () => {
    const bot = await mkBot("Helper");
    const trig = await makeTrigger(bot.id, { eventName: "Inbox" });
    expect(trig).toMatchObject({ name: "Inbox helper", source: "event", eventName: "inbox", contains: "", enabled: false, cooldownSeconds: 300, botName: "Helper", watchBotId: null });
    expect(trig.instructionTemplate).toContain("{{text}}");
  });

  it("validates everything", async () => {
    const a = await mkBot("A");
    const b = await mkBot("B");
    const bad: [string, Record<string, unknown>][] = [
      ["event without a name", { eventName: undefined }],
      ["event name with spaces", { eventName: "my event" }],
      ["event name too long", { eventName: "e".repeat(41) }],
      ["task_result without a bot to watch", { source: "task_result", eventName: undefined }],
      ["watching itself", { source: "task_result", eventName: undefined, watchBotId: a.id }],
      ["cooldown under 30 seconds", { cooldownSeconds: 29 }],
      ["cooldown over a day", { cooldownSeconds: 86_401 }],
      ["too-long template", { instructionTemplate: "x".repeat(1501) }],
      ["too-long keyword", { contains: "x".repeat(201) }],
      ["unknown source", { source: "webhook" }],
      ["an extra field", { enabled: true }],
      ["empty name", { name: " " }],
    ];
    for (const [label, extra] of bad) expect((await newTrigger(a.id, extra)).status, label).toBe(400);
    expect((await newTrigger("00000000-0000-4000-8000-000000000000")).body.error).toBe("invalid_bot");
    expect((await newTrigger(a.id, { source: "task_result", eventName: undefined, watchBotId: "00000000-0000-4000-8000-000000000000" })).body.error).toBe("invalid_bot");
    expect((await newTrigger(a.id, { source: "task_result", eventName: undefined, watchBotId: b.id })).status).toBe(201);
    expect((await t.call("GET", "/api/triggers")).body.triggers).toHaveLength(1);
  });

  it("caps the number of triggers at 20, refuses archived bots, and needs the client header", async () => {
    const bot = await mkBot("Helper");
    const old = await mkBot("Old");
    await t.call("DELETE", `/api/bots/${old.id}`);
    expect((await newTrigger(old.id)).body.error).toBe("bot_not_ready");
    for (let i = 0; i < 20; i++) await makeTrigger(bot.id, { name: `T${i}` });
    expect((await newTrigger(bot.id)).body.error).toBe("too_many_triggers");
    const res = await t.app.inject({ method: "POST", url: "/api/triggers", payload: { name: "x", source: "event", eventName: "x", botId: bot.id } });
    expect(res.statusCode).toBe(403);
  });

  it("switching on needs a bot that can take tasks; editing and deleting work", async () => {
    const noModel = (await switchOn(t.call, await t.call("POST", "/api/bots", { name: "NoModel" }))).body.bot;
    const trig = await makeTrigger(noModel.id);
    expect((await t.call("PATCH", `/api/triggers/${trig.id}`, { enabled: true })).body.error).toBe("bot_not_ready");

    const bot = await mkBot("Helper");
    const live = await liveTrigger(bot.id);
    const edited = (await t.call("PATCH", `/api/triggers/${live.id}`, { name: "Renamed", contains: "  urgent  ", cooldownSeconds: 60, instructionTemplate: "Handle: {{text}}" })).body.trigger;
    expect(edited).toMatchObject({ name: "Renamed", contains: "urgent", cooldownSeconds: 60, instructionTemplate: "Handle: {{text}}", enabled: true });
    expect((await t.call("PATCH", `/api/triggers/${live.id}`, { cooldownSeconds: 5 })).body.error).toBe("cooldown_too_short");
    expect((await t.call("PATCH", `/api/triggers/${live.id}`, { surprise: 1 })).status).toBe(400);
    expect((await t.call("DELETE", `/api/triggers/${live.id}`)).status).toBe(204);
    expect((await t.call("GET", `/api/triggers/${live.id}`)).status).toBe(404);
    expect((await t.call("GET", "/api/triggers/nope")).status).toBe(404);
  });
});

describe("triggers: text events", () => {
  it("starts a task for the right bot, with the text put into the message", async () => {
    const bot = await mkBot("Helper");
    const trig = await liveTrigger(bot.id, { contains: "urgent", instructionTemplate: "Reply to this: {{text}} (end of message)" });
    const res = await sendEvent("INBOX", "This is URGENT, please help");
    expect(res.body.outcomes).toHaveLength(1);
    expect(res.body.outcomes[0]).toMatchObject({ status: "started", triggerId: trig.id, triggerName: "Inbox helper" });
    await settle();
    expect(t.provider.calls[0]!.messages[1]!.content).toBe(
      'Task started by the trigger "Inbox helper":\nReply to this: This is URGENT, please help (end of message)',
    );
    expect((await tasks())[0]).toMatchObject({ origin: "trigger", originId: trig.id, originLabel: "Inbox helper", originDepth: 0, status: "completed" });
    expect((await runs())[0]).toMatchObject({ source: "trigger", status: "started" });
  });

  it("ignores events that do not match, with a note in the log", async () => {
    const bot = await mkBot("Helper");
    await liveTrigger(bot.id, { contains: "urgent" });
    const nope = await sendEvent("inbox", "just saying hi");
    expect(nope.body.outcomes[0]).toMatchObject({ status: "skipped", triggerId: null });
    const other = await sendEvent("other-event", "urgent");
    expect(other.body.outcomes[0].status).toBe("skipped");
    expect(t.provider.calls).toHaveLength(0);
    expect((await runs())[0]).toMatchObject({ source: "event", status: "skipped", reason: "No enabled trigger matched this event." });
  });

  it("a switched-off trigger never fires", async () => {
    const bot = await mkBot("Helper");
    await makeTrigger(bot.id);
    expect((await sendEvent("inbox", "hello")).body.outcomes[0].status).toBe("skipped");
    expect(t.provider.calls).toHaveLength(0);
  });

  it("an empty keyword matches every event of that name; the keyword ignores capital letters", async () => {
    const bot = await mkBot("Helper");
    await liveTrigger(bot.id, { name: "Anything", eventName: "any" });
    await liveTrigger(bot.id, { name: "Keyword", eventName: "kw", contains: "InVoIcE" });
    expect((await sendEvent("any", "whatever")).body.outcomes[0].status).toBe("started");
    await settle();
    advance(2);
    expect((await sendEvent("kw", "Your invoice is ready")).body.outcomes[0].status).toBe("started");
    await settle();
  });

  it("every matching trigger fires, each with its own result", async () => {
    const a = await mkBot("A");
    const b = await mkBot("B");
    await liveTrigger(a.id, { name: "First" });
    await liveTrigger(b.id, { name: "Second" });
    const res = await sendEvent("inbox", "hello");
    expect(res.body.outcomes.map((o: any) => [o.triggerName, o.status])).toEqual([["First", "started"], ["Second", "started"]]);
    await settle();
    expect(t.provider.calls).toHaveLength(2);
  });

  it("replaces every {{text}} and uses the default message when the template is blank", async () => {
    const bot = await mkBot("Helper");
    await liveTrigger(bot.id, { name: "Twice", eventName: "twice", instructionTemplate: "{{text}} / {{text}}" });
    await sendEvent("twice", "hi");
    await settle();
    expect(t.provider.calls[0]!.messages[1]!.content).toContain("hi / hi");
    await liveTrigger(bot.id, { name: "Default", eventName: "plain", instructionTemplate: "   " });
    await sendEvent("plain", "the text");
    await settle();
    expect(t.provider.calls[1]!.messages[1]!.content).toContain("A message arrived:\n\nthe text\n\nRespond helpfully.");
  });

  it("only fires once per cooldown", async () => {
    const bot = await mkBot("Helper");
    await liveTrigger(bot.id, { cooldownSeconds: 300 });
    expect((await sendEvent("inbox", "one")).body.outcomes[0].status).toBe("started");
    await settle();
    const second = (await sendEvent("inbox", "two")).body.outcomes[0];
    expect(second).toMatchObject({ status: "skipped" });
    expect(second.reason).toMatch(/Cooling down.*300 seconds/);
    t.clock.t += 301_000;
    expect((await sendEvent("inbox", "three")).body.outcomes[0].status).toBe("started");
    await settle();
    expect(t.provider.calls).toHaveLength(2);
  });

  it("validates events", async () => {
    const bot = await mkBot("Helper");
    await liveTrigger(bot.id);
    const tooLong = await sendEvent("inbox", "x".repeat(2001));
    expect(tooLong.status).toBe(413);
    expect(tooLong.body.error).toBe("event_too_long");
    expect((await sendEvent("inbox", "x".repeat(2000))).status).toBe(200);
    await settle();
    expect((await sendEvent("bad name!", "x")).status).toBe(400);
    expect((await t.call("POST", "/api/events", { name: "inbox", text: "x", extra: 1 })).status).toBe(400);
    expect((await t.call("POST", "/api/events", { name: "inbox" })).status).toBe(400);
    const noHeader = await t.app.inject({ method: "POST", url: "/api/events", payload: { name: "inbox", text: "x" } });
    expect(noHeader.statusCode).toBe(403);
  });

  it("switches a trigger off after 3 failures in a row", async () => {
    await t.call("PUT", "/api/llm/limits", { retries: 0, breakerFailures: 20, botRequestsPerMinute: 100 });
    const bot = await mkBot("Helper");
    const trig = await liveTrigger(bot.id, { cooldownSeconds: 30 });
    for (let i = 0; i < 3; i++) {
      t.provider.script.push(new LlmError("auth_failed", "bad key"));
      await sendEvent("inbox", `try ${i}`);
      await settle();
      advance(1);
    }
    const dead = (await t.call("GET", `/api/triggers/${trig.id}`)).body.trigger;
    expect(dead).toMatchObject({ enabled: false, consecutiveFailures: 3 });
    expect(dead.disabledReason).toMatch(/Switched off after 3 failed runs in a row/);
    expect((await sendEvent("inbox", "again")).body.outcomes[0].status).toBe("skipped");
    expect(t.provider.calls).toHaveLength(3);
  });
});

describe("triggers: reacting to another bot's finished task", () => {
  const userTask = async (botId: string, instruction = "work") => {
    const res = await t.call("POST", `/api/bots/${botId}/tasks`, { instruction });
    expect(res.status).toBe(202);
    await settle();
  };

  it("starts a task for another bot, with the finished answer as the text", async () => {
    const writer = await mkBot("Writer");
    const reviewer = await mkBot("Reviewer");
    const trig = await liveTrigger(reviewer.id, { name: "Review drafts", source: "task_result", eventName: undefined, watchBotId: writer.id, instructionTemplate: "Please review: {{text}}" });
    t.provider.script.push(reply("A fine draft."));
    await userTask(writer.id);
    await vi.waitFor(async () => expect((await tasks()).length).toBe(2));
    await settle();
    const [review, draft] = await tasks();
    expect(draft).toMatchObject({ origin: "user", status: "completed" });
    expect(review).toMatchObject({ origin: "trigger", originId: trig.id, originDepth: 1, assigneeName: "Reviewer", status: "completed" });
    expect(t.provider.calls[1]!.messages[1]!.content).toBe('Task started by the trigger "Review drafts":\nPlease review: A fine draft.');
  });

  it("only fires if the answer contains the keyword, and never for a failed task", async () => {
    await t.call("PUT", "/api/llm/limits", { retries: 0 });
    const writer = await mkBot("Writer");
    const reviewer = await mkBot("Reviewer");
    await liveTrigger(reviewer.id, { source: "task_result", eventName: undefined, watchBotId: writer.id, contains: "NEEDS REVIEW" });
    t.provider.script.push(reply("All good."));
    await userTask(writer.id);
    expect(await tasks()).toHaveLength(1);
    t.provider.script.push(new LlmError("auth_failed", "bad key"));
    await userTask(writer.id);
    expect(await tasks()).toHaveLength(2);
    expect(t.provider.calls).toHaveLength(2); // the reviewer was never asked
    advance(10);
    t.provider.script.push(reply("This NEEDS REVIEW please"));
    await userTask(writer.id);
    await vi.waitFor(async () => expect((await tasks()).length).toBe(4));
    await settle();
  });

  it("stops endless chains: at most 2 automatic hops by default", async () => {
    const [a, b, c, d] = [await mkBot("A"), await mkBot("B"), await mkBot("C"), await mkBot("D")] as any[];
    await t.call("PUT", "/api/automation/limits", { maxHops: 2 });
    for (const [watch, target] of [[a, b], [b, c], [c, d]] as any[]) {
      await liveTrigger(target.id, { name: `${watch.name} to ${target.name}`, source: "task_result", eventName: undefined, watchBotId: watch.id, cooldownSeconds: 30 });
    }
    await userTask(a.id);
    await vi.waitFor(async () => expect((await tasks()).length).toBe(3));
    await settle();
    expect((await tasks()).map((x) => x.assigneeName).reverse()).toEqual(["A", "B", "C"]); // D was never started
    const stopped = (await runs()).find((r) => /limited to 2 hops/.test(r.reason ?? ""));
    expect(stopped).toMatchObject({ source: "trigger", status: "skipped", sourceName: "C to D" });
    expect(t.provider.calls).toHaveLength(3);
  });

  it("the hop limit can be lowered to 1", async () => {
    await t.call("PUT", "/api/automation/limits", { maxHops: 1 });
    const [a, b, c] = [await mkBot("A"), await mkBot("B"), await mkBot("C")] as any[];
    await liveTrigger(b.id, { name: "A to B", source: "task_result", eventName: undefined, watchBotId: a.id, cooldownSeconds: 30 });
    await liveTrigger(c.id, { name: "B to C", source: "task_result", eventName: undefined, watchBotId: b.id, cooldownSeconds: 30 });
    await userTask(a.id);
    await vi.waitFor(async () => expect((await tasks()).length).toBe(2));
    await settle();
    expect(await tasks()).toHaveLength(2);
  });

  it("an event-started task can trigger a follow-up too, within the hop limit", async () => {
    const a = await mkBot("A");
    const b = await mkBot("B");
    await liveTrigger(a.id, { name: "From event" });
    await liveTrigger(b.id, { name: "A to B", source: "task_result", eventName: undefined, watchBotId: a.id, cooldownSeconds: 30 });
    await sendEvent("inbox", "kick off");
    await vi.waitFor(async () => expect((await tasks()).length).toBe(2));
    await settle();
    const [followUp, first] = await tasks();
    expect(first).toMatchObject({ origin: "trigger", originDepth: 0 });
    expect(followUp).toMatchObject({ origin: "trigger", originDepth: 1 });
  });

  it("a trigger never restarts itself, and the kill switch stops these too", async () => {
    const writer = await mkBot("Writer");
    const reviewer = await mkBot("Reviewer");
    await liveTrigger(reviewer.id, { name: "Review", source: "task_result", eventName: undefined, watchBotId: writer.id });
    await t.call("PUT", "/api/automation/pause", { paused: true });
    await userTask(writer.id);
    expect(await tasks()).toHaveLength(1);
    expect((await runs())[0]).toMatchObject({ status: "skipped", reason: "Automation is paused." });
  });
});

// ======================================================================================
describe("settings and the run log", () => {
  it("reports status: switches, limits, counts", async () => {
    const bot = await mkBot("Helper");
    await liveSchedule(bot.id);
    await makeTrigger(bot.id);
    const res = (await t.call("GET", "/api/automation/status")).body;
    expect(res).toMatchObject({ paused: false, runsToday: 0, counts: { schedules: 1, enabledSchedules: 1, triggers: 1, enabledTriggers: 0 } });
    expect(res.limits).toEqual({ minIntervalMinutes: 15, maxRunsPerDay: 20, maxRunsPerSourcePerDay: 10, maxConsecutiveFailures: 3, maxHops: 2, minCooldownSeconds: 30 });
    expect(res.defaults).toEqual(res.limits);
  });

  it("limits can be changed within hard ceilings, and reset", async () => {
    expect((await t.call("PUT", "/api/automation/limits", { maxRunsPerDay: 50, minIntervalMinutes: 30 })).body.limits).toMatchObject({ maxRunsPerDay: 50, minIntervalMinutes: 30, maxHops: 2 });
    for (const bad of [{ minIntervalMinutes: 4 }, { maxRunsPerDay: 201 }, { maxHops: 5 }, { maxHops: 0 }, { maxConsecutiveFailures: 11 }, { minCooldownSeconds: 9 }, { maxRunsPerDay: 1.5 }, { nonsense: 1 }, { maxRunsPerDay: "many" }]) {
      expect((await t.call("PUT", "/api/automation/limits", bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await t.call("POST", "/api/automation/limits/reset")).body.limits.maxRunsPerDay).toBe(20);
  });

  it("a raised minimum interval applies to new schedules", async () => {
    await t.call("PUT", "/api/automation/limits", { minIntervalMinutes: 60 });
    const bot = await mkBot("Helper");
    expect((await newSchedule(bot.id, { intervalMinutes: 30 })).body.error).toBe("interval_too_short");
    expect((await newSchedule(bot.id, { intervalMinutes: 60 })).status).toBe(201);
  });

  it("the kill switch is a simple on/off and needs the client header", async () => {
    expect((await t.call("PUT", "/api/automation/pause", { paused: "yes" })).status).toBe(400);
    expect((await t.call("PUT", "/api/automation/pause", { paused: true, extra: 1 })).status).toBe(400);
    const noHeader = await t.app.inject({ method: "PUT", url: "/api/automation/pause", payload: { paused: true } });
    expect(noHeader.statusCode).toBe(403);
    expect((await t.call("GET", "/api/automation/status")).body.paused).toBe(false);
  });

  it("the run log lists runs newest first, can be limited, and cannot be edited or deleted", async () => {
    const bot = await mkBot("Helper");
    const s = await makeSchedule(bot.id);
    for (let i = 0; i < 3; i++) {
      await t.call("POST", `/api/schedules/${s.id}/run-now`);
      await settle();
      advance(1);
    }
    expect((await t.call("GET", "/api/automation/runs?limit=2")).body.runs).toHaveLength(2);
    expect((await t.call("GET", "/api/automation/runs?limit=0")).status).toBe(400);
    expect((await t.call("GET", "/api/automation/runs?limit=201")).status).toBe(400);

    const db = openDatabase(":memory:");
    db.prepare("INSERT INTO automation_runs (created_at, created_ms, day, source, source_name, status) VALUES ('x', 1, 'd', 'event', 'n', 'skipped')").run();
    expect(() => db.prepare("UPDATE automation_runs SET status = 'started'").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM automation_runs").run()).toThrow(/append-only/);
  });

  it("existing tasks default to 'started by you'", async () => {
    const bot = await mkBot("Helper");
    t.provider.script.push(reply("done"));
    await t.call("POST", `/api/bots/${bot.id}/tasks`, { instruction: "by hand" });
    await settle();
    expect((await tasks())[0]).toMatchObject({ origin: "user", originId: null, originLabel: null, originDepth: 0, requestedByName: "You" });
  });

  it("no external action exists anywhere: automation only creates text tasks", async () => {
    const bot = await mkBot("Helper");
    await liveTrigger(bot.id);
    await sendEvent("inbox", "send an email to everyone!");
    await settle();
    for (const call of t.provider.calls) {
      expect(Object.keys(call).sort()).toEqual(["maxOutputTokens", "messages", "model", "temperature", "timeoutMs"]);
      expect(JSON.stringify(call)).not.toMatch(/"tools?"|"functions?"|tool_choice/);
    }
    const permissions = (await t.call("GET", `/api/bots/${bot.id}`)).body.bot.permissions;
    expect(permissions.every((p: any) => p.readEnabled === false && p.writePolicy === "approval_required")).toBe(true);
  });
});
