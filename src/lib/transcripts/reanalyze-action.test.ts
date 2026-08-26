import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/transcripts/reanalyze-action.ts.
// Reanalyze wipes downstream artifacts (commitments +
// issues linked to the meeting via source_meeting_id, then the
// analysis row), flips the meeting to 'pending', and kicks off
// the pipeline via next/server after().
//
// Contracts:
// - Admin-for-company only. Team members and members of other
//   companies get rejected before any delete fires.
// - Returns the counts of what was deleted so the confirm dialog
//   can say what happened.
// - after() failure falls back to fire-and-forget; either way,
//   processPendingMeetings gets called with the meeting id.

const mocks = vi.hoisted(() => {
  const meetingsSelectMaybeSingle = vi.fn();
  const commitmentsDelete = vi.fn();
  const issuesDelete = vi.fn();
  const analysesDelete = vi.fn();
  const meetingsUpdate = vi.fn(async () => ({ error: null }));

  // Admin from() router mirrors the RLS-scoped one; the admin
  // client is used for the destructive path.
  const adminFrom = (table: string) => {
    if (table === "commitments") {
      return {
        delete: () => ({
          eq: () => ({
            select: () => commitmentsDelete(),
          }),
        }),
      };
    }
    if (table === "issues") {
      return {
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
          eq: () => meetingsUpdate(patch),
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
    commitmentsDelete,
    issuesDelete,
    analysesDelete,
    meetingsUpdate,
    serverClient,
    adminClient,
    requireProfile,
    isAdminForCompany,
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

import { reanalyzeMeetingAction } from "./reanalyze-action";

const ADMIN = {
  id: "u_admin",
  role: "company_admin" as const,
  company_id: "co_acme",
};
const MEMBER = {
  id: "u_member",
  role: "team_member" as const,
  company_id: "co_acme",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAdminForCompany.mockImplementation((profile: { id: string }) =>
    profile.id === ADMIN.id
  );
  mocks.meetingsSelectMaybeSingle.mockResolvedValue({
    data: { id: "m_1", company_id: "co_acme" },
  });
  mocks.commitmentsDelete.mockResolvedValue({ data: [] });
  mocks.issuesDelete.mockResolvedValue({ data: [] });
  mocks.analysesDelete.mockResolvedValue({ error: null });
  mocks.meetingsUpdate.mockResolvedValue({ error: null });
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
    if (!result.ok) expect(result.message).toMatch(/admins and guides/i);
    expect(mocks.commitmentsDelete).not.toHaveBeenCalled();
    expect(mocks.processPendingMeetings).not.toHaveBeenCalled();
  });

  it("wipes commitments + issues + analysis and returns deletion counts", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.commitmentsDelete.mockResolvedValue({
      data: [{ id: "c_1" }, { id: "c_2" }, { id: "c_3" }],
    });
    mocks.issuesDelete.mockResolvedValue({
      data: [{ id: "i_1" }],
    });

    const result = await reanalyzeMeetingAction("m_1");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deletedCommitments).toBe(3);
      expect(result.deletedIssues).toBe(1);
    }
    // All three destructive calls hit the admin client.
    expect(mocks.commitmentsDelete).toHaveBeenCalledTimes(1);
    expect(mocks.issuesDelete).toHaveBeenCalledTimes(1);
    expect(mocks.analysesDelete).toHaveBeenCalledTimes(1);
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
});
