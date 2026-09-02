import { describe, it, expect } from "vitest";
import { deriveCompanyContext } from "./context-label";

// Characterises the sidebar context pill. Written alongside the layout
// parallelisation: the company row and the feature flags now load
// together instead of back to back, which meant rewriting this
// branching, and it is the sort of code where an undefined quietly
// becomes a null.

describe("deriveCompanyContext — cross-tenant roles", () => {
  it("formats role and company when scoped in", () => {
    expect(
      deriveCompanyContext({
        isCrossCompanyRole: true,
        roleLabel: "System admin",
        companyRow: { name: "Meridian Construction", timezone: "America/Anchorage" },
      })
    ).toEqual({
      contextLabel: "System admin · Meridian Construction",
      scopedCompanyName: "Meridian Construction",
      analyticsCompanyName: "Meridian Construction",
      companyTimezone: "America/Anchorage",
    });
  });

  it("falls back to the bare role label when not scoped into any company", () => {
    // A guide between assignments, or a sysadmin who exited scope.
    // The pill must still identify them; dropping to undefined would
    // make the sidebar look logged-out.
    expect(
      deriveCompanyContext({
        isCrossCompanyRole: true,
        roleLabel: "AiMS Guide",
        companyRow: null,
      })
    ).toEqual({
      contextLabel: "AiMS Guide",
      scopedCompanyName: undefined,
      analyticsCompanyName: null,
      companyTimezone: null,
    });
  });

  it("treats a company row with a null name as unscoped for display", () => {
    expect(
      deriveCompanyContext({
        isCrossCompanyRole: true,
        roleLabel: "System admin",
        companyRow: { name: null, timezone: "UTC" },
      })
    ).toMatchObject({
      contextLabel: "System admin",
      scopedCompanyName: undefined,
      // Timezone still carries — notifications need it even when the
      // name is missing.
      companyTimezone: "UTC",
    });
  });
});

describe("deriveCompanyContext — company users", () => {
  it("shows the plain company name, never a role prefix", () => {
    expect(
      deriveCompanyContext({
        isCrossCompanyRole: false,
        roleLabel: null,
        companyRow: { name: "Meridian Construction", timezone: "America/Anchorage" },
      })
    ).toEqual({
      contextLabel: "Meridian Construction",
      scopedCompanyName: undefined,
      analyticsCompanyName: "Meridian Construction",
      companyTimezone: "America/Anchorage",
    });
  });

  it("shows nothing when the profile has no company", () => {
    expect(
      deriveCompanyContext({
        isCrossCompanyRole: false,
        roleLabel: null,
        companyRow: null,
      })
    ).toEqual({
      contextLabel: undefined,
      scopedCompanyName: undefined,
      analyticsCompanyName: null,
      companyTimezone: null,
    });
  });

  it("never leaks a scoped company name for a company user", () => {
    // scopedCompanyName drives the "Exit <company>" affordance, which
    // a company user must never see.
    expect(
      deriveCompanyContext({
        isCrossCompanyRole: false,
        roleLabel: null,
        companyRow: { name: "Meridian Construction", timezone: null },
      }).scopedCompanyName
    ).toBeUndefined();
  });
});
