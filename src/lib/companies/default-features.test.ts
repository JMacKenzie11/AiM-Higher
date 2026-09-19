import { describe, it, expect } from "vitest";

import { defaultFeatures } from "./create-company";
import { COMPANY_FEATURES } from "./features";

// What a company starts with.
//
// A new company set up without Success Tracking gets a /measures page
// it can write a list on and never record a number against. That was
// defensible when a critical success factor was a heading and the
// measurable thing lived beneath it; since the KPI collapse the
// factor IS the measurable thing.

describe("defaultFeatures", () => {
  it("includes Success Tracking", () => {
    expect(defaultFeatures()).toContain("performance_tracking");
  });

  it("still includes the execution platform", () => {
    // The other default, and the one everything else hangs off.
    expect(defaultFeatures()).toContain("execution");
  });

  it("does not switch on the paid or per-client extras", () => {
    // A default set that grows by accident is how a company ends up
    // entitled to something nobody sold it. External Measures in
    // particular is built for one client.
    expect(defaultFeatures()).not.toContain("external_measures");
    expect(defaultFeatures()).not.toContain("strengths");
  });

  it("is derived from the catalogue, not a second list", () => {
    // `defaultFeatures()` reads `defaultOnCreate` off the catalogue
    // entries so adding a feature is one edit. A hand-maintained copy
    // is how the two drift.
    expect([...defaultFeatures()].sort()).toEqual(
      COMPANY_FEATURES.filter((f) => f.defaultOnCreate)
        .map((f) => f.value)
        .sort()
    );
  });

  it("names a feature that exists", () => {
    const known = new Set(COMPANY_FEATURES.map((f) => f.value));
    for (const value of defaultFeatures()) expect(known.has(value)).toBe(true);
  });
});
