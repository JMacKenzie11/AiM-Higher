import { describe, it, expect } from "vitest";
import { readPageSummary } from "./page-summary";

describe("readPageSummary", () => {
  it("keeps the agenda's order and one entry per part, whatever came back", () => {
    const s = readPageSummary({
      overview: "A steady meeting.",
      sections: [
        { part: "issues", points: ["Late routes worked to a plan."] },
        { part: "checkin", points: ["Everyone shared."] },
        { part: "checkin", points: ["A second check-in entry."] },
        { part: "made-up", points: ["Dropped."] },
        { part: "headlines", points: [] },
      ],
      issues: [{ title: "Late routes", what: true, want: true, way: false, who: false, outcome: "Who takes it?" }],
      decisions: ["Trial the early load.", ""],
      values_shown: [{ value: "Own it", moment: "Marcus took the routes." }, { value: "", moment: "x" }],
      values_to_name: [],
    })!;
    expect(s.sections.map((x) => x.part)).toEqual(["checkin", "issues"]);
    expect(s.sections[0].points).toEqual(["Everyone shared."]);
    expect(s.issues[0]).toMatchObject({ what: true, way: false });
    expect(s.decisions).toEqual(["Trial the early load."]);
    expect(s.values_shown).toHaveLength(1);
  });

  it("reads nothing from an empty or broken answer", () => {
    expect(readPageSummary(null)).toBeNull();
    expect(readPageSummary({ overview: "", sections: [] })).toBeNull();
  });
});
