import { describe, it, expect } from "vitest";
import { summarizePriorityHealth } from "./priority-health";

// Extracted from getDashboardData when /portfolio became the second
// caller. These tests pin the rule so the two surfaces cannot drift,
// which is the whole reason it moved out of the page loader.

const rows = (...statuses: string[]) => statuses.map((status) => ({ status }));

describe("summarizePriorityHealth", () => {
  it("counts on_track and complete as good", () => {
    const h = summarizePriorityHealth(rows("on_track", "complete"));
    expect(h).toEqual({ good: 2, total: 2, percent: 100 });
  });

  it("does not count at_risk or off_track", () => {
    const h = summarizePriorityHealth(
      rows("on_track", "at_risk", "off_track", "complete")
    );
    expect(h).toEqual({ good: 2, total: 4, percent: 50 });
  });

  it("returns null, not zero, for a quarter with no priorities", () => {
    // Null and zero are different answers. "Nothing planned yet" and
    // "nothing is on track" render differently on a portfolio card
    // and should — the same rule follow-through follows.
    expect(summarizePriorityHealth([])).toEqual({
      good: 0,
      total: 0,
      percent: null,
    });
  });

  it("returns zero, not null, when nothing is on track", () => {
    expect(summarizePriorityHealth(rows("off_track", "at_risk"))).toEqual({
      good: 0,
      total: 2,
      percent: 0,
    });
  });

  it("rounds to a whole percent", () => {
    const h = summarizePriorityHealth(
      rows("on_track", "off_track", "off_track")
    );
    expect(h.percent).toBe(33);
  });

  it("ignores any status it does not recognise", () => {
    // A status added to the enum later is not good until somebody
    // decides it is. Failing closed is the right default for a number
    // a portfolio owner reads as health.
    const h = summarizePriorityHealth(rows("on_track", "some_new_status"));
    expect(h).toEqual({ good: 1, total: 2, percent: 50 });
  });
});
