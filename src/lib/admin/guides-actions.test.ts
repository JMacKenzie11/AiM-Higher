import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/admin/guides-actions.ts. Three
// contracts here are load-bearing:
//   1. The three-step create rolls back the auth user if EITHER the
//      profile insert or the guide_assignments insert fails —
//      otherwise a partial create leaks an orphan auth user with no
//      way to reach it (the failure mode that produced Jeff Boumwan's
//      dead-end guide row on 2026-08-08).
//   2. dispatchInvite failure on create surfaces as a WARNING with
//      the guide still marked ok — the admin resends from the row.
//   3. unassignGuideAction preserves the "at least one assignment"
//      invariant — the last unassign is rejected so a guide never
//      ends up with zero companies.

// ---- Shared spies + fakes -------------------------------------
const mocks = vi.hoisted(() => {
  const createUser = vi.fn();
  const deleteUser = vi.fn();
  const getUserById = vi.fn();

  const profilesInsert = vi.fn();
  const profilesSelectMaybeSingle = vi.fn();

  const assignmentsInsert = vi.fn();
  const assignmentsUpsert = vi.fn();
  const assignmentsCountEq = vi.fn(); // .select("*", {count, head}).eq(...)
  const assignmentsDeleteEqEq = vi.fn(); // .delete().eq().eq()

  const fromBuilder = (table: string) => {
    if (table === "profiles") {
      return {
        insert: profilesInsert,
        select: () => ({
          eq: () => ({ maybeSingle: profilesSelectMaybeSingle }),
        }),
      };
    }
    if (table === "guide_assignments") {
      return {
        insert: assignmentsInsert,
        upsert: assignmentsUpsert,
        // Two select shapes:
        //   .select("*", { count: "exact", head: true }).eq("guide_id", id)
        //     → resolves to { count }
        // and a delete shape:
        //   .delete().eq("guide_id", id).eq("company_id", cid)
        //     → resolves to { error }
        select: () => ({ eq: () => assignmentsCountEq() }),
        delete: () => ({
          eq: () => ({ eq: () => assignmentsDeleteEqEq() }),
        }),
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const admin = {
    auth: { admin: { createUser, deleteUser, getUserById } },
    from: fromBuilder,
  };

  const requireRole = vi.fn();
  const dispatchInvite = vi.fn();
  const revalidatePath = vi.fn();
  const reportError = vi.fn();

  return {
    createUser,
    deleteUser,
    getUserById,
    profilesInsert,
    profilesSelectMaybeSingle,
    assignmentsInsert,
    assignmentsUpsert,
    assignmentsCountEq,
    assignmentsDeleteEqEq,
    admin,
    requireRole,
    dispatchInvite,
    revalidatePath,
    reportError,
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mocks.admin,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireRole: mocks.requireRole,
}));

vi.mock("@/lib/auth/users", () => ({
  dispatchInvite: mocks.dispatchInvite,
}));

vi.mock("@/lib/observability/report", () => ({
  reportError: mocks.reportError,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

// ---- Helpers --------------------------------------------------
function formDataFrom(entries: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) for (const item of v) fd.append(k, item);
    else fd.set(k, v);
  }
  return fd;
}

function primeHappyPath() {
  mocks.requireRole.mockResolvedValue({
    profile: { id: "root", role: "system_admin" },
  });
  mocks.createUser.mockResolvedValue({
    data: { user: { id: "guide_new" } },
    error: null,
  });
  mocks.deleteUser.mockResolvedValue({ error: null });
  mocks.getUserById.mockResolvedValue({
    data: { user: { email: "existing@guide.co" } },
    error: null,
  });
  mocks.profilesInsert.mockResolvedValue({ error: null });
  mocks.profilesSelectMaybeSingle.mockResolvedValue({
    data: { id: "guide_new", role: "aims_guide", status: "pending" },
    error: null,
  });
  mocks.assignmentsInsert.mockResolvedValue({ error: null });
  mocks.assignmentsUpsert.mockResolvedValue({ error: null });
  mocks.assignmentsCountEq.mockResolvedValue({ count: 3 });
  mocks.assignmentsDeleteEqEq.mockResolvedValue({ error: null });
  mocks.dispatchInvite.mockResolvedValue({ ok: true });
}

// ==============================================================
// createGuideAction
// ==============================================================
describe("createGuideAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("requires at least one initial company assignment", async () => {
    // Creating a guide with no assignments would produce an account
    // that sees "no companies" on sign-in — the exact hole this rule
    // was added to close.
    const { createGuideAction } = await import("./guides-actions");

    const res = await createGuideAction(
      formDataFrom({ email: "g@x.co", full_name: "Guide G" })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/at least one company/);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("rolls back the auth user when the profile insert fails", async () => {
    mocks.profilesInsert.mockResolvedValueOnce({
      error: { message: "duplicate id" },
    });
    const { createGuideAction } = await import("./guides-actions");

    const res = await createGuideAction(
      formDataFrom({
        email: "g@x.co",
        full_name: "Guide G",
        company_id: ["co_1"],
      })
    );

    expect(res.ok).toBe(false);
    expect(mocks.deleteUser).toHaveBeenCalledWith("guide_new");
  });

  it("rolls back the auth user when the guide_assignments insert fails", async () => {
    // Second-stage failure — profile row exists but no assignments.
    // Better to delete than to leak an orphaned guide profile that
    // can't sign into anything.
    mocks.assignmentsInsert.mockResolvedValueOnce({
      error: { message: "fk violation" },
    });
    const { createGuideAction } = await import("./guides-actions");

    const res = await createGuideAction(
      formDataFrom({
        email: "g@x.co",
        full_name: "Guide G",
        company_id: ["co_1", "co_2"],
      })
    );

    expect(res.ok).toBe(false);
    expect(mocks.deleteUser).toHaveBeenCalledWith("guide_new");
  });

  it("surfaces a warning (not an error) when dispatchInvite fails", async () => {
    // The guide is fully created — admin can resend from GuideRowActions.
    mocks.dispatchInvite.mockResolvedValueOnce({
      ok: false,
      message: "smtp down",
    });
    const { createGuideAction } = await import("./guides-actions");

    const res = await createGuideAction(
      formDataFrom({
        email: "g@x.co",
        full_name: "Guide G",
        company_id: ["co_1"],
      })
    );

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.warning).toMatch(/invite email didn't send/);
      expect(res.warning).toMatch(/smtp down/);
    }
    // Rollback must NOT fire on invite failure — the guide stays.
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("creates the profile with role='aims_guide' and no company_id", async () => {
    const { createGuideAction } = await import("./guides-actions");

    await createGuideAction(
      formDataFrom({
        email: "g@x.co",
        full_name: "Guide G",
        company_id: ["co_1"],
      })
    );

    expect(mocks.profilesInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "guide_new",
        role: "aims_guide",
        company_id: null,
        status: "pending",
      })
    );
  });
});

// ==============================================================
// resendGuideInviteAction
// ==============================================================
describe("resendGuideInviteAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("refuses to resend for a profile that isn't an aims_guide", async () => {
    // Belt-and-braces: a stale form field on the admin page could
    // otherwise trigger a guide-flavored invite for a company_admin.
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "u_1", role: "company_admin", status: "pending" },
      error: null,
    });
    const { resendGuideInviteAction } = await import("./guides-actions");

    const res = await resendGuideInviteAction("u_1");

    expect(res).toEqual({
      ok: false,
      message: "That user isn't an AiMS Guide.",
    });
    expect(mocks.dispatchInvite).not.toHaveBeenCalled();
  });

  it("refuses to resend for an active guide", async () => {
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "g_1", role: "aims_guide", status: "active" },
      error: null,
    });
    const { resendGuideInviteAction } = await import("./guides-actions");

    const res = await resendGuideInviteAction("g_1");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/already active/);
    expect(mocks.dispatchInvite).not.toHaveBeenCalled();
  });

  it("refuses to resend for an inactive guide", async () => {
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "g_1", role: "aims_guide", status: "inactive" },
      error: null,
    });
    const { resendGuideInviteAction } = await import("./guides-actions");

    const res = await resendGuideInviteAction("g_1");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/deactivated/);
  });

  it("dispatches an invite on the happy path", async () => {
    const { resendGuideInviteAction } = await import("./guides-actions");

    const res = await resendGuideInviteAction("g_1");

    expect(res).toEqual({ ok: true, guideId: "g_1" });
    expect(mocks.dispatchInvite).toHaveBeenCalledWith(
      "g_1",
      "existing@guide.co"
    );
  });
});

// ==============================================================
// assignGuideAction
// ==============================================================
describe("assignGuideAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects a target profile that isn't an aims_guide", async () => {
    mocks.profilesSelectMaybeSingle.mockResolvedValueOnce({
      data: { id: "u_1", role: "team_member" },
      error: null,
    });
    const { assignGuideAction } = await import("./guides-actions");

    const res = await assignGuideAction("u_1", "co_1");

    expect(res).toEqual({
      ok: false,
      message: "That user isn't an AiMS Guide.",
    });
    expect(mocks.assignmentsUpsert).not.toHaveBeenCalled();
  });

  it("uses upsert with onConflict so re-assigning is idempotent", async () => {
    const { assignGuideAction } = await import("./guides-actions");

    const res = await assignGuideAction("g_1", "co_1");

    expect(res).toEqual({ ok: true });
    // Assert the upsert options include the composite conflict target
    // — otherwise a re-assign would trip the unique constraint.
    expect(mocks.assignmentsUpsert).toHaveBeenCalledWith(
      { guide_id: "g_1", company_id: "co_1" },
      { onConflict: "guide_id,company_id" }
    );
  });
});

// ==============================================================
// unassignGuideAction — the invariant
// ==============================================================
describe("unassignGuideAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("refuses to unassign the guide's LAST company (delete the guide instead)", async () => {
    // Invariant: no guide row with zero assignments. If we let this
    // through, the guide's sign-in would land on an empty picker with
    // no recourse.
    mocks.assignmentsCountEq.mockResolvedValueOnce({ count: 1 });
    const { unassignGuideAction } = await import("./guides-actions");

    const res = await unassignGuideAction("g_1", "co_1");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/only company/);
    expect(mocks.assignmentsDeleteEqEq).not.toHaveBeenCalled();
  });

  it("deletes the assignment when the guide has other companies", async () => {
    mocks.assignmentsCountEq.mockResolvedValueOnce({ count: 3 });
    const { unassignGuideAction } = await import("./guides-actions");

    const res = await unassignGuideAction("g_1", "co_1");

    expect(res).toEqual({ ok: true });
    expect(mocks.assignmentsDeleteEqEq).toHaveBeenCalledTimes(1);
  });
});

// ==============================================================
// deleteGuideAction
// ==============================================================
describe("deleteGuideAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("removes the auth user (which cascades profile + assignments)", async () => {
    const { deleteGuideAction } = await import("./guides-actions");

    const res = await deleteGuideAction("g_1");

    expect(res).toEqual({ ok: true });
    expect(mocks.deleteUser).toHaveBeenCalledWith("g_1");
  });
});
