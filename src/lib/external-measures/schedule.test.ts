import { describe, it, expect, vi, afterEach } from "vitest";

import {
  STANDARD_PULL_DAY,
  effectivePullDay,
  isDueToday,
  isStandardPullDayToday,
  isTransient,
  targetWeekEnding,
  weekdayKey,
} from "./schedule";
import type { ExternalMapping } from "./mapping";

const TZ = "America/Anchorage";

// The clock is the input to everything here, so it is set rather
// than waited for. Anchorage is UTC-8, so 18:00 UTC is the same
// calendar day locally and these dates mean what they say.
function onDay(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${iso}T18:00:00Z`));
}

afterEach(() => {
  vi.useRealTimers();
});

const weekKeyed: ExternalMapping = {
  kind: "week_keyed",
  file_id: "F",
  tab: "T",
  key_column: "Week Ending",
  value_column: "V",
};

describe("targetWeekEnding", () => {
  it("is the most recently COMPLETED week, not the one in progress", () => {
    // The distinction the scheduler turns on. thisFriday() on a
    // Saturday is six days ahead: the week that has just begun,
    // whose numbers do not exist yet. A scheduler reading that week
    // finds an empty row every single time.
    onDay("2026-09-19"); // Saturday
    expect(targetWeekEnding(TZ)).toBe("2026-09-18");
  });

  it("gives the SAME week every day from Saturday to the next Friday", () => {
    // This is what makes pull_day work at all: a Monday override has
    // to fill the same week the Saturday pass would have filled, not
    // a week further back.
    const week = "2026-09-18";
    for (const day of [
      "2026-09-19", // Sat
      "2026-09-20", // Sun
      "2026-09-21", // Mon
      "2026-09-22", // Tue
      "2026-09-24", // Thu
      "2026-09-25", // Fri
    ]) {
      onDay(day);
      expect(targetWeekEnding(TZ), `on ${day}`).toBe(week);
      vi.useRealTimers();
    }
  });

  it("rolls to the next week once that Friday has closed", () => {
    onDay("2026-09-26"); // the Saturday after
    expect(targetWeekEnding(TZ)).toBe("2026-09-25");
  });
});

describe("pull day routing", () => {
  it("defaults to Saturday when the mapping says nothing", () => {
    expect(effectivePullDay(weekKeyed)).toBe(STANDARD_PULL_DAY);
    expect(STANDARD_PULL_DAY).toBe("sat");
  });

  it("maps weekday numbers the way todayInTimezone reports them", () => {
    expect(weekdayKey(0)).toBe("sun");
    expect(weekdayKey(6)).toBe("sat");
  });

  it("runs a default mapping on Saturday and no other day", () => {
    onDay("2026-09-19"); // Sat
    expect(isDueToday(weekKeyed, TZ)).toBe(true);
    vi.useRealTimers();

    for (const day of ["2026-09-20", "2026-09-21", "2026-09-24"]) {
      onDay(day);
      expect(isDueToday(weekKeyed, TZ), `on ${day}`).toBe(false);
      vi.useRealTimers();
    }
  });

  it("runs an overridden mapping on ITS day and not on Saturday", () => {
    const monday: ExternalMapping = { ...weekKeyed, pull_day: "mon" };
    onDay("2026-09-19"); // Sat
    expect(isDueToday(monday, TZ)).toBe(false);
    vi.useRealTimers();
    onDay("2026-09-21"); // Mon
    expect(isDueToday(monday, TZ)).toBe(true);
  });

  it("knows the standard day for mappings that will not parse", () => {
    onDay("2026-09-19");
    expect(isStandardPullDayToday(TZ)).toBe(true);
    vi.useRealTimers();
    onDay("2026-09-21");
    expect(isStandardPullDayToday(TZ)).toBe(false);
  });
});

describe("isTransient", () => {
  it("retries the failures where a second attempt can differ", () => {
    expect(isTransient("socket hang up")).toBe(true);
    expect(isTransient("connect ETIMEDOUT 142.250.0.1:443")).toBe(true);
    expect(isTransient("Quota exceeded for quota metric")).toBe(true);
    expect(isTransient("The service is currently unavailable. (503)")).toBe(true);
    expect(isTransient("Internal error encountered.")).toBe(true);
  });

  it("does NOT retry a failure that will answer identically", () => {
    // Reading a misspelled tab a second time costs somebody else's
    // API a request and produces the same answer a second later.
    expect(isTransient("Unable to parse range: 'Dashbord Data'")).toBe(false);
    expect(isTransient("The caller does not have permission")).toBe(false);
    expect(
      isTransient(
        "Google Sheets API has not been used in project 733280735342 before or it is disabled"
      )
    ).toBe(false);
    expect(isTransient("Requested entity was not found.")).toBe(false);
  });

  it("does not retry something it has never seen", () => {
    // The safe direction. An unknown failure retried in a loop costs
    // a rate limit for every company on the instance; not retried, it
    // costs one week of one measure and says so on the receipt.
    expect(isTransient("something nobody has written a matcher for")).toBe(
      false
    );
    expect(isTransient("")).toBe(false);
  });
});
