import type { SupabaseClient } from "@supabase/supabase-js";
import { clampScore, type DisciplineScore } from "../types";

// Execution score = commitments landing on time, linked to
// priorities, without piling up overdue.
//
//   - Follow-through rate over rolling 30 days
//       (kept / (kept + missed))                         → 5 pts max
//   - % of currently-OPEN commitments linked to a priority
//     (vs floating operational work — some floaters are fine but a
//      high floater ratio means the plan cascade isn't driving work)
//                                                         → 2 pts max
//   - Aging opens: open commitments with due_date more than 14 days
//     past today. Each one costs 0.5 pts up to a 3 pt cap so a large
//     backlog can't drive the whole discipline to 0 by itself.
//                                                         → 3 pts max
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

  // Two window queries + one "current open" query. The follow-through
  // window uses week_ending as the anchor so completed_at nulls on
  // legacy rows still bucket correctly.
  const [resolvedRes, openRes] = await Promise.all([
    admin
      .from("commitments")
      .select("status")
      .eq("company_id", companyId)
      .in("status", ["kept", "missed"])
      .gte("week_ending", cutoffIso),
    admin
      .from("commitments")
      .select("priority_id, due_date")
      .eq("company_id", companyId)
      .eq("status", "open"),
  ]);

  const resolved = (resolvedRes.data ?? []) as Array<{ status: string }>;
  const open = (openRes.data ?? []) as Array<{
    priority_id: string | null;
    due_date: string | null;
  }>;

  const kept = resolved.filter((r) => r.status === "kept").length;
  const missed = resolved.filter((r) => r.status === "missed").length;
  const followThroughRate =
    kept + missed > 0 ? kept / (kept + missed) : 0;

  const openLinked = open.filter((o) => !!o.priority_id).length;
  const linkRate = open.length > 0 ? openLinked / open.length : 0;

  const agingCount = open.filter(
    (o) => !!o.due_date && o.due_date < agingCutoff
  ).length;

  const points =
    followThroughRate * 5 +
    linkRate * 2 +
    Math.max(0, 3 - agingCount * 0.5);

  return {
    key: "execution",
    score: clampScore(points),
    breakdown: {
      windowDays: 30,
      keptCount: kept,
      missedCount: missed,
      followThroughPct: Math.round(followThroughRate * 100),
      openCount: open.length,
      linkedPct: Math.round(linkRate * 100),
      agingCount,
      today: todayIso,
    },
  };
}
