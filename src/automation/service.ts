import { randomUUID } from "node:crypto";
import type { BotRecord } from "../agent-manager/types.js";
import type { TaskEngine } from "../delegation/engine.js";
import type { TaskRecord } from "../delegation/repository.js";
import { AppError } from "../errors.js";
import { localDay } from "../llm/limits.js";
import type { LlmService } from "../llm/service.js";
import {
  DEFAULT_AUTOMATION_LIMITS,
  EVENT_TEXT_MAX,
  LATE_GRACE_MS,
  MAX_SCHEDULES,
  MAX_TRIGGERS,
  automationLimitsUpdateSchema,
  mergeAutomationLimits,
  type AutomationLimits,
  type AutomationLimitsUpdate,
} from "./limits.js";
import type {
  AutomationRepository,
  RunRecord,
  ScheduleRecord,
  TriggerRecord,
  TriggerSource,
} from "./repository.js";
import { ALL_DAYS, TIME_OF_DAY, nextRunAfter, type ScheduleKind, type ScheduleTiming } from "./timing.js";

const LIMITS_KEY = "limits";
const PAUSED_KEY = "paused";
const MAX_INTERVAL_MINUTES = 10_080; // one week
const DEFAULT_TEMPLATE = "A message arrived:\n\n{{text}}\n\nRespond helpfully.";

export interface ScheduleView extends Omit<ScheduleRecord, "runAt" | "nextRunAt" | "lastRunAt"> {
  botName: string;
  runAt: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

export interface TriggerView extends Omit<TriggerRecord, "lastFiredAt"> {
  botName: string;
  watchBotName: string | null;
  lastFiredAt: string | null;
}

export interface RunOutcome {
  status: "started" | "skipped" | "failed";
  reason?: string;
  taskId?: string;
}

export interface EventOutcome extends RunOutcome {
  triggerId: string | null;
  triggerName: string;
}

export interface CreateScheduleInput {
  name: string;
  botId: string;
  instruction: string;
  kind: ScheduleKind;
  intervalMinutes?: number | undefined;
  timeOfDay?: string | undefined;
  days?: number[] | undefined;
  runAt?: string | undefined;
}

export interface UpdateScheduleInput extends Partial<CreateScheduleInput> {
  enabled?: boolean | undefined;
}

export interface CreateTriggerInput {
  name: string;
  source: TriggerSource;
  eventName?: string | undefined;
  watchBotId?: string | undefined;
  contains?: string | undefined;
  botId: string;
  instructionTemplate?: string | undefined;
  cooldownSeconds?: number | undefined;
}

export interface UpdateTriggerInput extends Partial<CreateTriggerInput> {
  enabled?: boolean | undefined;
}

export interface AutomationDeps {
  repo: AutomationRepository;
  engine: TaskEngine;
  llm: LlmService;
  getBot: (id: string) => BotRecord;
  now?: () => number;
  /** The Guardian: a plain-language reason while nothing may start, else null. */
  startGuard?: () => string | null;
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/**
 * Schedules and text triggers. Every automatic run goes through TaskEngine.submit, so the free-only
 * gate, usage limits, pause switch and teamwork limits all apply. Text only: nothing external happens.
 */
export class AutomationService {
  private readonly now: () => number;
  private ticking = false;

  constructor(private readonly deps: AutomationDeps) {
    this.now = deps.now ?? Date.now;
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  // ---------------- settings: kill switch and limits ----------------

  limits(): AutomationLimits {
    const raw = this.deps.repo.getSetting(LIMITS_KEY);
    if (!raw) return mergeAutomationLimits(null);
    try {
      return mergeAutomationLimits(automationLimitsUpdateSchema.parse(JSON.parse(raw)));
    } catch {
      return mergeAutomationLimits(null);
    }
  }

  updateLimits(update: AutomationLimitsUpdate): AutomationLimits {
    const parsed = automationLimitsUpdateSchema.parse(update);
    let current: AutomationLimitsUpdate = {};
    try {
      const raw = this.deps.repo.getSetting(LIMITS_KEY);
      current = raw ? automationLimitsUpdateSchema.parse(JSON.parse(raw)) : {};
    } catch {
      current = {};
    }
    this.deps.repo.setSetting(LIMITS_KEY, JSON.stringify({ ...current, ...parsed }), this.iso());
    return this.limits();
  }

  resetLimits(): AutomationLimits {
    this.deps.repo.deleteSetting(LIMITS_KEY);
    return this.limits();
  }

  isPaused(): boolean {
    return this.deps.repo.getSetting(PAUSED_KEY) === "true";
  }

  setPaused(paused: boolean): void {
    this.deps.repo.setSetting(PAUSED_KEY, paused ? "true" : "false", this.iso());
  }

  status() {
    const schedules = this.deps.repo.listSchedules();
    const triggers = this.deps.repo.listTriggers();
    return {
      paused: this.isPaused(),
      limits: this.limits(),
      defaults: { ...DEFAULT_AUTOMATION_LIMITS } as AutomationLimits,
      counts: {
        schedules: schedules.length,
        enabledSchedules: schedules.filter((s) => s.enabled).length,
        triggers: triggers.length,
        enabledTriggers: triggers.filter((t) => t.enabled).length,
      },
      runsToday: this.deps.repo.countStarted(localDay(this.now())),
    };
  }

  // ---------------- helpers ----------------

  private botName(id: string | null): string | null {
    if (!id) return null;
    try {
      return this.deps.getBot(id).name;
    } catch {
      return "(unknown)";
    }
  }

  private mustExistingBot(id: string, what = "bot"): BotRecord {
    try {
      return this.deps.getBot(id);
    } catch {
      throw new AppError(400, "invalid_bot", `The chosen ${what} does not exist.`);
    }
  }

  /** A bot must be able to take a task before a schedule or trigger for it is switched on. */
  private assertBotReady(botId: string): void {
    const bot = this.mustExistingBot(botId);
    if (bot.archived) throw new AppError(409, "bot_not_ready", `${bot.name} is archived. Unarchive it first.`);
    if (bot.runtime !== "builtin") throw new AppError(409, "bot_not_ready", `${bot.name} uses OpenClaw, which is not installed.`);
    if (!bot.model) throw new AppError(409, "bot_not_ready", `${bot.name} has no model yet. Choose one on its Details tab.`);
  }

  private timingOf(s: ScheduleRecord): ScheduleTiming {
    return { kind: s.kind, intervalMinutes: s.intervalMinutes, timeOfDay: s.timeOfDay, days: s.days, runAt: s.runAt };
  }

  // ---------------- schedules ----------------

  private scheduleView(s: ScheduleRecord): ScheduleView {
    return {
      ...s,
      botName: this.botName(s.botId) ?? "(unknown)",
      runAt: iso(s.runAt),
      nextRunAt: iso(s.nextRunAt),
      lastRunAt: iso(s.lastRunAt),
    };
  }

  listSchedules(): ScheduleView[] {
    return this.deps.repo.listSchedules().map((s) => this.scheduleView(s));
  }

  private mustSchedule(id: string): ScheduleRecord {
    const s = this.deps.repo.getSchedule(id);
    if (!s) throw new AppError(404, "schedule_not_found", "Schedule not found");
    return s;
  }

  getSchedule(id: string): ScheduleView {
    return this.scheduleView(this.mustSchedule(id));
  }

  /** Checks the timing fields for one kind of schedule and returns the clean values. */
  private validateTiming(input: {
    kind: ScheduleKind;
    intervalMinutes?: number | null | undefined;
    timeOfDay?: string | null | undefined;
    days?: number[] | undefined;
    runAt?: string | number | null | undefined;
  }): Pick<ScheduleRecord, "intervalMinutes" | "timeOfDay" | "days" | "runAt"> {
    const limits = this.limits();
    if (input.kind === "interval") {
      const minutes = input.intervalMinutes;
      if (minutes === undefined || minutes === null || !Number.isInteger(minutes)) {
        throw new AppError(400, "invalid_schedule", "Say how many minutes between runs.");
      }
      if (minutes < limits.minIntervalMinutes) {
        throw new AppError(400, "interval_too_short", `Runs must be at least ${limits.minIntervalMinutes} minutes apart (this protects your free-tier limits).`);
      }
      if (minutes > MAX_INTERVAL_MINUTES) throw new AppError(400, "invalid_schedule", "That interval is longer than a week.");
      return { intervalMinutes: minutes, timeOfDay: null, days: ALL_DAYS, runAt: null };
    }
    if (input.kind === "daily") {
      if (!input.timeOfDay || !TIME_OF_DAY.test(input.timeOfDay)) {
        throw new AppError(400, "invalid_schedule", "Give a time like 09:30.");
      }
      const days = [...new Set(input.days ?? ALL_DAYS)].sort((a, b) => a - b);
      if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
        throw new AppError(400, "invalid_schedule", "Choose at least one day of the week.");
      }
      return { intervalMinutes: null, timeOfDay: input.timeOfDay, days, runAt: null };
    }
    const runAt = typeof input.runAt === "number" ? input.runAt : Date.parse(String(input.runAt ?? ""));
    if (!Number.isFinite(runAt)) throw new AppError(400, "invalid_schedule", "Give the date and time for the one-off run.");
    if (runAt <= this.now()) throw new AppError(400, "run_time_passed", "That time has already passed.");
    if (runAt > this.now() + 366 * 86_400_000) throw new AppError(400, "invalid_schedule", "A one-off run can be at most a year away.");
    return { intervalMinutes: null, timeOfDay: null, days: ALL_DAYS, runAt };
  }

  /** New schedules are ALWAYS created switched off. */
  createSchedule(input: CreateScheduleInput): ScheduleView {
    if (this.deps.repo.countSchedules() >= MAX_SCHEDULES) {
      throw new AppError(409, "too_many_schedules", `You can have at most ${MAX_SCHEDULES} schedules.`);
    }
    const bot = this.mustExistingBot(input.botId);
    if (bot.archived) throw new AppError(409, "bot_not_ready", `${bot.name} is archived. Unarchive it first.`);
    const timing = this.validateTiming(input);
    const now = this.iso();
    const record: ScheduleRecord = {
      id: randomUUID(),
      name: input.name,
      botId: input.botId,
      instruction: input.instruction,
      kind: input.kind,
      ...timing,
      enabled: false,
      nextRunAt: null,
      lastRunAt: null,
      consecutiveFailures: 0,
      disabledReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.deps.repo.insertSchedule(record);
    return this.getSchedule(record.id);
  }

  updateSchedule(id: string, input: UpdateScheduleInput): ScheduleView {
    const current = this.mustSchedule(id);
    const botId = input.botId ?? current.botId;
    if (input.botId !== undefined) {
      const bot = this.mustExistingBot(input.botId);
      if (bot.archived) throw new AppError(409, "bot_not_ready", `${bot.name} is archived. Unarchive it first.`);
    }

    const timingChanged = ["kind", "intervalMinutes", "timeOfDay", "days", "runAt"].some((k) => (input as Record<string, unknown>)[k] !== undefined);
    const kind = input.kind ?? current.kind;
    const timing = timingChanged
      ? this.validateTiming({
          kind,
          intervalMinutes: input.intervalMinutes ?? (kind === current.kind ? current.intervalMinutes : undefined),
          timeOfDay: input.timeOfDay ?? (kind === current.kind ? current.timeOfDay : undefined),
          days: input.days ?? (kind === current.kind ? current.days : undefined),
          runAt: input.runAt ?? (kind === current.kind ? current.runAt : undefined),
        })
      : null;

    const enabled = input.enabled ?? current.enabled;
    const patch: Parameters<AutomationRepository["updateSchedule"]>[1] = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.instruction !== undefined) patch.instruction = input.instruction;
    if (input.botId !== undefined) patch.botId = input.botId;
    if (timing) Object.assign(patch, { kind, ...timing });

    const merged: ScheduleRecord = { ...current, ...patch, kind, enabled };
    if (enabled) {
      this.assertBotReady(botId);
      // Switching on, or changing the timing of a running schedule, plans the next run from now.
      if (!current.enabled || timing) {
        const next = nextRunAfter(this.timingOf(merged), this.now());
        if (next === null) throw new AppError(409, "run_time_passed", "This schedule has no future run time. Change its timing first.");
        patch.nextRunAt = next;
      }
      if (!current.enabled) {
        patch.consecutiveFailures = 0;
        patch.disabledReason = null;
      }
    } else {
      patch.nextRunAt = null;
      if (input.enabled === false) patch.disabledReason = null;
    }
    patch.enabled = enabled;
    this.deps.repo.updateSchedule(id, patch, this.iso());
    return this.getSchedule(id);
  }

  deleteSchedule(id: string): void {
    this.mustSchedule(id);
    this.deps.repo.deleteSchedule(id);
  }

  /** A manual test run. It obeys every check and counts toward the daily limits. */
  runScheduleNow(id: string): RunOutcome {
    const s = this.mustSchedule(id);
    const outcome = this.launch("schedule", s, s.instruction, 0);
    if (outcome.status === "started") this.deps.repo.updateSchedule(id, { lastRunAt: this.now() }, this.iso());
    return outcome;
  }

  // ---------------- triggers ----------------

  private triggerView(t: TriggerRecord): TriggerView {
    return {
      ...t,
      botName: this.botName(t.botId) ?? "(unknown)",
      watchBotName: this.botName(t.watchBotId),
      lastFiredAt: iso(t.lastFiredAt),
    };
  }

  listTriggers(): TriggerView[] {
    return this.deps.repo.listTriggers().map((t) => this.triggerView(t));
  }

  private mustTrigger(id: string): TriggerRecord {
    const t = this.deps.repo.getTrigger(id);
    if (!t) throw new AppError(404, "trigger_not_found", "Trigger not found");
    return t;
  }

  getTrigger(id: string): TriggerView {
    return this.triggerView(this.mustTrigger(id));
  }

  private validateTrigger(t: {
    source: TriggerSource;
    eventName: string | null;
    watchBotId: string | null;
    botId: string;
    cooldownSeconds: number;
  }): void {
    const limits = this.limits();
    if (t.source === "event" && !t.eventName) throw new AppError(400, "invalid_trigger", "Give the name of the event to listen for.");
    if (t.source === "task_result") {
      if (!t.watchBotId) throw new AppError(400, "invalid_trigger", "Choose which bot's finished tasks to watch.");
      this.mustExistingBot(t.watchBotId, "bot to watch");
      if (t.watchBotId === t.botId) {
        throw new AppError(400, "invalid_trigger", "A bot's own results cannot start a task for the same bot (that would loop).");
      }
    }
    if (t.cooldownSeconds < limits.minCooldownSeconds) {
      throw new AppError(400, "cooldown_too_short", `The cooldown must be at least ${limits.minCooldownSeconds} seconds.`);
    }
  }

  /** New triggers are ALWAYS created switched off. */
  createTrigger(input: CreateTriggerInput): TriggerView {
    if (this.deps.repo.countTriggers() >= MAX_TRIGGERS) {
      throw new AppError(409, "too_many_triggers", `You can have at most ${MAX_TRIGGERS} triggers.`);
    }
    const bot = this.mustExistingBot(input.botId);
    if (bot.archived) throw new AppError(409, "bot_not_ready", `${bot.name} is archived. Unarchive it first.`);
    const record: TriggerRecord = {
      id: randomUUID(),
      name: input.name,
      source: input.source,
      eventName: input.source === "event" ? (input.eventName?.toLowerCase() ?? null) : null,
      watchBotId: input.source === "task_result" ? (input.watchBotId ?? null) : null,
      contains: (input.contains ?? "").trim(),
      botId: input.botId,
      instructionTemplate: input.instructionTemplate?.trim() || DEFAULT_TEMPLATE,
      cooldownSeconds: input.cooldownSeconds ?? Math.max(300, this.limits().minCooldownSeconds),
      enabled: false,
      lastFiredAt: null,
      consecutiveFailures: 0,
      disabledReason: null,
      createdAt: this.iso(),
      updatedAt: this.iso(),
    };
    this.validateTrigger(record);
    this.deps.repo.insertTrigger(record);
    return this.getTrigger(record.id);
  }

  updateTrigger(id: string, input: UpdateTriggerInput): TriggerView {
    const current = this.mustTrigger(id);
    const source = input.source ?? current.source;
    const next = {
      source,
      eventName: source === "event" ? (input.eventName?.toLowerCase() ?? current.eventName) : null,
      watchBotId: source === "task_result" ? (input.watchBotId ?? current.watchBotId) : null,
      botId: input.botId ?? current.botId,
      cooldownSeconds: input.cooldownSeconds ?? current.cooldownSeconds,
    };
    if (input.botId !== undefined) {
      const bot = this.mustExistingBot(input.botId);
      if (bot.archived) throw new AppError(409, "bot_not_ready", `${bot.name} is archived. Unarchive it first.`);
    }
    this.validateTrigger(next);
    const enabled = input.enabled ?? current.enabled;
    if (enabled) this.assertBotReady(next.botId);

    const patch: Parameters<AutomationRepository["updateTrigger"]>[1] = { ...next, enabled };
    if (input.name !== undefined) patch.name = input.name;
    if (input.contains !== undefined) patch.contains = input.contains.trim();
    if (input.instructionTemplate !== undefined) patch.instructionTemplate = input.instructionTemplate.trim() || DEFAULT_TEMPLATE;
    if (enabled && !current.enabled) {
      patch.consecutiveFailures = 0;
      patch.disabledReason = null;
    } else if (input.enabled === false) {
      patch.disabledReason = null;
    }
    this.deps.repo.updateTrigger(id, patch, this.iso());
    return this.getTrigger(id);
  }

  deleteTrigger(id: string): void {
    this.mustTrigger(id);
    this.deps.repo.deleteTrigger(id);
  }

  // ---------------- running ----------------

  /**
   * The one place every automatic run passes through. A run is skipped (and logged) if automation
   * or AI calls are paused, a daily limit is reached, or the previous run is still working.
   */
  private launch(
    source: "schedule" | "trigger",
    rec: { id: string; name: string; botId: string },
    instruction: string,
    originDepth: number,
  ): RunOutcome {
    const limits = this.limits();
    const nowMs = this.now();
    const day = localDay(nowMs);
    const log = (status: RunRecord["status"], reason: string | null, taskId: string | null = null) =>
      this.deps.repo.insertRun({ nowMs, source, sourceId: rec.id, sourceName: rec.name, status, reason, taskId });
    const skip = (reason: string): RunOutcome => {
      log("skipped", reason);
      return { status: "skipped", reason };
    };

    const paused = this.pauseReason();
    if (paused) return skip(paused);
    if (this.deps.repo.countStarted(day) >= limits.maxRunsPerDay) {
      return skip(`The limit of ${limits.maxRunsPerDay} automatic runs per day was reached.`);
    }
    if (this.deps.repo.countStarted(day, rec.id) >= limits.maxRunsPerSourcePerDay) {
      return skip(`This ${source} already ran ${limits.maxRunsPerSourcePerDay} times today (the daily limit for one ${source}).`);
    }
    if (this.deps.engine.activeFromOrigin(rec.id) > 0) return skip("The previous run is still working.");

    try {
      const task = this.deps.engine.submit(rec.botId, instruction, { type: source, id: rec.id, label: rec.name, depth: originDepth });
      log("started", null, task.id);
      return { status: "started", taskId: task.id };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "The task could not be started.";
      log("failed", reason);
      this.recordFailure(source, rec.id, reason);
      return { status: "failed", reason };
    }
  }

  /** Why nothing may start right now because of a pause switch, or null. Checked before anything else. */
  private pauseReason(): string | null {
    if (this.isPaused()) return "Automation is paused.";
    if (this.deps.llm.isPaused()) return "All AI calls are paused.";
    return this.deps.startGuard?.() ?? null;
  }

  /** Counts a failure, and switches the schedule or trigger off after too many in a row. */
  private recordFailure(source: "schedule" | "trigger", id: string, reason: string): void {
    const max = this.limits().maxConsecutiveFailures;
    const now = this.iso();
    const current = source === "schedule" ? this.deps.repo.getSchedule(id) : this.deps.repo.getTrigger(id);
    if (!current) return;
    const failures = current.consecutiveFailures + 1;
    const patch = { consecutiveFailures: failures } as { consecutiveFailures: number; enabled?: boolean; nextRunAt?: null; disabledReason?: string };
    if (failures >= max) {
      patch.enabled = false;
      patch.disabledReason = `Switched off after ${failures} failed runs in a row. Last problem: ${reason}`;
      if (source === "schedule") patch.nextRunAt = null;
    }
    if (source === "schedule") this.deps.repo.updateSchedule(id, patch, now);
    else this.deps.repo.updateTrigger(id, patch, now);
  }

  /** Called when a task that was started from outside ends. Tracks failures and fires result triggers. */
  onRootFinished(task: TaskRecord): void {
    if ((task.origin === "schedule" || task.origin === "trigger") && task.originId) {
      if (task.status === "completed") {
        if (task.origin === "schedule") this.deps.repo.updateSchedule(task.originId, { consecutiveFailures: 0 }, this.iso());
        else this.deps.repo.updateTrigger(task.originId, { consecutiveFailures: 0 }, this.iso());
      } else if (task.status === "failed") {
        const reason = task.errorMessage ?? "The task failed.";
        this.deps.repo.insertRun({
          nowMs: this.now(),
          source: task.origin,
          sourceId: task.originId,
          sourceName: task.originLabel ?? task.origin,
          status: "failed",
          reason,
          taskId: task.id,
        });
        this.recordFailure(task.origin, task.originId, reason);
      }
    }
    if (task.status === "completed") this.fireResultTriggers(task);
  }

  private matches(trigger: TriggerRecord, text: string): boolean {
    return trigger.contains === "" || text.toLowerCase().includes(trigger.contains.toLowerCase());
  }

  /** Starts the trigger's task, unless it is still cooling down. */
  private fire(trigger: TriggerRecord, text: string, originDepth: number): RunOutcome {
    const nowMs = this.now();
    // A pause switch is the more important reason, so it is reported ahead of a cooldown.
    const paused = this.pauseReason();
    if (paused) {
      this.deps.repo.insertRun({ nowMs, source: "trigger", sourceId: trigger.id, sourceName: trigger.name, status: "skipped", reason: paused });
      return { status: "skipped", reason: paused };
    }
    if (trigger.lastFiredAt !== null && nowMs - trigger.lastFiredAt < trigger.cooldownSeconds * 1000) {
      const reason = `Cooling down (at least ${trigger.cooldownSeconds} seconds between runs).`;
      this.deps.repo.insertRun({ nowMs, source: "trigger", sourceId: trigger.id, sourceName: trigger.name, status: "skipped", reason });
      return { status: "skipped", reason };
    }
    const instruction = trigger.instructionTemplate.split("{{text}}").join(text);
    const outcome = this.launch("trigger", trigger, instruction, originDepth);
    if (outcome.status === "started") this.deps.repo.updateTrigger(trigger.id, { lastFiredAt: nowMs }, this.iso());
    return outcome;
  }

  private fireResultTriggers(task: TaskRecord): void {
    const limits = this.limits();
    for (const trigger of this.deps.repo.listTriggers()) {
      if (!trigger.enabled || trigger.source !== "task_result" || trigger.watchBotId !== task.assigneeBotId) continue;
      if (trigger.id === task.originId) continue; // a trigger never restarts itself
      const text = (task.result ?? "").slice(0, EVENT_TEXT_MAX);
      if (!this.matches(trigger, text)) continue;
      if (task.originDepth >= limits.maxHops) {
        this.deps.repo.insertRun({
          nowMs: this.now(),
          source: "trigger",
          sourceId: trigger.id,
          sourceName: trigger.name,
          status: "skipped",
          reason: `Stopped: automatic chains are limited to ${limits.maxHops} hops.`,
        });
        continue;
      }
      this.fire(trigger, text, task.originDepth + 1);
    }
  }

  /** A text event arrives (from the test form now, from connectors such as Telegram in the future). */
  private readonly eventListeners: ((name: string, text: string) => number)[] = [];

  /** Other parts (workflows) that also want to react to text events. They return how many things they started. */
  addEventListener(listener: (name: string, text: string) => number): void {
    this.eventListeners.push(listener);
  }

  handleEvent(name: string, text: string): EventOutcome[] {
    if (text.length > EVENT_TEXT_MAX) {
      throw new AppError(413, "event_too_long", `That text is too long (${text.length.toLocaleString()} characters; the limit is ${EVENT_TEXT_MAX.toLocaleString()}).`);
    }
    const eventName = name.toLowerCase();
    const outcomes: EventOutcome[] = [];
    for (const trigger of this.deps.repo.listTriggers()) {
      if (!trigger.enabled || trigger.source !== "event" || trigger.eventName !== eventName) continue;
      if (!this.matches(trigger, text)) continue;
      outcomes.push({ ...this.fire(trigger, text, 0), triggerId: trigger.id, triggerName: trigger.name });
    }
    const alsoStarted = this.eventListeners.reduce((n, l) => n + l(eventName, text), 0);
    if (outcomes.length === 0 && alsoStarted === 0) {
      const reason = "No enabled trigger matched this event.";
      this.deps.repo.insertRun({ nowMs: this.now(), source: "event", sourceId: null, sourceName: eventName, status: "skipped", reason });
      outcomes.push({ status: "skipped", reason, triggerId: null, triggerName: "(none)" });
    }
    return outcomes;
  }

  // ---------------- the clock ----------------

  /**
   * Looks for schedules that are due. Called every 30 seconds while the app runs.
   * A run that is more than 5 minutes late (the app was off, or the PC slept) is skipped, never replayed.
   */
  tick(): number {
    if (this.ticking) return 0;
    this.ticking = true;
    let launched = 0;
    try {
      const nowMs = this.now();
      for (const schedule of this.deps.repo.dueSchedules(nowMs)) {
        const planned = schedule.nextRunAt ?? nowMs;
        const timing = this.timingOf(schedule);
        const once = schedule.kind === "once";
        // Plan the next run BEFORE starting this one, so a crash can never repeat it.
        const next = once ? null : nextRunAfter(timing, nowMs);
        this.deps.repo.updateSchedule(
          schedule.id,
          once ? { enabled: false, nextRunAt: null, lastRunAt: nowMs } : { nextRunAt: next, lastRunAt: nowMs },
          this.iso(),
        );
        if (nowMs - planned > LATE_GRACE_MS) {
          this.deps.repo.insertRun({
            nowMs,
            source: "schedule",
            sourceId: schedule.id,
            sourceName: schedule.name,
            status: "skipped",
            reason: "Missed: the app was not running at the planned time. Runs are never replayed.",
          });
          continue;
        }
        if (this.launch("schedule", schedule, schedule.instruction, 0).status === "started") launched += 1;
      }
    } finally {
      this.ticking = false;
    }
    return launched;
  }

  listRuns(limit = 50): RunRecord[] {
    return this.deps.repo.listRuns(limit);
  }
}
