import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/plan/cascade-actions.ts. The
// interesting behavior is the "close open commitments as kept" cascade:
// completing a priority (or a goal, which cascades through its
// priorities) also flips every OPEN commitment underneath to KEPT,
// stamping completed_at and clearing missed_reason. If the commitment
// close fails, neither the priority nor the goal moves — the caller
// sees an error and the plan stays in a consistent state.

// ---- Shared spies + fakes -------------------------------------
const mocks = vi.hoisted(() => {
  const prioritiesSelectMaybeSingle = vi.fn();
  const prioritiesByGoalEq = vi.fn(); // .select("id").eq(annual_goal_id).eq(archived, false)
  const prioritiesUpdatePatch = vi.fn();
  const prioritiesUpdateEq = vi.fn();
  const prioritiesUpdateIn = vi.fn();

  const goalsSelectMaybeSingle = vi.fn();
  const goalsUpdatePatch = vi.fn();
  const goalsUpdateEq = vi.fn();

  const commitmentsOpenByPriority = vi.fn(); // .select("id").eq(priority_id).eq(status, "open")
  const commitmentsUpdatePatch = vi.fn();
  const commitmentsUpdateIn = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "priorities") {
      return {
        select: () => ({
          eq: () => ({
            // Terminal after ONE eq: maybeSingle (the "load one" path)
            maybeSingle: prioritiesSelectMaybeSingle,
            // Terminal after TWO eqs: the eq itself resolves as the
            // list-fetch result. Supabase's builder is thenable at
            // any point in the chain.
            eq: () => prioritiesByGoalEq(),
          }),
        }),
        update: (patch: unknown) => {
          prioritiesUpdatePatch(patch);
          return {
            eq: prioritiesUpdateEq,
            in: prioritiesUpdateIn,
          };
        },
      };
    }
    if (table === "annual_goals") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: goalsSelectMaybeSingle }),
        }),
        update: (patch: unknown) => {
          goalsUpdatePatch(patch);
          return { eq: goalsUpdateEq };
        },
      };
    }
    if (table === "commitments") {
      return {
        select: () => ({
          // .eq(priority_id).eq(status).is(deleted_at).is(parked_at)
          // The two is() calls exclude soft-deleted and parked rows,
          // which the UI hides — closing them would resurrect them
          // into the kept counts. The chain is thenable at the end.
          eq: () => ({
            eq: () => ({
              is: () => ({ is: () => commitmentsOpenByPriority() }),
            }),
          }),
        }),
        update: (patch: unknown) => {
          commitmentsUpdatePatch(patch);
          return { in: commitmentsUpdateIn };
        },
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const serverClient = { from: fromBuilder };
  const requireRole = vi.fn();
  const revalidatePath = vi.fn();

  return {
    prioritiesSelectMaybeSingle,
    prioritiesByGoalEq,
    prioritiesUpdatePatch,
    prioritiesUpdateEq,
    prioritiesUpdateIn,
    goalsSelectMaybeSingle,
    goalsUpdatePatch,
    goalsUpdateEq,
    commitmentsOpenByPriority,
    commitmentsUpdatePatch,
    commitmentsUpdateIn,
    serverClient,
    requireRole,
    revalidatePath,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.serverClient,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireRole: mocks.requireRole,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

// ---- Helpers --------------------------------------------------
function primeHappyPath() {
  mocks.requireRole.mockResolvedValue({
    profile: { id: "admin_1", role: "company_admin", company_id: "co_acme" },
  });
  mocks.prioritiesSelectMaybeSingle.mockResolvedValue({
    data: { id: "pri_1", company_id: "co_acme", annual_goal_id: "goal_1" },
    error: null,
  });
  mocks.prioritiesByGoalEq.mockResolvedValue({
    data: [{ id: "pri_1" }, { id: "pri_2" }],
    error: null,
  });
  mocks.prioritiesUpdateEq.mockResolvedValue({ error: null });
  mocks.prioritiesUpdateIn.mockResolvedValue({ error: null });
  mocks.goalsSelectMaybeSingle.mockResolvedValue({
    data: { id: "goal_1", company_id: "co_acme" },
    error: null,
  });
  mocks.goalsUpdateEq.mockResolvedValue({ error: null });
  mocks.commitmentsOpenByPriority.mockResolvedValue({
    data: [{ id: "c_1" }, { id: "c_2" }, { id: "c_3" }],
    error: null,
  });
  mocks.commitmentsUpdateIn.mockResolvedValue({ error: null });
}

// ==============================================================
// completePriorityAction
// ==============================================================
describe("completePriorityAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("errors when the priority doesn't exist", async () => {
    mocks.prioritiesSelectMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    const { completePriorityAction } = await import("./cascade-actions");

    const res = await completePriorityAction("pri_missing");

    expect(res).toEqual({ ok: false, message: "Action not found." });
    expect(mocks.commitmentsUpdateIn).not.toHaveBeenCalled();
    expect(mocks.prioritiesUpdatePatch).not.toHaveBeenCalled();
  });

  it("closes N open commitments as KEPT and stamps completed_at + clears missed_reason", async () => {
    // Contract: the cascade default treats every remaining open
    // commitment as work that shipped alongside the priority. If a
    // commitment was actually abandoned, the operator resolves it
    // as Closed BEFORE hitting Complete on the priority. Missed_reason
    // must be nulled so a previously-closed-then-reopened row doesn't
    // carry stale text.
    const { completePriorityAction } = await import("./cascade-actions");

    const res = await completePriorityAction("pri_1");

    expect(res).toEqual({ ok: true, commitmentsClosedCount: 3 });
    // MUST be kept_on_time, not "kept". Migration 0139 replaced the
    // old 'kept' value and added a CHECK constraint that rejects it,
    // so writing "kept" here made the whole action fail with
    // "Couldn't close the open commitments" whenever the priority had
    // any open commitment. This assertion previously read "kept" and
    // passed anyway, because the fake below has no CHECK constraint —
    // the suite stayed green while the feature was broken in prod.
    expect(mocks.commitmentsUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "kept_on_time",
        completed_at: expect.any(String),
        missed_reason: null,
      })
    );
    expect(mocks.commitmentsUpdateIn).toHaveBeenCalledWith("id", [
      "c_1",
      "c_2",
      "c_3",
    ]);
  });

  it("marks the priority complete AFTER closing commitments", async () => {
    const { completePriorityAction } = await import("./cascade-actions");

    await completePriorityAction("pri_1");

    expect(mocks.prioritiesUpdatePatch).toHaveBeenCalledWith({
      status: "complete",
    });
    // Ordering: commitments update fires before priorities update.
    // Vitest doesn't have a great cross-spy ordering matcher, so we
    // check via invocationCallOrder — smaller = earlier.
    const commitOrder = (
      mocks.commitmentsUpdateIn.mock.invocationCallOrder[0] ?? Infinity
    );
    const priorityOrder = (
      mocks.prioritiesUpdateEq.mock.invocationCallOrder[0] ?? -Infinity
    );
    expect(commitOrder).toBeLessThan(priorityOrder);
  });

  it("does NOT mark the priority complete when the commitment close fails", async () => {
    // Consistency guarantee: a partial cascade would leave the plan in
    // a "priority done but half its work still open" state. The action
    // bails BEFORE touching priorities.status.
    mocks.commitmentsUpdateIn.mockResolvedValueOnce({
      error: { message: "network hiccup" },
    });
    const { completePriorityAction } = await import("./cascade-actions");

    const res = await completePriorityAction("pri_1");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/action left unchanged/);
    expect(mocks.prioritiesUpdatePatch).not.toHaveBeenCalled();
  });

  it("still succeeds when there are zero open commitments under the priority", async () => {
    mocks.commitmentsOpenByPriority.mockResolvedValueOnce({
      data: [],
      error: null,
    });
    const { completePriorityAction } = await import("./cascade-actions");

    const res = await completePriorityAction("pri_1");

    expect(res).toEqual({ ok: true, commitmentsClosedCount: 0 });
    // No commitments to update → the update path should never fire.
    expect(mocks.commitmentsUpdateIn).not.toHaveBeenCalled();
    // Priority is still marked complete.
    expect(mocks.prioritiesUpdatePatch).toHaveBeenCalledWith({
      status: "complete",
    });
  });
});

// ==============================================================
// completeGoalAction
// ==============================================================
describe("completeGoalAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("errors when the goal doesn't exist", async () => {
    mocks.goalsSelectMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    const { completeGoalAction } = await import("./cascade-actions");

    const res = await completeGoalAction("goal_missing");

    expect(res).toEqual({ ok: false, message: "Goal not found." });
    expect(mocks.commitmentsUpdateIn).not.toHaveBeenCalled();
    expect(mocks.goalsUpdatePatch).not.toHaveBeenCalled();
  });

  it("cascades: closes commitments under every non-archived priority, marks priorities and goal complete", async () => {
    // Two priorities in primeHappyPath; each triggers a
    // commitmentsOpenByPriority call. Both close to 3 commitments,
    // so the total closed count is 6.
    const { completeGoalAction } = await import("./cascade-actions");

    const res = await completeGoalAction("goal_1");

    expect(res).toEqual({
      ok: true,
      commitmentsClosedCount: 6,
      prioritiesCompletedCount: 2,
    });
    // Both priorities are marked complete via a single .in() update.
    expect(mocks.prioritiesUpdateIn).toHaveBeenCalledWith("id", [
      "pri_1",
      "pri_2",
    ]);
    // The goal itself is marked complete last.
    expect(mocks.goalsUpdatePatch).toHaveBeenCalledWith({ status: "complete" });
  });

  it("bails without touching priorities/goal if any commitment close fails", async () => {
    // Second cascade fails → the goal is NOT flipped, priorities are
    // NOT flipped. The user sees "goal left unchanged" and can
    // retry after diagnosing.
    mocks.commitmentsUpdateIn
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "network hiccup" } });
    const { completeGoalAction } = await import("./cascade-actions");

    const res = await completeGoalAction("goal_1");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/goal left unchanged/);
    expect(mocks.prioritiesUpdateIn).not.toHaveBeenCalled();
    expect(mocks.goalsUpdatePatch).not.toHaveBeenCalled();
  });

  it("still marks the goal complete when it has zero non-archived priorities", async () => {
    mocks.prioritiesByGoalEq.mockResolvedValueOnce({
      data: [],
      error: null,
    });
    const { completeGoalAction } = await import("./cascade-actions");

    const res = await completeGoalAction("goal_1");

    expect(res).toEqual({
      ok: true,
      commitmentsClosedCount: 0,
      prioritiesCompletedCount: 0,
    });
    expect(mocks.prioritiesUpdateIn).not.toHaveBeenCalled();
    expect(mocks.goalsUpdatePatch).toHaveBeenCalledWith({ status: "complete" });
  });
});
