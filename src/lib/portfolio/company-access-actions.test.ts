import { describe, it, expect, beforeEach, vi } from "vitest";

// Setting a portfolio admin's company access.
//
// RLS IS THE BOUNDARY: portfolio_assignments_insert (0199) admits a
// row only when it names the caller, and the harness case
// portfolio-assignment-company-access covers the delete side. These
// cover the parts RLS cannot see — the diff, the self-only guard, and
// the ORDER of the release.
//
// THE ORDER IS THE INTERESTING ONE. Removing an assignment takes away
// the caller's only write path into that company, so the open
// commitments have to be released while the assignment still stands.
// Do it the other way round and the release is refused and the work
// is stranded: owned by somebody who cannot resolve it, rendering as
// "Unassigned" because the roster lookup no longer finds them, and
// unclaimable because owner_id is not actually null.

const mocks = vi.hoisted(() => ({
  profile: {
    id: "pa_1",
    role: "portfolio_admin" as string,
    company_id: null as string | null,
  },
  current: [] as Array<{ company_id: string }>,
  inserted: [] as Array<{ portfolio_admin_id: string; company_id: string }>,
  deleted: [] as string[],
  released: [] as string[],
  calls: [] as string[],
  revalidatePath: vi.fn(),
  recordEvent: vi.fn(),
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: async () => ({ profile: mocks.profile }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/portfolio/audit", () => ({
  recordPortfolioEvent: mocks.recordEvent,
}));
vi.mock("@/lib/instances/current", () => ({
  getCurrentInstanceConfig: () => ({}),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      if (table === "portfolio_assignments") {
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
      // commitments: update().eq().eq().eq().is().select()
      return {
        update: () => ({
          eq: (_c: string, companyId: string) => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  select: async () => {
                    mocks.calls.push("release");
                    mocks.released.push(companyId);
                    return { data: [{ id: "c1" }], error: null };
                  },
                }),
              }),
            }),
          }),
        }),
      };
    },
  }),
}));

async function setAccess(id: string, companyIds: string[]) {
  const { setPortfolioCompanyAccessAction } = await import(
    "./company-access-actions"
  );
  return setPortfolioCompanyAccessAction(id, companyIds);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profile = { id: "pa_1", role: "portfolio_admin", company_id: null };
  mocks.current = [];
  mocks.inserted = [];
  mocks.deleted = [];
  mocks.released = [];
  mocks.calls = [];
});

describe("setPortfolioCompanyAccessAction", () => {
  it("adds the companies that were ticked", async () => {
    const result = await setAccess("pa_1", ["co_a", "co_b"]);
    expect(result).toMatchObject({ ok: true, added: 2, removed: 0 });
    expect(mocks.inserted.map((r) => r.company_id)).toEqual(["co_a", "co_b"]);
  });

  it("writes nothing when nothing changed", async () => {
    mocks.current = [{ company_id: "co_a" }];
    const result = await setAccess("pa_1", ["co_a"]);
    expect(result).toMatchObject({ ok: true, added: 0, removed: 0 });
    expect(mocks.calls).toEqual([]);
  });

  it("releases open commitments BEFORE removing the assignment", async () => {
    // The claim this whole action is shaped around.
    mocks.current = [{ company_id: "co_a" }];
    const result = await setAccess("pa_1", []);
    expect(result).toMatchObject({ ok: true, removed: 1, released: 1 });
    expect(mocks.calls).toEqual(["release", "delete"]);
    expect(mocks.released).toEqual(["co_a"]);
  });

  it("only releases in the companies being removed", async () => {
    mocks.current = [{ company_id: "co_a" }, { company_id: "co_b" }];
    await setAccess("pa_1", ["co_b"]);
    expect(mocks.released).toEqual(["co_a"]);
    expect(mocks.deleted).toEqual(["co_a"]);
  });

  it("refuses to change somebody else's access", async () => {
    const result = await setAccess("pa_other", ["co_a"]);
    expect(result.ok).toBe(false);
    expect(mocks.calls).toEqual([]);
  });

  it("lets a system admin change anyone's", async () => {
    mocks.profile = { id: "root", role: "system_admin", company_id: null };
    expect((await setAccess("pa_1", ["co_a"])).ok).toBe(true);
  });

  it("records a grant and a revoke, one row each", async () => {
    // Decision 2: the arrangement must be "recorded, visible, and
    // never silent". The card shipped visible and not recorded.
    mocks.current = [{ company_id: "co_a" }];
    await setAccess("pa_1", ["co_b"]);
    const actions = mocks.recordEvent.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual([
      "company_access_granted",
      "company_access_revoked",
    ]);
  });

  it("records nothing when nothing changed", async () => {
    mocks.current = [{ company_id: "co_a" }];
    await setAccess("pa_1", ["co_a"]);
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it("refuses a company admin outright", async () => {
    mocks.profile = { id: "ca_1", role: "company_admin", company_id: "co_a" };
    const result = await setAccess("ca_1", ["co_a"]);
    expect(result.ok).toBe(false);
    expect(mocks.calls).toEqual([]);
  });
});
