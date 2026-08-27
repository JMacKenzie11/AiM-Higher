import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/issues/actions.ts. Contracts:
//
// - Edit rights: admin-for-company OR creator. Team members can
//   only rename/edit-outcome/resolve issues they created.
// - Title required, capped at 200 chars. Desired outcome trims to
//   null when empty.
// - createIssueAction lands at rank = max(open rank) + 1.
// - resolveIssueAction flips status → 'resolved' + stamps
//   resolved_at. Idempotent (returns ok on already-resolved).
// - reorderIssuesAction writes rank = index for every id in the
//   passed array; permission check runs against the first issue.

const mocks = vi.hoisted(() => {
  const issuesSelectMaybeSingle = vi.fn();
  const issuesSelectLimitMaybeSingle = vi.fn();
  const issuesInsertSingle = vi.fn();
  const issuesInsertPatch = vi.fn();
  const issuesUpdatePatch = vi.fn();
  const issuesUpdateSingle = vi.fn();
  const issuesUpdateNoSelect = vi.fn(async () => ({ error: null }));
  // Typed with the delete-options arg and count on the return so
  // `.mock.calls` and `.mockResolvedValue({error, count})` both
  // stay well-typed. Delete now goes through the admin client and
  // reads `count: "exact"` to guard against silent RLS 0-row hits.
  const issuesDelete = vi.fn(
    async (_opts?: { count?: string }): Promise<{
      error: unknown;
      count: number | null;
    }> => ({ error: null, count: 1 })
  );

  // Two shapes of select on the issues table:
  //   1. select("*").eq("id", x).maybeSingle()          — loadIssue
  //   2. select("rank").eq(...).eq(...).order().limit().maybeSingle()
  //      — createIssueAction's next-rank probe
  const fromBuilder = (table: string) => {
    if (table === "issues") {
      return {
        insert: (patch: unknown) => {
          issuesInsertPatch(patch);
          return { select: () => ({ single: issuesInsertSingle }) };
        },
        select: (cols?: string) => {
          if (cols === "rank") {
            // rank probe: .eq().eq().order().limit().maybeSingle()
            return {
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: issuesSelectLimitMaybeSingle,
                    }),
                  }),
                }),
              }),
            };
          }
          // loadIssue
          return {
            eq: () => ({ maybeSingle: issuesSelectMaybeSingle }),
          };
        },
        update: (patch: unknown) => {
          issuesUpdatePatch(patch);
          return {
            eq: () => ({
              // reorder path: .update().eq() with no select
              // returns { error } — Vitest sees it as the awaited
              // value on that chain.
              then: (
                onFulfilled: (v: { error: unknown }) => unknown
              ) => issuesUpdateNoSelect().then(onFulfilled),
              select: () => ({ single: issuesUpdateSingle }),
            }),
          };
        },
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  // Admin client is used for DELETE only (bypasses the missing
  // DELETE RLS policy on issues — see the action's comment).
  const adminFrom = (table: string) => {
    if (table === "issues") {
      return {
        delete: (opts?: { count?: string }) => ({
          eq: () => issuesDelete(opts),
        }),
      };
    }
    throw new Error(`Unexpected admin table in test: ${table}`);
  };

  const serverClient = { from: fromBuilder };
  const adminClient = { from: adminFrom };
  const requireProfile = vi.fn();
  const isAdminForCompany = vi.fn();
  const getEffectiveCompanyId = vi.fn();
  const revalidatePath = vi.fn();
  const trackAfter = vi.fn();

  return {
    issuesSelectMaybeSingle,
    issuesSelectLimitMaybeSingle,
    issuesInsertSingle,
    issuesInsertPatch,
    issuesUpdatePatch,
    issuesUpdateSingle,
    issuesUpdateNoSelect,
    issuesDelete,
    serverClient,
    adminClient,
    requireProfile,
    isAdminForCompany,
    getEffectiveCompanyId,
    revalidatePath,
    trackAfter,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.serverClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mocks.adminClient,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: mocks.requireProfile,
}));

vi.mock("@/lib/auth/permissions", () => ({
  isAdminForCompany: mocks.isAdminForCompany,
}));

vi.mock("@/lib/admin/scope", () => ({
  getEffectiveCompanyId: mocks.getEffectiveCompanyId,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/analytics/track", () => ({
  trackAfter: mocks.trackAfter,
}));

import {
  createIssueAction,
  renameIssueAction,
  updateIssueDesiredOutcomeAction,
  resolveIssueAction,
  reorderIssuesAction,
  deleteIssueAction,
} from "./actions";

const CREATOR = {
  id: "u_creator",
  role: "team_member" as const,
  company_id: "co_acme",
};
const OTHER_MEMBER = {
  id: "u_other",
  role: "team_member" as const,
  company_id: "co_acme",
};
const ADMIN = {
  id: "u_admin",
  role: "company_admin" as const,
  company_id: "co_acme",
};

function baseIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "i_1",
    company_id: "co_acme",
    title: "Onboarding is drifting",
    desired_outcome: null,
    status: "open" as const,
    rank: 0,
    source_meeting_id: null,
    resolved_at: null,
    created_by: CREATOR.id,
    created_at: "2026-08-20T00:00:00Z",
    updated_at: "2026-08-20T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAdminForCompany.mockImplementation((profile: { id: string }) =>
    profile.id === ADMIN.id
  );
  mocks.getEffectiveCompanyId.mockResolvedValue("co_acme");
  mocks.issuesUpdateNoSelect.mockResolvedValue({ error: null });
  mocks.issuesDelete.mockResolvedValue({ error: null, count: 1 });
});

// ---- createIssueAction ---------------------------------------
describe("createIssueAction", () => {
  it("rejects an empty title", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: CREATOR });
    const fd = new FormData();
    fd.set("title", "   ");
    const result = await createIssueAction(undefined, fd);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/name the issue/i);
    expect(mocks.issuesInsertPatch).not.toHaveBeenCalled();
  });

  it("rejects a title over 200 chars", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: CREATOR });
    const fd = new FormData();
    fd.set("title", "A".repeat(201));
    const result = await createIssueAction(undefined, fd);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/under 200/i);
  });

  it("rejects when no company scope is set", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: CREATOR });
    mocks.getEffectiveCompanyId.mockResolvedValue(null);
    const fd = new FormData();
    fd.set("title", "Real issue");
    const result = await createIssueAction(undefined, fd);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/company scope/i);
  });

  it("lands the new issue at rank = max + 1 and stamps created_by", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: CREATOR });
    mocks.issuesSelectLimitMaybeSingle.mockResolvedValue({
      data: { rank: 4 },
    });
    mocks.issuesInsertSingle.mockResolvedValue({
      data: baseIssue({ rank: 5, title: "Real issue" }),
      error: null,
    });
    const fd = new FormData();
    fd.set("title", "Real issue");
    const result = await createIssueAction(undefined, fd);
    expect(result.ok).toBe(true);
    const patch = mocks.issuesInsertPatch.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(patch.rank).toBe(5);
    expect(patch.created_by).toBe(CREATOR.id);
    expect(patch.company_id).toBe("co_acme");
    expect(patch.desired_outcome).toBeNull();
  });

  it("first-ever issue lands at rank 0", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: CREATOR });
    mocks.issuesSelectLimitMaybeSingle.mockResolvedValue({ data: null });
    mocks.issuesInsertSingle.mockResolvedValue({
      data: baseIssue({ rank: 0 }),
      error: null,
    });
    const fd = new FormData();
    fd.set("title", "First");
    await createIssueAction(undefined, fd);
    const patch = mocks.issuesInsertPatch.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(patch.rank).toBe(0);
  });

  it("trims desired_outcome to null when only whitespace", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: CREATOR });
    mocks.issuesSelectLimitMaybeSingle.mockResolvedValue({ data: null });
    mocks.issuesInsertSingle.mockResolvedValue({
      data: baseIssue(),
      error: null,
    });
    const fd = new FormData();
    fd.set("title", "Real issue");
    fd.set("desired_outcome", "   ");
    await createIssueAction(undefined, fd);
    const patch = mocks.issuesInsertPatch.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(patch.desired_outcome).toBeNull();
  });
});

// ---- renameIssueAction ---------------------------------------
describe("renameIssueAction", () => {
  it("lets the creator rename their own issue", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: CREATOR });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({ data: baseIssue() });
    mocks.issuesUpdateSingle.mockResolvedValue({
      data: baseIssue({ title: "New title" }),
      error: null,
    });
    const result = await renameIssueAction("i_1", "New title");
    expect(result.ok).toBe(true);
    expect(mocks.issuesUpdatePatch).toHaveBeenCalledWith({ title: "New title" });
  });

  it("lets an admin rename any issue in their company", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({
      data: baseIssue({ created_by: "u_someone_else" }),
    });
    mocks.issuesUpdateSingle.mockResolvedValue({
      data: baseIssue({ title: "New title" }),
      error: null,
    });
    const result = await renameIssueAction("i_1", "New title");
    expect(result.ok).toBe(true);
  });

  it("blocks a non-creator team member", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: OTHER_MEMBER });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({ data: baseIssue() });
    const result = await renameIssueAction("i_1", "New title");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/can't edit/i);
    expect(mocks.issuesUpdatePatch).not.toHaveBeenCalled();
  });

  it("returns not-found for a missing issue", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({ data: null });
    const result = await renameIssueAction("i_missing", "x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/not found/i);
  });

  it("rejects an empty title", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: CREATOR });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({ data: baseIssue() });
    const result = await renameIssueAction("i_1", "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/can't be empty/i);
  });
});

// ---- updateIssueDesiredOutcomeAction --------------------------
describe("updateIssueDesiredOutcomeAction", () => {
  it("stores a trimmed value on save", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: CREATOR });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({ data: baseIssue() });
    mocks.issuesUpdateSingle.mockResolvedValue({
      data: baseIssue({ desired_outcome: "Clear ramp plan" }),
      error: null,
    });
    const result = await updateIssueDesiredOutcomeAction(
      "i_1",
      "  Clear ramp plan  "
    );
    expect(result.ok).toBe(true);
    expect(mocks.issuesUpdatePatch).toHaveBeenCalledWith({
      desired_outcome: "Clear ramp plan",
    });
  });

  it("stores null when the value trims to empty", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: CREATOR });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({ data: baseIssue() });
    mocks.issuesUpdateSingle.mockResolvedValue({
      data: baseIssue(),
      error: null,
    });
    await updateIssueDesiredOutcomeAction("i_1", "    ");
    expect(mocks.issuesUpdatePatch).toHaveBeenCalledWith({
      desired_outcome: null,
    });
  });

  it("blocks a non-creator team member", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: OTHER_MEMBER });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({ data: baseIssue() });
    const result = await updateIssueDesiredOutcomeAction("i_1", "x");
    expect(result.ok).toBe(false);
    expect(mocks.issuesUpdatePatch).not.toHaveBeenCalled();
  });
});

// ---- resolveIssueAction --------------------------------------
describe("resolveIssueAction", () => {
  it("flips status to resolved and stamps resolved_at", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: CREATOR });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({ data: baseIssue() });
    mocks.issuesUpdateSingle.mockResolvedValue({
      data: baseIssue({ status: "resolved", resolved_at: "2026-08-27T…" }),
      error: null,
    });
    const result = await resolveIssueAction("i_1");
    expect(result.ok).toBe(true);
    const patch = mocks.issuesUpdatePatch.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(patch.status).toBe("resolved");
    expect(typeof patch.resolved_at).toBe("string");
  });

  it("is idempotent for an already-resolved issue", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({
      data: baseIssue({ status: "resolved", resolved_at: "2026-08-01T…" }),
    });
    const result = await resolveIssueAction("i_1");
    expect(result.ok).toBe(true);
    expect(mocks.issuesUpdatePatch).not.toHaveBeenCalled();
  });

  it("blocks a non-creator team member", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: OTHER_MEMBER });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({ data: baseIssue() });
    const result = await resolveIssueAction("i_1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/can't resolve/i);
  });
});

// ---- reorderIssuesAction -------------------------------------
describe("reorderIssuesAction", () => {
  it("is a no-op on empty input", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    const result = await reorderIssuesAction([]);
    expect(result.ok).toBe(true);
    expect(mocks.issuesUpdatePatch).not.toHaveBeenCalled();
  });

  it("blocks a non-creator team member", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: OTHER_MEMBER });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({ data: baseIssue() });
    const result = await reorderIssuesAction(["i_1", "i_2"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/can't reorder/i);
    expect(mocks.issuesUpdatePatch).not.toHaveBeenCalled();
  });

  it("writes rank = index for every id in order (admin)", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({ data: baseIssue() });
    const result = await reorderIssuesAction(["i_a", "i_b", "i_c"]);
    expect(result.ok).toBe(true);
    // One update patch per id, with rank = index.
    const patches = mocks.issuesUpdatePatch.mock.calls.map(
      (call) => call[0] as { rank: number }
    );
    expect(patches).toEqual([{ rank: 0 }, { rank: 1 }, { rank: 2 }]);
  });

  it("returns not-found when the first id doesn't exist", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({ data: null });
    const result = await reorderIssuesAction(["i_missing"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/not found/i);
  });
});

// ---- deleteIssueAction ---------------------------------------
describe("deleteIssueAction", () => {
  it("hard-deletes the row for an admin", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({ data: baseIssue() });
    const result = await deleteIssueAction("i_1");
    expect(result.ok).toBe(true);
    expect(mocks.issuesDelete).toHaveBeenCalledTimes(1);
  });

  it("blocks a non-admin (creators can't delete their own issue)", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: CREATOR });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({ data: baseIssue() });
    const result = await deleteIssueAction("i_1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/admins and guides/i);
    expect(mocks.issuesDelete).not.toHaveBeenCalled();
  });

  it("returns not-found for a missing issue without firing DELETE", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({ data: null });
    const result = await deleteIssueAction("i_missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/not found/i);
    expect(mocks.issuesDelete).not.toHaveBeenCalled();
  });

  it("surfaces a 0-rows-affected delete instead of pretending success", async () => {
    // Regression pin: DELETE via the RLS-scoped client used to
    // silently return { error: null, count: null } for admins
    // because migration 0143 ships no delete policy on issues.
    // The action now uses the admin client AND checks count so a
    // no-op delete never returns ok:true.
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({ data: baseIssue() });
    mocks.issuesDelete.mockResolvedValue({ error: null, count: 0 });
    const result = await deleteIssueAction("i_1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/already gone/i);
  });
});
