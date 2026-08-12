import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/chart/actions.ts. chart/actions is
// the biggest single action module in the codebase; these tests focus
// on the load-bearing contracts and skip the many similarly-shaped
// rename/archive CRUD paths (already covered by pattern in earlier
// modules). Key contracts pinned:
//   - reorderFunctionsAction returns ok:false the moment any single
//     update fails (drag-drop with a partial success would leave the
//     tree in a mangled state that's hard to reconstruct).
//   - createMeasureAction / updateMeasureAction enforce the
//     performance_tracking entitlement: when the company has it, EVERY
//     measure must carry a target — otherwise the "on track / behind"
//     rollup silently ignores the untargetted rows.
//   - upsertMeasureEntryAction dual-auths (admin OR Lead OR Track).
//     A team member who isn't LTD MUST NOT write measure entries even
//     if they get past RLS somehow.
//   - upsertMeasureEntryAction retries on SQLSTATE 57014 (statement
//     timeout) — but NEVER on constraint violations.

// ---- Shared spies + fakes -------------------------------------
const mocks = vi.hoisted(() => {
  const functionsInsertSingle = vi.fn();
  const functionsUpdate = vi.fn(); // reorder path — bare eq() result
  const functionsUpdatePatch = vi.fn(); // rename/update path
  const functionsUpdateSingle = vi.fn();

  const outcomesJoinedMaybeSingle = vi.fn(); // for createMeasure
  const measuresInsertPatch = vi.fn();
  const measuresInsertSingle = vi.fn();
  const measuresJoinedMaybeSingle = vi.fn(); // for updateMeasure / upsertEntry
  const measuresUpdateSingle = vi.fn();

  const entriesUpsertPayload = vi.fn();
  const entriesUpsertSingle = vi.fn();

  const drTailSort = vi.fn();
  const drInsertPatch = vi.fn();
  const drInsertSingle = vi.fn();

  const compTailSort = vi.fn();
  const compInsertPatch = vi.fn();
  const compInsertSingle = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "functions") {
      return {
        insert: () => ({ select: () => ({ single: functionsInsertSingle }) }),
        // Two chain shapes:
        //  a) reorderFunctionsAction: update({...}).eq(id)  → thenable
        //  b) update/rename/archive: update({...}).eq(id).select("*").single()
        update: (patch: unknown) => {
          functionsUpdatePatch(patch);
          const eqResult = {
            select: () => ({ single: functionsUpdateSingle }),
            // For reorder — awaiting the eq() itself should resolve.
            then: (onFulfilled: (v: unknown) => unknown) =>
              Promise.resolve(functionsUpdate()).then(onFulfilled),
          };
          return { eq: () => eqResult };
        },
      };
    }
    if (table === "function_outcomes") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: outcomesJoinedMaybeSingle }),
        }),
      };
    }
    if (table === "success_measures") {
      return {
        insert: (patch: unknown) => {
          measuresInsertPatch(patch);
          return { select: () => ({ single: measuresInsertSingle }) };
        },
        select: () => ({
          eq: () => ({ maybeSingle: measuresJoinedMaybeSingle }),
        }),
        update: () => ({
          eq: () => ({
            select: () => ({ single: measuresUpdateSingle }),
          }),
        }),
      };
    }
    if (table === "success_measure_entries") {
      return {
        upsert: (payload: unknown, opts: unknown) => {
          entriesUpsertPayload(payload, opts);
          return { select: () => ({ single: entriesUpsertSingle }) };
        },
      };
    }
    if (table === "function_decision_rights") {
      return {
        select: () => ({
          eq: () => ({ order: () => ({ limit: () => drTailSort() }) }),
        }),
        insert: (patch: unknown) => {
          drInsertPatch(patch);
          return { select: () => ({ single: drInsertSingle }) };
        },
      };
    }
    if (table === "function_competencies") {
      return {
        select: () => ({
          eq: () => ({ order: () => ({ limit: () => compTailSort() }) }),
        }),
        insert: (patch: unknown) => {
          compInsertPatch(patch);
          return { select: () => ({ single: compInsertSingle }) };
        },
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const serverClient = { from: fromBuilder };
  const requireRole = vi.fn();
  const requireProfile = vi.fn();
  const scopedCompanyId = vi.fn();
  const companyHasFeature = vi.fn();
  const scoreMeasureTarget = vi.fn();
  const revalidatePath = vi.fn();

  return {
    functionsInsertSingle,
    functionsUpdate,
    functionsUpdatePatch,
    functionsUpdateSingle,
    outcomesJoinedMaybeSingle,
    measuresInsertPatch,
    measuresInsertSingle,
    measuresJoinedMaybeSingle,
    measuresUpdateSingle,
    entriesUpsertPayload,
    entriesUpsertSingle,
    drTailSort,
    drInsertPatch,
    drInsertSingle,
    compTailSort,
    compInsertPatch,
    compInsertSingle,
    serverClient,
    requireRole,
    requireProfile,
    scopedCompanyId,
    companyHasFeature,
    scoreMeasureTarget,
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

vi.mock("@/lib/subscriptions/service", () => ({
  companyHasFeature: mocks.companyHasFeature,
}));

vi.mock("@/lib/measures/target-check", () => ({
  scoreMeasureTarget: mocks.scoreMeasureTarget,
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

function primeHappyPath() {
  mocks.requireRole.mockResolvedValue({
    profile: { id: "admin_1", role: "company_admin", company_id: "co_acme" },
  });
  mocks.requireProfile.mockResolvedValue({
    profile: { id: "admin_1", role: "company_admin", company_id: "co_acme" },
  });
  mocks.scopedCompanyId.mockResolvedValue("co_acme");
  mocks.companyHasFeature.mockResolvedValue(false);
  mocks.scoreMeasureTarget.mockResolvedValue(null);

  mocks.functionsInsertSingle.mockResolvedValue({
    data: { id: "fn_new", title: "New function", company_id: "co_acme" },
    error: null,
  });
  mocks.functionsUpdate.mockResolvedValue({ error: null });
  mocks.functionsUpdateSingle.mockResolvedValue({
    data: { id: "fn_1", title: "Renamed" },
    error: null,
  });

  mocks.outcomesJoinedMaybeSingle.mockResolvedValue({
    data: {
      function_id: "fn_1",
      functions: { company_id: "co_acme" },
    },
    error: null,
  });
  mocks.measuresInsertSingle.mockResolvedValue({
    data: { id: "m_new", target: null, target_hint: null },
    error: null,
  });
  mocks.measuresJoinedMaybeSingle.mockResolvedValue({
    data: {
      id: "m_1",
      value_type: "number",
      outcome: {
        function: {
          id: "fn_1",
          company_id: "co_acme",
          lead_id: "leader_1",
          track_id: "tracker_1",
        },
      },
    },
    error: null,
  });
  mocks.measuresUpdateSingle.mockResolvedValue({
    data: { id: "m_1" },
    error: null,
  });

  mocks.entriesUpsertSingle.mockResolvedValue({
    data: {
      id: "e_1",
      measure_id: "m_1",
      week_ending: "2026-08-14",
      value_number: 5,
      value_text: null,
      entered_by: "admin_1",
    },
    error: null,
  });

  mocks.drTailSort.mockResolvedValue({ data: [{ sort_order: 3 }] });
  mocks.drInsertSingle.mockResolvedValue({
    data: { id: "dr_new", function_id: "fn_1" },
    error: null,
  });
  mocks.compTailSort.mockResolvedValue({ data: [{ sort_order: 2 }] });
  mocks.compInsertSingle.mockResolvedValue({
    data: { id: "comp_new", function_id: "fn_1" },
    error: null,
  });
}

// ==============================================================
// createFunctionAction
// ==============================================================
describe("createFunctionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects an empty title", async () => {
    const { createFunctionAction } = await import("./actions");

    const res = await createFunctionAction(
      undefined,
      formDataFrom({ title: "  " })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/title/i);
    expect(mocks.functionsInsertSingle).not.toHaveBeenCalled();
  });

  it("errors when no company can be resolved", async () => {
    mocks.scopedCompanyId.mockResolvedValueOnce(null);
    const { createFunctionAction } = await import("./actions");

    const res = await createFunctionAction(
      undefined,
      formDataFrom({ title: "Sales" })
    );

    expect(res).toEqual({ ok: false, message: "Pick a company first." });
  });
});

// ==============================================================
// reorderFunctionsAction — drag-drop consistency
// ==============================================================
describe("reorderFunctionsAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("returns ok immediately on an empty updates array (no writes)", async () => {
    const { reorderFunctionsAction } = await import("./actions");

    const res = await reorderFunctionsAction([]);

    expect(res).toEqual({ ok: true });
    expect(mocks.functionsUpdatePatch).not.toHaveBeenCalled();
  });

  it("fails the whole reorder if ANY per-row update errors — the tree stays in the caller's original state, roughly", async () => {
    // Partial success on a drag-drop would leave the sort_order values
    // in a mangled state that's very hard to reconstruct visually.
    // Returning ok:false at least tells the caller the drag didn't
    // take and prompts a fresh page load.
    mocks.functionsUpdate
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "rls" } })
      .mockResolvedValueOnce({ error: null });
    const { reorderFunctionsAction } = await import("./actions");

    const res = await reorderFunctionsAction([
      { id: "fn_a", sort_order: 0 },
      { id: "fn_b", sort_order: 1 },
      { id: "fn_c", sort_order: 2 },
    ]);

    expect(res.ok).toBe(false);
  });
});

// ==============================================================
// createMeasureAction — performance_tracking gate
// ==============================================================
describe("createMeasureAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects a missing outcome_id up front", async () => {
    const { createMeasureAction } = await import("./actions");

    const res = await createMeasureAction(
      undefined,
      formDataFrom({ description: "% on-time delivery" })
    );

    expect(res).toEqual({ ok: false, message: "Missing parent outcome." });
    expect(mocks.measuresInsertPatch).not.toHaveBeenCalled();
  });

  it("REQUIRES a target when the company has performance_tracking on", async () => {
    // Contract: an untargetted measure under performance_tracking
    // is silently ignored by the on-track/behind rollup. Making the
    // target mandatory at the write path prevents that silent gap.
    mocks.companyHasFeature.mockResolvedValueOnce(true);
    const { createMeasureAction } = await import("./actions");

    const res = await createMeasureAction(
      undefined,
      formDataFrom({
        outcome_id: "o_1",
        description: "% on-time delivery",
        // NB: no target field
      })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/every measure needs a target/);
    expect(mocks.measuresInsertPatch).not.toHaveBeenCalled();
  });

  it("allows an untargetted measure when performance_tracking is OFF", async () => {
    // Same call, but flag off → allowed. Regression-guards the flag
    // check itself: if the check accidentally becomes always-on, this
    // test flips red.
    mocks.companyHasFeature.mockResolvedValue(false);
    const { createMeasureAction } = await import("./actions");

    const res = await createMeasureAction(
      undefined,
      formDataFrom({
        outcome_id: "o_1",
        description: "% on-time delivery",
      })
    );

    expect(res.ok).toBe(true);
    expect(mocks.measuresInsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome_id: "o_1",
        description: "% on-time delivery",
        target: null,
      })
    );
  });

  it("defaults an unknown value_type to 'number' and unknown direction to 'higher_is_better'", async () => {
    const { createMeasureAction } = await import("./actions");

    await createMeasureAction(
      undefined,
      formDataFrom({
        outcome_id: "o_1",
        description: "New KPI",
        value_type: "totally-fake",
        target_direction: "totally-fake",
      })
    );

    const patch = mocks.measuresInsertPatch.mock.calls[0][0] as {
      value_type: string;
      target_direction: string;
    };
    expect(patch.value_type).toBe("number");
    expect(patch.target_direction).toBe("higher_is_better");
  });
});

// ==============================================================
// upsertMeasureEntryAction — dual-auth + coercion + retry
// ==============================================================
describe("upsertMeasureEntryAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("blocks a team_member who isn't the function's Lead OR Track", async () => {
    // Dual-auth contract: admin OR Lead OR Track can log. Everyone
    // else is out — even if RLS would let a peer through, the action
    // fails fast with a clear message.
    mocks.requireProfile.mockResolvedValue({
      profile: {
        id: "peer_1",
        role: "team_member",
        company_id: "co_acme",
      },
    });
    const { upsertMeasureEntryAction } = await import("./actions");

    const res = await upsertMeasureEntryAction("m_1", "2026-08-14", "5");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/Lead \/ Track \/ an admin/);
    expect(mocks.entriesUpsertPayload).not.toHaveBeenCalled();
  });

  it("allows the Lead to log an entry even without an admin role", async () => {
    mocks.requireProfile.mockResolvedValue({
      profile: {
        id: "leader_1",
        role: "team_member",
        company_id: "co_acme",
      },
    });
    const { upsertMeasureEntryAction } = await import("./actions");

    const res = await upsertMeasureEntryAction("m_1", "2026-08-14", "5");

    expect(res.ok).toBe(true);
    expect(mocks.entriesUpsertPayload).toHaveBeenCalledTimes(1);
  });

  it("routes text values to value_text and leaves value_number null", async () => {
    mocks.measuresJoinedMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "m_1",
        value_type: "text",
        outcome: {
          function: {
            id: "fn_1",
            company_id: "co_acme",
            lead_id: "leader_1",
            track_id: "tracker_1",
          },
        },
      },
      error: null,
    });
    const { upsertMeasureEntryAction } = await import("./actions");

    await upsertMeasureEntryAction("m_1", "2026-08-14", "on track");

    const payload = mocks.entriesUpsertPayload.mock.calls[0][0] as {
      value_number: number | null;
      value_text: string | null;
    };
    expect(payload).toEqual(
      expect.objectContaining({ value_number: null, value_text: "on track" })
    );
  });

  it("strips non-digits for numeric measures ('$1,234.50' → 1234.50)", async () => {
    const { upsertMeasureEntryAction } = await import("./actions");

    await upsertMeasureEntryAction("m_1", "2026-08-14", "$1,234.50");

    const payload = mocks.entriesUpsertPayload.mock.calls[0][0] as {
      value_number: number | null;
    };
    expect(payload.value_number).toBe(1234.5);
  });

  it("retries once on SQLSTATE 57014 (statement timeout)", async () => {
    mocks.entriesUpsertSingle
      .mockResolvedValueOnce({
        data: null,
        error: { code: "57014", message: "canceling statement due to timeout" },
      })
      .mockResolvedValueOnce({
        data: { id: "e_1" },
        error: null,
      });
    const { upsertMeasureEntryAction } = await import("./actions");

    const res = await upsertMeasureEntryAction("m_1", "2026-08-14", "5");

    expect(res.ok).toBe(true);
    expect(mocks.entriesUpsertSingle).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on constraint violations — a bad row would silently double", async () => {
    mocks.entriesUpsertSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "23514", message: "check constraint violated" },
    });
    const { upsertMeasureEntryAction } = await import("./actions");

    const res = await upsertMeasureEntryAction("m_1", "2026-08-14", "5");

    expect(res.ok).toBe(false);
    expect(mocks.entriesUpsertSingle).toHaveBeenCalledTimes(1);
  });
});

// ==============================================================
// createFunctionDecisionRightAction + createFunctionCompetencyAction
// ==============================================================
describe("createFunctionDecisionRightAction + createFunctionCompetencyAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("createDecisionRight tail-appends sort_order (existing max=3 → new=4)", async () => {
    const { createFunctionDecisionRightAction } = await import("./actions");

    await createFunctionDecisionRightAction(
      undefined,
      formDataFrom({ function_id: "fn_1", title: "Approve budgets" })
    );

    const patch = mocks.drInsertPatch.mock.calls[0][0] as {
      sort_order: number;
    };
    expect(patch.sort_order).toBe(4);
  });

  it("createDecisionRight uses sort_order=1 when the function has no existing rows", async () => {
    // Contract: unlike foundation_items (0-based), R&R + DR + comp
    // start at sort_order=1 because the trigger-seeded default sits
    // at 0 and user-added rows should live below it.
    mocks.drTailSort.mockResolvedValueOnce({ data: [] });
    const { createFunctionDecisionRightAction } = await import("./actions");

    await createFunctionDecisionRightAction(
      undefined,
      formDataFrom({ function_id: "fn_1", title: "Approve budgets" })
    );

    const patch = mocks.drInsertPatch.mock.calls[0][0] as {
      sort_order: number;
    };
    expect(patch.sort_order).toBe(1);
  });

  it("createCompetency tail-appends the same way", async () => {
    const { createFunctionCompetencyAction } = await import("./actions");

    await createFunctionCompetencyAction(
      undefined,
      formDataFrom({ function_id: "fn_1", title: "Systems thinking" })
    );

    const patch = mocks.compInsertPatch.mock.calls[0][0] as {
      sort_order: number;
    };
    expect(patch.sort_order).toBe(3);
  });
});
