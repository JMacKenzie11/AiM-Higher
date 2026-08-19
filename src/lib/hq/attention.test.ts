import { describe, it, expect, beforeEach, vi } from "vitest";

// Attention-queue trigger tests. One test per condition per the DoD:
// scorecard drop, FTR low, FTR declining, facilitation low or
// insufficient, priority overdue, unrouted transcript.
//
// The Supabase client is mocked as a per-table dispatch so each test
// primes only the rows relevant to its trigger. loadCompanyScorecard
// (external module) is mocked so scorecard tests can dictate the
// current + prior snapshot values without setting up snapshots by
// hand.

const mocks = vi.hoisted(() => {
  // Each table returns a promise from the terminating call. Tests
  // set the resolved value per test via these spies.
  const companiesResult = vi.fn();
  const commitmentsResult = vi.fn();
  const quartersResult = vi.fn();
  const meetingsCompletedResult = vi.fn();
  const meetingsUnroutedResult = vi.fn();
  const aliasesResult = vi.fn();
  const prioritiesResult = vi.fn();
  const analysesResult = vi.fn();

  const loadCompanyScorecard = vi.fn();

  const supabase = {
    from(table: string) {
      if (table === "companies") {
        return {
          select: () => ({
            in: () => companiesResult(),
          }),
        };
      }
      if (table === "commitments") {
        return {
          select: () => ({
            in: () => ({
              gte: () => commitmentsResult(),
            }),
          }),
        };
      }
      if (table === "quarters") {
        return {
          select: () => ({
            in: () => ({
              eq: () => quartersResult(),
            }),
          }),
        };
      }
      if (table === "priorities") {
        return {
          select: () => ({
            in: () => ({
              lt: () => ({
                not: () => prioritiesResult(),
              }),
            }),
          }),
        };
      }
      if (table === "meetings") {
        return {
          select: () => ({
            in: (col: string) => {
              // Two shapes:
              //   .select(...).in("company_id", ids).eq("status", "complete").order()
              //   .select(...).eq("status", "unrouted")
              // The dispatch below picks based on which chain is called.
              if (col === "company_id") {
                return {
                  eq: () => ({ order: () => meetingsCompletedResult() }),
                };
              }
              throw new Error("unexpected meetings filter col: " + col);
            },
            eq: () => meetingsUnroutedResult(),
          }),
        };
      }
      if (table === "transcript_aliases") {
        return {
          select: () => ({
            in: () => aliasesResult(),
          }),
        };
      }
      if (table === "meeting_analyses") {
        return {
          select: () => ({
            in: () => analysesResult(),
          }),
        };
      }
      throw new Error("unmocked table: " + table);
    },
  };

  return {
    companiesResult,
    commitmentsResult,
    quartersResult,
    prioritiesResult,
    meetingsCompletedResult,
    meetingsUnroutedResult,
    aliasesResult,
    analysesResult,
    loadCompanyScorecard,
    supabase,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.supabase,
}));

vi.mock("@/lib/maturity/service", () => ({
  loadCompanyScorecard: mocks.loadCompanyScorecard,
}));

function primeNoTriggers() {
  mocks.companiesResult.mockResolvedValue({
    data: [{ id: "co_1", name: "Acme" }],
  });
  mocks.commitmentsResult.mockResolvedValue({ data: [] });
  mocks.quartersResult.mockResolvedValue({ data: [] });
  mocks.prioritiesResult.mockResolvedValue({ data: [] });
  mocks.meetingsCompletedResult.mockResolvedValue({ data: [] });
  mocks.meetingsUnroutedResult.mockResolvedValue({ data: [] });
  mocks.aliasesResult.mockResolvedValue({ data: [] });
  mocks.analysesResult.mockResolvedValue({ data: [] });
  mocks.loadCompanyScorecard.mockResolvedValue({
    companyId: "co_1",
    computedAt: "2026-01-01",
    overall: { score: 7, disciplinesCounted: 4 },
    disciplines: [],
    timeseries: {},
    overallTimeseries: [{ date: "2025-12-01", score: 7 }],
  });
}

describe("computeAttentionForCompanies — per-trigger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeNoTriggers();
  });

  it("clean baseline returns no rows", async () => {
    const { computeAttentionForCompanies } = await import("./attention");
    const rows = await computeAttentionForCompanies(["co_1"]);
    expect(rows).toEqual([]);
  });

  it("scorecard_dropped fires when current < last snapshot", async () => {
    mocks.loadCompanyScorecard.mockResolvedValueOnce({
      companyId: "co_1",
      computedAt: "2026-01-01",
      overall: { score: 5, disciplinesCounted: 4 },
      disciplines: [],
      timeseries: {},
      overallTimeseries: [{ date: "2025-12-01", score: 8 }],
    });
    const { computeAttentionForCompanies } = await import("./attention");
    const rows = await computeAttentionForCompanies(["co_1"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].triggers[0]).toEqual({
      kind: "scorecard_dropped",
      from: 8,
      to: 5,
      priorDate: "2025-12-01",
    });
  });

  it("ftr_low fires when 30d follow-through < threshold", async () => {
    // Recent-window rows: 1 kept-on-time, 3 missed → 25% < 60%.
    const now = new Date().toISOString();
    mocks.commitmentsResult.mockResolvedValueOnce({
      data: [
        {
          company_id: "co_1",
          status: "kept_on_time",
          completed_at: now,
          deleted_at: null,
          parked_at: null,
        },
        ...Array.from({ length: 3 }, () => ({
          company_id: "co_1",
          status: "missed",
          completed_at: now,
          deleted_at: null,
          parked_at: null,
        })),
      ],
    });
    const { computeAttentionForCompanies, FTR_THRESHOLD } = await import(
      "./attention"
    );
    const rows = await computeAttentionForCompanies(["co_1"]);
    expect(rows[0].triggers[0]).toEqual({
      kind: "ftr_low",
      rate: 25,
      threshold: FTR_THRESHOLD,
    });
  });

  it("ftr_declining fires when newer window is below older window (but neither below threshold)", async () => {
    // Older window: 8 kept-on-time, 2 missed → 80%
    // Newer window: 7 kept-on-time, 3 missed → 70%
    // Both above the 60% floor, but the trend is down.
    const now = Date.now();
    const nowIso = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
    const oldIso = new Date(now - 45 * 24 * 60 * 60 * 1000).toISOString();
    const rows = [
      ...Array.from({ length: 7 }, () => ({
        company_id: "co_1",
        status: "kept_on_time",
        completed_at: nowIso,
        deleted_at: null,
        parked_at: null,
      })),
      ...Array.from({ length: 3 }, () => ({
        company_id: "co_1",
        status: "missed",
        completed_at: nowIso,
        deleted_at: null,
        parked_at: null,
      })),
      ...Array.from({ length: 8 }, () => ({
        company_id: "co_1",
        status: "kept_on_time",
        completed_at: oldIso,
        deleted_at: null,
        parked_at: null,
      })),
      ...Array.from({ length: 2 }, () => ({
        company_id: "co_1",
        status: "missed",
        completed_at: oldIso,
        deleted_at: null,
        parked_at: null,
      })),
    ];
    mocks.commitmentsResult.mockResolvedValueOnce({ data: rows });
    const { computeAttentionForCompanies } = await import("./attention");
    const result = await computeAttentionForCompanies(["co_1"]);
    expect(result[0].triggers[0]).toEqual({
      kind: "ftr_declining",
      from: 80,
      to: 70,
    });
  });

  it("facilitation_low fires when latest review overall < threshold", async () => {
    mocks.meetingsCompletedResult.mockResolvedValueOnce({
      data: [{ id: "m_1", company_id: "co_1" }],
    });
    mocks.analysesResult.mockResolvedValueOnce({
      data: [
        {
          meeting_id: "m_1",
          facilitation_review_json: {
            overall: 3,
            insufficient_transcript: false,
          },
        },
      ],
    });
    const { computeAttentionForCompanies } = await import("./attention");
    const rows = await computeAttentionForCompanies(["co_1"]);
    expect(rows[0].triggers.find((t) => t.kind === "facilitation_low"))
      .toEqual({ kind: "facilitation_low", overall: 3, meetingId: "m_1" });
  });

  it("facilitation_insufficient fires when latest review flagged insufficient", async () => {
    mocks.meetingsCompletedResult.mockResolvedValueOnce({
      data: [{ id: "m_1", company_id: "co_1" }],
    });
    mocks.analysesResult.mockResolvedValueOnce({
      data: [
        {
          meeting_id: "m_1",
          facilitation_review_json: {
            overall: null,
            insufficient_transcript: true,
          },
        },
      ],
    });
    const { computeAttentionForCompanies } = await import("./attention");
    const rows = await computeAttentionForCompanies(["co_1"]);
    expect(
      rows[0].triggers.find((t) => t.kind === "facilitation_insufficient")
    ).toEqual({ kind: "facilitation_insufficient", meetingId: "m_1" });
  });

  it("priority_overdue fires when a priority is > 14 days past due", async () => {
    mocks.quartersResult.mockResolvedValueOnce({
      data: [{ id: "q_1", company_id: "co_1" }],
    });
    const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    mocks.prioritiesResult.mockResolvedValueOnce({
      data: [
        {
          company_id: "co_1",
          due_date: past,
          status: "on_track",
          archived: false,
        },
      ],
    });
    const { computeAttentionForCompanies } = await import("./attention");
    const rows = await computeAttentionForCompanies(["co_1"]);
    const trigger = rows[0].triggers.find((t) => t.kind === "priority_overdue");
    expect(trigger?.kind).toBe("priority_overdue");
    if (trigger && trigger.kind === "priority_overdue") {
      expect(trigger.count).toBe(1);
      expect(trigger.oldestDays).toBeGreaterThanOrEqual(29);
    }
  });

  it("unrouted_transcript fires when an unrouted meeting matches this company's alias", async () => {
    mocks.aliasesResult.mockResolvedValueOnce({
      data: [{ company_id: "co_1", alias: "acme" }],
    });
    mocks.meetingsUnroutedResult.mockResolvedValueOnce({
      data: [{ file_name: "Acme Meeting 2026-01-01.txt" }],
    });
    const { computeAttentionForCompanies } = await import("./attention");
    const rows = await computeAttentionForCompanies(["co_1"]);
    expect(rows[0].triggers.find((t) => t.kind === "unrouted_transcript"))
      .toEqual({ kind: "unrouted_transcript", count: 1 });
  });
});
