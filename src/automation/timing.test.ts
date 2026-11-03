import { describe, expect, it } from "vitest";
import { ALL_DAYS, TIME_OF_DAY, formatDays, nextRunAfter, parseDays, type ScheduleTiming } from "./timing.js";

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();
const daily = (timeOfDay: string, days = ALL_DAYS): ScheduleTiming => ({ kind: "daily", intervalMinutes: null, timeOfDay, days, runAt: null });

describe("every N minutes", () => {
  const every = (n: number): ScheduleTiming => ({ kind: "interval", intervalMinutes: n, timeOfDay: null, days: ALL_DAYS, runAt: null });

  it("counts from the moment it is asked, so a late run never causes a burst", () => {
    expect(nextRunAfter(every(30), at(2026, 6, 15, 12, 0))).toBe(at(2026, 6, 15, 12, 30));
    expect(nextRunAfter(every(30), at(2026, 6, 15, 12, 17))).toBe(at(2026, 6, 15, 12, 47)); // 17 minutes late: still a full interval from now
    expect(nextRunAfter(every(1440), at(2026, 6, 15, 23, 0))).toBe(at(2026, 6, 16, 23, 0));
  });
  it("has no next run without an interval", () => {
    expect(nextRunAfter({ ...every(30), intervalMinutes: null }, 0)).toBeNull();
  });
});

describe("daily at a time of day (local time)", () => {
  it("picks today if the time has not passed yet, otherwise tomorrow", () => {
    expect(nextRunAfter(daily("09:30"), at(2026, 6, 15, 8, 0))).toBe(at(2026, 6, 15, 9, 30));
    expect(nextRunAfter(daily("09:30"), at(2026, 6, 15, 9, 30))).toBe(at(2026, 6, 16, 9, 30)); // strictly after
    expect(nextRunAfter(daily("09:30"), at(2026, 6, 15, 23, 59))).toBe(at(2026, 6, 16, 9, 30));
  });

  it("respects the chosen days (0 = Sunday)", () => {
    // 15 June 2026 is a Monday. Wednesdays and Fridays only:
    const wedFri = daily("07:00", [3, 5]);
    expect(nextRunAfter(wedFri, at(2026, 6, 15, 12, 0))).toBe(at(2026, 6, 17, 7, 0)); // Wednesday
    expect(nextRunAfter(wedFri, at(2026, 6, 17, 8, 0))).toBe(at(2026, 6, 19, 7, 0)); // Friday
    expect(nextRunAfter(wedFri, at(2026, 6, 19, 8, 0))).toBe(at(2026, 6, 24, 7, 0)); // next Wednesday
    expect(nextRunAfter(daily("07:00", [1]), at(2026, 6, 15, 7, 0))).toBe(at(2026, 6, 22, 7, 0)); // same weekday: a week later
  });

  it("works across the end of a month and a year", () => {
    expect(nextRunAfter(daily("06:00"), at(2026, 6, 30, 12, 0))).toBe(at(2026, 7, 1, 6, 0));
    expect(nextRunAfter(daily("06:00"), at(2026, 12, 31, 12, 0))).toBe(at(2027, 1, 1, 6, 0));
  });

  it("has no next run for a bad time or no days", () => {
    expect(nextRunAfter(daily("25:00"), 0)).toBeNull();
    expect(nextRunAfter(daily("9:30"), 0)).toBeNull();
    expect(nextRunAfter(daily("09:30", []), 0)).toBeNull();
    expect(nextRunAfter({ ...daily("09:30"), timeOfDay: null }, 0)).toBeNull();
  });
});

describe("once", () => {
  const once = (runAt: number | null): ScheduleTiming => ({ kind: "once", intervalMinutes: null, timeOfDay: null, days: ALL_DAYS, runAt });
  it("runs at the set time, and never again once it has passed", () => {
    expect(nextRunAfter(once(at(2026, 6, 20, 10, 0)), at(2026, 6, 15))).toBe(at(2026, 6, 20, 10, 0));
    expect(nextRunAfter(once(at(2026, 6, 20, 10, 0)), at(2026, 6, 20, 10, 0))).toBeNull();
    expect(nextRunAfter(once(at(2026, 6, 20, 10, 0)), at(2026, 6, 21))).toBeNull();
    expect(nextRunAfter(once(null), 0)).toBeNull();
  });
});

describe("helpers", () => {
  it("checks times of day", () => {
    for (const ok of ["00:00", "09:05", "12:30", "23:59"]) expect(TIME_OF_DAY.test(ok), ok).toBe(true);
    for (const bad of ["24:00", "9:30", "09:60", "0930", "09:5", "", "ab:cd"]) expect(TIME_OF_DAY.test(bad), bad).toBe(false);
  });
  it("stores days as a sorted, de-duplicated list and ignores junk", () => {
    expect(formatDays([5, 1, 1, 3])).toBe("1,3,5");
    expect(parseDays("1,3,5")).toEqual([1, 3, 5]);
    expect(parseDays("0,9,x,-1,2")).toEqual([0, 2]);
    expect(parseDays("")).toEqual([]);
  });
});
