import { describe, it, expect, beforeEach, vi } from "vitest";

// Tests for getIssuesPageData. The interesting logic is the
// enrichment + grouping, not the SQL:
//
// - Splits issues by status.open vs resolved.
// - Fetches every linked commitment in one round trip, enriches
//   with owner meta, drops soft-deleted rows.
// - Groups commitments under their parent issue via issue_id, so
//   IssueWithCommitments.commitments is the correct slice for
//   both open and resolved issues.
// - Resolved list carries the same enriched shape as open (recent
//   shape change — the read-only Resolved table needs the same
//   fields as Open to render its five columns).

const mocks = vi.hoisted(() => {
  const issuesOrder = vi.fn();
  const commitmentsOrder = vi.fn();
  const profilesIn = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "issues") {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              order: () => ({
                order: () => issuesOrder(),
              }),
            }),
          }),
        }),
      };
    }
    if (table === "commitments") {
      return {
        select: () => ({
          in: () => ({
            is: () => ({
              order: () => commitmentsOrder(),
            }),
          }),
        }),
      };
    }
    if (table === "profiles") {
      return {
        select: () => ({
          in: () => profilesIn(),
        }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const serverClient = { from: fromBuilder };

  return {
    issuesOrder,
    commitmentsOrder,
    profilesIn,
    serverClient,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.serverClient,
}));

import { getIssuesPageData } from "./service";

function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: "i_open_1",
    company_id: "co_acme",
    title: "Onboarding drift",
    desired_outcome: null,
    status: "open",
    rank: 0,
    source_meeting_id: null,
    resolved_at: null,
    created_by: "u_creator",
    created_at: "2026-08-20T00:00:00Z",
    updated_at: "2026-08-20T00:00:00Z",
    ...overrides,
  };
}

function commitment(overrides: Record<string, unknown> = {}) {
  return {
    id: "c_1",
    company_id: "co_acme",
    priority_id: null,
    issue_id: "i_open_1",
    functional_area_id: null,
    owner_id: "u_owner",
    description: "Draft the plan",
    week_ending: "2026-08-28",
    due_date: "2026-08-27",
    status: "open",
    completed_at: null,
    missed_reason: null,
    source_meeting_id: null,
    clarity_timeline: true,
    clarity_success: true,
    clarity_note: null,
    parked_at: null,
    deleted_at: null,
    resolved_by_role: null,
    resolved_by_profile_id: null,
    created_at: "2026-08-21T00:00:00Z",
    updated_at: "2026-08-21T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getIssuesPageData", () => {
  it("returns empty lists when the company has no issues", async () => {
    mocks.issuesOrder.mockResolvedValue({ data: [] });
    // commitmentsOrder + profilesIn should never be hit (short-circuit).
    const data = await getIssuesPageData("co_acme");
    expect(data).toEqual({ open: [], resolved: [] });
    expect(mocks.commitmentsOrder).not.toHaveBeenCalled();
    expect(mocks.profilesIn).not.toHaveBeenCalled();
  });

  it("splits open vs resolved issues", async () => {
    mocks.issuesOrder.mockResolvedValue({
      data: [
        issue({ id: "i_open_1", status: "open" }),
        issue({
          id: "i_resolved_1",
          status: "resolved",
          resolved_at: "2026-08-15T00:00:00Z",
        }),
        issue({ id: "i_open_2", status: "open" }),
      ],
    });
    mocks.commitmentsOrder.mockResolvedValue({ data: [] });
    mocks.profilesIn.mockResolvedValue({ data: [] });

    const data = await getIssuesPageData("co_acme");
    expect(data.open.map((i) => i.id)).toEqual(["i_open_1", "i_open_2"]);
    expect(data.resolved.map((i) => i.id)).toEqual(["i_resolved_1"]);
  });

  it("groups linked commitments under their parent issue", async () => {
    mocks.issuesOrder.mockResolvedValue({
      data: [
        issue({ id: "i_open_1" }),
        issue({ id: "i_open_2", rank: 1 }),
      ],
    });
    mocks.commitmentsOrder.mockResolvedValue({
      data: [
        commitment({ id: "c_a", issue_id: "i_open_1" }),
        commitment({ id: "c_b", issue_id: "i_open_2" }),
        commitment({ id: "c_c", issue_id: "i_open_1" }),
      ],
    });
    mocks.profilesIn.mockResolvedValue({
      data: [{ id: "u_owner", full_name: "Owner One", position: null }],
    });

    const data = await getIssuesPageData("co_acme");
    const one = data.open.find((i) => i.id === "i_open_1");
    const two = data.open.find((i) => i.id === "i_open_2");
    expect(one?.commitments.map((c) => c.id)).toEqual(["c_a", "c_c"]);
    expect(two?.commitments.map((c) => c.id)).toEqual(["c_b"]);
  });

  it("enriches each commitment with owner meta and stubs the parent issue link", async () => {
    mocks.issuesOrder.mockResolvedValue({
      data: [issue({ id: "i_open_1", title: "Onboarding drift" })],
    });
    mocks.commitmentsOrder.mockResolvedValue({
      data: [commitment({ id: "c_a", issue_id: "i_open_1", owner_id: "u_o" })],
    });
    mocks.profilesIn.mockResolvedValue({
      data: [{ id: "u_o", full_name: "Owen Owner", position: "PM" }],
    });

    const data = await getIssuesPageData("co_acme");
    const c = data.open[0]!.commitments[0]!;
    expect(c.owner).toEqual({
      id: "u_o",
      full_name: "Owen Owner",
      position: "PM",
    });
    // Priority + functional area are always null on issue-linked
    // commitments (DB constraint), even after enrichment.
    expect(c.priority).toBeNull();
    expect(c.functionalArea).toBeNull();
    // Parent issue is stubbed for LinkChip context.
    expect(c.issue).toEqual({
      id: "i_open_1",
      title: "Onboarding drift",
      status: "open",
    });
  });

  it("resolved issues carry the same enriched shape as open (not a stripped summary)", async () => {
    // Regression pin for the recent shape change: read-only
    // Resolved table depends on IssueWithCommitments so it can
    // render the same five columns as Open. If this ever reverts
    // to ResolvedIssueSummary, the read-only table breaks.
    mocks.issuesOrder.mockResolvedValue({
      data: [
        issue({
          id: "i_resolved_1",
          status: "resolved",
          resolved_at: "2026-08-15T00:00:00Z",
        }),
      ],
    });
    mocks.commitmentsOrder.mockResolvedValue({
      data: [
        commitment({
          id: "c_r",
          issue_id: "i_resolved_1",
          owner_id: "u_owner",
        }),
      ],
    });
    mocks.profilesIn.mockResolvedValue({
      data: [{ id: "u_owner", full_name: "Owen", position: null }],
    });

    const data = await getIssuesPageData("co_acme");
    const resolved = data.resolved[0]!;
    // Full Issue fields plus enriched commitments.
    expect(resolved.title).toBe("Onboarding drift");
    expect(resolved.desired_outcome).toBeNull();
    expect(resolved.commitments).toHaveLength(1);
    expect(resolved.commitments[0]!.owner?.full_name).toBe("Owen");
  });

  it("nulls owner when the profile isn't returned (owner deactivated or off-company)", async () => {
    mocks.issuesOrder.mockResolvedValue({
      data: [issue({ id: "i_open_1" })],
    });
    mocks.commitmentsOrder.mockResolvedValue({
      data: [commitment({ owner_id: "u_ghost" })],
    });
    mocks.profilesIn.mockResolvedValue({ data: [] });

    const data = await getIssuesPageData("co_acme");
    expect(data.open[0]!.commitments[0]!.owner).toBeNull();
  });

  it("an unowned commitment (owner_id null) never asks Supabase for zero ids", async () => {
    mocks.issuesOrder.mockResolvedValue({
      data: [issue({ id: "i_open_1" })],
    });
    mocks.commitmentsOrder.mockResolvedValue({
      data: [commitment({ owner_id: null })],
    });

    const data = await getIssuesPageData("co_acme");
    // The .in([]) short-circuit means profiles wasn't queried at all.
    expect(mocks.profilesIn).not.toHaveBeenCalled();
    expect(data.open[0]!.commitments[0]!.owner).toBeNull();
  });
});
