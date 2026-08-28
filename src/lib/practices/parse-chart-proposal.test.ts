import { describe, it, expect } from "vitest";
import {
  parseChartProposal,
  chartProposalToPlainText,
} from "./parse-chart-proposal";

// Validator for the chart_proposal fenced-block payload emitted by
// the Functional Chart Builder practice. These tests define what
// the ChartProposalCard renders (happy path) and what triggers the
// malformed-fallback with the "Fix the proposal" action.

describe("parseChartProposal", () => {
  it("accepts the minimal valid shape", () => {
    const out = parseChartProposal(
      JSON.stringify({
        top_seats: [{ name: "Visionary", note: "CEO — sets the vision." }],
        functions: [
          { name: "Sales", responsibilities: ["LMA", "Pipeline"] },
        ],
      })
    );
    expect(out).not.toBeNull();
    expect(out?.top_seats[0]?.name).toBe("Visionary");
    expect(out?.functions[0]?.responsibilities).toEqual(["LMA", "Pipeline"]);
  });

  it("accepts optional sub_functions", () => {
    const out = parseChartProposal(
      JSON.stringify({
        top_seats: [],
        functions: [
          {
            name: "Sales & Marketing",
            responsibilities: ["LMA", "Pipeline", "Brand"],
            sub_functions: [
              { name: "Marketing", responsibilities: ["LMA", "Content"] },
            ],
          },
        ],
      })
    );
    expect(out?.functions[0]?.sub_functions?.[0]?.name).toBe("Marketing");
  });

  it("trims whitespace but rejects empty strings", () => {
    const out = parseChartProposal(
      JSON.stringify({
        top_seats: [{ name: "  Visionary  ", note: "  " }],
        functions: [{ name: "Sales", responsibilities: ["LMA"] }],
      })
    );
    expect(out?.top_seats[0]?.name).toBe("Visionary");
    // note trimmed to empty is still allowed (note is descriptive)
    expect(out?.top_seats[0]?.note).toBe("");
  });

  it("rejects an empty responsibility inside the array", () => {
    // An empty responsibility would render as a bullet with no
    // text — bad UX. Reject and fall through to the malformed
    // fallback so the coach can regenerate.
    const out = parseChartProposal(
      JSON.stringify({
        top_seats: [],
        functions: [
          { name: "Sales", responsibilities: ["LMA", "   "] },
        ],
      })
    );
    expect(out).toBeNull();
  });

  it("rejects a function with missing responsibilities key", () => {
    const out = parseChartProposal(
      JSON.stringify({
        top_seats: [],
        functions: [{ name: "Sales" }],
      })
    );
    expect(out).toBeNull();
  });

  it("rejects a top-seat missing name", () => {
    const out = parseChartProposal(
      JSON.stringify({
        top_seats: [{ note: "no name here" }],
        functions: [],
      })
    );
    expect(out).toBeNull();
  });

  it("rejects a top-seat with non-string note", () => {
    const out = parseChartProposal(
      JSON.stringify({
        top_seats: [{ name: "Visionary", note: 42 }],
        functions: [],
      })
    );
    expect(out).toBeNull();
  });

  it("returns null on non-JSON garbage", () => {
    expect(parseChartProposal("not json at all")).toBeNull();
    expect(parseChartProposal("{ broken: true")).toBeNull();
    expect(parseChartProposal("")).toBeNull();
  });

  it("returns null on JSON that isn't an object", () => {
    expect(parseChartProposal(JSON.stringify(["array"]))).toBeNull();
    expect(parseChartProposal(JSON.stringify("string"))).toBeNull();
    expect(parseChartProposal(JSON.stringify(null))).toBeNull();
  });
});

describe("chartProposalToPlainText", () => {
  it("serialises a proposal to a readable indented block", () => {
    const text = chartProposalToPlainText({
      top_seats: [
        { name: "Visionary", note: "Sets vision" },
        { name: "Integrator", note: "Runs the day-to-day" },
      ],
      functions: [
        {
          name: "Sales",
          responsibilities: ["LMA", "Pipeline"],
          sub_functions: [
            { name: "Marketing", responsibilities: ["LMA", "Brand"] },
          ],
        },
      ],
    });
    expect(text).toContain("Top seats");
    expect(text).toContain("Visionary — Sets vision");
    expect(text).toContain("Sales");
    expect(text).toContain("  - LMA");
    expect(text).toContain("  Marketing");
    expect(text).toContain("    - Brand");
  });
});
