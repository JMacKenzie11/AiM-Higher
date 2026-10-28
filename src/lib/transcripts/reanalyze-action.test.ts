import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/transcripts/reanalyze-action.ts.
// Reanalyze wipes downstream artifacts (commitments +
// issues linked to the meeting via source_meeting_id, then the
// analysis row), flips the meeting to 'pending', and kicks off
// the pipeline via next/server after().
//
// Contracts, since 2026-09-25:
// - system_admin only. A company admin, a guide and a team member are
//   refused before anything is written.
// - Refused for any meeting with a commitment or an issue sourced from
//   it, and it never deletes either. Only the analysis row goes.
// - Fails closed when the counts cannot be read.
// - after() failure falls back to fire-and-forget; either way,
//   processPendingMeetings gets called with the meeting id.

const mocks = vi.hoisted(() => {
  const meetingsSelectMaybeSingle = vi.fn();
  const commitmentsDelete = vi.fn();
  const issuesDelete = vi.fn();
  const commitmentsCount = vi.fn();
  const issuesCount = vi.fn();
  const analysesDelete = vi.fn();
  // Typed with a `_patch` arg so the mock signature matches the
  // adapter below and `.mock.calls[N][0]` is well-typed at the
  // assertion sites.
  // The reset is a compare-and-set: update().eq(id).in(status, from)
  // .select("id"). The statuses it was allowed to move from are
  // recorded so a test can assert them; an empty data array is a lost
  // claim (somebody else already started a run).
  const meetingsUpdate = vi.fn(
    async (_patch: unknown, _from?: string[]) => ({
      data: [{ id: "m_1" }] as Array<{ id: string }>,
      error: null as { message: string } | null,
    })
  );

  // Admin from() router mirrors the RLS-scoped one; the admin
  // client is used for the destructive path.
  const adminFrom = (table: string) => {
    if (table === "commitments") {
      return {
        select: () => ({ eq: () => commitmentsCount() }),
        delete: () => ({
          eq: () => ({
            select: () => commitmentsDelete(),
          }),
        }),
      };
    }
    if (table === "issues") {
      return {
        select: () => ({ eq: () => issuesCount() }),
        delete: () => ({
          eq: () => ({
            select: () => issuesDelete(),
          }),
        }),
      };
    }
    if (table === "meeting_analyses") {
      return {
        delete: () => ({
          eq: () => analysesDelete(),
        }),
      };
    }
    if (table === "meetings") {
      return {
        update: (patch: unknown) => ({
          eq: () => ({
            in: (_col: string, from: string[]) => ({
              select: () => meetingsUpdate(patch, from),
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected admin table in test: ${table}`);
  };

  const serverFrom = (table: string) => {
    if (table === "meetings") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: meetingsSelectMaybeSingle }),
        }),
      };
    }
    throw new Error(`Unexpected server table in test: ${table}`);
  };

  const serverClient = { from: serverFrom };
  const adminClient = { from: adminFrom };
  const requireProfile = vi.fn();
  const isAdminForCompany = vi.fn();
  const transcriptSourcesAllowed = vi.fn(
    (profile: { role: string }) =>
      profile.role === "system_admin" ||
      profile.role === "aims_guide" ||
      profile.role === "company_admin"
  );
  const processPendingMeetings = vi.fn(async () => ({
    processed: 1,
    recovered: 0,
  }));
  const revalidatePath = vi.fn();
  // Vercel's `after` runs the callback after the response returns.
  // In tests we just invoke it inline so the assertions see the
  // scheduled work.
  const after = vi.fn((cb: () => Promise<void> | void) => {
    // Fire-and-forget: mimic the runtime by invoking without await.
    void cb();
  });

  return {
    meetingsSelectMaybeSingle,
    commitmentsCount,
    issuesCount,
    commitmentsDelete,
    issuesDelete,
    analysesDelete,
    meetingsUpdate,
    serverClient,
    adminClient,
    requireProfile,
    isAdminForCompany,
    transcriptSourcesAllowed,
    processPendingMeetings,
    revalidatePath,
    after,
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
  transcriptSourcesAllowed: mocks.transcriptSourcesAllowed,
}));

vi.mock("./ingest", () => ({
  processPendingMeetings: mocks.processPendingMeetings,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("next/server", () => ({
  after: mocks.after,
}));

import {
  reanalyzeMeetingAction,
  retryFailedMeetingAction,
} from "./reanalyze-action";

const ADMIN = {
  id: "u_admin",
  role: "system_admin" as const,
  company_id: null,
};
const COMPANY_ADMIN = {
  id: "u_company_admin",
  role: "company_admin" as const,
  company_id: "co_acme",
};
const GUIDE = {
  id: "u_guide",
  role: "aims_guide" as const,
  company_id: null,
};
const OTHER_COMPANY_ADMIN = {
  id: "u_other_admin",
  role: "company_admin" as const,
  company_id: "co_other",
};
const PORTFOLIO_ADMIN = {
  id: "u_portfolio",
  role: "portfolio_admin" as const,
  company_id: null,
};
const MEMBER = {
  id: "u_member",
  role: "team_member" as const,
  company_id: "co_acme",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Who admins co_acme: the system admin, its own company admin, the
  // assigned guide, and (switched on) the portfolio admin. The other
  // company's admin does not.
  mocks.isAdminForCompany.mockImplementation(
    (profile: { id: string }, companyId: string) =>
      companyId === "co_acme" &&
      [ADMIN.id, COMPANY_ADMIN.id, GUIDE.id, PORTFOLIO_ADMIN.id].includes(
        profile.id
      )
  );
  mocks.commitmentsCount.mockResolvedValue({ count: 0, error: null });
  mocks.issuesCount.mockResolvedValue({ count: 0, error: null });
  mocks.meetingsSelectMaybeSingle.mockResolvedValue({
    data: { id: "m_1", company_id: "co_acme", status: "complete", error: null },
  });
  mocks.commitmentsDelete.mockResolvedValue({ data: [] });
  mocks.issuesDelete.mockResolvedValue({ data: [] });
  mocks.analysesDelete.mockResolvedValue({ error: null });
  mocks.meetingsUpdate.mockResolvedValue({ data: [{ id: "m_1" }], error: null });
});

describe("reanalyzeMeetingAction", () => {
  it("returns not-found when the meeting is missing", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.meetingsSelectMaybeSingle.mockResolvedValue({ data: null });
    const result = await reanalyzeMeetingAction("m_missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/not found/i);
    // No deletes should fire — the meeting doesn't exist.
    expect(mocks.commitmentsDelete).not.toHaveBeenCalled();
    expect(mocks.issuesDelete).not.toHaveBeenCalled();
  });

  it("blocks a non-admin", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: MEMBER });
    const result = await reanalyzeMeetingAction("m_1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/system admin/i);
    expect(mocks.analysesDelete).not.toHaveBeenCalled();
    expect(mocks.processPendingMeetings).not.toHaveBeenCalled();
  });

  it("blocks a company admin now: system_admin only", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: COMPANY_ADMIN });
    const result = await reanalyzeMeetingAction("m_1");
    expect(result.ok).toBe(false);
    expect(mocks.analysesDelete).not.toHaveBeenCalled();
    expect(mocks.meetingsUpdate).not.toHaveBeenCalled();
  });

  it("refuses a meeting with commitments from it, and deletes nothing", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.commitmentsCount.mockResolvedValue({ count: 3, error: null });
    const result = await reanalyzeMeetingAction("m_1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/commitments or issues/i);
    expect(mocks.analysesDelete).not.toHaveBeenCalled();
    expect(mocks.commitmentsDelete).not.toHaveBeenCalled();
    expect(mocks.processPendingMeetings).not.toHaveBeenCalled();
  });

  it("refuses a meeting with issues from it, and deletes nothing", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.issuesCount.mockResolvedValue({ count: 1, error: null });
    const result = await reanalyzeMeetingAction("m_1");
    expect(result.ok).toBe(false);
    expect(mocks.analysesDelete).not.toHaveBeenCalled();
    expect(mocks.issuesDelete).not.toHaveBeenCalled();
  });

  it("fails closed when it cannot count", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.commitmentsCount.mockResolvedValue({ count: null, error: { message: "boom" } });
    const result = await reanalyzeMeetingAction("m_1");
    expect(result.ok).toBe(false);
    expect(mocks.analysesDelete).not.toHaveBeenCalled();
  });

  it("with no commitments or issues, replaces only the analysis", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    const result = await reanalyzeMeetingAction("m_1");
    expect(result).toEqual({ ok: true });
    expect(mocks.analysesDelete).toHaveBeenCalledTimes(1);
    // Never, on any path.
    expect(mocks.commitmentsDelete).not.toHaveBeenCalled();
    expect(mocks.issuesDelete).not.toHaveBeenCalled();
  });

  it("flips meeting.status back to pending and clears any prior error", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    await reanalyzeMeetingAction("m_1");
    // update() was called with the reset patch.
    const patch = mocks.meetingsUpdate.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(patch).toEqual({ status: "pending", error: null });
  });

  it("schedules the pipeline to run out-of-band via after()", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    await reanalyzeMeetingAction("m_1");
    // after() was scheduled. Our mock invokes it inline, so the
    // processPendingMeetings mock should have been called with
    // the meeting id scope.
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.processPendingMeetings).toHaveBeenCalledWith({
      meetingId: "m_1",
    });
  });

  it("falls back to fire-and-forget when after() throws", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.after.mockImplementationOnce(() => {
      throw new Error("after() not available in this runtime");
    });
    await reanalyzeMeetingAction("m_1");
    // Fallback path calls processPendingMeetings directly (still
    // fire-and-forget, but scheduled).
    expect(mocks.processPendingMeetings).toHaveBeenCalledWith({
      meetingId: "m_1",
    });
  });

  it("revalidates the meeting summary path so the caller sees the pending state", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    await reanalyzeMeetingAction("m_1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      "/leadership/meetings/m_1"
    );
  });

  it("moves only from complete or failed, never from a run in progress", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    await reanalyzeMeetingAction("m_1");
    expect(mocks.meetingsUpdate.mock.calls[0]?.[1]).toEqual(["complete", "failed"]);
  });

  it("a second click loses the claim and starts nothing", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.meetingsUpdate.mockResolvedValueOnce({ data: [], error: null });
    const result = await reanalyzeMeetingAction("m_1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/already being analyzed/i);
    // The analysis is untouched and no model run is scheduled.
    expect(mocks.analysesDelete).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.processPendingMeetings).not.toHaveBeenCalled();
  });
});

describe("retryFailedMeetingAction", () => {
  const failed = (error: string | null = "overloaded", company_id = "co_acme") => ({
    data: { id: "m_1", company_id, status: "failed", error },
  });

  beforeEach(() => {
    mocks.meetingsSelectMaybeSingle.mockResolvedValue(failed());
  });

  it.each([
    ["a system admin", ADMIN],
    ["the company's own admin", COMPANY_ADMIN],
    ["an assigned guide", GUIDE],
  ])("lets %s run a failed meeting again", async (_label, profile) => {
    mocks.requireProfile.mockResolvedValue({ profile });
    const result = await retryFailedMeetingAction("m_1");
    expect(result).toEqual({ ok: true });
    expect(mocks.meetingsUpdate.mock.calls[0]?.[0]).toEqual({ status: "pending", error: null });
    // Failed only: a retry can never reset a complete meeting.
    expect(mocks.meetingsUpdate.mock.calls[0]?.[1]).toEqual(["failed"]);
    expect(mocks.processPendingMeetings).toHaveBeenCalledWith({ meetingId: "m_1" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/leadership");
  });

  it.each([
    ["another company's admin", OTHER_COMPANY_ADMIN],
    ["a team member", MEMBER],
    ["a portfolio admin", PORTFOLIO_ADMIN],
  ])("refuses %s and writes nothing", async (_label, profile) => {
    mocks.requireProfile.mockResolvedValue({ profile });
    const result = await retryFailedMeetingAction("m_1");
    expect(result.ok).toBe(false);
    expect(mocks.meetingsUpdate).not.toHaveBeenCalled();
    expect(mocks.analysesDelete).not.toHaveBeenCalled();
    expect(mocks.processPendingMeetings).not.toHaveBeenCalled();
  });

  it("refuses a meeting that is not failed", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: COMPANY_ADMIN });
    mocks.meetingsSelectMaybeSingle.mockResolvedValue({
      data: { id: "m_1", company_id: "co_acme", status: "complete", error: null },
    });
    const result = await retryFailedMeetingAction("m_1");
    expect(result.ok).toBe(false);
    expect(mocks.meetingsUpdate).not.toHaveBeenCalled();
  });

  it("refuses a dismissed meeting", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: COMPANY_ADMIN });
    mocks.meetingsSelectMaybeSingle.mockResolvedValue(failed("dismissed"));
    const result = await retryFailedMeetingAction("m_1");
    expect(result.ok).toBe(false);
    expect(mocks.meetingsUpdate).not.toHaveBeenCalled();
  });

  it("a double click starts one run: the second loses the claim", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: COMPANY_ADMIN });
    mocks.meetingsUpdate
      .mockResolvedValueOnce({ data: [{ id: "m_1" }], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    const [first, second] = await Promise.all([
      retryFailedMeetingAction("m_1"),
      retryFailedMeetingAction("m_1"),
    ]);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    expect(mocks.analysesDelete).toHaveBeenCalledTimes(1);
    expect(mocks.processPendingMeetings).toHaveBeenCalledTimes(1);
  });

  it("refuses a failed meeting with commitments from it", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: COMPANY_ADMIN });
    mocks.commitmentsCount.mockResolvedValue({ count: 2, error: null });
    const result = await retryFailedMeetingAction("m_1");
    expect(result.ok).toBe(false);
    expect(mocks.meetingsUpdate).not.toHaveBeenCalled();
  });
});
