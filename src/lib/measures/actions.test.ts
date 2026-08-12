import { describe, it, expect, beforeEach, vi } from "vitest";

// Server-action tests for src/lib/measures/actions.ts. Two behaviors
// carry most of the risk here: the blank-row skip (so partial saves
// don't accidentally clear existing values) and the statement-timeout
// retry (upsert is idempotent, but the retry only kicks in for
// SQLSTATE 57014 — never for constraint violations, or a bad row
// would get silently retried twice).

// ---- Shared spies + fakes -------------------------------------
const mocks = vi.hoisted(() => {
  // .from("success_measure_entries").upsert(rows, { onConflict: ... })
  const entriesUpsert = vi.fn();

  const fromBuilder = (table: string) => {
    if (table === "success_measure_entries") {
      return { upsert: entriesUpsert };
    }
    throw new Error(`Unexpected table in test: ${table}`);
  };

  const serverClient = { from: fromBuilder };
  const requireProfile = vi.fn();
  const scoreMeasureDraft = vi.fn();
  const revalidatePath = vi.fn();

  return {
    entriesUpsert,
    serverClient,
    requireProfile,
    scoreMeasureDraft,
    revalidatePath,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.serverClient,
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireProfile: mocks.requireProfile,
}));

vi.mock("./critique", () => ({
  scoreMeasureDraft: mocks.scoreMeasureDraft,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

// ---- Helpers --------------------------------------------------
function primeHappyPath() {
  mocks.requireProfile.mockResolvedValue({
    profile: { id: "user_1", role: "team_member", company_id: "co_acme" },
  });
  mocks.entriesUpsert.mockResolvedValue({ error: null });
}

// ==============================================================
// logMeasureEntriesAction
// ==============================================================
describe("logMeasureEntriesAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("rejects a missing or malformed week (must be YYYY-MM-DD)", async () => {
    const { logMeasureEntriesAction } = await import("./actions");

    const res = await logMeasureEntriesAction(
      [{ measureId: "m1", valueType: "number", rawValue: "5" }],
      "not-a-date"
    );

    expect(res).toEqual({ ok: false, message: "Missing or invalid week." });
    expect(mocks.entriesUpsert).not.toHaveBeenCalled();
  });

  it("skips blank entries entirely — no clear, no row written", async () => {
    // Contract: blank = "I'll come back to this," not "I meant to
    // clear it." If this ever flips to "blank = null," an admin's
    // hand-entered value would be silently wiped on the next save.
    const { logMeasureEntriesAction } = await import("./actions");

    const res = await logMeasureEntriesAction(
      [
        { measureId: "m1", valueType: "number", rawValue: "" },
        { measureId: "m2", valueType: "number", rawValue: "   " },
      ],
      "2026-08-14"
    );

    expect(res).toEqual({ ok: true, savedCount: 0 });
    expect(mocks.entriesUpsert).not.toHaveBeenCalled();
  });

  it("only writes non-blank entries and reports the count", async () => {
    const { logMeasureEntriesAction } = await import("./actions");

    const res = await logMeasureEntriesAction(
      [
        { measureId: "m1", valueType: "number", rawValue: "5" },
        { measureId: "m2", valueType: "number", rawValue: "" },
        { measureId: "m3", valueType: "text", rawValue: "green" },
      ],
      "2026-08-14"
    );

    expect(res).toEqual({ ok: true, savedCount: 2 });
    const rows = mocks.entriesUpsert.mock.calls[0][0] as Array<{
      measure_id: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.measure_id)).toEqual(["m1", "m3"]);
  });

  it("routes text values to value_text and leaves value_number null", async () => {
    const { logMeasureEntriesAction } = await import("./actions");

    await logMeasureEntriesAction(
      [{ measureId: "m1", valueType: "text", rawValue: "on track" }],
      "2026-08-14"
    );

    const rows = mocks.entriesUpsert.mock.calls[0][0] as Array<{
      value_number: number | null;
      value_text: string | null;
    }>;
    expect(rows[0]).toEqual(
      expect.objectContaining({ value_number: null, value_text: "on track" })
    );
  });

  it("strips non-digits from numeric values ('$1,234.50' → 1234.50)", async () => {
    const { logMeasureEntriesAction } = await import("./actions");

    await logMeasureEntriesAction(
      [{ measureId: "m1", valueType: "number", rawValue: "$1,234.50" }],
      "2026-08-14"
    );

    const rows = mocks.entriesUpsert.mock.calls[0][0] as Array<{
      value_number: number | null;
      value_text: string | null;
    }>;
    expect(rows[0]).toEqual(
      expect.objectContaining({ value_number: 1234.5, value_text: null })
    );
  });

  it("rejects a numeric value that doesn't parse", async () => {
    const { logMeasureEntriesAction } = await import("./actions");

    const res = await logMeasureEntriesAction(
      [{ measureId: "m1", valueType: "number", rawValue: "N/A" }],
      "2026-08-14"
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/isn't a number/);
    expect(mocks.entriesUpsert).not.toHaveBeenCalled();
  });

  it("stamps entered_by with the session profile id", async () => {
    const { logMeasureEntriesAction } = await import("./actions");

    await logMeasureEntriesAction(
      [{ measureId: "m1", valueType: "number", rawValue: "10" }],
      "2026-08-14"
    );

    const rows = mocks.entriesUpsert.mock.calls[0][0] as Array<{
      entered_by: string;
    }>;
    expect(rows[0].entered_by).toBe("user_1");
  });

  it("retries once on statement timeout (SQLSTATE 57014) and succeeds", async () => {
    // Retry is safe because upsert is idempotent on
    // (measure_id, week_ending). Without this, cold-start Supabase
    // connections would fail every first save of the session.
    mocks.entriesUpsert
      .mockResolvedValueOnce({
        error: { code: "57014", message: "canceling statement due to timeout" },
      })
      .mockResolvedValueOnce({ error: null });
    const { logMeasureEntriesAction } = await import("./actions");

    const res = await logMeasureEntriesAction(
      [{ measureId: "m1", valueType: "number", rawValue: "5" }],
      "2026-08-14"
    );

    expect(res).toEqual({ ok: true, savedCount: 1 });
    expect(mocks.entriesUpsert).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on a non-timeout error — a constraint violation would be silently duplicated", async () => {
    mocks.entriesUpsert.mockResolvedValueOnce({
      error: { code: "23514", message: "check constraint violated" },
    });
    const { logMeasureEntriesAction } = await import("./actions");

    const res = await logMeasureEntriesAction(
      [{ measureId: "m1", valueType: "number", rawValue: "5" }],
      "2026-08-14"
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/check constraint/);
    expect(mocks.entriesUpsert).toHaveBeenCalledTimes(1);
  });

  it("surfaces a friendly message on repeated statement timeouts", async () => {
    mocks.entriesUpsert.mockResolvedValue({
      error: { code: "57014", message: "canceling statement due to timeout" },
    });
    const { logMeasureEntriesAction } = await import("./actions");

    const res = await logMeasureEntriesAction(
      [{ measureId: "m1", valueType: "number", rawValue: "5" }],
      "2026-08-14"
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/took too long/);
    // Two total attempts: first + retry.
    expect(mocks.entriesUpsert).toHaveBeenCalledTimes(2);
  });
});

// ==============================================================
// critiqueMeasureDraftAction
// ==============================================================
describe("critiqueMeasureDraftAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeHappyPath();
  });

  it("short-circuits (returns null) for an empty description without calling the critique engine", async () => {
    // Contract: an empty draft has nothing to score, and calling the
    // model with an empty prompt would burn tokens for a nonsense
    // critique. Guard is BEFORE the model call, not after.
    const { critiqueMeasureDraftAction } = await import("./actions");

    const res = await critiqueMeasureDraftAction({
      description: "   ",
      target: "10",
      valueType: "number",
      direction: "higher_is_better",
      outcomeTitle: "On-time delivery",
      outcomeDescription: null,
    });

    expect(res).toBeNull();
    expect(mocks.scoreMeasureDraft).not.toHaveBeenCalled();
  });

  it("delegates to scoreMeasureDraft when the description is non-empty", async () => {
    mocks.scoreMeasureDraft.mockResolvedValueOnce({
      clarity: 8,
      suggestions: [],
    });
    const { critiqueMeasureDraftAction } = await import("./actions");

    const res = await critiqueMeasureDraftAction({
      description: "% of projects delivered on committed date",
      target: "95",
      valueType: "number",
      direction: "higher_is_better",
      outcomeTitle: "On-time delivery",
      outcomeDescription: null,
    });

    expect(res).toEqual({ clarity: 8, suggestions: [] });
    expect(mocks.scoreMeasureDraft).toHaveBeenCalledTimes(1);
  });
});
