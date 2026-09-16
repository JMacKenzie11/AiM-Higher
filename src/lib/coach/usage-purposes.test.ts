import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// The TypeScript union and the database CHECK must list the same
// purposes.
//
// THE INCIDENT. `memory` was added to CoachUsagePurpose when coach
// memory shipped and never added to the constraint. logCoachTokenUsage
// is called with `void` — fire-and-forget by design, so the write
// never blocks a coaching turn — which means a check violation goes
// nowhere. Measured on production: 681 usage rows, every other
// purpose represented, `memory` at zero. The cost of distilling a
// conversation had never reached the dashboard, and nothing had ever
// said so.
//
// This reads the two lists out of the source rather than restating
// them, because a test that restates a list is a third copy to
// forget.

const USAGE_TS = path.join(process.cwd(), "src/lib/coach/usage.ts");
const MIGRATIONS = path.join(process.cwd(), "supabase/migrations");

function unionPurposes(): string[] {
  const src = readFileSync(USAGE_TS, "utf8");
  const start = src.indexOf("export type CoachUsagePurpose =");
  expect(start).toBeGreaterThan(-1);
  const block = src.slice(start, src.indexOf(";", start));
  return [...block.matchAll(/\|\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
}

function constraintPurposes(): string[] {
  // The most recent migration that rewrites the constraint wins,
  // which is how the database actually resolves it.
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let latest: string | null = null;
  for (const f of files) {
    const sql = readFileSync(path.join(MIGRATIONS, f), "utf8");
    if (sql.includes("coach_token_usage_purpose_check") && sql.includes("check (purpose in (")) {
      latest = sql;
    }
  }
  expect(latest).not.toBeNull();
  const block = latest!.slice(latest!.lastIndexOf("check (purpose in ("));
  const list = block.slice(0, block.indexOf("))"));
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

describe("coach token usage purposes", () => {
  it("the TypeScript union and the database constraint agree", () => {
    expect(constraintPurposes()).toEqual(unionPurposes());
  });

  it("includes the two the database used to refuse", () => {
    // Named explicitly so a future narrowing has to argue with a
    // test rather than quietly drop them again.
    const allowed = constraintPurposes();
    expect(allowed).toContain("memory");
    expect(allowed).toContain("facilitation_retry");
  });

  it("catches drift in either direction", () => {
    // Falsification, inline, because a comparison of two parsed
    // lists is exactly the shape that passes by parsing nothing.
    const union = unionPurposes();
    const constraint = constraintPurposes();
    expect(constraint).toEqual(union);
    expect(constraint).not.toEqual(union.filter((p) => p !== "memory"));
    expect([...constraint, "invented"].sort()).not.toEqual(union);
  });

  it("is reading real lists, not empty ones", () => {
    // A guard that passes because both sides parsed to [] would be
    // worse than no guard.
    expect(unionPurposes().length).toBeGreaterThan(8);
    expect(constraintPurposes().length).toBeGreaterThan(8);
  });
});
