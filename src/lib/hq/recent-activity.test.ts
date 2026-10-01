import { describe, it, expect, vi } from "vitest";

// Guide HQ's recent activity feed. A finished facilitation review is
// one of its kinds, and it never appeared: the loader asked
// meeting_analyses for updated_at, a column the table has never had,
// so PostgREST refused the query and the feed carried on without the
// reviews. The mock refuses an unknown column the same way, against
// the table's real columns (information_schema, 2026-10-01).

const mocks = vi.hoisted(() => {
  const analysisColumns = new Set([
    "id", "meeting_id", "analysis_markdown", "commitments_json", "model",
    "created_at", "facilitation_review_json", "issues_json", "truncated",
    "coverage_json", "score_positive_framing", "score_rhythm",
    "score_accountability", "score_alignment", "score_agenda",
    "score_overall", "score_weights", "spelling_changes",
  ]);

  // A query builder that ignores its filters and resolves to `result`,
  // whether awaited directly or ended with limit().
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const k of ["in", "eq", "gte", "order"]) c[k] = () => c;
    c.limit = async () => result;
    c.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return c;
  };

  const supabase = {
    from(table: string) {
      if (table === "companies") {
        return { select: () => chain({ data: [{ id: "co_1", name: "Acme" }] }) };
      }
      if (table === "meetings") {
        return {
          select: () =>
            chain({
              data: [
                {
                  id: "m_1",
                  company_id: "co_1",
                  status: "complete",
                  meeting_title: "Weekly",
                  file_name: "weekly.txt",
                  updated_at: "2026-09-29T15:00:00Z",
                },
              ],
            }),
        };
      }
      if (table === "quarters") {
        return { select: () => chain({ data: [] }) };
      }
      if (table === "meeting_analyses") {
        return {
          select: (cols: string) => {
            const unknown = cols
              .split(",")
              .map((c) => c.trim())
              .filter((c) => !analysisColumns.has(c));
            return chain(
              unknown.length > 0
                ? {
                    data: null,
                    error: {
                      code: "42703",
                      message: `column meeting_analyses.${unknown[0]} does not exist`,
                    },
                  }
                : {
                    data: [
                      {
                        meeting_id: "m_1",
                        created_at: "2026-09-29T15:02:00Z",
                        facilitation_review_json: {
                          overall: 3.5,
                          insufficient_transcript: false,
                        },
                      },
                    ],
                    error: null,
                  }
            );
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { supabase };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => mocks.supabase,
}));

vi.mock("@/lib/maturity/service", () => ({
  loadCompanyScorecardScores: vi.fn(),
  loadLatestOverallSnapshots: vi.fn(),
}));

import { loadRecentActivity } from "./service";

describe("loadRecentActivity", () => {
  it("lists a finished facilitation review, dated when the review was written", async () => {
    const items = await loadRecentActivity(["co_1"]);
    expect(items.find((i) => i.kind === "facilitation_review")).toMatchObject({
      meetingId: "m_1",
      companyName: "Acme",
      when: "2026-09-29T15:02:00Z",
      overall: 3.5,
      insufficient: false,
    });
    expect(items.map((i) => i.kind)).toEqual([
      "facilitation_review",
      "meeting_analyzed",
    ]);
  });
});
