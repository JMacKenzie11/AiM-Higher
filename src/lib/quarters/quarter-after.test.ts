import { describe, it, expect } from "vitest";

import { quarterAfter, nextCalendarQuarter } from "./service";

// What the next quarter is offered as, once a company can move the
// end date of the one it is in.

describe("quarterAfter", () => {
  it("agrees with the calendar for a calendar-aligned quarter", () => {
    // The case that must not move. A company that never edits
    // anything sees exactly what it saw before: Q3 runs 1 Jul to 30
    // Sep, 92 days, and 92 days from 1 Oct is 31 Dec.
    const next = quarterAfter({
      label: "Q3 2026",
      startDate: "2026-07-01",
      endDate: "2026-09-30",
    });
    expect(next).toEqual({
      label: "Q4 2026",
      startDate: "2026-10-01",
      endDate: "2026-12-31",
    });
    expect(next.startDate).toBe(
      nextCalendarQuarter({
        label: "Q3 2026",
        startDate: "2026-07-01",
        endDate: "2026-09-30",
      }).startDate
    );
  });

  it("starts the day after an end date that was moved OUT", () => {
    // The reason this function exists. nextCalendarQuarter would snap
    // back to 1 October and overlap the fortnight the company just
    // added, quietly undoing the edit they had made on purpose.
    const next = quarterAfter({
      label: "Q3 2026",
      startDate: "2026-07-01",
      endDate: "2026-10-15",
    });
    expect(next.startDate).toBe("2026-10-16");
    expect(
      nextCalendarQuarter({
        label: "Q3 2026",
        startDate: "2026-07-01",
        endDate: "2026-10-15",
      }).startDate,
      "the old behaviour, kept here to show what changed"
    ).toBe("2026-10-01");
  });

  it("starts the day after an end date that was pulled IN", () => {
    const next = quarterAfter({
      label: "Q3 2026",
      startDate: "2026-07-01",
      endDate: "2026-09-04",
    });
    expect(next.startDate).toBe("2026-09-05");
  });

  it("keeps the length the company chose", () => {
    // A 14-week cycle stays a 14-week cycle rather than being
    // rounded back to a calendar quarter at the first roll.
    const next = quarterAfter({
      label: "Cycle 1",
      startDate: "2026-01-05",
      endDate: "2026-04-12", // 98 days inclusive
    });
    expect(next.startDate).toBe("2026-04-13");
    expect(next.endDate).toBe("2026-07-19");
    const days =
      (Date.parse(`${next.endDate}T00:00:00Z`) -
        Date.parse(`${next.startDate}T00:00:00Z`)) /
      86400000;
    expect(days).toBe(97);
  });

  it("names it for the calendar quarter its start falls in", () => {
    // Whatever the company's own boundaries, people call it by the
    // calendar quarter it begins in.
    expect(
      quarterAfter({
        label: "Anything",
        startDate: "2026-07-01",
        endDate: "2026-10-15",
      }).label
    ).toBe("Q4 2026");
  });

  it("handles a one-day quarter without inverting", () => {
    const next = quarterAfter({
      label: "Q1",
      startDate: "2026-03-02",
      endDate: "2026-03-02",
    });
    expect(next.startDate).toBe("2026-03-03");
    expect(next.endDate).toBe("2026-03-03");
  });

  it("stays on the calendar across a year boundary", () => {
    // THE CASE THAT BROKE THE FIRST VERSION. Q4 is 92 days and Q1 is
    // 90, so "the day after, for the same number of days" offered 1
    // January to 2 April and would have walked every calendar company
    // off the calendar, one roll at a time. A calendar-aligned
    // quarter is followed by the calendar quarter.
    const next = quarterAfter({
      label: "Q4 2026",
      startDate: "2026-10-01",
      endDate: "2026-12-31",
    });
    expect(next).toEqual({
      label: "Q1 2027",
      startDate: "2027-01-01",
      endDate: "2027-03-31",
    });
  });

  it("uses the calendar only when the quarter actually is one", () => {
    // Same start as Q3, end moved by a day. That is no longer a
    // calendar quarter, so the day-after rule takes over rather than
    // the dates being rounded back.
    expect(
      quarterAfter({
        label: "Q3 2026",
        startDate: "2026-07-01",
        endDate: "2026-09-29",
      }).startDate
    ).toBe("2026-09-30");
  });
});
