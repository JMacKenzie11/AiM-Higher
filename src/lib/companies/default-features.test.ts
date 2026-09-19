import { describe, it, expect } from "vitest";

import { defaultFeatures } from "./create-company";
import { COMPANY_FEATURES } from "./features";

// Which features a new company is created with.
//
// Success Tracking is NOT one of them, and that is a reversal. It was
// switched on by default when the KPI collapse landed, on the
// reasoning that a critical success factor IS the measurable thing so
// a company without the flag got a page it could never record a
// number against.
//
// The gate was the problem, not the default. Recording a number no
// longer needs the flag: it governs only the Friday nudge, the Issue
// raised from a below-target entry, and the commitment raised for an
// actual nobody entered. None of those three is in use with any
// company yet, so switching it on at creation would only schedule
// work nobody asked for.

describe("defaultFeatures", () => {
  it("does NOT include Success Tracking", () => {
    // Turning this on hands the company a Saturday cron that raises
    // Issues and commitments against it. That is opt-in.
    expect(defaultFeatures()).not.toContain("performance_tracking");
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
