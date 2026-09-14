import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// ROUTE-LEVEL ACCESS PROBE for the trust surface.
//
// The table was probed caller by caller in the rls-harness batch:
// system_admin 0, portfolio_admin 0, company_admin 0, guide 0,
// colleague 0, subject 1. This asks the same question one layer up,
// where a page could undo all of it by accepting an identifier.
//
// It reads the source because that is where the property lives. The
// page cannot be pointed at another person because THERE IS NO
// PARAMETER TO POINT — not because a check refuses. A behavioural
// test would have to invent the request that cannot be formed.

const PAGE = "src/app/(app)/ask-aimee/memory/page.tsx";
const LIST = "src/app/(app)/ask-aimee/memory/MemoryList.tsx";
const ACTIONS = "src/lib/coach/memory-actions.ts";

const read = (p: string) => readFileSync(p, "utf8").replace(/^\s*\/\/.*$/gm, "");

describe("the trust surface serves the subject and nobody else", () => {
  it("the route takes no identifier at all", () => {
    // A dynamic segment would be a way to ask for somebody else's
    // memory, which RLS would refuse — and "refused" is a worse
    // property than "unaskable", because the refusal is one
    // well-meaning policy edit away from not happening.
    const page = read(PAGE);
    expect(page).not.toMatch(/params/);
    expect(page).not.toMatch(/searchParams/);
    expect(page).not.toMatch(/profileId|profile_id|subjectId|userId/);
  });

  it("nothing on the surface reaches for the service client", () => {
    for (const file of [PAGE, LIST, ACTIONS]) {
      expect(read(file), file).not.toMatch(/createSupabaseAdminClient/);
    }
  });

  it("no role branch decides what this page shows", () => {
    // There is no role that may read another person's memory, so
    // there is nothing for a role check to decide. One appearing here
    // would mean somebody had invented one.
    const page = read(PAGE);
    const list = read(LIST);
    for (const role of [
      "system_admin",
      "company_admin",
      "aims_guide",
      "portfolio_admin",
      "isAdmin",
    ]) {
      expect(page, `page names ${role}`).not.toContain(role);
      expect(list, `list names ${role}`).not.toContain(role);
    }
  });

  it("every memory read and write is scoped to the caller's own id", () => {
    // Belt to RLS's braces. The policy is the boundary; this asserts
    // the code never even asks a broader question, so a policy
    // mistake has no waiting caller to exploit it.
    const actions = read(ACTIONS);
    const reads = actions.match(/from\("coach_memories"\)/g) ?? [];
    expect(reads.length).toBeGreaterThan(0);
    // Each statement against the table carries the caller's id, with
    // the single exception of the tool, which carries NO id and
    // relies on RLS alone (asserted separately in memory-tool.test).
    const scoped = actions.match(/eq\("profile_id", session\.profile\.id\)/g) ?? [];
    expect(scoped.length).toBe(reads.length);
  });

  it("offers no export and no share", () => {
    const page = read(PAGE);
    const list = read(LIST);
    for (const forbidden of ["export const dynamic = \"force-static\"", "download", "csv", "Share", "share"]) {
      expect(`${page}${list}`.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
