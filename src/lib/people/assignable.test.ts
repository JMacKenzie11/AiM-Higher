import { describe, it, expect, vi } from "vitest";
import { getAssignablePeople } from "./assignable";
import type { SupabaseClient } from "@supabase/supabase-js";

// Who can be given a commitment in a company.
//
// RLS decides what comes back from each of these reads —
// profiles_select_assigned (0204) is the boundary, and the harness
// case profiles-select-assigned asserts it as five claims against the
// clone. These cover the assembly: the union, the de-duplication, and
// the behaviour when a caller cannot see the assigned rows at all.

type Row = Record<string, unknown>;

function client(tables: {
  members?: Row[];
  guides?: Row[];
  portfolio?: Row[];
  assigned?: Row[];
}): SupabaseClient {
  const calls: string[] = [];
  const api = {
    calls,
    from(table: string) {
      calls.push(table);
      const result = (data: Row[] | undefined) => ({ data: data ?? [] });
      if (table === "guide_assignments") {
        return { select: () => ({ eq: async () => result(tables.guides) }) };
      }
      if (table === "portfolio_assignments") {
        return { select: () => ({ eq: async () => result(tables.portfolio) }) };
      }
      // profiles: the members query chains .eq().neq().order(), the
      // assigned query chains .in().neq().order().
      return {
        select: () => ({
          eq: () => ({
            neq: () => ({ order: async () => result(tables.members) }),
          }),
          in: () => ({
            neq: () => ({ order: async () => result(tables.assigned) }),
          }),
        }),
      };
    },
  };
  return api as unknown as SupabaseClient;
}

const person = (id: string, name: string) => ({
  id,
  full_name: name,
  position: null,
});

describe("getAssignablePeople", () => {
  it("returns company members when nobody is assigned", async () => {
    const supabase = client({ members: [person("m1", "Dana")] });
    expect(await getAssignablePeople(supabase, "co_a")).toEqual([
      person("m1", "Dana"),
    ]);
  });

  it("appends an assigned guide after the members", async () => {
    const supabase = client({
      members: [person("m1", "Dana")],
      guides: [{ guide_id: "g1" }],
      assigned: [person("g1", "Jeff")],
    });
    expect(await getAssignablePeople(supabase, "co_a")).toEqual([
      person("m1", "Dana"),
      person("g1", "Jeff"),
    ]);
  });

  it("appends an assigned portfolio admin too", async () => {
    const supabase = client({
      members: [person("m1", "Dana")],
      portfolio: [{ portfolio_admin_id: "p1" }],
      assigned: [person("p1", "Scot")],
    });
    expect(await getAssignablePeople(supabase, "co_a")).toEqual([
      person("m1", "Dana"),
      person("p1", "Scot"),
    ]);
  });

  it("never lists somebody twice", async () => {
    // A portfolio admin who is also homed here would otherwise appear
    // as a member AND as an assignment.
    const supabase = client({
      members: [person("m1", "Dana"), person("p1", "Scot")],
      portfolio: [{ portfolio_admin_id: "p1" }],
      assigned: [person("p1", "Scot")],
    });
    const people = await getAssignablePeople(supabase, "co_a");
    expect(people.map((p) => p.id)).toEqual(["m1", "p1"]);
  });

  it("skips the second query entirely when there is nobody to fetch", async () => {
    const supabase = client({ members: [person("m1", "Dana")] });
    await getAssignablePeople(supabase, "co_a");
    const profileReads = (
      supabase as unknown as { calls: string[] }
    ).calls.filter((t) => t === "profiles");
    expect(profileReads).toHaveLength(1);
  });

  it("falls back to the members when RLS hides the assigned rows", async () => {
    // The pre-0204 shape, and the shape for any caller the policy
    // does not admit: the assignment rows resolve to ids, and the
    // profiles read returns nothing. The answer must be the list they
    // had before, never an empty one.
    const supabase = client({
      members: [person("m1", "Dana")],
      guides: [{ guide_id: "g1" }],
      assigned: [],
    });
    expect(await getAssignablePeople(supabase, "co_a")).toEqual([
      person("m1", "Dana"),
    ]);
  });
});
