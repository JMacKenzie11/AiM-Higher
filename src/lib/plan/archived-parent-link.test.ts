import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// AN ARCHIVED PARENT IS NOT A PARENT, ON EVERY SURFACE.
//
// ---- what went wrong -------------------------------------------
//
// `bucketCascadeChildren` has always treated a row whose parent is
// archived as standalone — "nowhere to put it", not "no parent
// column set" — so /plan renders such a priority under Standalone
// Quarterly Priorities with its Link to picker reading
// "Not linked (yet)".
//
// The detail-page loaders did not filter. `getPriorityDetail`
// resolved `annual_goal_id` straight to the row, archived or not, so
// the same priority's own page offered "← Back to goal" and
// "Goal: <title>" — both pointing at a goal the plan had stopped
// showing, and neither saying it was archived. Two surfaces
// disagreeing about whether the row has a parent, and the one
// carrying the link was the wrong one. Found on Benson Seafood,
// whose goal "We've hired 10 people for the Processing Facility" was
// archived with three priorities still under it.
//
// `getGoalDetail` had the same gap one level up.
//
// ---- why this is a source test ---------------------------------
//
// The rule is a clause on a query. Both loaders build their client
// through createSupabaseServerClient and getCurrentInstanceConfig,
// so exercising them means mocking the instance resolution as well
// as the client — a lot of scaffolding to assert one `.eq`. The
// clause is what matters and the clause is what this reads.
//
// If you are here because this failed: the fix is to filter, not to
// delete the assertion. A priority whose parent is archived must
// resolve its parent to null, which drops the page through to its
// existing no-parent state ("Back to plan", "Not linked to a goal or
// focus area"). The column is untouched either way, so un-archiving
// restores the link on both surfaces at once.

const SERVICE = path.resolve(
  __dirname,
  "../../../src/lib/plan/service.ts"
);

function source(): string {
  return readFileSync(SERVICE, "utf8");
}

// The chained call that resolves ONE parent row by id, from its
// `.from(table)` through to the `.maybeSingle`. Returned whole so the
// assertion can look for the filter anywhere inside it rather than
// depending on the order of the clauses.
function parentLookup(table: string, idExpr: string): string | null {
  const src = source();
  const needle = `.eq("id", ${idExpr})`;
  const at = src.indexOf(needle);
  if (at === -1) return null;
  const from = src.lastIndexOf(`.from("${table}")`, at);
  if (from === -1) return null;
  const end = src.indexOf("maybeSingle", at);
  if (end === -1) return null;
  return src.slice(from, end);
}

describe("an archived parent is not linked to", () => {
  it("resolves a priority's goal only when it is not archived", () => {
    const lookup = parentLookup("annual_goals", "priority.annual_goal_id");
    expect(lookup, "getPriorityDetail's goal lookup not found").not.toBeNull();
    expect(lookup).toContain('.eq("archived", false)');
  });

  it("resolves a priority's focus area only when it is not archived", () => {
    const lookup = parentLookup("strategic_focus_areas", "priority.sfa_id");
    expect(lookup, "getPriorityDetail's sfa lookup not found").not.toBeNull();
    expect(lookup).toContain('.eq("archived", false)');
  });

  it("resolves a goal's focus area only when it is not archived", () => {
    const lookup = parentLookup("strategic_focus_areas", "goal.sfa_id");
    expect(lookup, "getGoalDetail's sfa lookup not found").not.toBeNull();
    expect(lookup).toContain('.eq("archived", false)');
  });

  it("still loads the ROW itself without an archived filter", () => {
    // The guard is about a parent, not about the page. An archived
    // priority's own page has to keep rendering, or archiving a row
    // would 404 every link anybody had to it.
    const own = parentLookup("priorities", "priorityId");
    if (own) expect(own).not.toContain('.eq("archived", false)');
    const goalOwn = parentLookup("annual_goals", "goalId");
    if (goalOwn) expect(goalOwn).not.toContain('.eq("archived", false)');
  });
});
