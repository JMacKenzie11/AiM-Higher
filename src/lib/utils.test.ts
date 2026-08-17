import { describe, it, expect } from "vitest";
import {
  bucketKeepRates,
  computeFollowThroughRate,
  computeRateFromCounts,
  summarizeKeepRate,
} from "./utils";

// Follow-Through math contracts pinned per the 2026-08-17 resolution
// refactor:
//   Numerator = kept_on_time only.
//   Denominator = kept_on_time + kept_late + missed.
//   Late keeps are "did the work" but NOT counted in the numerator —
//   the discipline signal we're measuring is "on time," not "at all."
//   Open, parked, and deleted rows are excluded by callers before
//   they reach these functions.

describe("computeRateFromCounts", () => {
  it("computes numerator ÷ denominator (kept_on_time only in the top)", () => {
    // 6 on-time + 2 late + 2 missed = 10 resolved. Rate = 6/10 = 60.
    expect(computeRateFromCounts(6, 2, 2)).toBe(60);
  });

  it("returns null when there are no resolved rows", () => {
    expect(computeRateFromCounts(0, 0, 0)).toBeNull();
  });

  it("counts late keeps in the denominator even with zero on-time", () => {
    // The person did the work every time but always late: rate = 0.
    // (Not the same as "no resolved rows" — the signal is present.)
    expect(computeRateFromCounts(0, 4, 0)).toBe(0);
  });

  it("still counts missed even with no keeps of either kind", () => {
    expect(computeRateFromCounts(0, 0, 3)).toBe(0);
  });
});

describe("summarizeKeepRate", () => {
  it("splits kept_on_time / kept_late / missed distinctly", () => {
    const s = summarizeKeepRate([
      "kept_on_time",
      "kept_on_time",
      "kept_late",
      "missed",
      "open", // ignored
    ]);
    expect(s.keptOnTime).toBe(2);
    expect(s.keptLate).toBe(1);
    expect(s.missed).toBe(1);
    // rate = 2 / (2 + 1 + 1) = 50
    expect(s.keepRate).toBe(50);
  });

  it("ignores unknown statuses (open, parked, deleted, etc.)", () => {
    const s = summarizeKeepRate(["open", "parked", "kept_on_time"]);
    expect(s.keptOnTime).toBe(1);
    expect(s.keptLate).toBe(0);
    expect(s.missed).toBe(0);
    expect(s.keepRate).toBe(100);
  });
});

describe("computeFollowThroughRate", () => {
  it("matches summarizeKeepRate().keepRate exactly (thin wrapper)", () => {
    const statuses = ["kept_on_time", "kept_late", "missed"];
    expect(computeFollowThroughRate(statuses)).toBe(
      summarizeKeepRate(statuses).keepRate
    );
  });
});

describe("bucketKeepRates", () => {
  it("returns per-bucket counts with kept_on_time as the numerator", () => {
    const rows = [
      { owner: "a", status: "kept_on_time" },
      { owner: "a", status: "kept_late" },
      { owner: "a", status: "missed" },
      { owner: "b", status: "kept_on_time" },
      { owner: "b", status: "kept_on_time" },
      { owner: "c", status: "open" }, // ignored
    ];
    const out = bucketKeepRates(rows, (r) => r.owner);

    // a: 1 on-time, 1 late, 1 missed → rate = 1/3 = 33
    expect(out.get("a")).toEqual({
      keptOnTime: 1,
      keptLate: 1,
      missed: 1,
      keepRate: 33,
    });
    // b: 2 on-time → rate = 100
    expect(out.get("b")).toEqual({
      keptOnTime: 2,
      keptLate: 0,
      missed: 0,
      keepRate: 100,
    });
    // c: no resolved rows → no bucket entry
    expect(out.get("c")).toBeUndefined();
  });
});

describe("ongoing occurrences (definition-of-done shape)", () => {
  it("three weeks of resolutions produces three entries in Follow-Through math", () => {
    // Simulates the shape /commitments passes into summarizeKeepRate
    // after occurrences have been folded in. Ongoing commitments
    // contribute one entry per week_ending, non-ongoing contribute
    // one entry each. Kept_on_time / kept_late / missed all count in
    // the denominator; the numerator is on-time only.
    const occurrencesForOneOngoingRow = [
      "kept_on_time",
      "kept_late",
      "missed",
    ];
    const s = summarizeKeepRate(occurrencesForOneOngoingRow);
    expect(s.keptOnTime).toBe(1);
    expect(s.keptLate).toBe(1);
    expect(s.missed).toBe(1);
    expect(s.keepRate).toBe(33);
  });
});

describe("parking-lot exclusion (definition-of-done shape)", () => {
  it("parked rows never reach the counter — callers filter parked_at first", () => {
    // The math itself just ignores non-resolved statuses; parking is
    // enforced by the caller's query (WHERE parked_at IS NULL). This
    // test pins the "ignore anything not resolved" behavior so a
    // future refactor doesn't accidentally count parked rows if
    // someone forgets to filter.
    const s = summarizeKeepRate([
      "open",
      "kept_on_time",
      "missed",
      // A hypothetical row where parking somehow leaks into the
      // status list — the math still correctly ignores non-resolved.
      "some_new_status",
    ]);
    expect(s.keptOnTime).toBe(1);
    expect(s.missed).toBe(1);
    expect(s.keptLate).toBe(0);
    expect(s.keepRate).toBe(50);
  });
});
