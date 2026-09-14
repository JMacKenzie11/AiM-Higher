import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Role gating for /portfolio, read from the source.
//
// WHY SOURCE-LEVEL RATHER THAN EXECUTING IT. The vitest environment is
// `node` with `jsx: preserve` from Next's tsconfig, so importing a
// .tsx page fails to parse before any assertion runs. The two existing
// app-directory tests in this repo (measures/counts-agree.test.ts,
// measures/grid-alignment.test.ts) read source for the same reason.
//
// WHAT IT CANNOT PROVE: that requireRole actually redirects. That is
// covered twice over elsewhere — by current-user.test.ts on the helper
// itself, and by the Playwright spec, which signs in as a real
// portfolio_admin and lands here.
//
// WHAT IT DOES PROVE: that the list has not quietly grown. The failure
// this is for is somebody adding a role to make a different page work
// and not noticing which page they changed.

const PAGE = join(process.cwd(), "src/app/(app)/portfolio/page.tsx");
const src = readFileSync(PAGE, "utf8");

function requireRoleArgs(): string {
  const at = src.indexOf("requireRole([");
  expect(at).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf("]", at) + 1);
}

describe("/portfolio role gating", () => {
  it("admits portfolio_admin", () => {
    expect(requireRoleArgs()).toContain('"portfolio_admin"');
  });

  it("admits system_admin, who grant the role and must be able to see it", () => {
    expect(requireRoleArgs()).toContain('"system_admin"');
  });

  it("admits nobody else", () => {
    const args = requireRoleArgs();
    for (const role of ["company_admin", "team_member", "aims_guide"]) {
      expect(args).not.toContain(`"${role}"`);
    }
  });

  it("gates before it loads anything", () => {
    // A page that fetches first and authorises second has already done
    // the read by the time it decides the caller should not have it.
    const gate = src.indexOf("requireRole(");
    const load = src.indexOf("loadPortfolioOverview(");
    expect(gate).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(gate);
  });

  it("imports none of the coaching machinery", () => {
    // Oversight, not coaching. The attention queue, nudges and session
    // briefs are absent by decision, and the way that decision erodes
    // is one import at a time — a file that already imports the
    // attention pass is one line away from rendering it.
    for (const forbidden of [
      "hq/attention",
      "hq/brief",
      "loadRecentActivity",
      "loadMyCommitments",
      "NeedsAttentionSection",
    ]) {
      expect(src).not.toContain(forbidden);
    }
  });

  it("offers the create affordance in both states", () => {
    // The empty instance IS the create affordance, and a populated one
    // still needs it. Two call sites, one component.
    const occurrences = src.split("CreateCompanyForm").length - 1;
    // One import, two renders.
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });
});
