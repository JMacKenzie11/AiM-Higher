import { describe, it, expect } from "vitest";
import { summarizeFollowThrough, computeFollowThrough } from "./follow-through";

// Pins the single definition of Follow-Through Rate.
//
// Written after B&B Electric showed 100%, 62% and "13 for 13" for the
// same thing on the same day, because the rule lived in three places
// and had drifted apart.

const TODAY = "2026-09-04";

function row(status: string, due_date: string | null = null) {
  return { status, due_date };
}

describe("summarizeFollowThrough — what lands in the denominator", () => {
  it("counts on-time keeps in both numerator and denominator", () => {
    const s = summarizeFollowThrough([row("kept_on_time")], TODAY);
    expect(s).toMatchObject({ keptOnTime: 1, resolved: 1, rate: 100 });
  });

  it("counts a late keep against the rate", () => {
    // The work landed, so it is not a miss, but it was late and must
    // not flatter the number.
    const s = summarizeFollowThrough(
      [row("kept_on_time"), row("kept_late")],
      TODAY
    );
    expect(s).toMatchObject({ keptLate: 1, resolved: 2, rate: 50 });
  });

  it("counts a miss", () => {
    const s = summarizeFollowThrough(
      [row("kept_on_time"), row("missed")],
      TODAY
    );
    expect(s.rate).toBe(50);
  });
});

describe("summarizeFollowThrough — the overdue-open change", () => {
  it("counts an open commitment past its due date against the rate", () => {
    // The reported problem. Previously this row was invisible, so a
    // company could be weeks behind on everything and still show a
    // perfect rate.
    const s = summarizeFollowThrough(
      [row("kept_on_time"), row("open", "2026-08-28")],
      TODAY
    );
    expect(s).toMatchObject({ overdueOpen: 1, resolved: 2, rate: 50 });
  });

  it("ignores an open commitment that is not due yet", () => {
    const s = summarizeFollowThrough(
      [row("kept_on_time"), row("open", "2026-09-11")],
      TODAY
    );
    expect(s).toMatchObject({ overdueOpen: 0, resolved: 1, rate: 100 });
  });

  it("does not treat a commitment due today as late", () => {
    // Someone still has the rest of the day.
    const s = summarizeFollowThrough([row("open", TODAY)], TODAY);
    expect(s).toMatchObject({ overdueOpen: 0, resolved: 0, rate: null });
  });

  it("ignores an open commitment with no due date", () => {
    // Nothing to be late against.
    const s = summarizeFollowThrough([row("open", null)], TODAY);
    expect(s.rate).toBeNull();
  });
});

describe("summarizeFollowThrough — null versus zero", () => {
  it("returns null when there is nothing to judge", () => {
    // Null means "no data". Zero means "nothing landed on time".
    // Conflating them puts a red 0% on a company that has simply not
    // started yet.
    expect(summarizeFollowThrough([], TODAY).rate).toBeNull();
    expect(summarizeFollowThrough([row("open", "2026-12-01")], TODAY).rate).toBeNull();
  });

  it("returns zero when work was due and none of it landed on time", () => {
    const s = summarizeFollowThrough(
      [row("missed"), row("open", "2026-08-01")],
      TODAY
    );
    expect(s.rate).toBe(0);
  });
});

describe("computeFollowThrough", () => {
  it("is the rate from the summary", () => {
    const rows = [row("kept_on_time"), row("missed")];
    expect(computeFollowThrough(rows, TODAY)).toBe(
      summarizeFollowThrough(rows, TODAY).rate
    );
  });

  it("rounds to a whole percent", () => {
    const rows = [row("kept_on_time"), row("missed"), row("missed")];
    expect(computeFollowThrough(rows, TODAY)).toBe(33);
  });
});
