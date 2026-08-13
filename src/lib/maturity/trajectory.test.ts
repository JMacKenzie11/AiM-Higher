import { describe, it, expect } from "vitest";
import { trajectoryFor, overallTrajectory } from "./service";
import type { CompanyScorecard, DisciplineScore } from "./types";

// Trajectory = current live score MINUS the oldest snapshot score
// that's still inside the 90-day window. These are the pins that
// stop the trend arrow from silently regressing to "flat" if a
// refactor changes how the anchor snapshot is picked.

function scorecardFrom(overrides: {
  disciplines?: DisciplineScore[];
  timeseries?: CompanyScorecard["timeseries"];
  overall?: CompanyScorecard["overall"];
  overallTimeseries?: CompanyScorecard["overallTimeseries"];
}): CompanyScorecard {
  return {
    companyId: "co_acme",
    computedAt: new Date().toISOString(),
    overall: overrides.overall ?? { score: 5, disciplinesCounted: 6 },
    disciplines:
      overrides.disciplines ??
      ([{ key: "foundation", score: 5, breakdown: {} }] as DisciplineScore[]),
    timeseries:
      overrides.timeseries ??
      ({
        foundation: [],
        chart: [],
        planning: [],
        execution: [],
        measures: [],
        meetings: [],
        solution_seeking: [],
        positive_framing: [],
      } as CompanyScorecard["timeseries"]),
    overallTimeseries: overrides.overallTimeseries ?? [],
  };
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

describe("trajectoryFor", () => {
  it("returns null when there's no prior snapshot to compare against", () => {
    const sc = scorecardFrom({
      disciplines: [{ key: "execution", score: 8, breakdown: {} }],
    });

    expect(trajectoryFor("execution", sc)).toBeNull();
  });

  it("compares current live to the OLDEST snapshot inside the 90-day window", () => {
    // Series has snapshots at ~120 days ago, ~60 days ago, ~7 days
    // ago. Only the last two are inside the 90d window; the anchor
    // is the OLDEST usable = the 60-day-ago row.
    const sc = scorecardFrom({
      disciplines: [{ key: "execution", score: 8.4, breakdown: {} }],
      timeseries: {
        foundation: [],
        chart: [],
        planning: [],
        execution: [
          { date: daysAgoIso(120), score: 3.0 }, // outside window — ignored
          { date: daysAgoIso(60), score: 4.0 }, // anchor
          { date: daysAgoIso(7), score: 7.0 },
        ],
        measures: [],
        meetings: [],
        solution_seeking: [],
        positive_framing: [],
      },
    });

    const t = trajectoryFor("execution", sc);
    expect(t).not.toBeNull();
    if (t) {
      expect(t.delta).toBe(4.4); // 8.4 - 4.0
      expect(t.priorDate).toBe(daysAgoIso(60));
    }
  });

  it("skips snapshots with null scores when finding the anchor", () => {
    // Feature was off at the 80-day-ago snapshot (score=null), turned
    // on later. Anchor should be the 40-day-ago row, not the null one.
    const sc = scorecardFrom({
      disciplines: [{ key: "measures", score: 6, breakdown: {} }],
      timeseries: {
        foundation: [],
        chart: [],
        planning: [],
        execution: [],
        measures: [
          { date: daysAgoIso(80), score: null },
          { date: daysAgoIso(40), score: 3 },
        ],
        meetings: [],
        solution_seeking: [],
        positive_framing: [],
      },
    });

    const t = trajectoryFor("measures", sc);
    expect(t?.delta).toBe(3);
    expect(t?.priorDate).toBe(daysAgoIso(40));
  });

  it("returns null when the current discipline scored null (feature off)", () => {
    const sc = scorecardFrom({
      disciplines: [{ key: "measures", score: null, breakdown: {} }],
      timeseries: {
        foundation: [],
        chart: [],
        planning: [],
        execution: [],
        measures: [{ date: daysAgoIso(40), score: 8 }],
        meetings: [],
        solution_seeking: [],
        positive_framing: [],
      },
    });

    expect(trajectoryFor("measures", sc)).toBeNull();
  });
});

describe("overallTrajectory", () => {
  it("compares overall live to the oldest overall-timeseries entry inside the window", () => {
    const sc = scorecardFrom({
      overall: { score: 7, disciplinesCounted: 6 },
      overallTimeseries: [
        { date: daysAgoIso(120), score: 2 }, // outside — ignored
        { date: daysAgoIso(60), score: 5 }, // anchor
        { date: daysAgoIso(7), score: 6.5 },
      ],
    });

    const t = overallTrajectory(sc);
    expect(t?.delta).toBe(2);
    expect(t?.priorDate).toBe(daysAgoIso(60));
  });

  it("returns null when overall is null (no scored disciplines at all)", () => {
    const sc = scorecardFrom({
      overall: { score: null, disciplinesCounted: 0 },
      overallTimeseries: [{ date: daysAgoIso(30), score: 4 }],
    });

    expect(overallTrajectory(sc)).toBeNull();
  });
});
