import { describe, it, expect } from "vitest";
import { reportLines, summarise, weekOf } from "./analysis-weekly";

const row = (over: Partial<Parameters<typeof summarise>[0][number]>) => ({
  company_id: "benson",
  created_at: "2026-09-24T15:00:00Z",
  coverage_json: { missed: [] },
  spelling_changes: [],
  ...over,
});

describe("weekOf", () => {
  it("is the Monday of the UTC week", () => {
    expect(weekOf("2026-09-24T15:00:00Z")).toBe("2026-09-21");
    expect(weekOf("2026-09-21T00:00:00Z")).toBe("2026-09-21");
    expect(weekOf("2026-09-27T23:59:59Z")).toBe("2026-09-21");
  });
});

describe("summarise", () => {
  it("adds the coverage flags and the spelling corrections per company per week", () => {
    const [w] = summarise([
      row({ coverage_json: { missed: [1, 2] }, spelling_changes: [{ from: "Graham and Ann", to: "Grand Manan", count: 2 }] }),
      row({ coverage_json: { missed: [3] }, spelling_changes: [{ from: "Graham and Ann", to: "Grand Manan", count: 1 }] }),
    ]);
    expect(w).toMatchObject({ meetings: 2, flagged: 3, spelling: 3, coverageNotRun: 0, spellingNotRun: 0 });
    expect([...w.changes]).toEqual([["Graham and Ann -> Grand Manan", 3]]);
  });

  it("counts a check that did not run apart from one that found nothing", () => {
    const [w] = summarise([row({ coverage_json: null, spelling_changes: null }), row({})]);
    expect(w).toMatchObject({ meetings: 2, flagged: 0, coverageNotRun: 1, spelling: 0, spellingNotRun: 1 });
  });
});

describe("reportLines", () => {
  it("prints the corrections themselves, so a wrong one can be read", () => {
    const lines = reportLines(
      summarise([row({ spelling_changes: [{ from: "Glenn Mason", to: "Glenn Jason", count: 1 }] })]),
      new Map([["benson", "Benson Seafood"]])
    ).join("\n");
    expect(lines).toContain("Benson Seafood");
    expect(lines).toContain("Glenn Mason -> Glenn Jason");
  });

  it("says so in words when nothing was analysed", () => {
    expect(reportLines([], new Map())).toEqual(["  No meetings analysed in this window on this instance."]);
  });
});
