import { describe, it, expect } from "vitest";
import {
  parseRoleDescription,
  roleDescriptionToPlainText,
  type RoleDescriptionDoc,
} from "./parse-document";

const ON_CHART: RoleDescriptionDoc = {
  version: 1,
  title: "Marketing Manager",
  function: { id: "11111111-1111-4111-8111-111111111111", title: "Marketing" },
  supports_functions: [],
  reports_to: "Dana Whitfield, Integrator",
  why_this_role_exists: "Because the pipeline is the constraint.",
  responsibilities: [
    { category: "Lead, Track, Decide", description: "The seat's baseline." },
    { category: "Demand generation", description: "Everything upstream of a lead." },
  ],
  critical_success_factors: [
    {
      description: "Qualified leads handed to sales",
      target: "12",
      value_type: "number",
      target_direction: "higher_is_better",
      update_frequency: "weekly",
      why_it_matters: "Sales cannot close what it never sees.",
    },
  ],
  decision_rights: {
    decides: ["Campaign spend under $5k"],
    decides_with: ["Annual brand positioning"],
    recommends: ["Agency selection"],
  },
  what_excellence_looks_like: [
    { value: "Honesty first", behaviour: "Reports a bad month in the week it happens." },
  ],
  capabilities: ["Runs a campaign end to end"],
  qualifications: ["Five years in B2B marketing"],
  why_this_role_matters: "Every other function is downstream of demand.",
};

const OFF_CHART: RoleDescriptionDoc = {
  ...ON_CHART,
  title: "Executive Assistant",
  function: null,
  supports_functions: ["Visionary", "Integrator"],
};

// The round trip the instruction asks for, both cases. A document
// that survives JSON and comes back identical is one the card, the
// Save action and the saved-document page cannot disagree about.
describe("round trip", () => {
  it("survives an on-chart document unchanged", () => {
    expect(parseRoleDescription(JSON.stringify(ON_CHART))).toEqual(ON_CHART);
  });

  it("survives an off-chart document unchanged", () => {
    expect(parseRoleDescription(JSON.stringify(OFF_CHART))).toEqual(OFF_CHART);
  });
});

describe("what is rejected", () => {
  it("rejects malformed JSON", () => {
    expect(parseRoleDescription("{not json")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(parseRoleDescription("")).toBeNull();
    expect(parseRoleDescription("   ")).toBeNull();
  });

  it("rejects a document with no title", () => {
    expect(parseRoleDescription(JSON.stringify({ ...ON_CHART, title: "" }))).toBeNull();
  });

  // A malformed function object must NOT collapse into "off the
  // chart". That would make a broken payload quietly assert
  // something untrue about where the role sits.
  it("rejects a malformed function rather than calling it off-chart", () => {
    const broken = JSON.stringify({ ...ON_CHART, function: { id: 7 } });
    expect(parseRoleDescription(broken)).toBeNull();
  });

  it("rejects a list where objects belong", () => {
    const broken = JSON.stringify({ ...ON_CHART, responsibilities: ["a string"] });
    expect(parseRoleDescription(broken)).toBeNull();
  });

  // "capabilities": "communication" is a document somebody would
  // read as a one-item list and we would render as nothing.
  it("rejects a string where a list belongs", () => {
    const broken = JSON.stringify({ ...ON_CHART, capabilities: "communication" });
    expect(parseRoleDescription(broken)).toBeNull();
  });
});

describe("what is allowed", () => {
  // Documented, allowed, and the reason the target column is
  // nullable everywhere else in this product.
  it("keeps a critical success factor with no target as null", () => {
    const doc = parseRoleDescription(
      JSON.stringify({
        ...ON_CHART,
        critical_success_factors: [
          { ...ON_CHART.critical_success_factors[0], target: null },
        ],
      })
    );
    expect(doc?.critical_success_factors[0]?.target).toBeNull();
  });

  it("accepts a numeric target and keeps it as text", () => {
    const doc = parseRoleDescription(
      JSON.stringify({
        ...ON_CHART,
        critical_success_factors: [
          { ...ON_CHART.critical_success_factors[0], target: 12 },
        ],
      })
    );
    expect(doc?.critical_success_factors[0]?.target).toBe("12");
  });

  // An unrecognised enum is a bug upstream, not a reason to lose the
  // factor the leader just spent five minutes agreeing.
  it("falls back to the add form's defaults on an unknown enum", () => {
    const doc = parseRoleDescription(
      JSON.stringify({
        ...ON_CHART,
        critical_success_factors: [
          {
            ...ON_CHART.critical_success_factors[0],
            value_type: "fahrenheit",
            target_direction: "sideways",
            update_frequency: "fortnightly",
          },
        ],
      })
    );
    expect(doc?.critical_success_factors[0]?.value_type).toBe("number");
    expect(doc?.critical_success_factors[0]?.target_direction).toBe("higher_is_better");
    expect(doc?.critical_success_factors[0]?.update_frequency).toBe("weekly");
  });

  it("treats absent decision rights as none rather than malformed", () => {
    const { decision_rights: _drop, ...rest } = ON_CHART;
    const doc = parseRoleDescription(JSON.stringify(rest));
    expect(doc?.decision_rights).toEqual({
      decides: [],
      decides_with: [],
      recommends: [],
    });
  });

  it("defaults a missing version rather than refusing the document", () => {
    const { version: _drop, ...rest } = ON_CHART;
    expect(parseRoleDescription(JSON.stringify(rest))?.version).toBe(1);
  });

  it("accepts an off-chart role that supports nothing", () => {
    const doc = parseRoleDescription(
      JSON.stringify({ ...OFF_CHART, supports_functions: [] })
    );
    expect(doc?.function).toBeNull();
    expect(doc?.supports_functions).toEqual([]);
  });
});

// Copy must say what the card says. Both are generated from the
// parsed document, so the text cannot describe a different role
// from the one on screen.
describe("plain text", () => {
  it("names the function for an on-chart role", () => {
    const text = roleDescriptionToPlainText(ON_CHART);
    expect(text).toContain("Marketing Manager");
    expect(text).toContain("Function: Marketing");
    expect(text).toContain("Reports to: Dana Whitfield, Integrator");
  });

  it("says what an off-chart role supports", () => {
    const text = roleDescriptionToPlainText(OFF_CHART);
    expect(text).toContain("Not on the chart. Supports: Visionary, Integrator");
  });

  it("says no target set rather than leaving a blank", () => {
    const text = roleDescriptionToPlainText({
      ...ON_CHART,
      critical_success_factors: [
        { ...ON_CHART.critical_success_factors[0], target: null },
      ],
    });
    expect(text).toContain("no target set");
  });

  it("leaves out a section the document has nothing for", () => {
    const text = roleDescriptionToPlainText({
      ...ON_CHART,
      capabilities: [],
      qualifications: [],
    });
    expect(text).not.toContain("CAPABILITIES");
    expect(text).not.toContain("QUALIFICATIONS");
  });
});
