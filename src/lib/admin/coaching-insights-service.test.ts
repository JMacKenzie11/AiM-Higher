import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/instances/current", () => ({ getCurrentInstanceConfig: () => ({}) }));

import { buildSynthesis, type AnalysisRow } from "./coaching-insights-service";

const FILTERS = { companyIds: [], startIso: "2026-09-01", endIso: "2026-09-30" };
const row = (person: string, company: string, summary: string): AnalysisRow => ({
  conversation_id: `${person}-${summary}`,
  created_by: person,
  company_id: company,
  practice_id: null,
  summary,
  topics: ["Hard conversations"],
  friction_level: 2,
  friction_signal: "avoidance",
  opportunity: "a prep checklist",
  analyzed_at: "2026-09-30T00:00:00Z",
});

describe("example sentences on the insights card (insights-privacy.ts, limit 2)", () => {
  it("shows none from a theme behind fewer than 3 people or one company", () => {
    const s = buildSynthesis(
      [row("a", "x", "One."), row("b", "x", "Two."), row("c", "x", "Three.")],
      FILTERS,
      30,
      new Map()
    );
    expect(s.themes[0]).toMatchObject({ label: "Hard conversations", count: 3, examples: [] });
    expect(s.friction[0].examples).toEqual([]);
    expect(s.opportunities[0].example).toBe("");
  });

  it("shows them from 3 people across 2 companies, never an emptied summary", () => {
    const s = buildSynthesis(
      [row("a", "x", "One."), row("b", "y", ""), row("c", "y", "Three.")],
      FILTERS,
      30,
      new Map()
    );
    expect(s.themes[0].examples).toEqual(["One.", "Three."]);
    expect(s.opportunities[0].example).toBe("One.");
  });
});
