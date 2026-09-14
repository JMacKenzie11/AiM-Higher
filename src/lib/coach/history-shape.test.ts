import { describe, it, expect } from "vitest";
import {
  completionTiming,
  quarterOf,
  summarizeQuarter,
  compareToOwnBaseline,
  themesFrom,
  type QuarterWindow,
  type TimedCommitment,
} from "./history-shape";

const row = (p: Partial<TimedCommitment>): TimedCommitment => ({
  status: "kept_on_time",
  due_date: "2026-03-11",
  week_ending: "2026-03-13",
  completed_at: null,
  ...p,
});

describe("completionTiming", () => {
  it("reads before, on, and after the due date", () => {
    expect(completionTiming(row({ completed_at: "2026-03-09T10:00:00Z" }))).toBe("early");
    expect(completionTiming(row({ completed_at: "2026-03-11T10:00:00Z" }))).toBe("on_time");
  });

  it("separates slipping a day from slipping the week", () => {
    // The distinction the tool exists for. Both are "late" against
    // the due date; only one missed the rhythm.
    expect(completionTiming(row({ completed_at: "2026-03-12T10:00:00Z" }))).toBe("late_in_week");
    expect(completionTiming(row({ completed_at: "2026-03-16T10:00:00Z" }))).toBe("late");
  });

  it("is unknown rather than a guess when a date is missing", () => {
    expect(completionTiming(row({ completed_at: null }))).toBe("unknown");
    expect(
      completionTiming(row({ due_date: null, completed_at: "2026-03-12T10:00:00Z" }))
    ).toBe("unknown");
  });

  it("does not read timing off the status", () => {
    // kept_late is decided against the due date at resolution time.
    // A row can be kept_late and still have landed inside its week,
    // and this reports what the dates say.
    expect(
      completionTiming(row({ status: "kept_late", completed_at: "2026-03-12T09:00:00Z" }))
    ).toBe("late_in_week");
  });
});

const QUARTERS: QuarterWindow[] = [
  { id: "q2", label: "Q2 2026", start_date: "2026-04-01", end_date: "2026-06-30" },
  { id: "q1", label: "Q1 2026", start_date: "2026-01-01", end_date: "2026-03-31" },
];

describe("quarterOf", () => {
  it("places a commitment by its WEEK, not its due date", () => {
    // A rescheduled commitment must not migrate between quarters and
    // change a closed quarter's rate after the fact.
    expect(quarterOf({ week_ending: "2026-03-13" }, QUARTERS)?.label).toBe("Q1 2026");
    expect(quarterOf({ week_ending: "2026-04-03" }, QUARTERS)?.label).toBe("Q2 2026");
  });

  it("returns null outside every quarter, and for a null week", () => {
    expect(quarterOf({ week_ending: "2025-12-31" }, QUARTERS)).toBeNull();
    expect(quarterOf({ week_ending: null }, QUARTERS)).toBeNull();
  });
});

describe("summarizeQuarter", () => {
  it("rates kept-either-way over all resolved", () => {
    const q = summarizeQuarter("Q1", [
      row({ status: "kept_on_time", completed_at: "2026-03-11T00:00:00Z" }),
      row({ status: "kept_late", completed_at: "2026-03-16T00:00:00Z" }),
      row({ status: "missed", completed_at: null }),
      row({ status: "open", completed_at: null }),
    ]);
    expect(q.kept_on_time).toBe(1);
    expect(q.kept_late).toBe(1);
    expect(q.missed).toBe(1);
    // Open rows are not resolved and are not in the denominator.
    expect(q.follow_through_pct).toBe(67);
  });

  it("returns null, not zero, for a quarter that resolved nothing", () => {
    // Zero reads as "failed everything". Null reads as "nothing to
    // judge", which is what an empty quarter is.
    const q = summarizeQuarter("Q1", [row({ status: "open", completed_at: null })]);
    expect(q.follow_through_pct).toBeNull();
  });

  it("counts timing only for commitments that were kept", () => {
    const q = summarizeQuarter("Q1", [
      row({ status: "kept_on_time", completed_at: "2026-03-09T00:00:00Z" }),
      row({ status: "missed", completed_at: null }),
    ]);
    expect(q.timing.early).toBe(1);
    expect(q.timing.unknown).toBe(0);
  });
});

describe("compareToOwnBaseline", () => {
  const q = (label: string, pct: number | null) =>
    ({ ...summarizeQuarter(label, []), follow_through_pct: pct });

  it("compares the current quarter to the person's own prior average", () => {
    const cmp = compareToOwnBaseline(q("Q2", 60), [q("Q1", 80), q("Q4", 90)]);
    expect(cmp).toEqual({
      current_pct: 60,
      baseline_pct: 85,
      baseline_quarters: 2,
      delta: -25,
    });
  });

  it("REFUSES to compare on a thin record", () => {
    // The provenance rule needs a machine-readable "not enough to say"
    // rather than a language model's judgement about two data points.
    expect(compareToOwnBaseline(q("Q2", 60), [q("Q1", 80)])).toBeNull();
    expect(compareToOwnBaseline(q("Q2", 60), [])).toBeNull();
  });

  it("refuses when the current quarter has resolved nothing", () => {
    expect(compareToOwnBaseline(q("Q2", null), [q("Q1", 80), q("Q4", 90)])).toBeNull();
  });

  it("ignores prior quarters that carry no rate", () => {
    const cmp = compareToOwnBaseline(q("Q2", 50), [q("Q1", 80), q("Q4", null), q("Q3", 60)]);
    expect(cmp?.baseline_quarters).toBe(2);
    expect(cmp?.baseline_pct).toBe(70);
  });
});

describe("themesFrom", () => {
  it("surfaces words that recur across descriptions", () => {
    expect(
      themesFrom([
        "Finish the hiring plan for ops",
        "Review hiring pipeline with Dana",
        "Draft onboarding checklist",
        "Ship onboarding revamp",
      ])
    ).toEqual(["hiring", "onboarding"]);
  });

  it("ignores one-offs and filler", () => {
    // A theme is a repetition. One mention of anything is a
    // commitment, not a pattern.
    expect(themesFrom(["Call the vendor", "Write the memo"])).toEqual([]);
  });

  it("counts a word once per commitment, not once per mention", () => {
    expect(themesFrom(["hiring hiring hiring hiring"])).toEqual([]);
  });
});
