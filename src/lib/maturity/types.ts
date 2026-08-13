import type { DisciplineKey } from "./disciplines";

// Every scorer returns this shape. Breakdown is the "why is our score
// what it is" evidence displayed on the discipline card. Keep the
// keys short — they render straight into the UI.
export type DisciplineScore = {
  key: DisciplineKey;
  // 0–10, one decimal place. Null means "not applicable" (feature-gated
  // discipline that's turned off) — the UI renders a muted tile.
  score: number | null;
  // Free-shape evidence, discipline-specific. Serialized to jsonb.
  breakdown: Record<string, unknown>;
};

export type ScorecardSnapshotRow = {
  id: string;
  company_id: string;
  snapshot_date: string; // YYYY-MM-DD
  discipline: DisciplineKey;
  score: number | null;
  breakdown_json: Record<string, unknown>;
  created_at: string;
};

// The bundle the /scorecard page reads: current live scores + the
// historical snapshots so the trend line can render.
export type CompanyScorecard = {
  companyId: string;
  computedAt: string; // ISO
  overall: {
    score: number | null; // null if no scored disciplines (rare — every non-gated one always scores)
    disciplinesCounted: number;
  };
  disciplines: DisciplineScore[];
  // Snapshots for the trend charts, oldest → newest, one per week.
  // Keyed by discipline for easy lookup in the client.
  timeseries: Record<DisciplineKey, Array<{ date: string; score: number | null }>>;
  // Overall score history (weighted average per snapshot date).
  overallTimeseries: Array<{ date: string; score: number | null }>;
};

// Small utility used by every scorer: clamp to [0, 10] and round to 1dp.
export function clampScore(raw: number): number {
  if (Number.isNaN(raw)) return 0;
  const clamped = Math.max(0, Math.min(10, raw));
  return Math.round(clamped * 10) / 10;
}
