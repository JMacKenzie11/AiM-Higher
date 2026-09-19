import { describe, it, expect } from "vitest";

import {
  targetInForce,
  groupTargetHistory,
  targetChangesWithin,
  type TargetHistoryRow,
} from "./target-history";

// The promise this file exists to keep: editing a target changes what
// happens next, and nothing that already happened.

function row(over: Partial<TargetHistoryRow>): TargetHistoryRow {
  return {
    measure_id: "m1",
    target: "60",
    value_type: "number",
    target_direction: "higher_is_better",
    effective_from: "2026-01-02",
    ...over,
  };
}

describe("targetInForce", () => {
  it("judges each week against the target that was in force then", () => {
    // The worked example from the scope. A target lowered from 60 to
    // 55, taking effect the week ending 18 September. Before this
    // existed, all four weeks read against 55 and three misses became
    // hits with no new data behind any of them.
    const history = [
      row({ target: "60", effective_from: "2026-04-24" }),
      row({ target: "55", effective_from: "2026-09-18" }),
    ];
    expect(targetInForce(history, "2026-08-28")?.target).toBe("60");
    expect(targetInForce(history, "2026-09-04")?.target).toBe("60");
    expect(targetInForce(history, "2026-09-11")?.target).toBe("60");
    expect(targetInForce(history, "2026-09-18")?.target).toBe("55");
  });

  it("applies a change to the week in progress, not the week after", () => {
    // effective_from and week_ending are both Fridays and the
    // comparison is inclusive, which is what makes a target set on
    // Wednesday govern the Friday everybody is looking at while they
    // type it. An exclusive comparison would be off by a week and
    // would look correct in every test that did not sit on the
    // boundary.
    const history = [row({ target: "70", effective_from: "2026-09-18" })];
    expect(targetInForce(history, "2026-09-18")?.target).toBe("70");
    expect(targetInForce(history, "2026-09-11")).toBeNull();
  });

  it("is null for a week before any target existed", () => {
    const history = [row({ target: "60", effective_from: "2026-09-18" })];
    expect(targetInForce(history, "2026-04-24")).toBeNull();
  });

  it("is null when there is no history at all", () => {
    expect(targetInForce([], "2026-09-18")).toBeNull();
  });

  it("stops judging once a target is cleared", () => {
    // The reason a null target is a ROW rather than a missing row.
    // Without the clearing recorded, the lookup keeps finding 60 and
    // keeps calling weeks missed against a number nobody wants.
    const history = [
      row({ target: "60", effective_from: "2026-04-24" }),
      row({ target: null, effective_from: "2026-09-18" }),
    ];
    expect(targetInForce(history, "2026-09-11")?.target).toBe("60");
    expect(targetInForce(history, "2026-09-18")).toBeNull();
  });

  it("treats a blank target as cleared", () => {
    const history = [
      row({ target: "60", effective_from: "2026-04-24" }),
      row({ target: "   ", effective_from: "2026-09-18" }),
    ];
    expect(targetInForce(history, "2026-09-18")).toBeNull();
  });

  it("carries the value type and direction of that week's target", () => {
    // A target moving from '30%' to '0.30' changes its type as well as
    // its text. Judging August against September's interpretation is
    // the same bug as judging it against September's number.
    const history = [
      row({
        target: "30%",
        value_type: "percent",
        target_direction: "higher_is_better",
        effective_from: "2026-04-24",
      }),
      row({
        target: "2",
        value_type: "number",
        target_direction: "lower_is_better",
        effective_from: "2026-09-18",
      }),
    ];
    expect(targetInForce(history, "2026-08-28")).toEqual({
      target: "30%",
      valueType: "percent",
      targetDirection: "higher_is_better",
    });
    expect(targetInForce(history, "2026-09-18")).toEqual({
      target: "2",
      valueType: "number",
      targetDirection: "lower_is_better",
    });
  });

  it("does not depend on the rows arriving in order", () => {
    // Nothing guarantees the order a query returns, and a scan that
    // took the last matching row would pass every test above while
    // being wrong the first time a query changed its ORDER BY.
    const ordered = [
      row({ target: "60", effective_from: "2026-04-24" }),
      row({ target: "55", effective_from: "2026-09-18" }),
    ];
    const shuffled = [ordered[1], ordered[0]];
    expect(targetInForce(shuffled, "2026-09-18")?.target).toBe("55");
    expect(targetInForce(shuffled, "2026-09-11")?.target).toBe("60");
  });
});

describe("groupTargetHistory", () => {
  it("splits rows by measure and keeps every one", () => {
    const rows = [
      row({ measure_id: "a", effective_from: "2026-04-24" }),
      row({ measure_id: "b", effective_from: "2026-04-24" }),
      row({ measure_id: "a", effective_from: "2026-09-18", target: "55" }),
    ];
    const grouped = groupTargetHistory(rows);
    expect(grouped.get("a")).toHaveLength(2);
    expect(grouped.get("b")).toHaveLength(1);
    expect(grouped.get("c")).toBeUndefined();
  });

  it("feeds targetInForce without leaking one measure into another", () => {
    // The failure this guards: two measures' rows scanned together,
    // where the later effective_from belongs to the other measure.
    const rows = [
      row({ measure_id: "a", target: "60", effective_from: "2026-04-24" }),
      row({ measure_id: "b", target: "999", effective_from: "2026-09-18" }),
    ];
    const grouped = groupTargetHistory(rows);
    expect(targetInForce(grouped.get("a") ?? [], "2026-09-18")?.target).toBe("60");
  });
});

describe("targetChangesWithin", () => {
  const WEEKS = ["2026-08-28", "2026-09-04", "2026-09-11", "2026-09-18"];

  it("marks the week a change takes effect", () => {
    const history = [
      row({ target: "60", effective_from: "2026-04-24" }),
      row({ target: "55", effective_from: "2026-09-18" }),
    ];
    const marks = targetChangesWithin(history, WEEKS);
    expect(marks.get("2026-09-18")).toEqual({ from: "60", to: "55" });
    expect(marks.size).toBe(1);
  });

  it("does not mark a measure that has only ever had one target", () => {
    // Otherwise every row in the grid carries a line at its first
    // week, which says nothing and costs the marker its meaning.
    const history = [row({ target: "60", effective_from: "2026-04-24" })];
    expect(targetChangesWithin(history, WEEKS).size).toBe(0);
  });

  it("marks a clearing as a change", () => {
    const history = [
      row({ target: "60", effective_from: "2026-04-24" }),
      row({ target: null, effective_from: "2026-09-11" }),
    ];
    expect(targetChangesWithin(history, WEEKS).get("2026-09-11")).toEqual({
      from: "60",
      to: null,
    });
  });

  it("ignores a change that happened before the window", () => {
    const history = [
      row({ target: "80", effective_from: "2026-01-02" }),
      row({ target: "60", effective_from: "2026-02-06" }),
    ];
    expect(targetChangesWithin(history, WEEKS).size).toBe(0);
  });

  it("ignores a change dated after the last week shown", () => {
    const history = [
      row({ target: "60", effective_from: "2026-04-24" }),
      row({ target: "55", effective_from: "2026-12-25" }),
    ];
    expect(targetChangesWithin(history, WEEKS).size).toBe(0);
  });

  it("returns nothing for an empty window", () => {
    const history = [
      row({ target: "60", effective_from: "2026-04-24" }),
      row({ target: "55", effective_from: "2026-09-18" }),
    ];
    expect(targetChangesWithin(history, []).size).toBe(0);
  });
});
