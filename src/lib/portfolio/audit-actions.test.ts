import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// PortfolioAction and the database CHECK must list the same actions.
//
// THE SECOND INSTANCE OF FAILURE MODE E14, caught before it could
// happen rather than after. recordPortfolioEvent is fire-and-report
// by design — an audit write must not be able to fail the thing it
// records — so an action missing from the constraint inserts nothing
// and says nothing, exactly the way `memory` vanished from
// coach_token_usage for the life of coach memory.
//
// Same guard, one table over: read both lists out of the source
// rather than restating them, and carry the falsification inline,
// because comparing two parsed lists is the shape that passes by
// parsing nothing.

const AUDIT_TS = path.join(process.cwd(), "src/lib/portfolio/audit.ts");
const MIGRATIONS = path.join(process.cwd(), "supabase/migrations");

function unionActions(): string[] {
  const src = readFileSync(AUDIT_TS, "utf8");
  const start = src.indexOf("export type PortfolioAction =");
  expect(start).toBeGreaterThan(-1);
  const block = src.slice(start, src.indexOf(";", start));
  return [...block.matchAll(/\|\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
}

function constraintActions(): string[] {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let latest: string | null = null;
  for (const f of files) {
    const sql = readFileSync(path.join(MIGRATIONS, f), "utf8");
    if (sql.includes("check (action in (")) latest = sql;
  }
  expect(latest).not.toBeNull();
  const block = latest!.slice(latest!.lastIndexOf("check (action in ("));
  const list = block.slice(0, block.indexOf("))"));
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

describe("portfolio admin event actions", () => {
  it("the TypeScript union and the database constraint agree", () => {
    expect(constraintActions()).toEqual(unionActions());
  });

  it("includes the two the card needs", () => {
    const allowed = constraintActions();
    expect(allowed).toContain("company_access_granted");
    expect(allowed).toContain("company_access_revoked");
  });

  it("catches drift in either direction", () => {
    const union = unionActions();
    const constraint = constraintActions();
    expect(constraint).not.toEqual(
      union.filter((a) => a !== "company_access_granted")
    );
    expect([...constraint, "invented"].sort()).not.toEqual(union);
  });

  it("is reading real lists, not empty ones", () => {
    expect(unionActions().length).toBeGreaterThan(8);
    expect(constraintActions().length).toBeGreaterThan(8);
  });
});
