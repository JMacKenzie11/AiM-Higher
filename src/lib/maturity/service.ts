import "server-only";
import { cache } from "react";
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
//
// Wrapped in React `cache()` so that within a single request, multiple
// callers asking for the same company scorecard share one fetch. On
// /hq the attention module and the rollups module both need it per
// company; without this wrapper each company's scorecard would be
// computed twice per page load.

const TRAJECTORY_WINDOW_DAYS = 90;

// Live scores only — no snapshot history, no timeseries bucketing.
//
// This is what Guide HQ actually needs: both consumers there read
// `overall.score` and nothing else. Going through loadCompanyScorecard
// made every company on a guide's caseload also fetch 26 weeks of
// every discipline's snapshots and bucket them into eight arrays, to
// then use one number.
//
// Cached for the same reason loadCompanyScorecard is: the attention
// pass and the rollup pass both walk the caseload, and without this
// they would each compute every company's scorecard from scratch.
export const loadCompanyScorecardScores = cache(
  async function loadCompanyScorecardScores(companyId: string) {
    const supabase = await createSupabaseServerClient();
    return computeCompanyScorecard(companyId, supabase);
  }
);

// The most recent snapshot per company, for a whole caseload, in ONE
// query. Guide HQ's attention pass compares each company's live score
// against its last snapshot; it used to get that by loading the full
// scorecard per company. Same weighting rule as everywhere else
// (overallFrom) so the comparison stays apples-to-apples.
//
// Returns an empty map entry for a company with no snapshots yet — a
// new tenant the weekly cron hasn't reached. Callers treat a missing
// entry as "no prior to compare against", which is what they already
// did when overallTimeseries was empty.
export async function loadLatestOverallSnapshots(
  companyIds: readonly string[]
): Promise<Map<string, { date: string; score: number | null }>> {
  const result = new Map<string, { date: string; score: number | null }>();
  if (companyIds.length === 0) return result;

  const supabase = await createSupabaseServerClient();
  // 26 weeks matches loadCompanyScorecard's window. We only need the
  // newest date per company, but the rows are small and one bounded
  // query beats N unbounded ones.
  const sinceIso = new Date(Date.now() - 26 * 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const { data } = await supabase
    .from("company_discipline_snapshots")
    .select("*")
    .in("company_id", companyIds)
    .gte("snapshot_date", sinceIso)
    .order("snapshot_date", { ascending: true });

  const rows = (data ?? []) as ScorecardSnapshotRow[];

  // company -> date -> rows, then take the last date per company.
  const byCompany = new Map<string, Map<string, ScorecardSnapshotRow[]>>();
  for (const row of rows) {
    const dates = byCompany.get(row.company_id) ?? new Map();
    const forDate = dates.get(row.snapshot_date) ?? [];
    forDate.push(row);
    dates.set(row.snapshot_date, forDate);
    byCompany.set(row.company_id, dates);
  }

  for (const [companyId, dates] of byCompany) {
    const latestDate = Array.from(dates.keys()).sort().pop();
    if (!latestDate) continue;
    const scores: DisciplineScore[] = (dates.get(latestDate) ?? []).map(
      (r) => ({
        key: r.discipline,
        score: r.score,
        breakdown: r.breakdown_json,
      })
    );
    const { score } = overallFrom(scores);
    result.set(companyId, { date: latestDate, score });
  }

  return result;
}

export const loadCompanyScorecard = cache(async function loadCompanyScorecard(
  companyId: string
): Promise<CompanyScorecard> {
  // Compute live via the server client — reads only, RLS is scoped
  // to the caller's tenant which is the same tenant we're loading.
  const supabase = await createSupabaseServerClient();
  // Shares the cache with Guide HQ so a request that hits both pays
  // for the live computation once.
  const scorecard = await loadCompanyScorecardScores(companyId);

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
    solution_seeking: [],
    positive_framing: [],
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
});

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
