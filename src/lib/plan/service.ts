import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { indexBy } from "@/lib/utils";
import type {
  AnnualGoal,
  AnnualGoalProgressRow,
  Priority,
  PriorityProgressRow,
  Profile,
  SfaProgressRow,
  StrategicFocusArea,
} from "@/lib/types";

// Cascade read model for /plan and the plan detail pages.
// One query per level (server-side RLS scopes to the caller's company),
// then stitched in memory. Priorities are filtered by the selected
// quarter so unrelated quarters' priorities don't leak into the view.

export type CascadePriority = Priority & {
  percent: number | null;
  kept_count: number;
  open_count: number;
  missed_count: number;
  carried_count: number;
  commitment_count: number; // includes carried
  owner: Pick<Profile, "id" | "full_name"> | null;
};

export type CascadeGoal = AnnualGoal & {
  percent: number | null;
  priorities: CascadePriority[];
  owner: Pick<Profile, "id" | "full_name"> | null;
};

export type CascadeSfa = StrategicFocusArea & {
  percent: number | null;
  goals: CascadeGoal[];
  sponsor: Pick<Profile, "id" | "full_name"> | null;
};

export type Cascade = {
  sfas: CascadeSfa[];
  orphanGoals: CascadeGoal[];
  orphanPriorities: CascadePriority[];
};

export async function getCascade(
  companyId: string,
  quarterId: string | null
): Promise<Cascade> {
  const supabase = await createSupabaseServerClient();

  const [sfaRes, goalRes, priorityRes, profileRes] = await Promise.all([
    supabase
      .from("strategic_focus_areas")
      .select("*")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("sort_order")
      .order("created_at"),
    supabase
      .from("annual_goals")
      .select("*")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("sort_order")
      .order("created_at"),
    quarterId
      ? supabase
          .from("priorities")
          .select("*")
          .eq("company_id", companyId)
          .eq("archived", false)
          .eq("quarter_id", quarterId)
          .order("sort_order")
          .order("created_at")
      : Promise.resolve({ data: [] as Priority[], error: null }),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("company_id", companyId),
  ]);

  const sfas = (sfaRes.data ?? []) as StrategicFocusArea[];
  const goals = (goalRes.data ?? []) as AnnualGoal[];
  const priorities = (priorityRes.data ?? []) as Priority[];
  const people = (profileRes.data ?? []) as Pick<Profile, "id" | "full_name">[];
  const peopleById = indexBy(people, (p) => p.id);

  // Progress views cover the whole company; filter to what's on screen.
  const priorityIds = priorities.map((p) => p.id);
  const goalIds = goals.map((g) => g.id);
  const sfaIds = sfas.map((s) => s.id);

  const [priorityProgressRes, goalProgressRes, sfaProgressRes] =
    await Promise.all([
      priorityIds.length > 0
        ? supabase
            .from("priority_progress")
            .select("*")
            .in("priority_id", priorityIds)
        : Promise.resolve({ data: [] as PriorityProgressRow[], error: null }),
      goalIds.length > 0
        ? supabase
            .from("annual_goal_progress")
            .select("*")
            .in("annual_goal_id", goalIds)
        : Promise.resolve({ data: [] as AnnualGoalProgressRow[], error: null }),
      sfaIds.length > 0
        ? supabase.from("sfa_progress").select("*").in("sfa_id", sfaIds)
        : Promise.resolve({ data: [] as SfaProgressRow[], error: null }),
    ]);

  const priorityProgressById = indexBy(
    (priorityProgressRes.data ?? []) as PriorityProgressRow[],
    (row) => row.priority_id
  );
  const goalProgressById = indexBy(
    (goalProgressRes.data ?? []) as AnnualGoalProgressRow[],
    (row) => row.annual_goal_id
  );
  const sfaProgressById = indexBy(
    (sfaProgressRes.data ?? []) as SfaProgressRow[],
    (row) => row.sfa_id
  );

  // ---- Priorities enriched ----
  const cascadePriorities: CascadePriority[] = priorities.map((p) => {
    const pp = priorityProgressById.get(p.id);
    return {
      ...p,
      percent: pp?.percent ?? null,
      kept_count: pp?.kept_count ?? 0,
      open_count: pp?.open_count ?? 0,
      missed_count: pp?.missed_count ?? 0,
      carried_count: pp?.carried_count ?? 0,
      commitment_count:
        (pp?.kept_count ?? 0) +
        (pp?.open_count ?? 0) +
        (pp?.missed_count ?? 0) +
        (pp?.carried_count ?? 0),
      owner: p.owner_id ? peopleById.get(p.owner_id) ?? null : null,
    };
  });

  // ---- Goals enriched (children filtered to selected quarter) ----
  const prioritiesByGoal = new Map<string | null, CascadePriority[]>();
  for (const cp of cascadePriorities) {
    const key = cp.annual_goal_id;
    if (!prioritiesByGoal.has(key)) prioritiesByGoal.set(key, []);
    prioritiesByGoal.get(key)!.push(cp);
  }

  const cascadeGoals: CascadeGoal[] = goals.map((g) => ({
    ...g,
    percent: goalProgressById.get(g.id)?.percent ?? null,
    owner: g.owner_id ? peopleById.get(g.owner_id) ?? null : null,
    priorities: prioritiesByGoal.get(g.id) ?? [],
  }));

  // ---- SFAs enriched ----
  const goalsBySfa = new Map<string | null, CascadeGoal[]>();
  for (const g of cascadeGoals) {
    const key = g.sfa_id;
    if (!goalsBySfa.has(key)) goalsBySfa.set(key, []);
    goalsBySfa.get(key)!.push(g);
  }

  const cascadeSfas: CascadeSfa[] = sfas.map((s) => ({
    ...s,
    percent: sfaProgressById.get(s.id)?.percent ?? null,
    sponsor: s.sponsor_id ? peopleById.get(s.sponsor_id) ?? null : null,
    goals: goalsBySfa.get(s.id) ?? [],
  }));

  const orphanGoals = goalsBySfa.get(null) ?? [];
  const orphanPriorities = prioritiesByGoal.get(null) ?? [];

  return {
    sfas: cascadeSfas,
    orphanGoals,
    orphanPriorities,
  };
}

// Detail-page loaders. Each throws (via null return) so callers can
// notFound() cleanly.

export async function getSfaDetail(sfaId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: sfa } = await supabase
    .from("strategic_focus_areas")
    .select("*")
    .eq("id", sfaId)
    .maybeSingle<StrategicFocusArea>();
  if (!sfa) return null;

  const [{ data: goals }, { data: progress }, { data: people }] =
    await Promise.all([
      supabase
        .from("annual_goals")
        .select("*")
        .eq("sfa_id", sfa.id)
        .eq("archived", false)
        .order("sort_order"),
      supabase
        .from("sfa_progress")
        .select("*")
        .eq("sfa_id", sfa.id)
        .maybeSingle<SfaProgressRow>(),
      supabase
        .from("profiles")
        .select("id, full_name")
        .eq("company_id", sfa.company_id),
    ]);

  return {
    sfa,
    goals: (goals ?? []) as AnnualGoal[],
    percent: progress?.percent ?? null,
    people: (people ?? []) as Pick<Profile, "id" | "full_name">[],
  };
}

export async function getGoalDetail(goalId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: goal } = await supabase
    .from("annual_goals")
    .select("*")
    .eq("id", goalId)
    .maybeSingle<AnnualGoal>();
  if (!goal) return null;

  const [
    { data: priorities },
    { data: sfa },
    { data: progress },
    { data: people },
    { data: sfaOptions },
  ] = await Promise.all([
    supabase
      .from("priorities")
      .select("*")
      .eq("annual_goal_id", goal.id)
      .eq("archived", false)
      .order("sort_order"),
    goal.sfa_id
      ? supabase
          .from("strategic_focus_areas")
          .select("id, title")
          .eq("id", goal.sfa_id)
          .maybeSingle<Pick<StrategicFocusArea, "id" | "title">>()
      : Promise.resolve({ data: null }),
    supabase
      .from("annual_goal_progress")
      .select("*")
      .eq("annual_goal_id", goal.id)
      .maybeSingle<AnnualGoalProgressRow>(),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("company_id", goal.company_id),
    supabase
      .from("strategic_focus_areas")
      .select("id, title")
      .eq("company_id", goal.company_id)
      .eq("archived", false)
      .order("title"),
  ]);

  // Open-commitment count across all non-archived priorities under
  // this goal — used by the "Mark Complete" confirm modal to show
  // how many rows the cascade will close.
  const priorityIds = (priorities ?? []).map((p) => p.id);
  let openCommitmentsCount = 0;
  if (priorityIds.length > 0) {
    const { count } = await supabase
      .from("commitments")
      .select("id", { count: "exact", head: true })
      .in("priority_id", priorityIds)
      .eq("status", "open");
    openCommitmentsCount = count ?? 0;
  }

  return {
    goal,
    priorities: (priorities ?? []) as Priority[],
    sfa,
    percent: progress?.percent ?? null,
    people: (people ?? []) as Pick<Profile, "id" | "full_name">[],
    sfaOptions: (sfaOptions ?? []) as Pick<StrategicFocusArea, "id" | "title">[],
    openCommitmentsCount,
  };
}

export type BulkResetImpact = {
  sfaCount: number;
  goalCount: number;
  priorityCount: number;
};

export async function getBulkResetImpact(
  companyId: string
): Promise<BulkResetImpact> {
  const supabase = await createSupabaseServerClient();
  const [sfa, goal, priority] = await Promise.all([
    supabase
      .from("strategic_focus_areas")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("archived", false),
    supabase
      .from("annual_goals")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("archived", false),
    supabase
      .from("priorities")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("archived", false),
  ]);
  return {
    sfaCount: sfa.count ?? 0,
    goalCount: goal.count ?? 0,
    priorityCount: priority.count ?? 0,
  };
}

export async function getPriorityDetail(priorityId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: priority } = await supabase
    .from("priorities")
    .select("*")
    .eq("id", priorityId)
    .maybeSingle<Priority>();
  if (!priority) return null;

  const [
    { data: goal },
    { data: quarter },
    { data: progress },
    { data: people },
    { data: goalOptions },
    { data: quarters },
  ] = await Promise.all([
    priority.annual_goal_id
      ? supabase
          .from("annual_goals")
          .select("id, title, sfa_id")
          .eq("id", priority.annual_goal_id)
          .maybeSingle<Pick<AnnualGoal, "id" | "title" | "sfa_id">>()
      : Promise.resolve({ data: null }),
    supabase
      .from("quarters")
      .select("id, label, status")
      .eq("id", priority.quarter_id)
      .maybeSingle(),
    supabase
      .from("priority_progress")
      .select("*")
      .eq("priority_id", priority.id)
      .maybeSingle<PriorityProgressRow>(),
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("company_id", priority.company_id),
    supabase
      .from("annual_goals")
      .select("id, title")
      .eq("company_id", priority.company_id)
      .eq("archived", false)
      .order("title"),
    supabase
      .from("quarters")
      .select("id, label, status")
      .eq("company_id", priority.company_id)
      .order("start_date", { ascending: false }),
  ]);

  return {
    priority,
    goal,
    quarter,
    progress: progress ?? null,
    people: (people ?? []) as Pick<Profile, "id" | "full_name">[],
    goalOptions: (goalOptions ?? []) as Pick<AnnualGoal, "id" | "title">[],
    quarters: (quarters ?? []) as Array<{
      id: string;
      label: string;
      status: string;
    }>,
  };
}
