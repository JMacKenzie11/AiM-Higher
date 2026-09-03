import { describe, it, expect, beforeEach, vi } from "vitest";

// loadLatestOverallSnapshots replaces a per-company full-scorecard
// load on Guide HQ. Both consumers there only ever read the most
// recent overall score, so pulling 26 weeks of every discipline per
// company to get it was waste. This is one query for the whole
// caseload.

const mocks = vi.hoisted(() => {
  const rowsResult = vi.fn();
  const inSpy = vi.fn();
  return { rowsResult, inSpy };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => ({
      select: () => ({
        in: (col: string, ids: readonly string[]) => {
          mocks.inSpy(col, ids);
          return {
            gte: () => ({ order: () => mocks.rowsResult() }),
          };
        },
      }),
    }),
  }),
}));

// overallFrom is the real implementation — the whole point is that
// the historical number uses the same weighting rule as the live one.
vi.mock("./compute", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./compute")>();
  return { ...actual, computeCompanyScorecard: vi.fn() };
});

function row(
  company_id: string,
  snapshot_date: string,
  discipline: string,
  score: number | null
) {
  return { company_id, snapshot_date, discipline, score, breakdown_json: {} };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("loadLatestOverallSnapshots", () => {
  it("issues ONE query for the whole caseload", async () => {
    mocks.rowsResult.mockResolvedValue({ data: [] });
    const { loadLatestOverallSnapshots } = await import("./service");

    await loadLatestOverallSnapshots(["co_1", "co_2", "co_3"]);

    expect(mocks.inSpy).toHaveBeenCalledTimes(1);
    expect(mocks.inSpy).toHaveBeenCalledWith("company_id", [
      "co_1",
      "co_2",
      "co_3",
    ]);
  });

  it("does not query at all for an empty caseload", async () => {
    const { loadLatestOverallSnapshots } = await import("./service");

    const result = await loadLatestOverallSnapshots([]);

    expect(result.size).toBe(0);
    expect(mocks.inSpy).not.toHaveBeenCalled();
  });

  it("takes the newest snapshot date per company, independently", async () => {
    // co_1's newest is December, co_2's is November. Companies must
    // not borrow each other's dates.
    mocks.rowsResult.mockResolvedValue({
      data: [
        row("co_1", "2025-11-01", "foundation", 4),
        row("co_1", "2025-12-01", "foundation", 8),
        row("co_2", "2025-11-01", "foundation", 6),
      ],
    });
    const { loadLatestOverallSnapshots } = await import("./service");

    const result = await loadLatestOverallSnapshots(["co_1", "co_2"]);

    expect(result.get("co_1")).toEqual({ date: "2025-12-01", score: 8 });
    expect(result.get("co_2")).toEqual({ date: "2025-11-01", score: 6 });
  });

  it("averages the disciplines on the newest date, ignoring older ones", async () => {
    mocks.rowsResult.mockResolvedValue({
      data: [
        // Older date should not contribute to the returned score.
        row("co_1", "2025-11-01", "foundation", 1),
        row("co_1", "2025-12-01", "foundation", 6),
        row("co_1", "2025-12-01", "chart", 8),
      ],
    });
    const { loadLatestOverallSnapshots } = await import("./service");

    const result = await loadLatestOverallSnapshots(["co_1"]);

    expect(result.get("co_1")?.date).toBe("2025-12-01");
    expect(result.get("co_1")?.score).toBe(7);
  });

  it("omits a company with no snapshots, so callers read it as 'no prior'", async () => {
    // A new tenant the weekly cron hasn't reached. Guide HQ treats a
    // missing entry the same way it used to treat an empty timeseries.
    mocks.rowsResult.mockResolvedValue({
      data: [row("co_1", "2025-12-01", "foundation", 5)],
    });
    const { loadLatestOverallSnapshots } = await import("./service");

    const result = await loadLatestOverallSnapshots(["co_1", "co_new"]);

    expect(result.has("co_1")).toBe(true);
    expect(result.has("co_new")).toBe(false);
  });

  it("survives a null result set", async () => {
    mocks.rowsResult.mockResolvedValue({ data: null });
    const { loadLatestOverallSnapshots } = await import("./service");

    await expect(loadLatestOverallSnapshots(["co_1"])).resolves.toBeInstanceOf(
      Map
    );
  });
});
