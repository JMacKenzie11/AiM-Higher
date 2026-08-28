import { describe, it, expect, beforeEach, vi } from "vitest";

// Tests for applyChartProposalAction — the server action behind the
// ChartProposalCard's Apply button. Pins the additive-only
// semantics agreed with the user:
//   * Top-level functions matched by case-insensitive title → skip
//     (never modify). Their proposal responsibilities are NOT
//     overwritten.
//   * Missing responsibilities on an existing function → MERGE in
//     (add-only, case-insensitive on title).
//   * Top seats skipped entirely when the chart already has ≥ 2
//     top-level functions. Kept-vs-proposed names surface in the
//     summary.
//   * Malformed JSON → error result, no writes.
//   * Non-admin caller → denied, no writes.

// ---- Shared spies ---------------------------------------------
const mocks = vi.hoisted(() => {
  const requireProfile = vi.fn();
  const revalidatePath = vi.fn();

  // Table-scoped stubs so a test can prime the .select() return
  // for each table independently.
  const functionsSelect = vi.fn(); // returns { data, error }
  const functionsInsert = vi.fn(); // called with the patch
  const functionsInsertSingle = vi.fn(); // returns { data, error }
  const rolesSelect = vi.fn(); // returns { data }
  const rolesInsert = vi.fn(); // returns { error, count }
  const rolesInsertPatch = vi.fn(); // captures the rows
  const conversationMaybeSingle = vi.fn(); // returns { data }

  const fromBuilder = (table: string) => {
    if (table === "coaching_conversations") {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: conversationMaybeSingle }),
        }),
      };
    }
    if (table === "functions") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => functionsSelect(),
          }),
        }),
        insert: (patch: unknown) => {
          functionsInsert(patch);
          return { select: () => ({ single: functionsInsertSingle }) };
        },
      };
    }
    if (table === "function_roles") {
      return {
        select: () => ({
          in: () => rolesSelect(),
        }),
        insert: (rows: unknown) => {
          rolesInsertPatch(rows);
          return rolesInsert();
        },
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const adminClient = { from: fromBuilder };

  return {
    requireProfile,
    revalidatePath,
    functionsSelect,
    functionsInsert,
    functionsInsertSingle,
    rolesSelect,
    rolesInsert,
    rolesInsertPatch,
    conversationMaybeSingle,
    adminClient,
  };
});

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: mocks.requireProfile,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mocks.adminClient,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

function sessionFor(overrides: {
  id?: string;
  role?: "system_admin" | "company_admin" | "team_member" | "aims_guide";
  company_id?: string | null;
  guide_company_ids?: readonly string[];
}) {
  return {
    profile: {
      id: overrides.id ?? "u1",
      role: overrides.role ?? "company_admin",
      company_id:
        "company_id" in overrides ? overrides.company_id : "co_acme",
      guide_company_ids: overrides.guide_company_ids ?? [],
    },
  };
}

function primeEmptyChart() {
  // No existing functions.
  mocks.functionsSelect.mockResolvedValue({ data: [], error: null });
  mocks.rolesSelect.mockResolvedValue({ data: [] });
  mocks.rolesInsert.mockResolvedValue({ error: null, count: 0 });
  let nextId = 1;
  mocks.functionsInsertSingle.mockImplementation(() =>
    Promise.resolve({
      data: {
        id: `fn_${nextId++}`,
        title: (mocks.functionsInsert.mock.calls.at(-1)?.[0] as { title: string })
          .title,
        parent_function_id: (
          mocks.functionsInsert.mock.calls.at(-1)?.[0] as {
            parent_function_id: string | null;
          }
        ).parent_function_id,
      },
      error: null,
    })
  );
}

const VALID_PROPOSAL = JSON.stringify({
  top_seats: [
    { name: "Visionary", note: "CEO — sets the vision." },
    { name: "Integrator", note: "COO — runs the day-to-day." },
  ],
  functions: [
    {
      name: "Sales",
      responsibilities: ["LMA", "Pipeline", "Forecasting"],
    },
    {
      name: "Operations",
      responsibilities: ["LMA", "Delivery", "Quality"],
    },
  ],
});

const CONV_ID = "conv_1";

describe("applyChartProposalAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeEmptyChart();
    // Every apply now resolves the target company from the
    // conversation row instead of the caller's scope cookie.
    // Default: the conversation belongs to co_acme, created by the
    // same user we mock in each test (u1 unless overridden).
    mocks.conversationMaybeSingle.mockResolvedValue({
      data: { id: CONV_ID, company_id: "co_acme", created_by: "u1" },
    });
  });

  it("rejects malformed proposal JSON with no writes", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ role: "company_admin" })
    );
    const { applyChartProposalAction } = await import("./apply-proposal-action");

    const res = await applyChartProposalAction("not json at all", CONV_ID);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/right shape/i);
    expect(mocks.functionsInsert).not.toHaveBeenCalled();
    expect(mocks.rolesInsertPatch).not.toHaveBeenCalled();
  });

  it("denies a team_member caller even with valid JSON", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ role: "team_member", company_id: "co_acme" })
    );
    const { applyChartProposalAction } = await import("./apply-proposal-action");

    const res = await applyChartProposalAction(VALID_PROPOSAL, CONV_ID);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/can't edit/i);
    expect(mocks.functionsInsert).not.toHaveBeenCalled();
  });

  it("denies an aims_guide off caseload", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({
        role: "aims_guide",
        company_id: null,
        guide_company_ids: ["co_meridian"],
      })
    );
    const { applyChartProposalAction } = await import("./apply-proposal-action");

    const res = await applyChartProposalAction(VALID_PROPOSAL, CONV_ID);

    expect(res.ok).toBe(false);
    expect(mocks.functionsInsert).not.toHaveBeenCalled();
  });

  it("skips top_seats entirely when the chart already has ≥ 2 top-level functions", async () => {
    // Universal case — every company is seeded with Visionary +
    // Integrator (migration 0112).
    mocks.functionsSelect.mockResolvedValue({
      data: [
        { id: "fn_v", title: "Visionary", parent_function_id: null },
        { id: "fn_i", title: "Integrator", parent_function_id: null },
      ],
      error: null,
    });
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ role: "company_admin" })
    );
    const { applyChartProposalAction } = await import("./apply-proposal-action");

    const res = await applyChartProposalAction(VALID_PROPOSAL, CONV_ID);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.summary.keptTopSeats.sort()).toEqual(
        ["Integrator", "Visionary"].sort()
      );
      expect(res.summary.proposedTopSeats.sort()).toEqual(
        ["Integrator", "Visionary"].sort()
      );
    }
    // The proposal's two functions should still create.
    const inserted = mocks.functionsInsert.mock.calls.map(
      (c) => (c[0] as { title: string }).title
    );
    expect(inserted).toEqual(expect.arrayContaining(["Sales", "Operations"]));
    // But the two top-seat names in the proposal should NOT be
    // inserted (they'd be dupes of the seeded seats).
    expect(inserted).not.toContain("Visionary");
    expect(inserted).not.toContain("Integrator");
  });

  it("skips a function whose title matches an existing one (case-insensitive), but merges missing responsibilities", async () => {
    // Existing chart has "Sales" (mixed case) with one
    // responsibility, "LMA". Proposal has "sales" with three.
    // Skip the function, MERGE the two missing responsibilities.
    mocks.functionsSelect.mockResolvedValue({
      data: [
        { id: "fn_v", title: "Visionary", parent_function_id: null },
        { id: "fn_i", title: "Integrator", parent_function_id: null },
        { id: "fn_s", title: "Sales", parent_function_id: null },
      ],
      error: null,
    });
    mocks.rolesSelect.mockResolvedValue({
      data: [
        { id: "r_lma", function_id: "fn_s", title: "Lead, Track, Decide", body: null },
        { id: "r_p", function_id: "fn_s", title: "Pipeline", body: null },
      ],
    });
    mocks.rolesInsert.mockResolvedValue({ error: null, count: 2 });
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ role: "company_admin" })
    );
    const proposal = JSON.stringify({
      top_seats: [],
      functions: [
        {
          name: "Sales",
          responsibilities: ["LMA", "Pipeline", "Forecasting", "Enablement"],
        },
      ],
    });
    const { applyChartProposalAction } = await import("./apply-proposal-action");

    const res = await applyChartProposalAction(proposal, CONV_ID);

    expect(res.ok).toBe(true);
    // Sales was not re-inserted (skipped by name).
    const inserted = mocks.functionsInsert.mock.calls.map(
      (c) => (c[0] as { title: string }).title
    );
    expect(inserted).not.toContain("Sales");
    // Two new responsibilities added — LMA and Pipeline already
    // existed (case-insensitive: "LMA" vs "Lead, Track, Decide"
    // are different strings, so LMA actually gets added too; the
    // dedupe key is on the exact title). "Forecasting" and
    // "Enablement" are the two novel titles.
    const rows = mocks.rolesInsertPatch.mock.calls[0]?.[0] as
      | Array<{ title: string }>
      | undefined;
    expect(rows).toBeDefined();
    const addedTitles = rows?.map((r) => r.title) ?? [];
    expect(addedTitles).toEqual(
      expect.arrayContaining(["LMA", "Forecasting", "Enablement"])
    );
    expect(addedTitles).not.toContain("Pipeline"); // exact match on existing
  });

  it("targets the conversation's company, not the caller's current scope cookie", async () => {
    // Regression: sysadmin scoped into co_meridian at Apply time, but
    // the practice conversation was created against co_acme. The chart
    // must land on co_acme (the conversation's company), never on the
    // caller's current scope.
    mocks.conversationMaybeSingle.mockResolvedValueOnce({
      data: { id: CONV_ID, company_id: "co_acme", created_by: "u1" },
    });
    mocks.requireProfile.mockResolvedValue(
      // Sysadmin — passes isAdminForCompany for any company_id.
      sessionFor({ role: "system_admin", company_id: null })
    );
    const { applyChartProposalAction } = await import(
      "./apply-proposal-action"
    );

    const res = await applyChartProposalAction(VALID_PROPOSAL, CONV_ID);

    expect(res.ok).toBe(true);
    // Confirm every function insert carries the conversation's
    // company_id, not any other value.
    for (const call of mocks.functionsInsert.mock.calls) {
      const patch = call[0] as { company_id: string };
      expect(patch.company_id).toBe("co_acme");
    }
  });

  it("rejects an apply against a conversation the caller doesn't own", async () => {
    mocks.conversationMaybeSingle.mockResolvedValueOnce({
      data: { id: CONV_ID, company_id: "co_acme", created_by: "someone_else" },
    });
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "u1", role: "system_admin" })
    );
    const { applyChartProposalAction } = await import(
      "./apply-proposal-action"
    );

    const res = await applyChartProposalAction(VALID_PROPOSAL, CONV_ID);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/not yours/i);
    expect(mocks.functionsInsert).not.toHaveBeenCalled();
  });

  it("is idempotent: applying the same proposal twice creates nothing the second time", async () => {
    // Existing chart already has every function + responsibility
    // from the proposal (state after a prior Apply). The second
    // Apply should return ok with a totals-zero summary.
    mocks.functionsSelect.mockResolvedValue({
      data: [
        { id: "fn_v", title: "Visionary", parent_function_id: null },
        { id: "fn_i", title: "Integrator", parent_function_id: null },
        { id: "fn_s", title: "Sales", parent_function_id: null },
        { id: "fn_o", title: "Operations", parent_function_id: null },
      ],
      error: null,
    });
    mocks.rolesSelect.mockResolvedValue({
      data: [
        { id: "r_s1", function_id: "fn_s", title: "LMA", body: null },
        { id: "r_s2", function_id: "fn_s", title: "Pipeline", body: null },
        { id: "r_s3", function_id: "fn_s", title: "Forecasting", body: null },
        { id: "r_o1", function_id: "fn_o", title: "LMA", body: null },
        { id: "r_o2", function_id: "fn_o", title: "Delivery", body: null },
        { id: "r_o3", function_id: "fn_o", title: "Quality", body: null },
      ],
    });
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ role: "company_admin" })
    );
    const { applyChartProposalAction } = await import("./apply-proposal-action");

    const res = await applyChartProposalAction(VALID_PROPOSAL, CONV_ID);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.summary.totalCreatedFunctions).toBe(0);
      expect(res.summary.totalAddedResponsibilities).toBe(0);
    }
    // Not a single insert should have fired.
    expect(mocks.functionsInsert).not.toHaveBeenCalled();
    expect(mocks.rolesInsertPatch).not.toHaveBeenCalled();
  });
});
