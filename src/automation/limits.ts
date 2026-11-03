import { z } from "zod";

/**
 * Automation limits. Deliberately small: your free tiers allow only a few dozen requests a day,
 * and one automatic run can use up to 8 model calls (see the teamwork limits).
 */
export const DEFAULT_AUTOMATION_LIMITS = {
  /** Shortest time allowed between two runs of an "every N minutes" schedule. */
  minIntervalMinutes: 15,
  /** Automatic runs per day, all schedules and triggers together. */
  maxRunsPerDay: 20,
  /** Automatic runs per day for any single schedule or trigger. */
  maxRunsPerSourcePerDay: 10,
  /** After this many failed runs in a row, the schedule or trigger switches itself off. */
  maxConsecutiveFailures: 3,
  /** How many times a trigger can start a task that starts another trigger (stops endless chains). */
  maxHops: 2,
  /** Shortest cooldown allowed on a trigger, in seconds. */
  minCooldownSeconds: 30,
} as const;

export type AutomationLimits = { [K in keyof typeof DEFAULT_AUTOMATION_LIMITS]: number };

/** The floor on the interval cannot be set below 5 minutes, whatever is typed. */
export const automationLimitsUpdateSchema = z
  .strictObject({
    minIntervalMinutes: z.number().int().min(5).max(1440),
    maxRunsPerDay: z.number().int().min(1).max(200),
    maxRunsPerSourcePerDay: z.number().int().min(1).max(100),
    maxConsecutiveFailures: z.number().int().min(1).max(10),
    maxHops: z.number().int().min(1).max(4),
    minCooldownSeconds: z.number().int().min(10).max(3600),
  })
  .partial();

export type AutomationLimitsUpdate = z.infer<typeof automationLimitsUpdateSchema>;

export function mergeAutomationLimits(overrides: AutomationLimitsUpdate | null): AutomationLimits {
  return { ...DEFAULT_AUTOMATION_LIMITS, ...(overrides ?? {}) } as AutomationLimits;
}

export const MAX_SCHEDULES = 20;
export const MAX_TRIGGERS = 20;
/** Longest text an event or a task result may pass to a trigger. */
export const EVENT_TEXT_MAX = 2000;
export const TEMPLATE_MAX = 1500;
/** A run that is late by more than this (the app was off, or the PC slept) is skipped, not replayed. */
export const LATE_GRACE_MS = 5 * 60_000;
