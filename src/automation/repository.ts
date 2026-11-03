import type { DatabaseSync } from "node:sqlite";
import { localDay } from "../llm/limits.js";
import { formatDays, parseDays, type ScheduleKind } from "./timing.js";

type Row = Record<string, unknown>;
type Value = string | number | null;

export interface ScheduleRecord {
  id: string;
  name: string;
  botId: string;
  instruction: string;
  kind: ScheduleKind;
  intervalMinutes: number | null;
  timeOfDay: string | null;
  days: number[];
  runAt: number | null;
  enabled: boolean;
  nextRunAt: number | null;
  lastRunAt: number | null;
  consecutiveFailures: number;
  disabledReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TriggerSource = "event" | "task_result";

export interface TriggerRecord {
  id: string;
  name: string;
  source: TriggerSource;
  eventName: string | null;
  watchBotId: string | null;
  contains: string;
  botId: string;
  instructionTemplate: string;
  cooldownSeconds: number;
  enabled: boolean;
  lastFiredAt: number | null;
  consecutiveFailures: number;
  disabledReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: number;
  createdAt: string;
  source: "schedule" | "trigger" | "event";
  sourceId: string | null;
  sourceName: string;
  status: "started" | "skipped" | "failed";
  reason: string | null;
  taskId: string | null;
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toSchedule(r: Row): ScheduleRecord {
  return {
    id: String(r["id"]),
    name: String(r["name"]),
    botId: String(r["bot_id"]),
    instruction: String(r["instruction"]),
    kind: String(r["kind"]) as ScheduleKind,
    intervalMinutes: num(r["interval_minutes"]),
    timeOfDay: str(r["time_of_day"]),
    days: parseDays(String(r["days"])),
    runAt: num(r["run_at"]),
    enabled: Number(r["enabled"]) === 1,
    nextRunAt: num(r["next_run_at"]),
    lastRunAt: num(r["last_run_at"]),
    consecutiveFailures: Number(r["consecutive_failures"]),
    disabledReason: str(r["disabled_reason"]),
    createdAt: String(r["created_at"]),
    updatedAt: String(r["updated_at"]),
  };
}

function toTrigger(r: Row): TriggerRecord {
  return {
    id: String(r["id"]),
    name: String(r["name"]),
    source: String(r["source"]) as TriggerSource,
    eventName: str(r["event_name"]),
    watchBotId: str(r["watch_bot_id"]),
    contains: String(r["contains"]),
    botId: String(r["bot_id"]),
    instructionTemplate: String(r["instruction_template"]),
    cooldownSeconds: Number(r["cooldown_seconds"]),
    enabled: Number(r["enabled"]) === 1,
    lastFiredAt: num(r["last_fired_at"]),
    consecutiveFailures: Number(r["consecutive_failures"]),
    disabledReason: str(r["disabled_reason"]),
    createdAt: String(r["created_at"]),
    updatedAt: String(r["updated_at"]),
  };
}

/** A change to a schedule. Only the fields that are present are written. */
export interface SchedulePatch {
  name?: string;
  botId?: string;
  instruction?: string;
  kind?: ScheduleKind;
  intervalMinutes?: number | null;
  timeOfDay?: string | null;
  days?: number[];
  runAt?: number | null;
  enabled?: boolean;
  nextRunAt?: number | null;
  lastRunAt?: number | null;
  consecutiveFailures?: number;
  disabledReason?: string | null;
}

export interface TriggerPatch {
  name?: string;
  source?: TriggerSource;
  eventName?: string | null;
  watchBotId?: string | null;
  contains?: string;
  botId?: string;
  instructionTemplate?: string;
  cooldownSeconds?: number;
  enabled?: boolean;
  lastFiredAt?: number | null;
  consecutiveFailures?: number;
  disabledReason?: string | null;
}

/** All SQL for schedules, triggers, the run log and automation settings. No rules here. */
export class AutomationRepository {
  constructor(private readonly db: DatabaseSync) {}

  private update(table: "schedules" | "triggers", id: string, columns: Record<string, Value>, now: string): void {
    const names = Object.keys(columns);
    if (names.length === 0) return;
    const sets = [...names.map((n) => `${n} = ?`), "updated_at = ?"].join(", ");
    this.db.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?`).run(...names.map((n) => columns[n] as Value), now, id);
  }

  // ---- schedules ----
  insertSchedule(s: ScheduleRecord): void {
    this.db
      .prepare(
        `INSERT INTO schedules (id, name, bot_id, instruction, kind, interval_minutes, time_of_day, days, run_at,
                                enabled, next_run_at, last_run_at, consecutive_failures, disabled_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 0, NULL, ?, ?)`,
      )
      .run(s.id, s.name, s.botId, s.instruction, s.kind, s.intervalMinutes, s.timeOfDay, formatDays(s.days), s.runAt, s.createdAt, s.updatedAt);
  }

  getSchedule(id: string): ScheduleRecord | undefined {
    const row = this.db.prepare("SELECT * FROM schedules WHERE id = ?").get(id);
    return row ? toSchedule(row) : undefined;
  }

  listSchedules(): ScheduleRecord[] {
    return this.db.prepare("SELECT * FROM schedules ORDER BY created_at, rowid").all().map(toSchedule);
  }

  countSchedules(): number {
    return Number(this.db.prepare("SELECT COUNT(*) AS n FROM schedules").get()?.["n"] ?? 0);
  }

  dueSchedules(nowMs: number): ScheduleRecord[] {
    return this.db
      .prepare("SELECT * FROM schedules WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at")
      .all(nowMs)
      .map(toSchedule);
  }

  updateSchedule(id: string, p: SchedulePatch, now: string): void {
    const c: Record<string, Value> = {};
    if (p.name !== undefined) c["name"] = p.name;
    if (p.botId !== undefined) c["bot_id"] = p.botId;
    if (p.instruction !== undefined) c["instruction"] = p.instruction;
    if (p.kind !== undefined) c["kind"] = p.kind;
    if (p.intervalMinutes !== undefined) c["interval_minutes"] = p.intervalMinutes;
    if (p.timeOfDay !== undefined) c["time_of_day"] = p.timeOfDay;
    if (p.days !== undefined) c["days"] = formatDays(p.days);
    if (p.runAt !== undefined) c["run_at"] = p.runAt;
    if (p.enabled !== undefined) c["enabled"] = p.enabled ? 1 : 0;
    if (p.nextRunAt !== undefined) c["next_run_at"] = p.nextRunAt;
    if (p.lastRunAt !== undefined) c["last_run_at"] = p.lastRunAt;
    if (p.consecutiveFailures !== undefined) c["consecutive_failures"] = p.consecutiveFailures;
    if (p.disabledReason !== undefined) c["disabled_reason"] = p.disabledReason;
    this.update("schedules", id, c, now);
  }

  deleteSchedule(id: string): void {
    this.db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
  }

  // ---- triggers ----
  insertTrigger(t: TriggerRecord): void {
    this.db
      .prepare(
        `INSERT INTO triggers (id, name, source, event_name, watch_bot_id, contains, bot_id, instruction_template,
                               cooldown_seconds, enabled, last_fired_at, consecutive_failures, disabled_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, NULL, ?, ?)`,
      )
      .run(t.id, t.name, t.source, t.eventName, t.watchBotId, t.contains, t.botId, t.instructionTemplate, t.cooldownSeconds, t.createdAt, t.updatedAt);
  }

  getTrigger(id: string): TriggerRecord | undefined {
    const row = this.db.prepare("SELECT * FROM triggers WHERE id = ?").get(id);
    return row ? toTrigger(row) : undefined;
  }

  listTriggers(): TriggerRecord[] {
    return this.db.prepare("SELECT * FROM triggers ORDER BY created_at, rowid").all().map(toTrigger);
  }

  countTriggers(): number {
    return Number(this.db.prepare("SELECT COUNT(*) AS n FROM triggers").get()?.["n"] ?? 0);
  }

  updateTrigger(id: string, p: TriggerPatch, now: string): void {
    const c: Record<string, Value> = {};
    if (p.name !== undefined) c["name"] = p.name;
    if (p.source !== undefined) c["source"] = p.source;
    if (p.eventName !== undefined) c["event_name"] = p.eventName;
    if (p.watchBotId !== undefined) c["watch_bot_id"] = p.watchBotId;
    if (p.contains !== undefined) c["contains"] = p.contains;
    if (p.botId !== undefined) c["bot_id"] = p.botId;
    if (p.instructionTemplate !== undefined) c["instruction_template"] = p.instructionTemplate;
    if (p.cooldownSeconds !== undefined) c["cooldown_seconds"] = p.cooldownSeconds;
    if (p.enabled !== undefined) c["enabled"] = p.enabled ? 1 : 0;
    if (p.lastFiredAt !== undefined) c["last_fired_at"] = p.lastFiredAt;
    if (p.consecutiveFailures !== undefined) c["consecutive_failures"] = p.consecutiveFailures;
    if (p.disabledReason !== undefined) c["disabled_reason"] = p.disabledReason;
    this.update("triggers", id, c, now);
  }

  deleteTrigger(id: string): void {
    this.db.prepare("DELETE FROM triggers WHERE id = ?").run(id);
  }

  // ---- the run log ----
  insertRun(r: {
    nowMs: number;
    source: RunRecord["source"];
    sourceId: string | null;
    sourceName: string;
    status: RunRecord["status"];
    reason?: string | null;
    taskId?: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO automation_runs (created_at, created_ms, day, source, source_id, source_name, status, reason, task_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(new Date(r.nowMs).toISOString(), r.nowMs, localDay(r.nowMs), r.source, r.sourceId, r.sourceName, r.status, r.reason ?? null, r.taskId ?? null);
  }

  listRuns(limit: number): RunRecord[] {
    return this.db
      .prepare("SELECT * FROM automation_runs ORDER BY id DESC LIMIT ?")
      .all(limit)
      .map((r) => ({
        id: Number(r["id"]),
        createdAt: String(r["created_at"]),
        source: String(r["source"]) as RunRecord["source"],
        sourceId: str(r["source_id"]),
        sourceName: String(r["source_name"]),
        status: String(r["status"]) as RunRecord["status"],
        reason: str(r["reason"]),
        taskId: str(r["task_id"]),
      }));
  }

  /** Automatic runs that really started on a local day (for the daily limits). */
  countStarted(day: string, sourceId?: string): number {
    const row =
      sourceId === undefined
        ? this.db.prepare("SELECT COUNT(*) AS n FROM automation_runs WHERE day = ? AND status = 'started'").get(day)
        : this.db.prepare("SELECT COUNT(*) AS n FROM automation_runs WHERE day = ? AND status = 'started' AND source_id = ?").get(day, sourceId);
    return Number(row?.["n"] ?? 0);
  }

  // ---- settings ----
  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM automation_settings WHERE key = ?").get(key);
    return row ? String(row["value"]) : null;
  }

  setSetting(key: string, value: string, now: string): void {
    this.db
      .prepare(
        `INSERT INTO automation_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, now);
  }

  deleteSetting(key: string): void {
    this.db.prepare("DELETE FROM automation_settings WHERE key = ?").run(key);
  }
}
