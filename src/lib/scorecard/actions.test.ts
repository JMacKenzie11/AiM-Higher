import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/scorecard/actions.ts. The riskiest
// branch is upsertEntryAction: it dual-authorizes (admin OR the area's
// accountable person), coerces the raw string based on value_type
// (text vs number-with-optional-trailing-%), and treats an empty
// string as "clear the cell" via a delete. Getting any of those
// wrong means either a bad number lands as NaN or the wrong user
// silently writes a peer's cell.

// ---- Shared spies + fakes -------------------------------------
const mocks = vi.hoisted(() => {
  const areasInsertSingle = vi.fn();
  const areasSelectMaybeSingle = vi.fn();
  const areasUpdateSingle = vi.fn();
  const areasDeleteEq = vi.fn();

  const metricsInsertSingle = vi.fn();
  const metricsInsertPatch = vi.fn();
  const metricsSelectMaybeSingle = vi.fn();
  const metricsUpdatePatch = vi.fn();
  const metricsUpdateSingle = vi.fn();

  const entriesUpsertPayload = vi.fn();
  const entriesUpsertSingle = vi.fn();
  const entriesDeleteEqEq = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "functional_areas") {
      return {
        insert: () => ({
          select: () => ({ single: areasInsertSingle }),
        }),
        select: () => ({
          eq: () => ({ maybeSingle: areasSelectMaybeSingle }),
        }),
        update: () => ({
          eq: () => ({
            select: () => ({ single: areasUpdateSingle }),
          }),
        }),
        delete: () => ({
          eq: () => areasDeleteEq(),
        }),
      };
    }
    if (table === "scorecard_metrics") {
      return {
        insert: (patch: unknown) => {
          metricsInsertPatch(patch);
          return { select: () => ({ single: metricsInsertSingle }) };
        },
        select: () => ({
          eq: () => ({ maybeSingle: metricsSelectMaybeSingle }),
        }),
        update: (patch: unknown) => {
          metricsUpdatePatch(patch);
          return {
            eq: () => ({
              select: () => ({ single: metricsUpdateSingle }),
            }),
          };
        },
      };
    }
    if (table === "scorecard_entries") {
      return {
        upsert: (payload: unknown, opts: unknown) => {
          entriesUpsertPayload(payload, opts);
          return { select: () => ({ single: entriesUpsertSingle }) };
        },
        delete: () => ({
          eq: () => ({ eq: () => entriesDeleteEqEq() }),
        }),
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
    areasInsertSingle,
    areasSelectMaybeSingle,
    areasUpdateSingle,
    areasDeleteEq,
    metricsInsertSingle,
    metricsInsertPatch,
    metricsSelectMaybeSingle,
    metricsUpdatePatch,
    metricsUpdateSingle,
    entriesUpsertPayload,
    entriesUpsertSingle,
    entriesDeleteEqEq,
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

function primeHappyPath() {
  mocks.requireRole.mockResolvedValue(sessionFor({}));
  mocks.requireProfile.mockResolvedValue(sessionFor({}));
  mocks.scopedCompanyId.mockResolvedValue("co_acme");
  mocks.areasInsertSingle.mockResolvedValue({
    data: {
      id: "area_1",
      company_id: "co_acme",
      name: "Sales",
      accountable_id: null,
    },
    error: null,
  });
  mocks.areasSelectMaybeSingle.mockResolvedValue({
    data: { accountable_id: "owner_1", company_id: "co_acme" },
    error: null,
  });
  mocks.areasDeleteEq.mockResolvedValue({ error: null });
  mocks.metricsInsertSingle.mockResolvedValue({
    data: {
      id: "metric_1",
      company_id: "co_acme",
      functional_area_id: "area_1",
      name: "Deals closed",
      target: "12",
      value_type: "number",
    },
    error: null,
  });
  mocks.metricsSelectMaybeSingle.mockResolvedValue({
    data: {
      id: "metric_1",
      company_id: "co_acme",
      functional_area_id: "area_1",
      value_type: "number",
    },
    error: null,
  });
  mocks.entriesUpsertSingle.mockResolvedValue({
    data: {
      id: "entry_1",
      company_id: "co_acme",
      metric_id: "metric_1",
      week_ending: "2026-08-14",
      value_number: 5,
      value_text: null,
      entered_by: "caller_1",
    },
    error: null,
  });
  mocks.entriesDeleteEqEq.mockResolvedValue({ error: null });
}

// ==============================================================
// createAreaAction / deleteAreaAction
// ==============================================================
describe("createAreaAction + deleteAreaAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("createArea rejects an empty name", async () => {
    const { createAreaAction } = await import("./actions");

    const res = await createAreaAction(undefined, formDataFrom({ name: " " }));

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/name/i);
  });

  it("createArea errors when no company can be resolved", async () => {
    mocks.scopedCompanyId.mockResolvedValueOnce(null);
    const { createAreaAction } = await import("./actions");

    const res = await createAreaAction(undefined, formDataFrom({ name: "Sales" }));

    expect(res).toEqual({ ok: false, message: "Pick a company first." });
  });

  it("deleteArea returns ok when the delete succeeds", async () => {
    const { deleteAreaAction } = await import("./actions");

    const res = await deleteAreaAction("area_1");

    expect(res).toEqual({ ok: true });
  });
});

// ==============================================================
// createMetricAction
// ==============================================================
describe("createMetricAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects when no functional area is supplied", async () => {
    const { createMetricAction } = await import("./actions");

    const res = await createMetricAction(
      undefined,
      formDataFrom({ name: "Deals closed" })
    );

    expect(res).toEqual({ ok: false, message: "Pick an area." });
    expect(mocks.metricsInsertPatch).not.toHaveBeenCalled();
  });

  it("defaults an unknown value_type to 'number'", async () => {
    // Any garbage value_type shouldn't land in the DB and later crash
    // rendering — coerce back to 'number' so the metric is at least
    // usable.
    const { createMetricAction } = await import("./actions");

    await createMetricAction(
      undefined,
      formDataFrom({
        functional_area_id: "area_1",
        name: "Deals",
        value_type: "totally-fake",
      })
    );

    const patch = mocks.metricsInsertPatch.mock.calls[0][0] as {
      value_type: string;
    };
    expect(patch.value_type).toBe("number");
  });
});

// ==============================================================
// upsertEntryAction — the interesting one
// ==============================================================
describe("upsertEntryAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("errors when the metric doesn't exist / isn't accessible", async () => {
    mocks.metricsSelectMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    const { upsertEntryAction } = await import("./actions");

    const res = await upsertEntryAction("m_missing", "2026-08-14", "5");

    expect(res).toEqual({
      ok: false,
      message: "That metric isn't accessible.",
    });
    expect(mocks.entriesUpsertPayload).not.toHaveBeenCalled();
  });

  it("blocks a non-admin who isn't the area's accountable person", async () => {
    // Dual-auth contract: admins can write any metric in their scope,
    // but non-admins can ONLY write the areas they're accountable for.
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "peer_1", role: "team_member" })
    );
    mocks.areasSelectMaybeSingle.mockResolvedValueOnce({
      data: { accountable_id: "owner_1", company_id: "co_acme" },
      error: null,
    });
    const { upsertEntryAction } = await import("./actions");

    const res = await upsertEntryAction("metric_1", "2026-08-14", "5");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/accountable person/);
    expect(mocks.entriesUpsertPayload).not.toHaveBeenCalled();
  });

  it("allows the accountable person to save even without an admin role", async () => {
    mocks.requireProfile.mockResolvedValue(
      sessionFor({ id: "owner_1", role: "team_member" })
    );
    mocks.areasSelectMaybeSingle.mockResolvedValueOnce({
      data: { accountable_id: "owner_1", company_id: "co_acme" },
      error: null,
    });
    const { upsertEntryAction } = await import("./actions");

    const res = await upsertEntryAction("metric_1", "2026-08-14", "5");

    expect(res.ok).toBe(true);
    expect(mocks.entriesUpsertPayload).toHaveBeenCalledTimes(1);
  });

  it("clears the cell (deletes the row) when the value is empty", async () => {
    // Empty-cell semantics: not "write null," but "no entry for this
    // week." Deleting keeps the unique index clean.
    const { upsertEntryAction } = await import("./actions");

    const res = await upsertEntryAction("metric_1", "2026-08-14", "   ");

    expect(res.ok).toBe(true);
    expect(mocks.entriesDeleteEqEq).toHaveBeenCalledTimes(1);
    expect(mocks.entriesUpsertPayload).not.toHaveBeenCalled();
  });

  it("routes text values to value_text and leaves value_number null", async () => {
    mocks.metricsSelectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "metric_1",
        company_id: "co_acme",
        functional_area_id: "area_1",
        value_type: "text",
      },
      error: null,
    });
    const { upsertEntryAction } = await import("./actions");

    await upsertEntryAction("metric_1", "2026-08-14", "on track");

    const payload = mocks.entriesUpsertPayload.mock.calls[0][0] as {
      value_number: number | null;
      value_text: string | null;
    };
    expect(payload).toEqual(
      expect.objectContaining({ value_number: null, value_text: "on track" })
    );
  });

  it("strips a trailing % for percent metrics and parses the number", async () => {
    mocks.metricsSelectMaybeSingle.mockResolvedValueOnce({
      data: {
        id: "metric_1",
        company_id: "co_acme",
        functional_area_id: "area_1",
        value_type: "percent",
      },
      error: null,
    });
    const { upsertEntryAction } = await import("./actions");

    await upsertEntryAction("metric_1", "2026-08-14", "82%");

    const payload = mocks.entriesUpsertPayload.mock.calls[0][0] as {
      value_number: number | null;
    };
    expect(payload.value_number).toBe(82);
  });

  it("errors when a numeric-type metric gets a non-numeric value", async () => {
    const { upsertEntryAction } = await import("./actions");

    const res = await upsertEntryAction("metric_1", "2026-08-14", "N/A");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/a number/);
    expect(mocks.entriesUpsertPayload).not.toHaveBeenCalled();
  });
});
