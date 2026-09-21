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
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { bucketCascadeChildren } from "./cascade-shape";

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
  // Priorities hanging straight off the focus area, with no goal in
  // between (migration 0209). They are PEERS of `goals`, not a
  // lesser kind of child: `sfa_progress` averages both one-each, and
  // /plan renders them at the same indent.
  priorities: CascadePriority[];
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
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

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
          // Earliest due date first — priorities without a due date
          // sort last, then sort_order/created_at as tiebreakers.
          .order("due_date", { ascending: true, nullsFirst: false })
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
      owner: p.owner_id ? peopleById.get(p.owner_id) ?? null : null,
    };
  });

  // ---- Where each row renders ----
  // The rules live in cascade-shape.ts, pure and tested: peers under
  // a focus area, one parent each, and anything whose parent is off
  // screen falls to the standalone sections.
  const buckets = bucketCascadeChildren(sfas, goals, cascadePriorities);

  const cascadeGoals: CascadeGoal[] = goals.map((g) => ({
    ...g,
    percent: goalProgressById.get(g.id)?.percent ?? null,
    owner: g.owner_id ? peopleById.get(g.owner_id) ?? null : null,
    priorities: buckets.prioritiesByGoal.get(g.id) ?? [],
  }));
  // The buckets were built from the SAME `goals` array these came
  // from, so every id in them is present here.
  const goalById = indexBy(cascadeGoals, (g) => g.id);
  const enriched = (rows: typeof goals) =>
    rows.flatMap((g) => {
      const found = goalById.get(g.id);
      return found ? [found] : [];
    });

  const cascadeSfas: CascadeSfa[] = sfas.map((s) => ({
    ...s,
    percent: sfaProgressById.get(s.id)?.percent ?? null,
    sponsor: s.sponsor_id ? peopleById.get(s.sponsor_id) ?? null : null,
    goals: enriched(buckets.goalsBySfa.get(s.id) ?? []),
    priorities: buckets.prioritiesBySfa.get(s.id) ?? [],
  }));

  const orphanGoals = enriched(buckets.orphanGoals);
  const orphanPriorities = buckets.orphanPriorities;

  return {
    sfas: cascadeSfas,
    orphanGoals,
    orphanPriorities,
  };
}

// Detail-page loaders. Each throws (via null return) so callers can
// notFound() cleanly.

export async function getSfaDetail(sfaId: string) {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: sfa } = await supabase
    .from("strategic_focus_areas")
    .select("*")
    .eq("id", sfaId)
    .maybeSingle<StrategicFocusArea>();
  if (!sfa) return null;

  const [
    { data: goals },
    { data: priorities },
    { data: progress },
    { data: people },
    { data: quarters },
  ] = await Promise.all([
    supabase
      .from("annual_goals")
      .select("*")
      .eq("sfa_id", sfa.id)
      .eq("archived", false)
      .order("sort_order"),
    // Priorities hanging straight off this focus area. NOT filtered
    // by quarter: the cascade on /plan shows one quarter at a time,
    // but this page is the focus area's own record and hiding last
    // quarter's work behind a filter that isn't on screen would read
    // as data loss.
    supabase
      .from("priorities")
      .select("*")
      .eq("sfa_id", sfa.id)
      .eq("archived", false)
      .order("due_date", { ascending: true, nullsFirst: false })
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
    supabase
      .from("quarters")
      .select("id, label, status")
      .eq("company_id", sfa.company_id)
      .eq("status", "open")
      .maybeSingle<{ id: string; label: string; status: string }>(),
  ]);

  return {
    sfa,
    goals: (goals ?? []) as AnnualGoal[],
    priorities: (priorities ?? []) as Priority[],
    percent: progress?.percent ?? null,
    people: (people ?? []) as Pick<Profile, "id" | "full_name">[],
    openQuarter: quarters ?? null,
  };
}

export async function getGoalDetail(goalId: string) {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("sort_order"),
    goal.sfa_id
      ? supabase
          .from("strategic_focus_areas")
          .select("id, title")
          .eq("id", goal.sfa_id)
          // Archived resolves to null here too. Same rule, one level
          // up: the cascade already shows this goal under Standalone
          // Goals, so the goal's own page must not link to a focus
          // area the plan has stopped showing.
          .eq("archived", false)
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
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
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
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: priority } = await supabase
    .from("priorities")
    .select("*")
    .eq("id", priorityId)
    .maybeSingle<Priority>();
  if (!priority) return null;

  const [
    { data: goal },
    { data: sfa },
    { data: quarter },
    { data: progress },
    { data: people },
    { data: goalOptions },
    { data: sfaOptions },
    { data: quarters },
  ] = await Promise.all([
    // ARCHIVED PARENTS RESOLVE TO NULL, which is what puts this page
    // in step with the cascade.
    //
    // `bucketCascadeChildren` already treats a priority whose parent
    // is archived as standalone — "nowhere to put it", not "no parent
    // column set" — and /plan renders it in Standalone Quarterly
    // Priorities with a Link to picker reading "Not linked (yet)".
    //
    // This query did not filter, so the detail page for that same
    // priority offered "← Back to goal" and "Goal: <title>", both
    // pointing at a goal the plan no longer shows. Following either
    // one landed on an archived goal's page with nothing saying it
    // was archived. Two surfaces disagreeing about whether a row has
    // a parent, and the one with the link was the wrong one.
    //
    // Null here makes the page fall through to its existing
    // no-parent state: "Back to plan", and "Not linked to a goal or
    // focus area". The column is untouched, so un-archiving the goal
    // restores the link on both surfaces at once.
    priority.annual_goal_id
      ? supabase
          .from("annual_goals")
          .select("id, title, sfa_id")
          .eq("id", priority.annual_goal_id)
          .eq("archived", false)
          .maybeSingle<Pick<AnnualGoal, "id" | "title" | "sfa_id">>()
      : Promise.resolve({ data: null }),
    // The other parent a priority can have. Exactly one of these two
    // is ever non-null; the page reads whichever it gets.
    priority.sfa_id
      ? supabase
          .from("strategic_focus_areas")
          .select("id, title")
          .eq("id", priority.sfa_id)
          .eq("archived", false)
          .maybeSingle<Pick<StrategicFocusArea, "id" | "title">>()
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
      .from("strategic_focus_areas")
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
    sfa,
    quarter,
    progress: progress ?? null,
    people: (people ?? []) as Pick<Profile, "id" | "full_name">[],
    goalOptions: (goalOptions ?? []) as Pick<AnnualGoal, "id" | "title">[],
    sfaOptions: (sfaOptions ?? []) as Pick<
      StrategicFocusArea,
      "id" | "title"
    >[],
    quarters: (quarters ?? []) as Array<{
      id: string;
      label: string;
      status: string;
    }>,
  };
}
