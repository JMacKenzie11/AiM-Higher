import { describe, it, expect } from "vitest";
import { reportLines } from "./guide-uptake";

const row = (over: Partial<Parameters<typeof reportLines>[0][number]> = {}) => ({
  company_id: "co_acme",
  week_starting: "2026-09-21",
  raised: 3,
  opened: 1,
  dismissed: 0,
  superseded: 2,
  still_pending: 0,
  ...over,
});

const names = new Map([["co_acme", "Acme Construction"]]);

describe("reportLines", () => {
  it("prints the ratio the report exists for", () => {
    const out = reportLines([row()], names).join("\n");
    expect(out).toContain("Acme Construction");
    expect(out).toContain("1 of 3 invitations opened (33%)");
  });

  it("keeps a week of zero opens visible", () => {
    // The case the whole shape is built around. Three invitations
    // and nobody came has to appear; it is the finding.
    const out = reportLines([row({ opened: 0 })], names).join("\n");
    expect(out).toContain("0 of 3 invitations opened (0%)");
  });

  it("says no nudges in words rather than printing an empty table", () => {
    // "No rows" and "nothing was ever raised" look identical as an
    // empty table and mean different things.
    const out = reportLines([], names).join("\n");
    expect(out).toContain("No nudges raised");
    expect(out).not.toContain("superseded");
  });

  it("falls back to the id when a company name is missing", () => {
    const out = reportLines([row()], new Map()).join("\n");
    expect(out).toContain("co_acme");
  });
});
