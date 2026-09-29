import { describe, it, expect, vi, beforeEach } from "vitest";

// The company admin switch (0247): system admins only, through their
// own session, and only on an assignment that exists.

const h = vi.hoisted(() => ({
  role: "system_admin" as string,
  updates: [] as Array<{ patch: unknown; filters: Array<[string, unknown]> }>,
  rows: [{ company_id: "co_a" }] as unknown[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));
vi.mock("@/lib/portfolio/audit", () => ({ recordPortfolioEvent: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: async () => ({ profile: { id: "me", role: h.role, company_id: null } }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => {
      const filters: Array<[string, unknown]> = [];
      let patch: unknown = null;
      const b: Record<string, unknown> = {};
      b.update = (p: unknown) => ((patch = p), b);
      b.eq = (k: string, v: unknown) => (filters.push([k, v]), b);
      b.select = async () => {
        h.updates.push({ patch, filters });
        return { data: h.rows, error: null };
      };
      return b;
    },
  }),
}));

beforeEach(() => {
  h.role = "system_admin";
  h.updates = [];
  h.rows = [{ company_id: "co_a" }];
});

describe("setPortfolioCompanyAdminAction", () => {
  it("lets a system admin switch an assignment on", async () => {
    const { setPortfolioCompanyAdminAction } = await import("./company-access-actions");
    expect(await setPortfolioCompanyAdminAction("pa_1", "co_a", true)).toEqual({ ok: true });
    expect(h.updates).toEqual([
      { patch: { acts_as_company_admin: true }, filters: [["portfolio_admin_id", "pa_1"], ["company_id", "co_a"]] },
    ]);
  });

  it.each(["portfolio_admin", "company_admin", "aims_guide", "team_member"])("refuses a %s and writes nothing", async (role) => {
    h.role = role;
    const { setPortfolioCompanyAdminAction } = await import("./company-access-actions");
    expect(await setPortfolioCompanyAdminAction("pa_1", "co_a", true)).toEqual({
      ok: false,
      message: "Only a system admin can change this.",
    });
    expect(h.updates).toEqual([]);
  });

  it("says so when there is no assignment to switch", async () => {
    h.rows = [];
    const { setPortfolioCompanyAdminAction } = await import("./company-access-actions");
    expect(await setPortfolioCompanyAdminAction("pa_1", "co_b", true)).toEqual({
      ok: false,
      message: "They need access to that company first.",
    });
  });
});
