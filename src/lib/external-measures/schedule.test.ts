import { describe, it, expect, vi, afterEach } from "vitest";

import {
  STANDARD_PULL_DAY,
  effectivePullDay,
  isDueToday,
  isPullHour,
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
  connector: "google_sheet",
  kind: "weekly",
  recipe: { file_id: "F", tab: "T", key_column: "Week Ending", value_column: "V" },
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
  // Sunday at 11 PM Eastern since 2026-10-06 (Jason); it was Saturday.
  it("defaults to Sunday when the mapping says nothing", () => {
    expect(effectivePullDay(weekKeyed)).toBe(STANDARD_PULL_DAY);
    expect(STANDARD_PULL_DAY).toBe("sun");
  });

  it("maps weekday numbers the way todayInTimezone reports them", () => {
    expect(weekdayKey(0)).toBe("sun");
    expect(weekdayKey(6)).toBe("sat");
  });

  it("runs a default mapping on Sunday and no other day", () => {
    onDay("2026-09-20"); // Sun
    expect(isDueToday(weekKeyed)).toBe(true);
    vi.useRealTimers();

    for (const day of ["2026-09-19", "2026-09-21", "2026-09-24"]) {
      onDay(day);
      expect(isDueToday(weekKeyed), `on ${day}`).toBe(false);
      vi.useRealTimers();
    }
  });

  it("runs an overridden mapping on ITS day and not on Sunday", () => {
    const monday: ExternalMapping = { ...weekKeyed, pull_day: "mon" };
    onDay("2026-09-20"); // Sun
    expect(isDueToday(monday)).toBe(false);
    vi.useRealTimers();
    onDay("2026-09-21"); // Mon
    expect(isDueToday(monday)).toBe(true);
  });

  it("knows the standard day for mappings that will not parse", () => {
    onDay("2026-09-20");
    expect(isStandardPullDayToday()).toBe(true);
    vi.useRealTimers();
    onDay("2026-09-21");
    expect(isStandardPullDayToday()).toBe(false);
  });
});

// One Eastern clock for the whole fleet: at 11 PM Eastern on a Sunday
// in daylight time it is already Monday in Halifax, and deciding the
// day per company would skip it.
describe("Sunday 11 PM Eastern", () => {
  function at(iso: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  }

  it("is the pull hour at 03:00 UTC under daylight time, not 04:00", () => {
    expect(isPullHour(new Date("2026-10-05T03:00:00Z"))).toBe(true); // Sun 11 PM EDT
    expect(isPullHour(new Date("2026-10-05T03:59:00Z"))).toBe(true);
    expect(isPullHour(new Date("2026-10-05T04:00:00Z"))).toBe(false); // midnight EDT
  });

  it("is the pull hour at 04:00 UTC under standard time, not 03:00", () => {
    expect(isPullHour(new Date("2026-12-07T04:00:00Z"))).toBe(true); // Sun 11 PM EST
    expect(isPullHour(new Date("2026-12-07T03:00:00Z"))).toBe(false); // 10 PM EST
  });

  it("calls it Sunday for every company, Halifax included", () => {
    at("2026-10-05T03:30:00Z"); // Sun 11:30 PM in New York, Mon 00:30 in Halifax
    expect(isStandardPullDayToday()).toBe(true);
    expect(isDueToday(weekKeyed)).toBe(true);
  });

  it("pulls the same finished week in every company's timezone", () => {
    at("2026-10-05T03:30:00Z");
    for (const tz of ["America/Anchorage", "America/Denver", "America/New_York", "America/Halifax"]) {
      expect(targetWeekEnding(tz), tz).toBe("2026-10-02");
    }
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
