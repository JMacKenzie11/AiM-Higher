import { describe, it, expect, beforeEach, vi } from "vitest";

// The accountability layer that stands in for a grant table.
//
// Two properties carry the weight. It must record a portfolio_admin's
// actions, and it must never fail the action it is recording — a
// portfolio_admin who creates a company and then sees an error
// because the log insert bounced will press the button again, and the
// second press makes a second company.

const mocks = vi.hoisted(() => {
  const insert = vi.fn(async () => ({ error: null }));
  const from = vi.fn(() => ({ insert }));
  return { insert, from };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ from: mocks.from }),
}));
vi.mock("@/lib/instances/current", () => ({
  getCurrentInstanceConfig: () => ({}),
}));

const PA = { id: "pa_1", role: "portfolio_admin" as const, company_id: null };

describe("recordPortfolioEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("writes the actor, action, company and detail", async () => {
    const { recordPortfolioEvent } = await import("./audit");

    await recordPortfolioEvent({
      profile: PA,
      action: "company_archived",
      companyId: "co_1",
      detail: { status: "archived" },
    });

    expect(mocks.from).toHaveBeenCalledWith("portfolio_admin_events");
    expect(mocks.insert).toHaveBeenCalledWith({
      actor_id: "pa_1",
      action: "company_archived",
      company_id: "co_1",
      detail: { status: "archived" },
    });
  });

  it("does nothing for any other role", async () => {
    // The table is about one role's reach. A system_admin's ordinary
    // work is not an event here, and the RLS policy agrees: an insert
    // from anyone else is refused rather than quietly stored.
    const { recordPortfolioEvent } = await import("./audit");

    for (const role of ["system_admin", "company_admin", "aims_guide", "team_member"] as const) {
      await recordPortfolioEvent({
        profile: { id: "x", role, company_id: null },
        action: "scoped_in",
        companyId: "co_1",
      });
    }

    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("swallows a failed insert rather than failing the action", async () => {
    mocks.insert.mockResolvedValueOnce({
      error: { message: "boom" },
    } as never);
    const { recordPortfolioEvent } = await import("./audit");

    await expect(
      recordPortfolioEvent({
        profile: PA,
        action: "company_created",
        companyId: "co_1",
      })
    ).resolves.toBeUndefined();
  });

  it("swallows a thrown client rather than failing the action", async () => {
    mocks.from.mockImplementationOnce(() => {
      throw new Error("no connection");
    });
    const { recordPortfolioEvent } = await import("./audit");

    await expect(
      recordPortfolioEvent({
        profile: PA,
        action: "user_invited",
        companyId: "co_1",
      })
    ).resolves.toBeUndefined();
  });

  it("defaults detail to an empty object rather than null", async () => {
    // The column is `jsonb not null default '{}'`. Sending null would
    // be a not-null violation on every event that has no detail.
    const { recordPortfolioEvent } = await import("./audit");

    await recordPortfolioEvent({
      profile: PA,
      action: "scoped_in",
      companyId: "co_1",
    });

    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ detail: {} })
    );
  });
});
