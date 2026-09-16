import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// A source-level guard on the server/client boundary at
// /admin/companies.
//
// THE INCIDENT. CompaniesTable is a Client Component. The first
// version of the companies list passed it a `renderRow` callback so
// the server could keep owning the cells, and React refuses that:
// "Functions cannot be passed directly to Client Components unless
// you explicitly expose it by marking it with 'use server'."
//
// It typechecked. It linted. It built. The Vercel preview deployed
// green. It threw on every render of /admin/companies in production,
// because the boundary is enforced at RENDER time and nothing in the
// gate set renders that route.
//
// THIS GUARDS THE COMPONENT'S CONTRACT, NOT THE CALL SITE. The first
// version of this test read the `<CompaniesTable ... />` JSX and
// sliced its props at the first "/>" — which is inside `</>`, the
// fragment closing the `header` prop, so it inspected 415 characters
// and none of the props that mattered. It passed against the broken
// code when that was checked deliberately. A props TYPE is a single
// declaration with no nested JSX to trip over, and it is the thing
// that must actually hold: a Client Component may not accept a
// function prop unless that function is a server action.
//
// Deliberately crude, and the same trade current-user.test.ts makes
// for its cache() wrapper: the honest regression signal available
// without booting a Next server. The durable version is
// e2e/reorder.spec.ts, which loads this page as an admin and would
// have caught the incident outright.

const COMPONENT = path.join(
  process.cwd(),
  "src/app/(app)/admin/companies/CompaniesTable.tsx"
);

function propsBlockOf(source: string): string {
  // The inline props type of the exported component: everything
  // between `}: {` and the `})` that closes the signature.
  const start = source.indexOf("}: {");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("}) {", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("the /admin/companies server/client boundary", () => {
  const source = readFileSync(COMPONENT, "utf8");

  it("is a Client Component, so the rule applies", () => {
    // If this ever stops being true the guard is pointed at nothing.
    expect(source.trimStart().startsWith('"use client"')).toBe(true);
  });

  it("accepts no function-typed prop", () => {
    const props = propsBlockOf(source);
    expect(props).not.toMatch(/=>/);
  });

  it("catches a function prop if one is reintroduced", () => {
    // Falsification, inline, because the previous version of this
    // test did not have one and was worthless without it.
    const reintroduced = source.replace(
      "  header: ReactNode;",
      "  header: ReactNode;\n  renderRow: (row: CompanyRow) => ReactNode;"
    );
    expect(reintroduced).not.toBe(source);
    expect(propsBlockOf(reintroduced)).toMatch(/=>/);
  });
});
