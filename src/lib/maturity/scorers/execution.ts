import type { SupabaseClient } from "@supabase/supabase-js";
import { clampScore, type DisciplineScore } from "../types";

// Execution score = commitments landing on time, without piling up
// past due.
//
//   - Follow-through rate over rolling 30 days
//       (kept / (kept + missed))                         → 7 pts max
//   - Aging opens: open commitments with due_date more than 14 days
//     past today. Each one costs 0.5 pts up to a 3 pt cap so a large
//     backlog can't drive the whole discipline to 0 by itself.
//                                                         → 3 pts max
//
// Priority linkage used to be scored here (a "% of open commitments
// linked to a priority" bonus), but it's by design that some
// commitments are operational floaters — the ratio isn't a signal of
// discipline. Dropped, weight redistributed into follow-through.
//
// Rolling by construction — as the window slides, stale kept/missed
// rows fall out and the score reflects the recent past only.

export async function scoreExecution(
  admin: SupabaseClient,
  companyId: string
): Promise<DisciplineScore> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const todayIso = now.toISOString().slice(0, 10);
  const cutoffIso = thirtyDaysAgo.toISOString().slice(0, 10);
  const agingCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [resolvedRes, openRes] = await Promise.all([
    admin
      .from("commitments")
      .select("status")
      .eq("company_id", companyId)
      // Both kept statuses count as resolved work. "kept" alone has
      // matched nothing since migration 0139, which silently pinned
      // this company's follow-through rate to 0.
      .in("status", ["kept_on_time", "kept_late", "missed"])
      // Soft-deleted and parked rows do not count, here or anywhere.
      // See the note below the query pair.
      .is("deleted_at", null)
      .is("parked_at", null)
      .gte("week_ending", cutoffIso),
    admin
      .from("commitments")
      .select("due_date")
      .eq("company_id", companyId)
      .eq("status", "open")
      .is("deleted_at", null)
      .is("parked_at", null),
  ]);

  // DELETED AND PARKED ROWS ARE EXCLUDED, as of 2026-09-14.
  //
  // They were not, and this was the only follow-through path in the
  // product where that was true — `company_follow_through` (0174),
  // `computeQuarterKeepRate` and the dashboard's quarter query all
  // filter both. Deleting a commitment is supposed to remove it from
  // every list, count and metric; here it went on costing the company
  // 0.5 points a week forever, because the aging query below has no
  // window for a row to age out of.
  //
  // MEASURED BEFORE IT WAS FIXED, on production 2026-09-14: 31
  // soft-deleted commitments were being counted as aging across five
  // companies, and one deleted row sat in a follow-through numerator.
  // Four of eight companies were scoring BELOW what they had earned —
  // Benson Seafood 7.5 where it should be 10.0, Geo-Sci 7.0 where it
  // should be 10.0, Centre North 7.0 against 9.0, Howard Concrete 7.5
  // against 9.0. Parked rows contributed nothing in practice: only
  // two exist and neither was aging.
  //
  // FIXED FORWARD ONLY. The 34 stored execution snapshots, covering
  // ten weeks from 2026-08-15, are LEFT AS THEY ARE. Recomputing them
  // would rewrite numbers clients have already been shown; leaving
  // them means the trend line steps up once, on the date this
  // shipped, for a reason no client behaviour caused. That is a
  // product decision, made deliberately, and the step is written down
  // in docs/product-spec.md so nobody has to rediscover it.
  //
  // compareOverall restricts to disciplines both points scored, so
  // the step cannot present as a false DROP on Guide HQ.
  //
  // STILL OPEN, and deliberately not fixed here: the open-commitments
  // query has no date window at all, so a commitment from 2024 still
  // costs 0.5 points today. Every other commitment read in the
  // product is bounded. Narrowing it would move scores again and is
  // its own decision.
  const resolved = (resolvedRes.data ?? []) as Array<{ status: string }>;
  const open = (openRes.data ?? []) as Array<{ due_date: string | null }>;

  // Follow-through here is "did the work", on-time or late — the
  // on-time-only rate is a separate measure (computeFollowThroughRate).
  const kept = resolved.filter(
    (r) => r.status === "kept_on_time" || r.status === "kept_late"
  ).length;
  const missed = resolved.filter((r) => r.status === "missed").length;
  const followThroughRate =
    kept + missed > 0 ? kept / (kept + missed) : 0;

  const agingCount = open.filter(
    (o) => !!o.due_date && o.due_date < agingCutoff
  ).length;

  const points =
    followThroughRate * 7 + Math.max(0, 3 - agingCount * 0.5);

  return {
    key: "execution",
    score: clampScore(points),
    breakdown: {
      windowDays: 30,
      keptCount: kept,
      missedCount: missed,
      followThroughPct: Math.round(followThroughRate * 100),
      openCount: open.length,
      agingCount,
      today: todayIso,
    },
  };
}
