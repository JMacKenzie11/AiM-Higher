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

// A discipline score, terse enough that a fixture reads as data.
function d(key: string, score: number | null): DisciplineScore {
  return { key, score, breakdown: {} } as DisciplineScore;
}

// An overall-timeseries point. `score` is the rolled-up number the
// chart draws; `scores` is what a comparison is actually computed
// from.
function point(date: string, scores: DisciplineScore[]) {
  const counted = scores.filter((s) => s.score !== null);
  return {
    date,
    score: counted.length === 0 ? null : 0, // unused by overallTrajectory
    scores,
  };
}

describe("overallTrajectory", () => {
  it("compares live against the oldest timeseries entry inside the window", () => {
    const sc = scorecardFrom({
      overall: { score: 7, disciplinesCounted: 2 },
      disciplines: [d("foundation", 7), d("chart", 7)],
      overallTimeseries: [
        point(daysAgoIso(120), [d("foundation", 2), d("chart", 2)]), // outside
        point(daysAgoIso(60), [d("foundation", 5), d("chart", 5)]), // anchor
        point(daysAgoIso(7), [d("foundation", 6.5), d("chart", 6.5)]),
      ],
    });

    const t = overallTrajectory(sc);
    expect(t?.delta).toBe(2);
    expect(t?.priorDate).toBe(daysAgoIso(60));
    expect(t?.disciplinesCompared).toBe(2);
  });

  it("ignores a discipline the anchor never scored", () => {
    // THE PRODUCTION BUG, as a test. From 2026-08-13 the weekly cron
    // could not read entitlements, so stored snapshots carry the four
    // ungated disciplines and nothing else, while the live score
    // covers everything enabled.
    //
    // Naive subtraction: live is (8 + 8 + 2) / 3 = 6 against an anchor
    // of 8, so the arrow reads DOWN 2 and Guide HQ raises its heaviest
    // trigger — on a company whose foundation and chart have not moved
    // a point.
    //
    // Restricted to what both sides scored, the honest answer is flat.
    const sc = scorecardFrom({
      overall: { score: 6, disciplinesCounted: 3 },
      disciplines: [d("foundation", 8), d("chart", 8), d("measures", 2)],
      overallTimeseries: [
        point(daysAgoIso(30), [
          d("foundation", 8),
          d("chart", 8),
          d("measures", null),
        ]),
      ],
    });

    const t = overallTrajectory(sc);
    expect(t?.delta).toBe(0);
    expect(t?.disciplinesCompared).toBe(2);
  });

  it("ignores a discipline the live score no longer has", () => {
    // The mirror case: a module switched OFF since the snapshot. The
    // history has it, today does not, and it must not count either way.
    const sc = scorecardFrom({
      overall: { score: 8, disciplinesCounted: 2 },
      disciplines: [d("foundation", 8), d("chart", 8), d("measures", null)],
      overallTimeseries: [
        point(daysAgoIso(30), [
          d("foundation", 8),
          d("chart", 8),
          d("measures", 1),
        ]),
      ],
    });

    const t = overallTrajectory(sc);
    expect(t?.delta).toBe(0);
    expect(t?.disciplinesCompared).toBe(2);
  });

  it("still reports a real decline in the disciplines both points share", () => {
    // The guard must not become "always flat". A genuine drop on
    // shared disciplines still reads as a drop.
    const sc = scorecardFrom({
      overall: { score: 4, disciplinesCounted: 3 },
      disciplines: [d("foundation", 4), d("chart", 4), d("measures", 9)],
      overallTimeseries: [
        point(daysAgoIso(30), [
          d("foundation", 8),
          d("chart", 8),
          d("measures", null),
        ]),
      ],
    });

    expect(overallTrajectory(sc)?.delta).toBe(-4);
  });

  it("returns null when the two points share no scored discipline", () => {
    const sc = scorecardFrom({
      overall: { score: 5, disciplinesCounted: 1 },
      disciplines: [d("measures", 5)],
      overallTimeseries: [point(daysAgoIso(30), [d("foundation", 8)])],
    });

    expect(overallTrajectory(sc)).toBeNull();
  });

  it("returns null when overall is null (no scored disciplines at all)", () => {
    const sc = scorecardFrom({
      overall: { score: null, disciplinesCounted: 0 },
      disciplines: [],
      overallTimeseries: [point(daysAgoIso(30), [d("foundation", 4)])],
    });

    expect(overallTrajectory(sc)).toBeNull();
  });
});
