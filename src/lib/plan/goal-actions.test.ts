import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/plan/goal-actions.ts. Mirrors the
// sfa-actions test shape — updateGoalStatusAction has the owner-path
// branch (owner_id can update even without an admin role), and
// updateGoalAction's parseStatus(...) gate must keep an invalid status
// value out of the DB patch instead of writing null.

// ---- Shared spies + fakes -------------------------------------
const mocks = vi.hoisted(() => {
  const goalsInsertSingle = vi.fn();
  const goalsSelectMaybeSingle = vi.fn();
  const goalsUpdatePatch = vi.fn();
  const goalsUpdateSingle = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "annual_goals") {
      return {
        insert: () => ({ select: () => ({ single: goalsInsertSingle }) }),
        select: () => ({
          eq: () => ({ maybeSingle: goalsSelectMaybeSingle }),
        }),
        update: (patch: unknown) => {
          goalsUpdatePatch(patch);
          return {
            eq: () => ({
              select: () => ({ single: goalsUpdateSingle }),
            }),
          };
        },
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const serverClient = { from: fromBuilder };
  const requireRole = vi.fn();
  const requireProfile = vi.fn();
  const scopedCompanyId = vi.fn();
  const revalidatePath = vi.fn();

  return {
    goalsInsertSingle,
    goalsSelectMaybeSingle,
    goalsUpdatePatch,
    goalsUpdateSingle,
    serverClient,
    requireRole,
    requireProfile,
    scopedCompanyId,
    revalidatePath,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.serverClient,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireRole: mocks.requireRole,
  requireProfile: mocks.requireProfile,
}));

vi.mock("@/lib/auth/permissions", () => ({
  scopedCompanyId: mocks.scopedCompanyId,
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

function sessionFor(profile: {
  id?: string;
  role?: "system_admin" | "company_admin" | "team_member" | "aims_guide";
  company_id?: string | null;
}) {
  return {
    profile: {
      id: profile.id ?? "caller_1",
      role: profile.role ?? "company_admin",
      company_id:
        "company_id" in profile ? profile.company_id : "co_acme",
    },
  };
}

function goalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "goal_1",
    company_id: "co_acme",
    sfa_id: "sfa_1",
    title: "Grow revenue 30%",
    description: null,
    owner_id: "owner_1",
    target_date: "2026-12-31",
    status: "on_track",
    archived: false,
    ...overrides,
  };
}

function primeHappyPath() {
  mocks.requireRole.mockResolvedValue(sessionFor({}));
  mocks.requireProfile.mockResolvedValue(sessionFor({}));
  mocks.scopedCompanyId.mockResolvedValue("co_acme");
  mocks.goalsInsertSingle.mockResolvedValue({ data: goalRow(), error: null });
  mocks.goalsUpdateSingle.mockResolvedValue({ data: goalRow(), error: null });
  mocks.goalsSelectMaybeSingle.mockResolvedValue({
    data: goalRow(),
    error: null,
  });
}

// ==============================================================
// createGoalAction
// ==============================================================
describe("createGoalAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("errors when no company can be resolved", async () => {
    mocks.scopedCompanyId.mockResolvedValueOnce(null);
    const { createGoalAction } = await import("./goal-actions");

    const res = await createGoalAction(
      undefined,
      formDataFrom({ title: "Grow revenue" })
    );

    expect(res).toEqual({ ok: false, message: "Pick a company first." });
    expect(mocks.goalsInsertSingle).not.toHaveBeenCalled();
  });

  it("rejects an empty title", async () => {
    const { createGoalAction } = await import("./goal-actions");

    const res = await createGoalAction(undefined, formDataFrom({ title: "" }));

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/title/i);
  });
});

// ==============================================================
// updateGoalAction
// ==============================================================
describe("updateGoalAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects missing id", async () => {
    const { updateGoalAction } = await import("./goal-actions");

    const res = await updateGoalAction(
      undefined,
      formDataFrom({ title: "X" })
    );

    expect(res).toEqual({ ok: false, message: "Missing goal id." });
    expect(mocks.goalsUpdatePatch).not.toHaveBeenCalled();
  });

  it("omits status from the update patch when the submitted value is invalid", async () => {
    // parseStatus returns null for garbage input — the action must
    // treat that as "don't touch status" instead of writing null and
    // wiping the current value.
    const { updateGoalAction } = await import("./goal-actions");

    await updateGoalAction(
      undefined,
      formDataFrom({ id: "goal_1", title: "Renamed", status: "totally-fake" })
    );

    const patch = mocks.goalsUpdatePatch.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(patch).not.toHaveProperty("status");
    expect(patch.title).toBe("Renamed");
  });
});

// ==============================================================
// updateGoalStatusAction — owner-path branch
// ==============================================================
describe("updateGoalStatusAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects an invalid status before touching the DB", async () => {
    const { updateGoalStatusAction } = await import("./goal-actions");

    const res = await updateGoalStatusAction(
      "goal_1",
      "totally-made-up" as unknown as "on_track"
    );

    expect(res).toEqual({ ok: false, message: "Not a valid status." });
    expect(mocks.goalsSelectMaybeSingle).not.toHaveBeenCalled();
  });

  it("blocks a non-owner team_member", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "someone_else", role: "team_member" })
    );
    mocks.goalsSelectMaybeSingle.mockResolvedValueOnce({
      data: goalRow({ owner_id: "owner_1" }),
      error: null,
    });
    const { updateGoalStatusAction } = await import("./goal-actions");

    const res = await updateGoalStatusAction("goal_1", "on_track");

    expect(res).toEqual({ ok: false, message: "You can't change this status." });
    expect(mocks.goalsUpdatePatch).not.toHaveBeenCalled();
  });

  it("allows the owner (owner path) even without an admin role", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "owner_1", role: "team_member" })
    );
    mocks.goalsSelectMaybeSingle.mockResolvedValueOnce({
      data: goalRow({ owner_id: "owner_1" }),
      error: null,
    });
    const { updateGoalStatusAction } = await import("./goal-actions");

    const res = await updateGoalStatusAction("goal_1", "on_track");

    expect(res.ok).toBe(true);
    expect(mocks.goalsUpdatePatch).toHaveBeenCalledWith({ status: "on_track" });
  });
});

// ==============================================================
// setGoalSfaAction
// ==============================================================
describe("setGoalSfaAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("writes null when unlinking", async () => {
    const { setGoalSfaAction } = await import("./goal-actions");

    await setGoalSfaAction("goal_1", null);

    expect(mocks.goalsUpdatePatch).toHaveBeenCalledWith({ sfa_id: null });
  });

  it("writes the sfa id when linking", async () => {
    const { setGoalSfaAction } = await import("./goal-actions");

    await setGoalSfaAction("goal_1", "sfa_new");

    expect(mocks.goalsUpdatePatch).toHaveBeenCalledWith({ sfa_id: "sfa_new" });
  });
});
