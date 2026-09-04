import { describe, it, expect } from "vitest";
import {
  expectedFridaysIn,
  freshnessWindowDays,
  isDueForWeek,
  lastExpectedFriday,
} from "./frequency";

// Weekly was assumed in the cron, the board, the scorer's cadence
// term and the tree's recent trail. A monthly measure looked
// permanently delinquent to all four. These pin the shared rule so
// they cannot drift apart again.

const ANCHOR = "2026-09-04"; // a Friday

describe("isDueForWeek", () => {
  it("says every week for a weekly measure", () => {
    for (const f of ["2026-09-04", "2026-09-11", "2026-09-18"]) {
      expect(
        isDueForWeek({ frequency: "weekly", weekEndingFriday: f, anchorFriday: ANCHOR })
      ).toBe(true);
    }
  });

  it("says every other week for a fortnightly measure", () => {
    const due = (f: string) =>
      isDueForWeek({ frequency: "biweekly", weekEndingFriday: f, anchorFriday: ANCHOR });
    expect(due("2026-09-04")).toBe(true);
    expect(due("2026-09-11")).toBe(false);
    expect(due("2026-09-18")).toBe(true);
    expect(due("2026-09-25")).toBe(false);
  });

  it("says roughly every fourth week for a monthly measure", () => {
    const due = (f: string) =>
      isDueForWeek({ frequency: "monthly", weekEndingFriday: f, anchorFriday: ANCHOR });
    expect(due("2026-09-04")).toBe(true);
    expect(due("2026-09-11")).toBe(false);
    expect(due("2026-09-25")).toBe(false);
    expect(due("2026-10-02")).toBe(true);
  });

  it("is anchored to the measure, not the calendar", () => {
    // A month with five Fridays must not shift a measure's rhythm.
    // Two measures created a week apart keep their own cadence.
    const a = isDueForWeek({
      frequency: "biweekly",
      weekEndingFriday: "2026-09-11",
      anchorFriday: "2026-09-11",
    });
    const b = isDueForWeek({
      frequency: "biweekly",
      weekEndingFriday: "2026-09-11",
      anchorFriday: "2026-09-04",
    });
    expect(a).toBe(true);
    expect(b).toBe(false);
  });

  it("expects nothing before the measure existed", () => {
    expect(
      isDueForWeek({
        frequency: "monthly",
        weekEndingFriday: "2026-08-28",
        anchorFriday: ANCHOR,
      })
    ).toBe(false);
  });
});

describe("freshnessWindowDays", () => {
  it("widens the window with the frequency", () => {
    // The scorer used to ask "logged in the last 7 days" of
    // everything, which scored every monthly measure at zero.
    expect(freshnessWindowDays("weekly")).toBe(7);
    expect(freshnessWindowDays("biweekly")).toBe(14);
    expect(freshnessWindowDays("monthly")).toBe(31);
  });
});

describe("expectedFridaysIn", () => {
  it("returns only the Fridays a measure owes a value for", () => {
    const fridays = ["2026-09-04", "2026-09-11", "2026-09-18", "2026-09-25"];
    const expected = expectedFridaysIn({
      frequency: "biweekly",
      fridays,
      anchorFriday: ANCHOR,
    });

    expect(Array.from(expected)).toEqual(["2026-09-04", "2026-09-18"]);
  });

  it("returns every Friday for a weekly measure", () => {
    const fridays = ["2026-09-04", "2026-09-11"];
    expect(
      expectedFridaysIn({ frequency: "weekly", fridays, anchorFriday: ANCHOR }).size
    ).toBe(2);
  });
});

describe("lastExpectedFriday", () => {
  it("is this week for a weekly measure", () => {
    expect(
      lastExpectedFriday({
        frequency: "weekly",
        weekEndingFriday: "2026-09-11",
        anchorFriday: ANCHOR,
      })
    ).toBe("2026-09-11");
  });

  it("walks back to the last period that actually closed", () => {
    // The cron asks "did they log the period that just closed", not
    // "did they log this week". On an off week for a fortnightly
    // measure, the answer is about the previous Friday.
    expect(
      lastExpectedFriday({
        frequency: "biweekly",
        weekEndingFriday: "2026-09-11",
        anchorFriday: ANCHOR,
      })
    ).toBe("2026-09-04");
  });

  it("returns null before the measure's first expected week", () => {
    expect(
      lastExpectedFriday({
        frequency: "monthly",
        weekEndingFriday: "2026-08-21",
        anchorFriday: ANCHOR,
      })
    ).toBeNull();
  });
});
