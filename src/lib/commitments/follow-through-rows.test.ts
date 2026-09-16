import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { mergeFollowThroughRows } from "./follow-through-rows";
import { summarizeFollowThrough } from "./follow-through";

// A recurring commitment is ONE row that never leaves 'open' while
// the cycle runs, so counting rows counted it once no matter how many
// weeks it had been kept. These pin the merge, and the end-to-end
// consequence through the real summarizer.

const MIGRATIONS = path.resolve(__dirname, "../../../supabase/migrations");

describe("mergeFollowThroughRows", () => {
  it("adds one row per resolved week", () => {
    const merged = mergeFollowThroughRows(
      [{ status: "open", due_date: "2026-09-18" }],
      [{ status: "kept_on_time" }, { status: "kept_on_time" }, { status: "missed" }]
    );
    expect(merged).toHaveLength(4);
  });

  it("gives an occurrence no due_date, so it can never read as overdue", () => {
    // due_date only decides whether an OPEN row is late. An
    // occurrence is a week already resolved; a date on it could only
    // ever push a resolved week into the overdue bucket.
    const [row] = mergeFollowThroughRows([], [{ status: "kept_late" }]);
    expect(row.due_date).toBeNull();
  });

  it("keeps the commitment rows untouched and first", () => {
    const commitments = [{ status: "missed", due_date: "2026-09-04" }];
    expect(mergeFollowThroughRows(commitments, [{ status: "kept_on_time" }])[0]).toEqual(
      commitments[0]
    );
  });
});

describe("what it changes for a recurring commitment", () => {
  // The case from the product: one ongoing commitment, kept on time
  // for three weeks, still running and not yet due this week.
  const parent = [{ status: "open", due_date: "2026-09-25" }];
  const weeks = [
    { status: "kept_on_time" },
    { status: "kept_on_time" },
    { status: "kept_on_time" },
  ];
  const today = "2026-09-16";

  it("used to be invisible: no keeps, and nothing in the denominator", () => {
    // Open and not yet due is excluded entirely, so the old
    // population produced a null rate — three weeks of work that the
    // score never saw.
    const before = summarizeFollowThrough(parent, today);
    expect(before.keptOnTime).toBe(0);
    expect(before.rate).toBeNull();
  });

  it("now counts every week that happened", () => {
    const after = summarizeFollowThrough(
      mergeFollowThroughRows(parent, weeks),
      today
    );
    expect(after.keptOnTime).toBe(3);
    expect(after.rate).toBe(100);
  });

  it("still counts a missed week against the rate", () => {
    const after = summarizeFollowThrough(
      mergeFollowThroughRows(parent, [...weeks, { status: "missed" }]),
      today
    );
    expect(after.keptOnTime).toBe(3);
    expect(after.missed).toBe(1);
    expect(after.rate).toBe(75);
  });
});

describe("the view agrees with the Node path", () => {
  it("counts occurrences too, so two pages cannot disagree", () => {
    // /admin/companies reads the view; the Session Brief and
    // Portfolio count rows in Node. Fixing one and not the other is
    // the B&B Electric incident that follow-through.ts exists to
    // end, so the view is pinned here beside the merge it mirrors.
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    let latest = "";
    for (const f of files) {
      const sql = readFileSync(path.join(MIGRATIONS, f), "utf8");
      if (/create\s+or\s+replace\s+view\s+public\.company_follow_through/i.test(sql)) {
        latest = sql;
      }
    }
    expect(latest).not.toBe("");
    expect(latest).toMatch(/commitment_occurrences/);
  });
});
