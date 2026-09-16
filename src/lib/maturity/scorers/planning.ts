import type { SupabaseClient } from "@supabase/supabase-js";
import { clampScore, type DisciplineScore } from "../types";

// Planning score = the plan is populated AND it's actually being
// closed on time.
//
//   - Cascade populated: 2 pts baseline. Missing pieces knock this
//     down to zero; a healthy cascade earns the floor but doesn't
//     drive the score on its own.
//
//     "Populated" is FOCUS AREAS + PRIORITIES, and goals are not
//     required. Until migration 0209 this demanded all three, which
//     was fine while every priority had to hang off a goal. It is
//     wrong now: a company whose focus area lives for one quarter
//     hangs its priorities straight off the focus area and holds no
//     goals at all — and that shape scored ZERO here, closure
//     halves included, because they sit behind this gate. A company
//     doing exactly what the product tells it to do was being told
//     its planning discipline did not exist.
//   - Goal closure — of goals whose target_date has passed,
//     what fraction are `complete`? Up to 4 pts. When no goals have
//     hit their date yet, we award full credit because there's
//     nothing to close (fresh plan shouldn't drag the score).
//   - Priority closure — same idea against priority.due_date. Up to
//     4 pts. Same "nothing due yet" fallback.
//
// We don't have a completed_at column on goals or priorities, so the
// signal is really "past-due AND still not complete" — which is a
// reasonable proxy for "we're behind." When completed_at ships, we
// can tighten this to "closed by the target date" instead of "closed
// at all."

const CASCADE_POINTS = 2;
const GOAL_POINTS = 4;
const PRIORITY_POINTS = 4;

export async function scorePlanning(
  admin: SupabaseClient,
  companyId: string
): Promise<DisciplineScore> {
  const { data: openQuarter } = await admin
    .from("quarters")
    .select("id")
    .eq("company_id", companyId)
    .eq("status", "open")
    .maybeSingle<{ id: string }>();

  if (!openQuarter) {
    return {
      key: "planning",
      score: 0,
      breakdown: {
        openQuarter: false,
        sfas: 0,
        goals: 0,
        priorities: 0,
        goalsPastDue: 0,
        goalsClosed: 0,
        goalClosureRate: 0,
        prioritiesPastDue: 0,
        prioritiesClosed: 0,
        priorityClosureRate: 0,
      },
    };
  }

  const todayIso = new Date().toISOString().slice(0, 10);

  const [sfaRes, goalRes, priorityRes] = await Promise.all([
    admin
      .from("strategic_focus_areas")
      .select("id")
      .eq("company_id", companyId)
      .eq("archived", false),
    admin
      .from("annual_goals")
      .select("id, target_date, status")
      .eq("company_id", companyId)
      .eq("archived", false),
    admin
      .from("priorities")
      .select("id, due_date, status")
      .eq("company_id", companyId)
      .eq("archived", false)
      .eq("quarter_id", openQuarter.id),
  ]);

  const sfas = (sfaRes.data ?? []) as Array<{ id: string }>;
  const goals = (goalRes.data ?? []) as Array<{
    id: string;
    target_date: string | null;
    status: string;
  }>;
  const priorities = (priorityRes.data ?? []) as Array<{
    id: string;
    due_date: string | null;
    status: string;
  }>;

  // Goals are optional, not missing. See the header.
  const cascadePopulated = sfas.length > 0 && priorities.length > 0;

  // Closure rate helper. Denominator = items whose due date has passed.
  // Nothing past due yet is "nothing to close" — full credit, since a
  // fresh plan shouldn't drag the score down for future work.
  // Empty item list is DIFFERENT — the caller (below) handles that by
  // gating on cascadePopulated before we ever get here, so an empty
  // plan can't sneak into full closure credit.
  function closure<T extends { status: string }>(
    items: T[],
    dateOf: (item: T) => string | null
  ): { pastDue: number; closed: number; rate: number } {
    const withPastDate = items.filter((i) => {
      const d = dateOf(i);
      return !!d && d <= todayIso;
    });
    if (withPastDate.length === 0) {
      return { pastDue: 0, closed: 0, rate: 1 };
    }
    const closed = withPastDate.filter((i) => i.status === "complete").length;
    return {
      pastDue: withPastDate.length,
      closed,
      rate: closed / withPastDate.length,
    };
  }

  // A company with no goals has nothing to close, which `closure`
  // already reads as full credit — the same answer it gives a fresh
  // plan whose targets are all in the future. That is the intended
  // reading now that goals are an optional level: score what the
  // company committed to, not what it declined to use.
  const goalClosure = closure(goals, (g) => g.target_date);
  const priorityClosure = closure(priorities, (p) => p.due_date);

  // No cascade in the open quarter ⇒ score is 0. The closure halves
  // are only meaningful once there's a plan to execute against — an
  // empty plan reading as 8/10 (because "nothing past due yet, full
  // credit") is the bug this branch prevents.
  const points = cascadePopulated
    ? CASCADE_POINTS +
      goalClosure.rate * GOAL_POINTS +
      priorityClosure.rate * PRIORITY_POINTS
    : 0;

  return {
    key: "planning",
    score: clampScore(points),
    breakdown: {
      openQuarter: true,
      cascadePopulated,
      sfas: sfas.length,
      goals: goals.length,
      priorities: priorities.length,
      goalsPastDue: goalClosure.pastDue,
      goalsClosed: goalClosure.closed,
      goalClosureRate: Math.round(goalClosure.rate * 100),
      prioritiesPastDue: priorityClosure.pastDue,
      prioritiesClosed: priorityClosure.closed,
      priorityClosureRate: Math.round(priorityClosure.rate * 100),
    },
  };
}
