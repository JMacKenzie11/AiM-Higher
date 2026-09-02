import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/transcripts/routing-actions.ts.
// These fire from the meeting summary when the reader clicks
// "Add to open issues", "Link to priority / functional area", or
// "Convert to issue" on an extracted row.
//
// Contracts:
// - Only admins-for-company (system_admin, company_admin scoped
//   in, or assigned aims_guide) can promote extractions.
// - Idempotency: (source_meeting_id + text) already exists →
//   return ok=true without inserting. A double-click is safe.
// - addExtractedCommitmentAction validates the link target
//   (priority in same company + open quarter; functional area in
//   same company + not archived).
// - convertExtractedCommitmentToIssueAction creates an issue with
//   title = description (trimmed to 200), NEVER a commitment.

const mocks = vi.hoisted(() => {
  const meetingsSelectMaybeSingle = vi.fn();
  const issuesSelectMaybeSingle = vi.fn();
  const issuesSelectLimitMaybeSingle = vi.fn();
  const issuesInsertSingle = vi.fn();
  const issuesInsertResult = vi.fn();
  const issuesInsertPatch = vi.fn();
  const commitmentsSelectMaybeSingle = vi.fn();
  const commitmentsInsertPatch = vi.fn();
  const commitmentsInsertResult = vi.fn();
  const prioritiesSelectMaybeSingle = vi.fn();
  const quartersSelectMaybeSingle = vi.fn();
  const functionsSelectMaybeSingle = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "meetings") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: meetingsSelectMaybeSingle }),
        }),
      };
    }
    if (table === "issues") {
      return {
        select: (cols?: string) => {
          if (cols === "rank") {
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
          // Idempotency probe: .select("id").eq(source_meeting_id).eq(title).maybeSingle()
          return {
            eq: () => ({
              eq: () => ({ maybeSingle: issuesSelectMaybeSingle }),
            }),
          };
        },
        insert: (patch: unknown) => {
          issuesInsertPatch(patch);
          const chain = {
            select: () => ({ single: issuesInsertSingle }),
            then: (onFulfilled: (v: unknown) => unknown) =>
              issuesInsertResult().then(onFulfilled),
          };
          return chain;
        },
      };
    }
    if (table === "commitments") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({ maybeSingle: commitmentsSelectMaybeSingle }),
            }),
          }),
        }),
        insert: (patch: unknown) => {
          commitmentsInsertPatch(patch);
          return commitmentsInsertResult();
        },
      };
    }
    if (table === "priorities") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: prioritiesSelectMaybeSingle }),
        }),
      };
    }
    if (table === "quarters") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: quartersSelectMaybeSingle }),
        }),
      };
    }
    if (table === "functions") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: functionsSelectMaybeSingle }),
        }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const serverClient = { from: fromBuilder };
  const requireProfile = vi.fn();
  const isAdminForCompany = vi.fn();
  const revalidatePath = vi.fn();
  const trackAfter = vi.fn();
  const fridayOf = vi.fn(() => "2026-08-28");

  return {
    meetingsSelectMaybeSingle,
    issuesSelectMaybeSingle,
    issuesSelectLimitMaybeSingle,
    issuesInsertSingle,
    issuesInsertResult,
    issuesInsertPatch,
    commitmentsSelectMaybeSingle,
    commitmentsInsertPatch,
    commitmentsInsertResult,
    prioritiesSelectMaybeSingle,
    quartersSelectMaybeSingle,
    functionsSelectMaybeSingle,
    serverClient,
    requireProfile,
    isAdminForCompany,
    revalidatePath,
    trackAfter,
    fridayOf,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.serverClient,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: mocks.requireProfile,
}));

vi.mock("@/lib/auth/permissions", () => ({
  isAdminForCompany: mocks.isAdminForCompany,
}));

vi.mock("@/lib/dates", () => ({
  fridayOf: mocks.fridayOf,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/lib/analytics/track", () => ({
  trackAfter: mocks.trackAfter,
}));

import {
  addExtractedIssueAsResolvedAction,
  addExtractedIssueToOpenIssuesAction,
  addExtractedCommitmentAction,
  convertExtractedCommitmentToIssueAction,
} from "./routing-actions";

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
const MEETING = {
  id: "m_1",
  company_id: "co_acme",
  created_at: "2026-08-20T14:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isAdminForCompany.mockImplementation((profile: { id: string }) =>
    profile.id === ADMIN.id
  );
  mocks.meetingsSelectMaybeSingle.mockResolvedValue({ data: MEETING });
  mocks.issuesSelectLimitMaybeSingle.mockResolvedValue({ data: null });
  mocks.issuesSelectMaybeSingle.mockResolvedValue({ data: null });
  mocks.commitmentsSelectMaybeSingle.mockResolvedValue({ data: null });
  mocks.commitmentsInsertResult.mockResolvedValue({ error: null });
  mocks.issuesInsertResult.mockResolvedValue({ error: null });
  mocks.issuesInsertSingle.mockResolvedValue({
    data: { id: "i_new" },
    error: null,
  });
});

// ---- addExtractedIssueToOpenIssuesAction ----------------------
describe("addExtractedIssueToOpenIssuesAction", () => {
  it("blocks a non-admin", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: MEMBER });
    const result = await addExtractedIssueToOpenIssuesAction(
      "m_1",
      "New issue"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/admins and guides/i);
    expect(mocks.issuesInsertPatch).not.toHaveBeenCalled();
  });

  it("returns not-found when the meeting is missing", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.meetingsSelectMaybeSingle.mockResolvedValueOnce({ data: null });
    const result = await addExtractedIssueToOpenIssuesAction(
      "m_missing",
      "New issue"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/not found/i);
  });

  it("rejects an empty title", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    const result = await addExtractedIssueToOpenIssuesAction("m_1", "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/empty/i);
    expect(mocks.issuesInsertPatch).not.toHaveBeenCalled();
  });

  it("is idempotent when the same title already exists for this meeting", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({
      data: { id: "i_existing" },
    });
    const result = await addExtractedIssueToOpenIssuesAction(
      "m_1",
      "Already added"
    );
    expect(result.ok).toBe(true);
    expect(mocks.issuesInsertPatch).not.toHaveBeenCalled();
  });

  it("creates the issue and stamps source_meeting_id + created_by", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.issuesSelectLimitMaybeSingle.mockResolvedValue({ data: { rank: 3 } });
    const result = await addExtractedIssueToOpenIssuesAction(
      "m_1",
      "New issue"
    );
    expect(result.ok).toBe(true);
    const patch = mocks.issuesInsertPatch.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(patch.title).toBe("New issue");
    expect(patch.source_meeting_id).toBe("m_1");
    expect(patch.created_by).toBe(ADMIN.id);
    expect(patch.rank).toBe(4);
    expect(patch.company_id).toBe("co_acme");
    // The OPEN path must NOT claim the resolved-in-meeting
    // provenance. If it ever did, an issue added from a meeting and
    // worked normally would mislabel itself on /issues the moment
    // someone resolved it.
    expect(patch.resolved_in_meeting).toBeUndefined();
  });
});

// ---- addExtractedIssueAsResolvedAction ------------------------
describe("addExtractedIssueAsResolvedAction", () => {
  it("blocks a non-admin", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: MEMBER });
    const result = await addExtractedIssueAsResolvedAction(
      "m_1",
      "Already handled in the meeting"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/admins and guides/i);
    expect(mocks.issuesInsertPatch).not.toHaveBeenCalled();
  });

  it("returns not-found when the meeting is missing", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.meetingsSelectMaybeSingle.mockResolvedValueOnce({ data: null });
    const result = await addExtractedIssueAsResolvedAction(
      "m_missing",
      "Handled"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/not found/i);
  });

  it("rejects an empty title", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    const result = await addExtractedIssueAsResolvedAction("m_1", "   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/empty/i);
    expect(mocks.issuesInsertPatch).not.toHaveBeenCalled();
  });

  it("is idempotent when the same title already exists for this meeting", async () => {
    // First-click-wins: an issue already created via either path
    // (open or resolved) blocks a second insert. Prevents twins.
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({
      data: { id: "i_existing" },
    });
    const result = await addExtractedIssueAsResolvedAction(
      "m_1",
      "Already handled"
    );
    expect(result.ok).toBe(true);
    expect(mocks.issuesInsertPatch).not.toHaveBeenCalled();
  });

  it("inserts as resolved with resolved_at stamped, no desired outcome / commitment / owner", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    const before = Date.now();
    const result = await addExtractedIssueAsResolvedAction(
      "m_1",
      "Handled in the meeting"
    );
    const after = Date.now();
    expect(result.ok).toBe(true);
    const patch = mocks.issuesInsertPatch.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(patch.title).toBe("Handled in the meeting");
    expect(patch.status).toBe("resolved");
    expect(patch.source_meeting_id).toBe("m_1");
    expect(patch.created_by).toBe(ADMIN.id);
    expect(patch.company_id).toBe("co_acme");
    // Provenance marker (migration 0162). This is what lets /issues
    // print "Resolved in meeting" in the Commitment column instead of
    // a bare dash. Without it the row is indistinguishable from an
    // issue resolved by any other route with no commitment attached.
    expect(patch.resolved_in_meeting).toBe(true);
    // resolved_at must be an ISO timestamp within the window of
    // this test — proves the action stamped "now" and didn't leak
    // a stale value.
    const resolvedAt = Date.parse(patch.resolved_at as string);
    expect(resolvedAt).toBeGreaterThanOrEqual(before);
    expect(resolvedAt).toBeLessThanOrEqual(after);
    // Fields the spec says must be absent: the row lands closed
    // with no follow-up work attached.
    expect(patch.desired_outcome).toBeUndefined();
    // Nothing about this action should ever touch commitments.
    expect(mocks.commitmentsInsertPatch).not.toHaveBeenCalled();
  });
});

// ---- addExtractedCommitmentAction -----------------------------
describe("addExtractedCommitmentAction", () => {
  const baseInput = {
    meetingId: "m_1",
    description: "Ship the report",
    dueDate: "2026-08-25",
    ownerId: "u_owner",
    target: { type: "none" as const },
  };

  it("blocks a non-admin", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: MEMBER });
    const result = await addExtractedCommitmentAction(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/admins and guides/i);
    expect(mocks.commitmentsInsertPatch).not.toHaveBeenCalled();
  });

  it("is idempotent when the same description already exists for this meeting", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
      data: { id: "c_existing" },
    });
    const result = await addExtractedCommitmentAction(baseInput);
    expect(result.ok).toBe(true);
    expect(mocks.commitmentsInsertPatch).not.toHaveBeenCalled();
  });

  it("inserts with no link when target.type is 'none'", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    const result = await addExtractedCommitmentAction(baseInput);
    expect(result.ok).toBe(true);
    const patch = mocks.commitmentsInsertPatch.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(patch.priority_id).toBeNull();
    expect(patch.functional_area_id).toBeNull();
    expect(patch.source_meeting_id).toBe("m_1");
    expect(patch.description).toBe("Ship the report");
  });

  it("rejects a priority link outside this company", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.prioritiesSelectMaybeSingle.mockResolvedValue({
      data: {
        id: "p_1",
        company_id: "co_other",
        quarter_id: "q_1",
      },
    });
    const result = await addExtractedCommitmentAction({
      ...baseInput,
      target: { type: "priority", id: "p_1" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/isn't in this company/i);
    expect(mocks.commitmentsInsertPatch).not.toHaveBeenCalled();
  });

  it("rejects a priority whose quarter is not open", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.prioritiesSelectMaybeSingle.mockResolvedValue({
      data: { id: "p_1", company_id: "co_acme", quarter_id: "q_closed" },
    });
    mocks.quartersSelectMaybeSingle.mockResolvedValue({
      data: { status: "closed" },
    });
    const result = await addExtractedCommitmentAction({
      ...baseInput,
      target: { type: "priority", id: "p_1" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/open-quarter/i);
  });

  it("wires the priority link when it's valid", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.prioritiesSelectMaybeSingle.mockResolvedValue({
      data: { id: "p_1", company_id: "co_acme", quarter_id: "q_open" },
    });
    mocks.quartersSelectMaybeSingle.mockResolvedValue({
      data: { status: "open" },
    });
    const result = await addExtractedCommitmentAction({
      ...baseInput,
      target: { type: "priority", id: "p_1" },
    });
    expect(result.ok).toBe(true);
    const patch = mocks.commitmentsInsertPatch.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(patch.priority_id).toBe("p_1");
    expect(patch.functional_area_id).toBeNull();
  });

  it("rejects an archived functional area", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.functionsSelectMaybeSingle.mockResolvedValue({
      data: { id: "f_1", company_id: "co_acme", archived: true },
    });
    const result = await addExtractedCommitmentAction({
      ...baseInput,
      target: { type: "functional_area", id: "f_1" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/isn't accessible/i);
  });

  it("wires the functional area link when it's valid", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.functionsSelectMaybeSingle.mockResolvedValue({
      data: { id: "f_1", company_id: "co_acme", archived: false },
    });
    const result = await addExtractedCommitmentAction({
      ...baseInput,
      target: { type: "functional_area", id: "f_1" },
    });
    expect(result.ok).toBe(true);
    const patch = mocks.commitmentsInsertPatch.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(patch.functional_area_id).toBe("f_1");
    expect(patch.priority_id).toBeNull();
  });

  it("defaults due_date to the meeting date when caller omits it", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    const result = await addExtractedCommitmentAction({
      ...baseInput,
      dueDate: null,
    });
    expect(result.ok).toBe(true);
    const patch = mocks.commitmentsInsertPatch.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(patch.due_date).toBe("2026-08-20");
  });
});

// ---- convertExtractedCommitmentToIssueAction ------------------
describe("convertExtractedCommitmentToIssueAction", () => {
  it("blocks a non-admin", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: MEMBER });
    const result = await convertExtractedCommitmentToIssueAction(
      "m_1",
      "Some description"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/admins and guides/i);
    expect(mocks.issuesInsertPatch).not.toHaveBeenCalled();
  });

  it("is idempotent when an issue with the same title + meeting exists", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    mocks.issuesSelectMaybeSingle.mockResolvedValue({
      data: { id: "i_existing" },
    });
    const result = await convertExtractedCommitmentToIssueAction(
      "m_1",
      "Already converted"
    );
    expect(result.ok).toBe(true);
    expect(mocks.issuesInsertPatch).not.toHaveBeenCalled();
  });

  it("trims the description to 200 chars for the issue title", async () => {
    mocks.requireProfile.mockResolvedValue({ profile: ADMIN });
    const long = "A".repeat(250);
    const result = await convertExtractedCommitmentToIssueAction("m_1", long);
    expect(result.ok).toBe(true);
    const patch = mocks.issuesInsertPatch.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect((patch.title as string).length).toBe(200);
    expect(patch.source_meeting_id).toBe("m_1");
    // Explicitly assert: this creates ONLY an issue, never a
    // commitment. Convert-to-issue must not spawn a commitment.
    expect(mocks.commitmentsInsertPatch).not.toHaveBeenCalled();
  });
});
