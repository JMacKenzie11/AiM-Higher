import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/quarters/actions.ts. Two contracts
// carry most of the weight: the SQLSTATE 23505 → friendly-message
// translation (the partial unique index quarters_one_open surfaces
// as a unique-violation, which we translate for both open and reopen
// paths), and the cross-tenant scope guard on close/reopen (a
// company_admin must never mutate another company's quarter).

// ---- Shared spies + fakes -------------------------------------
const mocks = vi.hoisted(() => {
  const quartersInsertPatch = vi.fn();
  const quartersInsertSingle = vi.fn();
  const quartersSelectMaybeSingle = vi.fn();
  const quartersUpdatePatch = vi.fn();
  const quartersUpdateSingle = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "quarters") {
      return {
        insert: (patch: unknown) => {
          quartersInsertPatch(patch);
          return { select: () => ({ single: quartersInsertSingle }) };
        },
        select: () => ({
          eq: () => ({ maybeSingle: quartersSelectMaybeSingle }),
        }),
        update: (patch: unknown) => {
          quartersUpdatePatch(patch);
          return {
            eq: () => ({
              select: () => ({ single: quartersUpdateSingle }),
            }),
          };
        },
      };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const serverClient = { from: fromBuilder };
  const requireRole = vi.fn();
  const revalidatePath = vi.fn();

  return {
    quartersInsertPatch,
    quartersInsertSingle,
    quartersSelectMaybeSingle,
    quartersUpdatePatch,
    quartersUpdateSingle,
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

function quarterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "q_1",
    company_id: "co_acme",
    label: "2026 Q3",
    start_date: "2026-07-01",
    end_date: "2026-09-30",
    status: "open" as "open" | "closed",
    ...overrides,
  };
}

function primeHappyPath() {
  mocks.requireRole.mockResolvedValue(sessionFor({}));
  mocks.quartersInsertSingle.mockResolvedValue({
    data: quarterRow(),
    error: null,
  });
  mocks.quartersSelectMaybeSingle.mockResolvedValue({
    data: quarterRow(),
    error: null,
  });
  mocks.quartersUpdateSingle.mockResolvedValue({
    data: quarterRow(),
    error: null,
  });
}

// ==============================================================
// openQuarterAction
// ==============================================================
describe("openQuarterAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("errors when a system_admin doesn't supply a company_id in the form", async () => {
    mocks.requireRole.mockResolvedValue(
      sessionFor({ role: "system_admin", company_id: null })
    );
    const { openQuarterAction } = await import("./actions");

    const res = await openQuarterAction(
      undefined,
      formDataFrom({
        label: "2026 Q4",
        start_date: "2026-10-01",
        end_date: "2026-12-31",
      })
    );

    expect(res).toEqual({
      ok: false,
      message: "Pick a company for this quarter first.",
    });
    expect(mocks.quartersInsertPatch).not.toHaveBeenCalled();
  });

  it("rejects when label / start_date / end_date is missing", async () => {
    const { openQuarterAction } = await import("./actions");

    const res = await openQuarterAction(
      undefined,
      formDataFrom({ label: "", start_date: "2026-07-01", end_date: "2026-09-30" })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/all required/);
  });

  it("rejects when end_date is before start_date", async () => {
    const { openQuarterAction } = await import("./actions");

    const res = await openQuarterAction(
      undefined,
      formDataFrom({
        label: "2026 Q3",
        start_date: "2026-09-01",
        end_date: "2026-08-01",
      })
    );

    expect(res).toEqual({
      ok: false,
      message: "End date can't come before start date.",
    });
    expect(mocks.quartersInsertPatch).not.toHaveBeenCalled();
  });

  it("translates the SQLSTATE 23505 unique-violation into the shared friendly message", async () => {
    // Two invariants can trigger 23505: duplicate label OR the
    // partial unique index quarters_one_open catches a second open
    // quarter. The message deliberately covers both cases without
    // distinguishing — either way, the caller resolves it manually.
    mocks.quartersInsertSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });
    const { openQuarterAction } = await import("./actions");

    const res = await openQuarterAction(
      undefined,
      formDataFrom({
        label: "2026 Q3",
        start_date: "2026-07-01",
        end_date: "2026-09-30",
      })
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/already an open quarter|with that label/i);
  });
});

// ==============================================================
// closeQuarterAction
// ==============================================================
describe("closeQuarterAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("errors when the quarter isn't found", async () => {
    mocks.quartersSelectMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    const { closeQuarterAction } = await import("./actions");

    const res = await closeQuarterAction("q_missing");

    expect(res).toEqual({ ok: false, message: "Quarter not found." });
    expect(mocks.quartersUpdatePatch).not.toHaveBeenCalled();
  });

  it("blocks a company_admin from closing another company's quarter", async () => {
    mocks.requireRole.mockResolvedValue(
      sessionFor({ role: "company_admin", company_id: "co_acme" })
    );
    mocks.quartersSelectMaybeSingle.mockResolvedValueOnce({
      data: quarterRow({ company_id: "co_other" }),
      error: null,
    });
    const { closeQuarterAction } = await import("./actions");

    const res = await closeQuarterAction("q_1");

    expect(res).toEqual({ ok: false, message: "Not your quarter to close." });
    expect(mocks.quartersUpdatePatch).not.toHaveBeenCalled();
  });

  it("refuses to re-close a quarter that's already closed", async () => {
    mocks.quartersSelectMaybeSingle.mockResolvedValueOnce({
      data: quarterRow({ status: "closed" }),
      error: null,
    });
    const { closeQuarterAction } = await import("./actions");

    const res = await closeQuarterAction("q_1");

    expect(res).toEqual({
      ok: false,
      message: "That quarter is already closed.",
    });
    expect(mocks.quartersUpdatePatch).not.toHaveBeenCalled();
  });

  it("closes an open quarter", async () => {
    const { closeQuarterAction } = await import("./actions");

    const res = await closeQuarterAction("q_1");

    expect(res.ok).toBe(true);
    expect(mocks.quartersUpdatePatch).toHaveBeenCalledWith({ status: "closed" });
  });
});

// ==============================================================
// reopenQuarterAction
// ==============================================================
describe("reopenQuarterAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("blocks a company_admin from reopening another company's quarter", async () => {
    mocks.requireRole.mockResolvedValue(
      sessionFor({ role: "company_admin", company_id: "co_acme" })
    );
    mocks.quartersSelectMaybeSingle.mockResolvedValueOnce({
      data: quarterRow({ company_id: "co_other", status: "closed" }),
      error: null,
    });
    const { reopenQuarterAction } = await import("./actions");

    const res = await reopenQuarterAction("q_1");

    expect(res).toEqual({ ok: false, message: "Not your quarter to reopen." });
    expect(mocks.quartersUpdatePatch).not.toHaveBeenCalled();
  });

  it("translates 23505 on reopen into a 'close the other open one first' message", async () => {
    // Reopening trips quarters_one_open if there's already an open
    // quarter for the company. The wording tells the operator what
    // to do next rather than surfacing the raw DB error.
    mocks.quartersSelectMaybeSingle.mockResolvedValueOnce({
      data: quarterRow({ status: "closed" }),
      error: null,
    });
    mocks.quartersUpdateSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });
    const { reopenQuarterAction } = await import("./actions");

    const res = await reopenQuarterAction("q_1");

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/Close it before reopening/);
  });

  it("reopens a closed quarter on the happy path", async () => {
    mocks.quartersSelectMaybeSingle.mockResolvedValueOnce({
      data: quarterRow({ status: "closed" }),
      error: null,
    });
    const { reopenQuarterAction } = await import("./actions");

    const res = await reopenQuarterAction("q_1");

    expect(res.ok).toBe(true);
    expect(mocks.quartersUpdatePatch).toHaveBeenCalledWith({ status: "open" });
  });
});
