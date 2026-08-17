import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/commitments/actions.ts. Contracts
// pinned by the 2026-08-17 resolution refactor:
//
// - markKeptAction decides on-time vs late from due_date vs today.
//   Owners are prompted for a reason on late; admins are exempt.
// - markMissedAction requires a reason from owners; admins are exempt.
// - rescheduleCommitmentAction requires a reason from owners; admins
//   are exempt and may change past-due dates.
// - parkCommitmentAction sets parked_at (excludes from metrics).
// - deleteCommitmentAction is now SOFT — sets deleted_at, never
//   physical delete.
// - Ongoing commitments: resolving writes a commitment_occurrences
//   row for the current week_ending and rolls the parent row's
//   due_date +7 days; the parent stays status='open'.
// - Every resolution stamps resolved_by_role + resolved_by_profile_id.

const mocks = vi.hoisted(() => {
  const commitmentsInsertPatch = vi.fn();
  const commitmentsInsertSingle = vi.fn();
  const commitmentsSelectMaybeSingle = vi.fn();
  const commitmentsUpdatePatch = vi.fn();
  const commitmentsUpdateSingle = vi.fn();

  const occurrencesUpsertPatch = vi.fn();
  const occurrencesUpsertResult = vi.fn();

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
      };
    }
    if (table === "commitment_occurrences") {
      return {
        upsert: (patch: unknown) => {
          occurrencesUpsertPatch(patch);
          return occurrencesUpsertResult();
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
    occurrencesUpsertPatch,
    occurrencesUpsertResult,
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

import {
  markKeptAction,
  markMissedAction,
  rescheduleCommitmentAction,
  parkCommitmentAction,
  unparkCommitmentAction,
  deleteCommitmentAction,
} from "./actions";

const TEAM_MEMBER = {
  id: "u_team",
  role: "team_member" as const,
  company_id: "co_acme",
};
const ADMIN = {
  id: "u_admin",
  role: "company_admin" as const,
  company_id: "co_acme",
};

function baseCommitment(overrides: Record<string, unknown> = {}) {
  return {
    id: "c_1",
    company_id: "co_acme",
    priority_id: null,
    owner_id: "u_team",
    description: "Ship the doc",
    week_ending: "2026-08-21",
    due_date: "2026-08-21",
    status: "open",
    completed_at: null,
    missed_reason: null,
    carried_from_id: null,
    source_meeting_id: null,
    clarity_timeline: null,
    clarity_success: null,
    clarity_note: null,
    deleted_at: null,
    parked_at: null,
    is_ongoing: false,
    resolved_by_role: null,
    resolved_by_profile_id: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canWriteOwnedRow.mockReturnValue(true);
  mocks.isAdminForCompany.mockReturnValue(false);
  mocks.fridayOf.mockImplementation((d: string) => d);
  mocks.todayInTimezone.mockReturnValue({ iso: "2026-08-17" });
  mocks.companiesSelectMaybeSingle.mockResolvedValue({
    data: { timezone: "America/Anchorage" },
  });
  mocks.requireProfile.mockResolvedValue({ profile: TEAM_MEMBER });
  mocks.commitmentsUpdateSingle.mockImplementation(async () => ({
    data: baseCommitment(),
    error: null,
  }));
  mocks.occurrencesUpsertResult.mockReturnValue({ error: null });
});

// ---- markKeptAction --------------------------------------------
describe("markKeptAction", () => {
  it("marks an on-time commitment as kept_on_time and stamps the resolver", async () => {
    mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
      data: baseCommitment({ due_date: "2026-08-21" }),
    });
    const updated = baseCommitment({ status: "kept_on_time" });
    mocks.commitmentsUpdateSingle.mockResolvedValueOnce({
      data: updated,
      error: null,
    });

    const result = await markKeptAction("c_1");

    expect(result.ok).toBe(true);
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "kept_on_time",
        resolved_by_role: "owner",
        resolved_by_profile_id: "u_team",
      })
    );
  });

  it("marks an overdue commitment as kept_late when a team member keeps it", async () => {
    mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
      data: baseCommitment({ due_date: "2026-08-10" }),
    });
    mocks.commitmentsUpdateSingle.mockResolvedValueOnce({
      data: baseCommitment({ status: "kept_late" }),
      error: null,
    });

    const result = await markKeptAction("c_1", { reason: "hit a bug" });

    expect(result.ok).toBe(true);
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "kept_late",
        missed_reason: "hit a bug",
        resolved_by_role: "owner",
      })
    );
  });

  it("late-keep from an owner without a reason still resolves (Skip flow)", async () => {
    mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
      data: baseCommitment({ due_date: "2026-08-10" }),
    });
    mocks.commitmentsUpdateSingle.mockResolvedValueOnce({
      data: baseCommitment({ status: "kept_late" }),
      error: null,
    });

    const result = await markKeptAction("c_1");

    expect(result.ok).toBe(true);
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "kept_late",
        missed_reason: null,
      })
    );
  });

  it("admin marking a past-due commitment kept-late succeeds in ONE action, no reason", async () => {
    mocks.requireProfile.mockResolvedValueOnce({ profile: ADMIN });
    mocks.isAdminForCompany.mockReturnValue(true);
    mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
      data: baseCommitment({ due_date: "2026-08-10" }),
    });
    mocks.commitmentsUpdateSingle.mockResolvedValueOnce({
      data: baseCommitment({ status: "kept_late" }),
      error: null,
    });

    const result = await markKeptAction("c_1");

    expect(result.ok).toBe(true);
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledTimes(1);
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "kept_late",
        missed_reason: null,
        resolved_by_role: "admin",
      })
    );
  });

  it("admin can force kept_on_time on a past-due row (retroactive correction)", async () => {
    mocks.requireProfile.mockResolvedValueOnce({ profile: ADMIN });
    mocks.isAdminForCompany.mockReturnValue(true);
    mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
      data: baseCommitment({ due_date: "2026-08-10" }),
    });
    mocks.commitmentsUpdateSingle.mockResolvedValueOnce({
      data: baseCommitment({ status: "kept_on_time" }),
      error: null,
    });

    const result = await markKeptAction("c_1", { resolveAs: "on_time" });

    expect(result.ok).toBe(true);
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({ status: "kept_on_time" })
    );
  });

  it("refuses to mark a parked commitment", async () => {
    mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
      data: baseCommitment({ parked_at: "2026-08-15T12:00:00Z" }),
    });

    const result = await markKeptAction("c_1");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/parking lot/i);
    expect(mocks.commitmentsUpdatePatch).not.toHaveBeenCalled();
  });

  it("ongoing commitment: writes an occurrence + rolls due_date +7 days", async () => {
    mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
      data: baseCommitment({
        is_ongoing: true,
        due_date: "2026-08-21",
        week_ending: "2026-08-21",
      }),
    });
    const rolled = baseCommitment({
      is_ongoing: true,
      status: "open",
      due_date: "2026-08-28",
      week_ending: "2026-08-28",
    });
    mocks.commitmentsUpdateSingle.mockResolvedValueOnce({
      data: rolled,
      error: null,
    });

    const result = await markKeptAction("c_1");

    expect(result.ok).toBe(true);
    // Occurrence upsert for the CURRENT week
    expect(mocks.occurrencesUpsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        commitment_id: "c_1",
        week_ending: "2026-08-21",
        status: "kept_on_time",
      })
    );
    // Commitment row updated to roll forward — same date +7 days,
    // status stays open (implicitly, we only update due_date + week).
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith({
      due_date: "2026-08-28",
      week_ending: "2026-08-28",
    });
  });
});

// ---- markMissedAction ------------------------------------------
describe("markMissedAction", () => {
  it("requires a reason from a team member", async () => {
    mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
      data: baseCommitment(),
    });

    const result = await markMissedAction("c_1", null);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/short reason/i);
    expect(mocks.commitmentsUpdatePatch).not.toHaveBeenCalled();
  });

  it("admin marks missed with no reason in one action", async () => {
    mocks.requireProfile.mockResolvedValueOnce({ profile: ADMIN });
    mocks.isAdminForCompany.mockReturnValue(true);
    mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
      data: baseCommitment(),
    });
    mocks.commitmentsUpdateSingle.mockResolvedValueOnce({
      data: baseCommitment({ status: "missed" }),
      error: null,
    });

    const result = await markMissedAction("c_1", null);

    expect(result.ok).toBe(true);
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledTimes(1);
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "missed",
        missed_reason: null,
        resolved_by_role: "admin",
      })
    );
  });
});

// ---- rescheduleCommitmentAction -------------------------------
describe("rescheduleCommitmentAction", () => {
  it("requires a reason from a team member", async () => {
    mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
      data: baseCommitment(),
    });

    const result = await rescheduleCommitmentAction("c_1", "2026-09-04", null);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/short reason/i);
  });

  it("admin can change a past-due date with no reason in one action", async () => {
    mocks.requireProfile.mockResolvedValueOnce({ profile: ADMIN });
    mocks.isAdminForCompany.mockReturnValue(true);
    mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
      data: baseCommitment({ due_date: "2026-08-10" }),
    });
    mocks.commitmentsUpdateSingle.mockResolvedValueOnce({
      data: baseCommitment({ due_date: "2026-09-04" }),
      error: null,
    });

    const result = await rescheduleCommitmentAction(
      "c_1",
      "2026-09-04",
      null
    );

    expect(result.ok).toBe(true);
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledTimes(1);
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({
        due_date: "2026-09-04",
        missed_reason: null,
      })
    );
  });
});

// ---- parkCommitmentAction --------------------------------------
describe("parkCommitmentAction", () => {
  it("sets parked_at on an open commitment (no reason required)", async () => {
    mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
      data: baseCommitment(),
    });
    mocks.commitmentsUpdateSingle.mockResolvedValueOnce({
      data: baseCommitment({ parked_at: "2026-08-17T10:00:00Z" }),
      error: null,
    });

    const result = await parkCommitmentAction("c_1");

    expect(result.ok).toBe(true);
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({
        parked_at: expect.any(String),
      })
    );
  });

  it("refuses to park a resolved commitment", async () => {
    mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
      data: baseCommitment({ status: "kept_on_time" }),
    });

    const result = await parkCommitmentAction("c_1");

    expect(result.ok).toBe(false);
    expect(mocks.commitmentsUpdatePatch).not.toHaveBeenCalled();
  });
});

// ---- unparkCommitmentAction ------------------------------------
describe("unparkCommitmentAction", () => {
  it("nulls parked_at and sets a fresh due_date + week_ending", async () => {
    mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
      data: baseCommitment({ parked_at: "2026-08-15T12:00:00Z" }),
    });
    mocks.commitmentsUpdateSingle.mockResolvedValueOnce({
      data: baseCommitment({
        parked_at: null,
        due_date: "2026-08-28",
        week_ending: "2026-08-28",
      }),
      error: null,
    });
    mocks.fridayOf.mockReturnValueOnce("2026-08-28");

    const result = await unparkCommitmentAction("c_1", "2026-08-28");

    expect(result.ok).toBe(true);
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith({
      parked_at: null,
      due_date: "2026-08-28",
      week_ending: "2026-08-28",
    });
  });
});

// ---- deleteCommitmentAction (soft delete) ---------------------
describe("deleteCommitmentAction (soft)", () => {
  it("sets deleted_at rather than physically removing the row", async () => {
    mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
      data: baseCommitment(),
    });
    mocks.commitmentsUpdateSingle.mockResolvedValueOnce({
      data: baseCommitment({ deleted_at: "2026-08-17T10:00:00Z" }),
      error: null,
    });

    const result = await deleteCommitmentAction("c_1");

    expect(result).toEqual({ ok: true });
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String) })
    );
  });

  it("admin can soft-delete a RESOLVED commitment", async () => {
    mocks.requireProfile.mockResolvedValueOnce({ profile: ADMIN });
    mocks.isAdminForCompany.mockReturnValue(true);
    mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
      data: baseCommitment({ status: "kept_on_time" }),
    });
    mocks.commitmentsUpdateSingle.mockResolvedValueOnce({
      data: baseCommitment({ deleted_at: "2026-08-17T10:00:00Z" }),
      error: null,
    });

    const result = await deleteCommitmentAction("c_1");

    expect(result).toEqual({ ok: true });
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String) })
    );
  });

  it("non-admin cannot soft-delete a resolved commitment", async () => {
    mocks.commitmentsSelectMaybeSingle.mockResolvedValue({
      data: baseCommitment({ status: "kept_on_time" }),
    });

    const result = await deleteCommitmentAction("c_1");

    expect(result.ok).toBe(false);
    expect(mocks.commitmentsUpdatePatch).not.toHaveBeenCalled();
  });
});
