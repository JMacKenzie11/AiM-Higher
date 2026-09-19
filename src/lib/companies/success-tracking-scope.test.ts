import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// WHAT SUCCESS TRACKING IS ALLOWED TO DECIDE.
//
// ---- THE RULE ---------------------------------------------------
//
// The flag governs three things, and they are all things the system
// does WITHOUT being asked:
//
//   the Friday nudge for a measure you lead and have not logged
//   an Issue raised from a below-target entry          (Saturday cron)
//   a commitment raised for an actual nobody entered   (same cron)
//
// It does NOT decide whether anyone may set a target, type a weekly
// value, see the 13-week board, or be scored on Success tracking.
//
// ---- WHY A CLOSED LIST ------------------------------------------
//
// Because it used to decide all of those, and the re-gate is a
// one-line edit that reads perfectly innocent in a diff:
// `companyHasFeature(companyId, "performance_tracking")` in front of
// a render is indistinguishable, at review, from the same call in
// front of a cron. The difference is which file it is in.
//
// So the test is not "is this call correct" — it is "is this file
// allowed to ask the question at all". A new consumer fails here and
// has to be argued for by editing this list, which is the
// conversation that was missing the first time.
//
// The state this replaced was invisible in testing for months: the
// dev clone had the flag ON for the company being looked at and
// production had it OFF, so /measures rendered week columns for
// whoever was checking and rendered none for the customer.

const SRC = join(process.cwd(), "src");

// Files that may name the flag AND act on it.
const MAY_ACT = new Set([
  // The three behaviours themselves.
  "app/api/cron/performance/route.ts", // issue + commitment
  "lib/notifications/service.ts", // Friday nudge
  // The catalog and the type, which define it rather than consume it.
  "lib/companies/features.ts",
  "lib/subscriptions/service.ts",
  "components/sidebar/Sidebar.tsx", // ModuleFeature union member only
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

// Comments are stripped before matching. Every file below explains
// what the flag stopped doing, and a guard that fires on its own
// explanation is a guard people delete.
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => {
      const i = l.indexOf("//");
      if (i === -1) return l;
      // Not inside a string or a URL.
      const before = l.slice(0, i);
      const quotes = (before.match(/["'`]/g) ?? []).length;
      if (quotes % 2 === 1) return l;
      if (before.endsWith(":")) return l;
      return before;
    })
    .join("\n");
}

const consumers = walk(SRC)
  .filter((f) => !/\.test\.tsx?$/.test(f))
  .map((f) => [relative(SRC, f).split("\\").join("/"), readFileSync(f, "utf8")] as const)
  .filter(([, src]) => codeOnly(src).includes("performance_tracking"))
  .map(([rel]) => rel)
  .sort();

describe("only the three automations read Success Tracking", () => {
  it("has no consumer outside the closed list", () => {
    const strays = consumers.filter((f) => !MAY_ACT.has(f));
    expect(strays).toEqual([]);
  });

  it("still has the three it is for", () => {
    // The other half of the rule. Deleting a gate is as much a
    // regression as adding one: without these the cron chases every
    // company on the fleet whether they asked for it or not.
    expect(consumers).toContain("app/api/cron/performance/route.ts");
    expect(consumers).toContain("lib/notifications/service.ts");
  });
});

describe("the surfaces it used to gate no longer ask", () => {
  const files = [
    "app/(app)/measures/page.tsx",
    "app/(app)/measures/MeasuresGrid.tsx",
    "app/(app)/measures/EditMeasureForm.tsx",
    "app/(app)/dashboard/page.tsx",
    "app/(app)/layout.tsx",
    "lib/chart/actions.ts",
    "lib/maturity/compute.ts",
  ];

  for (const rel of files) {
    it(`${rel} does not read it`, () => {
      const src = codeOnly(readFileSync(join(SRC, rel), "utf8"));
      expect(src).not.toContain("performance_tracking");
      expect(src).not.toContain("trackingEnabled");
    });
  }
});
