import type { SupabaseClient } from "@supabase/supabase-js";
import { clampScore, type DisciplineScore } from "../types";

// Planning score = the cascade is populated in the open quarter.
//   - open quarter exists          → 1 pt (gate — if not, score = 0)
//   - ≥1 SFA                       → 2 pts
//   - ≥1 annual goal               → 2 pts
//   - ≥1 priority in open quarter  → 2 pts
//   - % of SFAs with ≥1 goal       → 1.5 pts (proportional)
//   - % of goals with ≥1 priority  → 1.5 pts (proportional)
// The two "coverage" ratios reward companies that don't leave orphan
// rows dangling in the cascade.

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
        goalCoverage: 0,
        priorityCoverage: 0,
      },
    };
  }

  const [sfaRes, goalRes, priorityRes] = await Promise.all([
    admin
      .from("strategic_focus_areas")
      .select("id")
      .eq("company_id", companyId)
      .eq("archived", false),
    admin
      .from("annual_goals")
      .select("id, sfa_id")
      .eq("company_id", companyId)
      .eq("archived", false),
    admin
      .from("priorities")
      .select("id, annual_goal_id")
      .eq("company_id", companyId)
      .eq("archived", false)
      .eq("quarter_id", openQuarter.id),
  ]);

  const sfas = (sfaRes.data ?? []) as Array<{ id: string }>;
  const goals = (goalRes.data ?? []) as Array<{
    id: string;
    sfa_id: string | null;
  }>;
  const priorities = (priorityRes.data ?? []) as Array<{
    id: string;
    annual_goal_id: string | null;
  }>;

  const sfasWithGoal = new Set(
    goals.map((g) => g.sfa_id).filter((id): id is string => !!id)
  );
  const goalsWithPriority = new Set(
    priorities.map((p) => p.annual_goal_id).filter((id): id is string => !!id)
  );

  const goalCoverage = sfas.length > 0 ? sfasWithGoal.size / sfas.length : 0;
  const priorityCoverage =
    goals.length > 0 ? goalsWithPriority.size / goals.length : 0;

  const points =
    1 + // openQuarter is true here
    (sfas.length > 0 ? 2 : 0) +
    (goals.length > 0 ? 2 : 0) +
    (priorities.length > 0 ? 2 : 0) +
    goalCoverage * 1.5 +
    priorityCoverage * 1.5;

  return {
    key: "planning",
    score: clampScore(points),
    breakdown: {
      openQuarter: true,
      sfas: sfas.length,
      goals: goals.length,
      priorities: priorities.length,
      goalCoverage: Math.round(goalCoverage * 100),
      priorityCoverage: Math.round(priorityCoverage * 100),
    },
  };
}
