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
      .gte("week_ending", cutoffIso),
    admin
      .from("commitments")
      .select("due_date")
      .eq("company_id", companyId)
      .eq("status", "open"),
  ]);

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
