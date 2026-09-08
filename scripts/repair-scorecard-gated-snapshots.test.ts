import { describe, it, expect } from "vitest";
import {
  parseArgs,
  summaryLines,
  describeCounts,
  type InstanceOutcome,
} from "./repair-scorecard-gated-snapshots.ts";

// The pure halves of the repair script: argument parsing, the count
// description, and the printed summary. The database work is not
// covered here — there is no Postgres in this suite — but these three
// are where an operator's understanding of what is about to happen
// comes from, so they carry the cover.
//
// Importing this file at all is a test of the entry-point guard: if
// the guard were missing, this import would DELETE ROWS. That is why
// scripts/entry-points.test.ts is a gate rather than a convention.

const LAST_AFFECTED = "2026-09-06";

describe("parseArgs", () => {
  it("defaults to applying, bounded at the last affected snapshot date", () => {
    expect(parseArgs([])).toEqual({
      dryRun: false,
      yes: false,
      instance: null,
      through: LAST_AFFECTED,
    });
  });

  it("reads --dry-run, --yes and --instance", () => {
    expect(parseArgs(["--dry-run", "--yes", "--instance", "promiseone"])).toEqual(
      { dryRun: true, yes: true, instance: "promiseone", through: LAST_AFFECTED }
    );
  });

  it("accepts a --through bound EARLIER than the default", () => {
    expect(parseArgs(["--through", "2026-08-22"]).through).toBe("2026-08-22");
  });

  it("refuses a --through bound later than the last affected date", () => {
    // The load-bearing one. After the fix shipped, a company that
    // genuinely lacks a module writes a legitimate notEnabled row that
    // is byte-identical to a broken one. Widening the window forward
    // deletes correct data, and nothing downstream would ever say so.
    expect(() => parseArgs(["--through", "2026-09-13"])).toThrow();
  });

  it("rejects a malformed date rather than coercing it", () => {
    expect(() => parseArgs(["--through", "13-09-2026"])).toThrow();
    expect(() => parseArgs(["--through", "soon"])).toThrow();
  });

  it("rejects an unknown option instead of ignoring it", () => {
    // A typo'd flag that parses as "no flag" is how --dry-run becomes
    // a live run.
    expect(() => parseArgs(["--dryrun"])).toThrow();
  });
});

describe("describeCounts", () => {
  it("shows the three narrowing counts so a broken jsonb filter is visible", () => {
    expect(
      describeCounts({
        inRange: 104,
        nullScored: 104,
        toDelete: 104,
        tableTotal: 208,
      })
    ).toBe("104 gated rows in range, 104 unscored, 104 to delete (table holds 208)");
  });

  it("shows disagreement rather than hiding it behind the final number", () => {
    const line = describeCounts({
      inRange: 104,
      nullScored: 104,
      toDelete: 0,
      tableTotal: 208,
    });
    expect(line).toContain("104 gated rows in range");
    expect(line).toContain("0 to delete");
  });
});

describe("summaryLines", () => {
  const ok = (subdomain: string, deleted: number): InstanceOutcome => ({
    subdomain,
    state: "ok",
    matched: deleted,
    deleted,
    detail: `deleted ${deleted}`,
  });

  it("totals the rows deleted across the fleet", () => {
    const lines = summaryLines([ok("@", 104), ok("promiseone", 0)], false);
    expect(lines.join("\n")).toContain("2 instances: 104 rows deleted");
  });

  it("says would-be-deleted on a dry run, and that nothing happened", () => {
    const out = summaryLines([ok("@", 104)], true).join("\n");
    expect(out).toContain("104 rows would be deleted");
    expect(out).toContain("--dry-run: nothing was deleted.");
  });

  it("names a blocked instance rather than dropping it from the count", () => {
    // The whole point of BLOCKED over "skipped": an instance the
    // repair could not reach has to appear, or it becomes the one
    // database still carrying the bad rows with nothing saying so.
    const out = summaryLines(
      [
        ok("@", 104),
        {
          subdomain: "acme",
          state: "blocked",
          matched: 0,
          deleted: 0,
          detail: "ACME_SUPABASE_SERVICE_KEY not set in .env.provisioning",
        },
      ],
      false
    ).join("\n");

    expect(out).toContain("BLOCKED acme");
    expect(out).toContain("1 need attention");
  });

  it("counts a failed instance as needing attention", () => {
    const out = summaryLines(
      [
        {
          subdomain: "@",
          state: "failed",
          matched: 104,
          deleted: 104,
          detail: "table went from 208 to 100, a change of 108 for 104 deletions",
        },
      ],
      false
    ).join("\n");

    expect(out).toContain("FAILED");
    expect(out).toContain("1 need attention");
  });
});
