export type ScheduleKind = "interval" | "daily" | "once";

export interface ScheduleTiming {
  kind: ScheduleKind;
  intervalMinutes: number | null;
  /** "HH:MM", local time. */
  timeOfDay: string | null;
  /** 0 = Sunday ... 6 = Saturday. */
  days: number[];
  /** Milliseconds since 1970, for "once". */
  runAt: number | null;
}

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The next time a schedule should run, strictly after `afterMs`. Returns null when there is none
 * (a one-off time that has passed, or a daily schedule with no valid day).
 * "Every N minutes" counts from the moment of the last run, so a late run never causes a burst.
 */
export function nextRunAfter(timing: ScheduleTiming, afterMs: number): number | null {
  if (timing.kind === "interval") {
    return timing.intervalMinutes ? afterMs + timing.intervalMinutes * 60_000 : null;
  }
  if (timing.kind === "once") {
    return timing.runAt !== null && timing.runAt > afterMs ? timing.runAt : null;
  }
  if (!timing.timeOfDay || !TIME_OF_DAY.test(timing.timeOfDay) || timing.days.length === 0) return null;
  const [hours, minutes] = timing.timeOfDay.split(":").map(Number) as [number, number];
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(afterMs);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hours, minutes, 0, 0);
    if (candidate.getTime() > afterMs && timing.days.includes(candidate.getDay())) return candidate.getTime();
  }
  return null;
}

export function parseDays(text: string): number[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "") // Number("") is 0, which would wrongly mean "Sunday"
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

export function formatDays(days: number[]): string {
  return [...new Set(days)].sort((a, b) => a - b).join(",");
}
