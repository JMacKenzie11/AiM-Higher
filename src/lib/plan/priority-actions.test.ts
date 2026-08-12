import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/plan/priority-actions.ts. Same
// shape as goal-actions but with two priority-specific rules to pin:
// createPriorityAction requires a quarter_id (priorities always live
// inside a quarter), and updatePriorityAction OMITS quarter_id from
// the patch when the caller sent an empty string — otherwise a partial
// edit form would move the priority into no-quarter-land.

// ---- Shared spies + fakes -------------------------------------
const mocks = vi.hoisted(() => {
  const prioritiesInsertSingle = vi.fn();
  const prioritiesSelectMaybeSingle = vi.fn();
  const prioritiesUpdatePatch = vi.fn();
  const prioritiesUpdateSingle = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "priorities") {
      return {
        insert: () => ({ select: () => ({ single: prioritiesInsertSingle }) }),
        select: () => ({
          eq: () => ({ maybeSingle: prioritiesSelectMaybeSingle }),
        }),
        update: (patch: unknown) => {
          prioritiesUpdatePatch(patch);
          return {
            eq: () => ({
              select: () => ({ single: prioritiesUpdateSingle }),
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
    prioritiesInsertSingle,
    prioritiesSelectMaybeSingle,
    prioritiesUpdatePatch,
    prioritiesUpdateSingle,
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

function priorityRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pri_1",
    company_id: "co_acme",
    annual_goal_id: "goal_1",
    quarter_id: "q_1",
    title: "Ship the migration",
    description: null,
    owner_id: "owner_1",
    due_date: "2026-09-15",
    status: "on_track",
    archived: false,
    ...overrides,
  };
}

function primeHappyPath() {
  mocks.requireRole.mockResolvedValue(sessionFor({}));
  mocks.requireProfile.mockResolvedValue(sessionFor({}));
  mocks.scopedCompanyId.mockResolvedValue("co_acme");
  mocks.prioritiesInsertSingle.mockResolvedValue({
    data: priorityRow(),
    error: null,
  });
  mocks.prioritiesUpdateSingle.mockResolvedValue({
    data: priorityRow(),
    error: null,
  });
  mocks.prioritiesSelectMaybeSingle.mockResolvedValue({
    data: priorityRow(),
    error: null,
  });
}

// ==============================================================
// createPriorityAction
// ==============================================================
describe("createPriorityAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("requires a quarter_id (priorities always live inside a quarter)", async () => {
    const { createPriorityAction } = await import("./priority-actions");

    const res = await createPriorityAction(
      undefined,
      formDataFrom({ title: "Ship it" })
    );

    expect(res).toEqual({
      ok: false,
      message: "Pick a quarter for this action.",
    });
    expect(mocks.prioritiesInsertSingle).not.toHaveBeenCalled();
  });

  it("rejects an empty title after the quarter check", async () => {
    const { createPriorityAction } = await import("./priority-actions");

    const res = await createPriorityAction(
      undefined,
      formDataFrom({ quarter_id: "q_1", title: "" })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/title/i);
  });
});

// ==============================================================
// updatePriorityAction
// ==============================================================
describe("updatePriorityAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("omits quarter_id from the patch when the form sent an empty value", async () => {
    // A partial edit form (e.g. rename-only) sends "" for fields the
    // user didn't touch. Writing null would move the priority out of
    // its quarter — the guard here preserves the existing quarter_id.
    const { updatePriorityAction } = await import("./priority-actions");

    await updatePriorityAction(
      undefined,
      formDataFrom({ id: "pri_1", title: "Renamed", quarter_id: "" })
    );

    const patch = mocks.prioritiesUpdatePatch.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(patch).not.toHaveProperty("quarter_id");
    expect(patch.title).toBe("Renamed");
  });

  it("writes quarter_id when a non-empty value is submitted", async () => {
    const { updatePriorityAction } = await import("./priority-actions");

    await updatePriorityAction(
      undefined,
      formDataFrom({ id: "pri_1", title: "Renamed", quarter_id: "q_new" })
    );

    const patch = mocks.prioritiesUpdatePatch.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(patch.quarter_id).toBe("q_new");
  });

  it("omits status from the patch when the submitted value is invalid", async () => {
    const { updatePriorityAction } = await import("./priority-actions");

    await updatePriorityAction(
      undefined,
      formDataFrom({ id: "pri_1", title: "Renamed", status: "totally-fake" })
    );

    const patch = mocks.prioritiesUpdatePatch.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(patch).not.toHaveProperty("status");
  });
});

// ==============================================================
// updatePriorityStatusAction — owner-path branch
// ==============================================================
describe("updatePriorityStatusAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects an invalid status before touching the DB", async () => {
    const { updatePriorityStatusAction } = await import("./priority-actions");

    const res = await updatePriorityStatusAction(
      "pri_1",
      "totally-made-up" as unknown as "on_track"
    );

    expect(res).toEqual({ ok: false, message: "Not a valid status." });
    expect(mocks.prioritiesSelectMaybeSingle).not.toHaveBeenCalled();
  });

  it("blocks a non-owner team_member", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "someone_else", role: "team_member" })
    );
    mocks.prioritiesSelectMaybeSingle.mockResolvedValueOnce({
      data: priorityRow({ owner_id: "owner_1" }),
      error: null,
    });
    const { updatePriorityStatusAction } = await import("./priority-actions");

    const res = await updatePriorityStatusAction("pri_1", "on_track");

    expect(res).toEqual({ ok: false, message: "You can't change this status." });
    expect(mocks.prioritiesUpdatePatch).not.toHaveBeenCalled();
  });

  it("allows the owner (owner path) even without an admin role", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "owner_1", role: "team_member" })
    );
    mocks.prioritiesSelectMaybeSingle.mockResolvedValueOnce({
      data: priorityRow({ owner_id: "owner_1" }),
      error: null,
    });
    const { updatePriorityStatusAction } = await import("./priority-actions");

    const res = await updatePriorityStatusAction("pri_1", "on_track");

    expect(res.ok).toBe(true);
    expect(mocks.prioritiesUpdatePatch).toHaveBeenCalledWith({
      status: "on_track",
    });
  });
});

// ==============================================================
// setPriorityGoalAction
// ==============================================================
describe("setPriorityGoalAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("writes null when unlinking from a goal", async () => {
    const { setPriorityGoalAction } = await import("./priority-actions");

    await setPriorityGoalAction("pri_1", null);

    expect(mocks.prioritiesUpdatePatch).toHaveBeenCalledWith({
      annual_goal_id: null,
    });
  });

  it("writes the new goal id when linking", async () => {
    const { setPriorityGoalAction } = await import("./priority-actions");

    await setPriorityGoalAction("pri_1", "goal_new");

    expect(mocks.prioritiesUpdatePatch).toHaveBeenCalledWith({
      annual_goal_id: "goal_new",
    });
  });
});
