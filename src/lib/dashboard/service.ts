import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentQuarter } from "@/lib/quarters/service";
import { addDays, thisFriday, todayInTimezone } from "@/lib/dates";
import { bucketKeepRates } from "@/lib/utils";
import { computeFollowThrough } from "@/lib/commitments/follow-through";
import type {
  Company,
  Commitment,
  Priority,
  Profile,
  Quarter,
  SfaProgressRow,
  StrategicFocusArea,
} from "@/lib/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Data shape rendered on /dashboard (Section 8.2).

export type DashboardSfa = StrategicFocusArea & {
  percent: number | null;
  sponsor: Pick<Profile, "id" | "full_name"> | null;
};

export type WeeklyKeepRatePoint = {
  weekEnding: string;
  keepRate: number | null; // 0-100 or null when no resolved rows
  isCurrentWeek: boolean;
};

export type DashboardPerson = {
  id: string;
  full_name: string;
  position: string | null;
  // Direct manager per profiles.reports_to. Surfaces so the caller
  // can render the Coach affordance for a row where the viewer is
  // the row subject's manager (in addition to admins).
  reports_to: string | null;
  openCount: number;
  // Split out kept-on-time from kept-late so the dashboard can show
  // the two signals distinctly — Follow-Through is on-time-only, but
  // "did the work eventually" still deserves visibility.
  keptOnTimeCount: number;
  keptLateCount: number;
  missedCount: number;
  keepRate: number | null;
};

export type DashboardData = {
  company: Pick<Company, "id" | "name" | "timezone">;
  openQuarter: Quarter | null;
  headline: {
    executionPercent: number | null;
    keepRatePercent: number | null;
    onTrack: { good: number; total: number };
    thisWeekOpen: number;
    // Clarity score for the open quarter: share of commitments (any
    // status) that pass all three clarity criteria. Null when there
    // aren't enough scored commitments in the quarter yet to make a
    // meaningful number.
    clarityPercent: number | null;
    clarityAssessedCount: number;
    clarityTotalCount: number;
  };
  sfas: DashboardSfa[];
  orphanGoalCount: number;
  keepRateTrend: WeeklyKeepRatePoint[]; // last 12 weeks, oldest → newest
  people: DashboardPerson[];
  // Five most-recent commitments closed on time this quarter. Positive
  // signal that matches the AiMS philosophy — celebrate what's working
  // where the whole company can see it. Admin-only surface on the
  // dashboard; the caller decides whether to render.
  recentSuccesses: RecentSuccess[];
};

export type RecentSuccess = {
  id: string;
  description: string;
  completedAt: string | null;
  weekEnding: string;
  ownerName: string;
  ownerId: string | null;
  priorityTitle: string | null;
};

export async function getDashboardData(
  companyId: string
): Promise<DashboardData | null> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  // ---- Wave 1: everything that needs only companyId ----------
  // These six have no dependency on each other. Previously they ran
  // in a straight line along with everything below, so a page load
  // paid 13 sequential round trips where the real dependency graph
  // is only two levels deep. Ordering is preserved in the
  // destructure, not in time.
  const [
    { data: company },
    openQuarter,
    { data: sfaRows },
    { data: orphanGoalRows },
    { data: people },
    { data: openRows },
  ] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, timezone")
      .eq("id", companyId)
      .maybeSingle<Pick<Company, "id" | "name" | "timezone">>(),
    getCurrentQuarter(companyId),
    supabase
      .from("strategic_focus_areas")
      .select("*")
      .eq("company_id", companyId)
      .eq("archived", false)
      .order("sort_order")
      .order("created_at"),
    // Orphan goals count for the muted footnote row.
    supabase
      .from("annual_goals")
      .select("id")
      .eq("company_id", companyId)
      .is("sfa_id", null)
      .eq("archived", false),
    // People — per-owner counts in the OPEN QUARTER (Section 8.2).
    // Pending users included so they surface on the dashboard as soon
    // as they're added, even before they accept the invite.
    supabase
      .from("profiles")
      .select("id, full_name, position, reports_to")
      .eq("company_id", companyId)
      .neq("status", "inactive")
      .order("full_name"),
    supabase
      .from("commitments")
      .select("owner_id")
      .eq("company_id", companyId)
      .eq("status", "open"),
  ]);

  // Bail before wave 2 rather than inside it — a missing company row
  // means there is nothing to render and no point spending the
  // second batch of queries.
  if (!company) return null;

  const sfas = (sfaRows ?? []) as StrategicFocusArea[];
  const orphanGoalCount = orphanGoalRows?.length ?? 0;
  const roster = (people ?? []) as Pick<
    Profile,
    "id" | "full_name" | "position" | "reports_to"
  >[];

  // ---- Wave 2: everything that needed one thing from wave 1 ----
  // Sponsors and progress need the focus areas; priorities and
  // quarter commitments need the open quarter; this-week and the
  // trend need the company's timezone; recent successes needs the
  // quarter. None of them need each other.
  const sponsorIds = Array.from(
    new Set(sfas.map((s) => s.sponsor_id).filter((x): x is string => Boolean(x)))
  );
  const tz = company.timezone ?? "America/Anchorage";
  const thisFri = thisFriday(tz);
  const trendWeeks: string[] = [];
  for (let i = 11; i >= 0; i -= 1) {
    trendWeeks.push(addDays(thisFri, -7 * i));
  }
  const oldestWeek = trendWeeks[0];

  const [
    { data: sponsorRows },
    { data: sfaProgress },
    { data: priorityStatusRows },
    { data: quarterCommitmentRows },
    { data: thisWeekRows },
    { data: trendRows },
    recentSuccesses,
  ] = await Promise.all([
    sponsorIds.length
      ? supabase.from("profiles").select("id, full_name").in("id", sponsorIds)
      : Promise.resolve({ data: [] }),
    sfas.length
      ? supabase
          .from("sfa_progress")
          .select("sfa_id, percent")
          .in(
            "sfa_id",
            sfas.map((s) => s.id)
          )
      : Promise.resolve({ data: [] }),
    // On Track — priority-level status counts for the open quarter.
    openQuarter
      ? supabase
          .from("priorities")
          .select("id, status, archived")
          .eq("company_id", companyId)
          .eq("quarter_id", openQuarter.id)
          .eq("archived", false)
      : Promise.resolve({ data: [] }),
    // Commitments in the open quarter — derived from week_ending
    // falling inside the quarter window, so operational (unlinked)
    // commitments count toward keep-rate identically to strategic
    // ones. The two clarity booleans ride along so the headline can
    // report share-with-both-met without a second scan.
    openQuarter
      ? supabase
          .from("commitments")
          .select(
            "status, owner_id, due_date, clarity_timeline, clarity_success"
          )
          .eq("company_id", companyId)
          .gte("week_ending", openQuarter.start_date)
          .lte("week_ending", openQuarter.end_date)
          // Deleted and parked rows never counted toward
          // follow-through anywhere else; they were counting here.
          .is("deleted_at", null)
          .is("parked_at", null)
      : Promise.resolve({ data: [] }),
    // This Week — count of open commitments due this Friday.
    supabase
      .from("commitments")
      .select("id")
      .eq("company_id", companyId)
      .eq("status", "open")
      .eq("week_ending", thisFri),
    // Keep-rate trend: last 12 weeks ending this Friday.
    supabase
      .from("commitments")
      .select("week_ending, status")
      .eq("company_id", companyId)
      .gte("week_ending", oldestWeek)
      .lte("week_ending", thisFri),
    loadRecentSuccesses(supabase, companyId, openQuarter),
  ]);

  const sponsorById = new Map(
    (sponsorRows ?? []).map((p) => [p.id, p as Pick<Profile, "id" | "full_name">])
  );

  const percentBySfaId = new Map(
    ((sfaProgress ?? []) as SfaProgressRow[]).map((row) => [
      row.sfa_id,
      row.percent,
    ])
  );

  const enrichedSfas: DashboardSfa[] = sfas.map((sfa) => ({
    ...sfa,
    percent: percentBySfaId.get(sfa.id) ?? null,
    sponsor: sfa.sponsor_id ? sponsorById.get(sfa.sponsor_id) ?? null : null,
  }));

  // Execution % = mean of SFA percents (excluding null).
  const executionValues = enrichedSfas
    .map((sfa) => sfa.percent)
    .filter((value): value is number => value !== null);
  const executionPercent =
    executionValues.length === 0
      ? null
      : Math.round(
          executionValues.reduce((sum, value) => sum + value, 0) /
            executionValues.length
        );

  // Derivations from wave 2. Identical arithmetic to before; only
  // the fetching moved.
  const priorities = (priorityStatusRows ?? []) as Pick<
    Priority,
    "id" | "status" | "archived"
  >[];
  const onTrackTotal = priorities.length;
  const onTrackGood = priorities.filter(
    (p) => p.status === "on_track" || p.status === "complete"
  ).length;

  const quarterCommitments = (quarterCommitmentRows ?? []) as Array<
    Pick<
      Commitment,
      | "status"
      | "owner_id"
      | "due_date"
      | "clarity_timeline"
      | "clarity_success"
    >
  >;

  // One shared rule, so this number matches the companies list and
  // the generated brief. Includes overdue-open commitments, which
  // previously were invisible to the rate.
  const keepRatePercent = computeFollowThrough(
    quarterCommitments.map((c) => ({
      status: c.status,
      due_date: c.due_date,
    })),
    todayInTimezone(company.timezone ?? "America/Anchorage").iso
  );

  // Clarity: percentage of assessed commitments where both
  // criteria pass. Un-assessed rows (either still null) are
  // excluded from both the numerator and the denominator so a
  // company that hasn't started assessing doesn't look like it's
  // failing.
  let clarityAssessed = 0;
  let clarityAllClear = 0;
  for (const c of quarterCommitments) {
    if (c.clarity_timeline === null || c.clarity_success === null) continue;
    clarityAssessed += 1;
    if (c.clarity_timeline === true && c.clarity_success === true) {
      clarityAllClear += 1;
    }
  }
  const clarityPercent =
    clarityAssessed === 0
      ? null
      : Math.round((clarityAllClear / clarityAssessed) * 100);

  const thisWeekOpen = thisWeekRows?.length ?? 0;

  const trendByWeek = bucketKeepRates(
    (trendRows ?? []) as Pick<Commitment, "week_ending" | "status">[],
    (row) => row.week_ending
  );
  const keepRateTrend: WeeklyKeepRatePoint[] = trendWeeks.map((week) => ({
    weekEnding: week,
    keepRate: trendByWeek.get(week)?.keepRate ?? null,
    isCurrentWeek: week === thisFri,
  }));

  // Group commitments by owner for the quarter's kept/missed counts
  // and the overall open count (open uses today's snapshot).
  const openByOwner = new Map<string, number>();
  for (const row of (openRows ?? []) as Pick<Commitment, "owner_id">[]) {
    // Person keep-rate ignores unassigned commitments (they show up
    // in the company-wide roll-up but not on any individual's row).
    if (!row.owner_id) continue;
    openByOwner.set(row.owner_id, (openByOwner.get(row.owner_id) ?? 0) + 1);
  }

  const perOwner = bucketKeepRates(
    quarterCommitments.filter((c) => c.owner_id !== null),
    (c) => c.owner_id as string
  );

  const dashboardPeople: DashboardPerson[] = roster.map((person) => {
    const bucket = perOwner.get(person.id);
    return {
      id: person.id,
      full_name: person.full_name,
      position: person.position ?? null,
      reports_to: person.reports_to ?? null,
      openCount: openByOwner.get(person.id) ?? 0,
      keptOnTimeCount: bucket?.keptOnTime ?? 0,
      keptLateCount: bucket?.keptLate ?? 0,
      missedCount: bucket?.missed ?? 0,
      keepRate: bucket?.keepRate ?? null,
    };
  });

  // Sort by keep rate ascending (nulls last so people with no data
  // don't crowd the "needs support" top of the list).
  dashboardPeople.sort((a, b) => {
    if (a.keepRate === null && b.keepRate === null) {
      return a.full_name.localeCompare(b.full_name);
    }
    if (a.keepRate === null) return 1;
    if (b.keepRate === null) return -1;
    return a.keepRate - b.keepRate;
  });

  return {
    company,
    openQuarter,
    headline: {
      executionPercent,
      keepRatePercent,
      onTrack: { good: onTrackGood, total: onTrackTotal },
      thisWeekOpen,
      clarityPercent,
      clarityAssessedCount: clarityAssessed,
      clarityTotalCount: quarterCommitments.length,
    },
    sfas: enrichedSfas,
    orphanGoalCount,
    keepRateTrend,
    people: dashboardPeople,
    recentSuccesses,
  };
}

// Five most recent commitments closed ON TIME this quarter. Positive
// signal that matches the AiMS philosophy: recognize the follow-through
// in public. Ordered by completed_at desc (falls back to week_ending
// desc when completed_at is null on old rows).
async function loadRecentSuccesses(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  companyId: string,
  openQuarter: Quarter | null
): Promise<RecentSuccess[]> {
  if (!openQuarter) return [];

  // Status values in the current schema are kept_on_time and
  // kept_late (migration 0139) — the old "kept" bucket doesn't
  // exist any more, so filtering .eq("status","kept") silently
  // returned zero rows for every company.
  const { data: rows } = await supabase
    .from("commitments")
    .select(
      "id, description, week_ending, owner_id, priority_id, completed_at"
    )
    .eq("company_id", companyId)
    .in("status", ["kept_on_time", "kept_late"])
    .gte("week_ending", openQuarter.start_date)
    .lte("week_ending", openQuarter.end_date)
    .order("completed_at", { ascending: false, nullsFirst: false })
    .order("week_ending", { ascending: false })
    .limit(5);

  const commitments = (rows ?? []) as Array<
    Pick<
      Commitment,
      | "id"
      | "description"
      | "week_ending"
      | "owner_id"
      | "priority_id"
      | "completed_at"
    >
  >;
  if (commitments.length === 0) return [];

  // Unassigned commitments have owner_id = null; strip them before
  // building the .in() so PostgREST doesn't get "id IN (NULL)" in
  // the query (which returns zero rows and would drop everyone
  // else's names from the lookup).
  const ownerIds = Array.from(
    new Set(
      commitments
        .map((c) => c.owner_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const priorityIds = Array.from(
    new Set(
      commitments
        .map((c) => c.priority_id)
        .filter((id): id is string => Boolean(id))
    )
  );

  const [{ data: ownerRows }, { data: priorityRows }] = await Promise.all([
    ownerIds.length > 0
      ? supabase.from("profiles").select("id, full_name").in("id", ownerIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
    priorityIds.length > 0
      ? supabase.from("priorities").select("id, title").in("id", priorityIds)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string }> }),
  ]);
  const nameById = new Map(
    ((ownerRows ?? []) as Array<{ id: string; full_name: string }>).map((p) => [
      p.id,
      p.full_name,
    ])
  );
  const priorityTitleById = new Map(
    ((priorityRows ?? []) as Array<{ id: string; title: string }>).map((p) => [
      p.id,
      p.title,
    ])
  );

  return commitments.map((c) => ({
    id: c.id,
    description: c.description,
    completedAt: c.completed_at,
    weekEnding: c.week_ending,
    ownerId: c.owner_id,
    ownerName: c.owner_id ? nameById.get(c.owner_id) ?? "—" : "Unassigned",
    priorityTitle: c.priority_id ? priorityTitleById.get(c.priority_id) ?? null : null,
  }));
}
