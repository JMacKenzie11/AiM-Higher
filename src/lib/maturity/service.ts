import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { computeCompanyScorecard, overallFrom } from "./compute";
import {
  DISCIPLINE_KEYS,
  type DisciplineKey,
} from "./disciplines";
import type {
  CompanyScorecard,
  DisciplineScore,
  ScorecardSnapshotRow,
} from "./types";

// Page-side reader. Combines the always-fresh live computation with
// the historical snapshots stored by the weekly cron so the /scorecard
// page can render the current score AND the trend line in one call.
//
// Live scoring is a handful of small reads — cheap enough to run on
// every page load. If that ever becomes a bottleneck we can memoize
// via a "current" cache row, but v1 keeps it live so "meeting cadence
// dropped off yesterday" shows up today, not next Sunday.

const TRAJECTORY_WINDOW_DAYS = 90;

export async function loadCompanyScorecard(
  companyId: string
): Promise<CompanyScorecard> {
  // Compute live via the server client — reads only, RLS is scoped
  // to the caller's tenant which is the same tenant we're loading.
  const supabase = await createSupabaseServerClient();
  const scorecard = await computeCompanyScorecard(companyId, supabase);

  // Historical snapshots for the trend chart. Limit to last 26 weeks
  // — enough to see a two-quarter arc without shipping a novel of
  // data down to the client.
  const sinceIso = new Date(Date.now() - 26 * 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const { data: snapshotRows } = await supabase
    .from("company_discipline_snapshots")
    .select("*")
    .eq("company_id", companyId)
    .gte("snapshot_date", sinceIso)
    .order("snapshot_date", { ascending: true });

  const snapshots = (snapshotRows ?? []) as ScorecardSnapshotRow[];

  // Bucket snapshots by discipline for the per-discipline trend
  // sparkline in the UI.
  const timeseries: Record<
    DisciplineKey,
    Array<{ date: string; score: number | null }>
  > = {
    foundation: [],
    chart: [],
    planning: [],
    execution: [],
    measures: [],
    meetings: [],
  };
  for (const s of snapshots) {
    const bucket = timeseries[s.discipline];
    if (bucket) bucket.push({ date: s.snapshot_date, score: s.score });
  }

  // Overall-per-date timeseries. Group snapshots by date, feed each
  // date's rows through overallFrom to keep the weighting rule
  // consistent between the live number and the historical line.
  const byDate = new Map<string, ScorecardSnapshotRow[]>();
  for (const s of snapshots) {
    const arr = byDate.get(s.snapshot_date) ?? [];
    arr.push(s);
    byDate.set(s.snapshot_date, arr);
  }
  const overallTimeseries = Array.from(byDate.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, rows]) => {
      const scores: DisciplineScore[] = rows.map((r) => ({
        key: r.discipline,
        score: r.score,
        breakdown: r.breakdown_json,
      }));
      const { score } = overallFrom(scores);
      return { date, score };
    });

  return {
    companyId,
    computedAt: scorecard.computedAt,
    overall: scorecard.overall,
    disciplines: scorecard.disciplines,
    timeseries,
    overallTimeseries,
  };
}

// Trajectory arrow helper. Compares the CURRENT live score for a
// discipline to the score recorded on the oldest snapshot within
// TRAJECTORY_WINDOW_DAYS. Returns null when there's no prior snapshot
// to compare against (fresh company).
export function trajectoryFor(
  discipline: DisciplineKey,
  scorecard: CompanyScorecard
): { delta: number; priorDate: string } | null {
  const current = scorecard.disciplines.find((d) => d.key === discipline);
  if (!current || current.score === null) return null;

  const cutoff = new Date(
    Date.now() - TRAJECTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000
  )
    .toISOString()
    .slice(0, 10);
  const history = scorecard.timeseries[discipline];
  // First snapshot whose date is >= the trajectory cutoff. Because
  // the series is sorted ascending, that's the oldest usable anchor.
  const anchor = history.find(
    (row) => row.date >= cutoff && row.score !== null
  );
  if (!anchor || anchor.score === null) return null;

  return {
    delta: Math.round((current.score - anchor.score) * 10) / 10,
    priorDate: anchor.date,
  };
}

// Overall trajectory: same idea, against overallTimeseries.
export function overallTrajectory(
  scorecard: CompanyScorecard
): { delta: number; priorDate: string } | null {
  if (scorecard.overall.score === null) return null;
  const cutoff = new Date(
    Date.now() - TRAJECTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000
  )
    .toISOString()
    .slice(0, 10);
  const anchor = scorecard.overallTimeseries.find(
    (row) => row.date >= cutoff && row.score !== null
  );
  if (!anchor || anchor.score === null) return null;
  return {
    delta: Math.round((scorecard.overall.score - anchor.score) * 10) / 10,
    priorDate: anchor.date,
  };
}

// Re-export DISCIPLINE_KEYS so callers importing from the service
// don't have to reach into the config module directly.
export { DISCIPLINE_KEYS };
