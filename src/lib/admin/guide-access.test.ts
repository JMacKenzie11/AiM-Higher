import { describe, it, expect, beforeEach, vi } from "vitest";

// Setting a guide's whole caseload in one Update.
//
// Replaces the per-chip assign/unassign pair the old table used, and
// carries their invariants forward. Two of these tests exist because
// the behaviour they pin was previously covered against
// unassignGuideAction, which this action replaced — deleting the
// action must not delete the rule.
//
// THE RULE THAT MOVED: a guide keeps at least one company. A guide
// coaching nobody is a guide who should be deleted, and the message
// says so. A system admin carrying a caseload may go to zero; the
// role does not depend on the assignments.
//
// THE RULE THAT IS NEW: open commitments are released BEFORE the
// assignment is removed. A guide's auth_company_id() is null, so
// commitments_update_owner has never admitted them — is_guide_for()
// was their only write path. Remove the assignment first and the
// release is refused, leaving work owned by somebody who cannot
// resolve it, rendering as "Unassigned" because the roster lookup no
// longer finds them, and unclaimable because owner_id is not null.

const mocks = vi.hoisted(() => ({
  role: "aims_guide" as string,
  current: [] as Array<{ company_id: string }>,
  calls: [] as string[],
  inserted: [] as Array<{ guide_id: string; company_id: string }>,
  released: [] as string[],
  deleted: [] as string[],
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireRole: async () => ({ profile: { id: "root", role: "system_admin" } }),
  requireProfile: async () => ({ profile: { id: "root", role: "system_admin" } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/instances/current", () => ({
  getCurrentInstanceConfig: () => ({}),
}));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: async () => ({
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { role: mocks.role } }),
            }),
          }),
        };
      }
      if (table === "guide_assignments") {
        return {
          select: () => ({
            eq: async () => ({ data: mocks.current, error: null }),
          }),
          insert: async (rows: typeof mocks.inserted) => {
            mocks.calls.push("insert");
            mocks.inserted.push(...rows);
            return { error: null };
          },
          delete: () => ({
            eq: () => ({
              in: async (_c: string, ids: string[]) => {
                mocks.calls.push("delete");
                mocks.deleted.push(...ids);
                return { error: null };
              },
            }),
          }),
        };
      }
      return {
        update: () => ({
          eq: (_c: string, companyId: string) => ({
            eq: () => ({
              eq: () => ({
                is: async () => {
                  mocks.calls.push("release");
                  mocks.released.push(companyId);
                  return { error: null };
                },
              }),
            }),
          }),
        }),
      };
    },
  }),
}));

async function setAccess(id: string, companyIds: string[]) {
  const { setGuideCompanyAccessAction } = await import("./guides-actions");
  return setGuideCompanyAccessAction(id, companyIds);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "aims_guide";
  mocks.current = [];
  mocks.calls = [];
  mocks.inserted = [];
  mocks.released = [];
  mocks.deleted = [];
});

describe("setGuideCompanyAccessAction", () => {
  it("adds the companies that were ticked", async () => {
    expect((await setAccess("g_1", ["co_a", "co_b"])).ok).toBe(true);
    expect(mocks.inserted.map((r) => r.company_id)).toEqual(["co_a", "co_b"]);
  });

  it("writes nothing when nothing changed", async () => {
    mocks.current = [{ company_id: "co_a" }];
    expect((await setAccess("g_1", ["co_a"])).ok).toBe(true);
    expect(mocks.calls).toEqual([]);
  });

  it("refuses to leave a guide with no companies", async () => {
    // Carried over from unassignGuideAction. Deleting that action
    // must not delete its rule.
    mocks.current = [{ company_id: "co_a" }];
    const res = await setAccess("g_1", []);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/at least one company/i);
    expect(mocks.calls).toEqual([]);
  });

  it("lets a system admin carrying a caseload go to zero", async () => {
    // Also carried over: the caseload is a marker for them, not the
    // thing their access rests on.
    mocks.role = "system_admin";
    mocks.current = [{ company_id: "co_a" }];
    expect((await setAccess("root", [])).ok).toBe(true);
    expect(mocks.deleted).toEqual(["co_a"]);
  });

  it("releases open commitments BEFORE removing the assignment", async () => {
    mocks.current = [{ company_id: "co_a" }, { company_id: "co_b" }];
    await setAccess("g_1", ["co_b"]);
    expect(mocks.calls).toEqual(["release", "delete"]);
    expect(mocks.released).toEqual(["co_a"]);
  });

  it("only releases in the companies being removed", async () => {
    mocks.current = [{ company_id: "co_a" }, { company_id: "co_b" }];
    await setAccess("g_1", ["co_a"]);
    expect(mocks.released).toEqual(["co_b"]);
    expect(mocks.deleted).toEqual(["co_b"]);
  });
});
