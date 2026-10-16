import { describe, it, expect } from "vitest";
import { computeReadiness, describeMissing } from "./readiness";

// The draft banner on a role description names what the function is
// missing. It used to say "1 of 5 sections filled in" above six written
// sections, because the count was of these gates rather than of what
// the reader could see.

type Detail = Parameters<typeof computeReadiness>[0];

function detail(overrides: Partial<Record<string, unknown>> = {}): Detail {
  return {
    fn: { title: "Operations" },
    roles: [],
    outcomes: [],
    decisionRights: [],
    competencies: [],
    ...overrides,
  } as unknown as Detail;
}

describe("describeMissing", () => {
  it("lists every gate still to pass, in order", () => {
    const { gates } = computeReadiness(detail());
    expect(describeMissing(gates)).toBe(
      "responsibilities, three critical success factors with targets, decision rights and three behaviors that show excellence"
    );
  });

  it("names a single missing gate on its own", () => {
    const { gates } = computeReadiness(
      detail({
        roles: [{ is_default: false }],
        outcomes: [{ target: "10" }, { target: "20" }, { target: "30" }],
        decisionRights: [{}],
        competencies: [{}, {}],
      })
    );
    expect(describeMissing(gates)).toBe("three behaviors that show excellence");
  });

  it("counts critical success factors without targets as missing", () => {
    const { gates } = computeReadiness(
      detail({
        roles: [{ is_default: false }],
        outcomes: [{ target: "10" }, { target: "" }, { target: null }],
        decisionRights: [{}],
        competencies: [{}, {}, {}],
      })
    );
    expect(describeMissing(gates)).toBe(
      "three critical success factors with targets"
    );
  });

  it("is empty when everything is ready", () => {
    const { gates, allReady } = computeReadiness(
      detail({
        roles: [{ is_default: false }],
        outcomes: [{ target: "10" }, { target: "20" }, { target: "30" }],
        decisionRights: [{}],
        competencies: [{}, {}, {}],
      })
    );
    expect(allReady).toBe(true);
    expect(describeMissing(gates)).toBe("");
  });
});
