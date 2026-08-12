import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/commitments/actions.ts. The
// commitment lifecycle has several load-bearing contracts:
//   - Kept is on-time only. An overdue open commitment MUST go
//     through Missed (labelled "Closed" in the UI).
//   - Missed and Reschedule REQUIRE a reason — the reason is the
//     coaching signal that shows the pattern over time.
//   - linkPriorityAction: resolved commitments have their link
//     FROZEN — a resolved row can't be silently retargeted to a
//     different priority because that would rewrite priority
//     progress history.
//   - reassignCommitmentAction: cross-company handoff is blocked
//     (RLS would break, priority progress would go silent), EXCEPT
//     for the system_admin coach special case who can be assigned
//     commitments in client meetings without a company membership.
//   - deleteCommitmentAction: non-admins can only delete their OWN
//     OPEN commitment; resolved rows stay in history no matter what.

// ---- Shared spies + fakes -------------------------------------
const mocks = vi.hoisted(() => {
  const commitmentsInsertPatch = vi.fn();
  const commitmentsInsertSingle = vi.fn();
  const commitmentsSelectMaybeSingle = vi.fn();
  const commitmentsUpdatePatch = vi.fn();
  const commitmentsUpdateSingle = vi.fn();
  const commitmentsDeleteEq = vi.fn();

  const prioritiesSelectMaybeSingle = vi.fn();
  const quartersSelectMaybeSingle = vi.fn();
  const profilesSelectMaybeSingle = vi.fn();
  const companiesSelectMaybeSingle = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "commitments") {
      return {
        insert: (patch: unknown) => {
          commitmentsInsertPatch(patch);
          return { select: () => ({ single: commitmentsInsertSingle }) };
        },
        select: () => ({
          eq: () => ({ maybeSingle: commitmentsSelectMaybeSingle }),
        }),
        update: (patch: unknown) => {
          commitmentsUpdatePatch(patch);
          return {
            eq: () => ({
              select: () => ({ single: commitmentsUpdateSingle }),
            }),
          };
        },
        delete: () => ({ eq: () => commitmentsDeleteEq() }),
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
    if (table === "profiles") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: profilesSelectMaybeSingle }),
        }),
      };
    }
    if (table === "companies") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: companiesSelectMaybeSingle }),
        }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const serverClient = { from: fromBuilder };
  const requireProfile = vi.fn();
  const canWriteOwnedRow = vi.fn();
  const isAdminForCompany = vi.fn();
  const getEffectiveCompanyId = vi.fn();
  const scoreCommitmentClarity = vi.fn();
  const fridayOf = vi.fn();
  const todayInTimezone = vi.fn();
  const revalidatePath = vi.fn();

  return {
    commitmentsInsertPatch,
    commitmentsInsertSingle,
    commitmentsSelectMaybeSingle,
    commitmentsUpdatePatch,
    commitmentsUpdateSingle,
    commitmentsDeleteEq,
    prioritiesSelectMaybeSingle,
    quartersSelectMaybeSingle,
    profilesSelectMaybeSingle,
    companiesSelectMaybeSingle,
    serverClient,
    requireProfile,
    canWriteOwnedRow,
    isAdminForCompany,
    getEffectiveCompanyId,
    scoreCommitmentClarity,
    fridayOf,
    todayInTimezone,
    revalidatePath,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.serverClient,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: mocks.requireProfile,
}));

vi.mock("@/lib/auth/permissions", () => ({
  canWriteOwnedRow: mocks.canWriteOwnedRow,
  isAdminForCompany: mocks.isAdminForCompany,
}));

vi.mock("@/lib/admin/scope", () => ({
  getEffectiveCompanyId: mocks.getEffectiveCompanyId,
}));

vi.mock("./clarity", () => ({
  scoreCommitmentClarity: mocks.scoreCommitmentClarity,
}));

vi.mock("@/lib/dates", () => ({
  fridayOf: mocks.fridayOf,
  todayInTimezone: mocks.todayInTimezone,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

// ---- Helpers --------------------------------------------------
function formDataFrom(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

function commitmentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c_1",
    company_id: "co_acme",
    priority_id: "pri_1",
    owner_id: "owner_1",
    description: "Send the estimate",
    week_ending: "2026-08-14",
    due_date: "2026-08-14",
    status: "open" as
      | "open"
      | "kept"
      | "missed"
      | "in_progress",
    completed_at: null as string | null,
    missed_reason: null as string | null,
    clarity_timeline: null,
    clarity_success: null,
    clarity_note: null,
    ...overrides,
  };
}

function primeHappyPath() {
  mocks.requireProfile.mockResolvedValue({
    profile: {
      id: "owner_1",
      role: "company_admin",
      company_id: "co_acme",
    },
  });
  mocks.canWriteOwnedRow.mockReturnValue(true);
  mocks.isAdminForCompany.mockReturnValue(true);
  mocks.getEffectiveCompanyId.mockResolvedValue("co_acme");
  mocks.scoreCommitmentClarity.mockResolvedValue(null);
  mocks.fridayOf.mockImplementation((d: string) => d); // pass-through
  mocks.todayInTimezone.mockReturnValue({ iso: "2026-08-14" });
  mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
    data: commitmentRow(),
    error: null,
  });
  mocks.commitmentsInsertSingle.mockResolvedValue({
    data: commitmentRow(),
    error: null,
  });
  mocks.commitmentsUpdateSingle.mockResolvedValue({
    data: commitmentRow(),
    error: null,
  });
  mocks.commitmentsDeleteEq.mockResolvedValue({ error: null });
  mocks.prioritiesSelectMaybeSingle.mockResolvedValue({
    data: { id: "pri_1", company_id: "co_acme", quarter_id: "q_1" },
    error: null,
  });
  mocks.quartersSelectMaybeSingle.mockResolvedValue({
    data: { status: "open" },
    error: null,
  });
  mocks.profilesSelectMaybeSingle.mockResolvedValue({
    data: {
      id: "new_owner",
      company_id: "co_acme",
      status: "active",
      role: "team_member",
    },
    error: null,
  });
  mocks.companiesSelectMaybeSingle.mockResolvedValue({
    data: { timezone: "America/Anchorage" },
    error: null,
  });
}

// ==============================================================
// createCommitmentAction
// ==============================================================
describe("createCommitmentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects an empty description", async () => {
    const { createCommitmentAction } = await import("./actions");

    const res = await createCommitmentAction(
      undefined,
      formDataFrom({ description: "  ", due_date: "2026-08-14" })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/what the commitment/);
    expect(mocks.commitmentsInsertPatch).not.toHaveBeenCalled();
  });

  it("rejects a missing due date (and week_ending fallback)", async () => {
    const { createCommitmentAction } = await import("./actions");

    const res = await createCommitmentAction(
      undefined,
      formDataFrom({ description: "Send estimate" })
    );

    expect(res).toEqual({ ok: false, message: "Pick a due date." });
  });

  it("buckets the commitment into the FRIDAY of the week containing its due date", async () => {
    // Contract: week_ending is always Friday so weekly rollups line up.
    mocks.fridayOf.mockReturnValueOnce("2026-08-14"); // Fri for a Wed input
    const { createCommitmentAction } = await import("./actions");

    await createCommitmentAction(
      undefined,
      formDataFrom({ description: "Send estimate", due_date: "2026-08-12" })
    );

    expect(mocks.fridayOf).toHaveBeenCalledWith("2026-08-12");
    const patch = mocks.commitmentsInsertPatch.mock.calls[0][0] as {
      week_ending: string;
    };
    expect(patch.week_ending).toBe("2026-08-14");
  });

  it("lets an admin set owner_id to someone else via the form field", async () => {
    mocks.isAdminForCompany.mockReturnValueOnce(true);
    const { createCommitmentAction } = await import("./actions");

    await createCommitmentAction(
      undefined,
      formDataFrom({
        description: "Send estimate",
        due_date: "2026-08-14",
        owner_id: "someone_else",
      })
    );

    const patch = mocks.commitmentsInsertPatch.mock.calls[0][0] as {
      owner_id: string;
    };
    expect(patch.owner_id).toBe("someone_else");
  });

  it("ignores a non-admin caller's owner_id override — defaults to the caller", async () => {
    // Otherwise a team_member could assign work to a peer just by
    // hand-submitting the form with a different owner_id.
    mocks.isAdminForCompany.mockReturnValue(false);
    mocks.requireProfile.mockResolvedValue({
      profile: {
        id: "caller_1",
        role: "team_member",
        company_id: "co_acme",
      },
    });
    const { createCommitmentAction } = await import("./actions");

    await createCommitmentAction(
      undefined,
      formDataFrom({
        description: "Send estimate",
        due_date: "2026-08-14",
        owner_id: "someone_else",
      })
    );

    const patch = mocks.commitmentsInsertPatch.mock.calls[0][0] as {
      owner_id: string;
    };
    expect(patch.owner_id).toBe("caller_1");
  });
});

// ==============================================================
// markKeptAction — on-time only
// ==============================================================
describe("markKeptAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects an overdue open commitment — it must go through Missed instead", async () => {
    // Contract: Kept is on-time only. Overdue = late = Missed (which
    // the UI renders as "Closed"). Sneaking a Kept for an overdue row
    // would fake the Follow-Through Rate.
    mocks.todayInTimezone.mockReturnValueOnce({ iso: "2026-08-15" });
    mocks.commitmentsSelectMaybeSingle.mockResolvedValueOnce({
      data: commitmentRow({ due_date: "2026-08-10" }),
      error: null,
    });
    const { markKeptAction } = await import("./actions");

    const res = await markKeptAction("c_1");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/close it with a reason/);
    expect(mocks.commitmentsUpdatePatch).not.toHaveBeenCalled();
  });

  it("rejects a commitment that isn't open", async () => {
    mocks.commitmentsSelectMaybeSingle.mockResolvedValueOnce({
      data: commitmentRow({ status: "kept" }),
      error: null,
    });
    const { markKeptAction } = await import("./actions");

    const res = await markKeptAction("c_1");

    expect(res.ok).toBe(false);
    expect(mocks.commitmentsUpdatePatch).not.toHaveBeenCalled();
  });

  it("marks Kept and stamps completed_at while clearing missed_reason on the happy path", async () => {
    const { markKeptAction } = await import("./actions");

    const res = await markKeptAction("c_1");

    expect(res.ok).toBe(true);
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "kept",
        completed_at: expect.any(String),
        missed_reason: null,
      })
    );
  });
});

// ==============================================================
// markMissedAction — requires a reason
// ==============================================================
describe("markMissedAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("requires a non-empty reason", async () => {
    // The reason is the coaching signal — without it, "missed" is
    // just a flag with no learning value.
    const { markMissedAction } = await import("./actions");

    const res = await markMissedAction("c_1", "   ");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/short reason/);
    expect(mocks.commitmentsUpdatePatch).not.toHaveBeenCalled();
  });

  it("writes status='missed' + missed_reason + completed_at on the happy path", async () => {
    const { markMissedAction } = await import("./actions");

    await markMissedAction("c_1", "Blocked on client approval");

    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "missed",
        missed_reason: "Blocked on client approval",
        completed_at: expect.any(String),
      })
    );
  });
});

// ==============================================================
// rescheduleCommitmentAction — reason + date required
// ==============================================================
describe("rescheduleCommitmentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("requires both a new date AND a reason", async () => {
    const { rescheduleCommitmentAction } = await import("./actions");

    const noReason = await rescheduleCommitmentAction("c_1", "2026-09-01", " ");
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.message).toMatch(/short reason/);

    const noDate = await rescheduleCommitmentAction("c_1", " ", "delayed");
    expect(noDate.ok).toBe(false);
    if (!noDate.ok) expect(noDate.message).toMatch(/new due date/);

    expect(mocks.commitmentsUpdatePatch).not.toHaveBeenCalled();
  });

  it("stamps the reason into missed_reason (the audit trail lives there)", async () => {
    // Contract: reschedules aren't a free action — they leave a trail
    // in missed_reason so the pattern is visible over time.
    mocks.fridayOf.mockReturnValueOnce("2026-09-04");
    const { rescheduleCommitmentAction } = await import("./actions");

    await rescheduleCommitmentAction("c_1", "2026-09-02", "customer holiday");

    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith({
      due_date: "2026-09-02",
      week_ending: "2026-09-04",
      missed_reason: "customer holiday",
    });
  });
});

// ==============================================================
// reassignCommitmentAction — cross-company + coach exception
// ==============================================================
describe("reassignCommitmentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("blocks a cross-company handoff (would break RLS + priority progress)", async () => {
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "outsider",
        company_id: "co_other",
        status: "active",
        role: "team_member",
      },
      error: null,
    });
    const { reassignCommitmentAction } = await import("./actions");

    const res = await reassignCommitmentAction("c_1", "outsider");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/isn't in this company/);
    expect(mocks.commitmentsUpdatePatch).not.toHaveBeenCalled();
  });

  it("ALLOWS a system_admin coach even without matching company (they take on commitments in client meetings)", async () => {
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "coach_1",
        company_id: null,
        status: "active",
        role: "system_admin",
      },
      error: null,
    });
    const { reassignCommitmentAction } = await import("./actions");

    const res = await reassignCommitmentAction("c_1", "coach_1");

    expect(res.ok).toBe(true);
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith({
      owner_id: "coach_1",
    });
  });

  it("blocks reassignment to an INACTIVE user", async () => {
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "gone",
        company_id: "co_acme",
        status: "inactive",
        role: "team_member",
      },
      error: null,
    });
    const { reassignCommitmentAction } = await import("./actions");

    const res = await reassignCommitmentAction("c_1", "gone");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/inactive/);
    expect(mocks.commitmentsUpdatePatch).not.toHaveBeenCalled();
  });

  it("allows a team_member to CLAIM a null-owner row for themselves", async () => {
    // The team-member self-claim escape hatch: canWriteOwnedRow would
    // normally reject a peer, but a null-owner row is unclaimed and
    // any active member of the same company can pick it up.
    mocks.canWriteOwnedRow.mockReturnValue(false);
    mocks.requireProfile.mockResolvedValue({
      profile: {
        id: "claimer",
        role: "team_member",
        company_id: "co_acme",
      },
    });
    mocks.commitmentsSelectMaybeSingle.mockResolvedValueOnce({
      data: commitmentRow({ owner_id: null }),
      error: null,
    });
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "claimer",
        company_id: "co_acme",
        status: "active",
        role: "team_member",
      },
      error: null,
    });
    const { reassignCommitmentAction } = await import("./actions");

    const res = await reassignCommitmentAction("c_1", "claimer");

    expect(res.ok).toBe(true);
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith({
      owner_id: "claimer",
    });
  });
});

// ==============================================================
// linkPriorityAction — frozen when resolved
// ==============================================================
describe("linkPriorityAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("refuses to relink a RESOLVED commitment (would rewrite priority progress history)", async () => {
    // Contract: once a commitment is Kept or Missed, its priority
    // link is frozen. Otherwise a resolved kept row could be moved to
    // Priority B, silently boosting B's progress while B never really
    // shipped that work.
    mocks.commitmentsSelectMaybeSingle.mockResolvedValueOnce({
      data: commitmentRow({ status: "kept" }),
      error: null,
    });
    const { linkPriorityAction } = await import("./actions");

    const res = await linkPriorityAction("c_1", "pri_2");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/frozen/);
    expect(mocks.commitmentsUpdatePatch).not.toHaveBeenCalled();
  });

  it("rejects a priority that belongs to a different company", async () => {
    mocks.prioritiesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "pri_other", company_id: "co_other", quarter_id: "q_1" },
      error: null,
    });
    const { linkPriorityAction } = await import("./actions");

    const res = await linkPriorityAction("c_1", "pri_other");

    expect(res.ok).toBe(false);
    expect(mocks.commitmentsUpdatePatch).not.toHaveBeenCalled();
  });

  it("rejects a priority whose quarter is CLOSED", async () => {
    // Linking into a closed quarter would rewrite historical
    // quarter-level rollups.
    mocks.quartersSelectMaybeSingle.mockResolvedValueOnce({
      data: { status: "closed" },
      error: null,
    });
    const { linkPriorityAction } = await import("./actions");

    const res = await linkPriorityAction("c_1", "pri_1");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/open quarter/);
  });

  it("allows unlinking (priorityId=null) on an open commitment", async () => {
    const { linkPriorityAction } = await import("./actions");

    const res = await linkPriorityAction("c_1", null);

    expect(res.ok).toBe(true);
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith({
      priority_id: null,
    });
  });
});

// ==============================================================
// deleteCommitmentAction — resolved rows stay in history
// ==============================================================
describe("deleteCommitmentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("lets a non-admin owner delete their OWN OPEN commitment", async () => {
    mocks.isAdminForCompany.mockReturnValue(false);
    mocks.requireProfile.mockResolvedValue({
      profile: {
        id: "owner_1",
        role: "team_member",
        company_id: "co_acme",
      },
    });
    const { deleteCommitmentAction } = await import("./actions");

    const res = await deleteCommitmentAction("c_1");

    expect(res).toEqual({ ok: true });
    expect(mocks.commitmentsDeleteEq).toHaveBeenCalledTimes(1);
  });

  it("blocks a non-admin non-owner from deleting", async () => {
    mocks.isAdminForCompany.mockReturnValue(false);
    mocks.requireProfile.mockResolvedValue({
      profile: {
        id: "peer_1",
        role: "team_member",
        company_id: "co_acme",
      },
    });
    const { deleteCommitmentAction } = await import("./actions");

    const res = await deleteCommitmentAction("c_1");

    expect(res).toEqual({ ok: false, message: "Not yours to delete." });
    expect(mocks.commitmentsDeleteEq).not.toHaveBeenCalled();
  });

  it("refuses to delete a RESOLVED commitment even for the owner (stays in history)", async () => {
    // Non-admin path: resolved commitments contribute to
    // Follow-Through Rate history; deleting them would silently move
    // that historical metric.
    mocks.isAdminForCompany.mockReturnValue(false);
    mocks.requireProfile.mockResolvedValue({
      profile: {
        id: "owner_1",
        role: "team_member",
        company_id: "co_acme",
      },
    });
    mocks.commitmentsSelectMaybeSingle.mockResolvedValueOnce({
      data: commitmentRow({ status: "kept" }),
      error: null,
    });
    const { deleteCommitmentAction } = await import("./actions");

    const res = await deleteCommitmentAction("c_1");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/stay in history/);
    expect(mocks.commitmentsDeleteEq).not.toHaveBeenCalled();
  });

  it("lets an admin delete a RESOLVED commitment (admin override)", async () => {
    // Admins bypass both the owner check AND the status check.
    // Whether that's the right policy is debatable, but it IS the
    // policy — pinning it so a future refactor is a deliberate
    // decision, not an accident.
    mocks.isAdminForCompany.mockReturnValue(true);
    mocks.commitmentsSelectMaybeSingle.mockResolvedValueOnce({
      data: commitmentRow({ status: "missed", owner_id: "someone_else" }),
      error: null,
    });
    const { deleteCommitmentAction } = await import("./actions");

    const res = await deleteCommitmentAction("c_1");

    expect(res).toEqual({ ok: true });
    expect(mocks.commitmentsDeleteEq).toHaveBeenCalledTimes(1);
  });
});
