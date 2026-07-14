import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentQuarter } from "@/lib/quarters/service";
import { addDays, thisFriday } from "@/lib/dates";
import {
  computeFollowThroughRate,
  computeRateFromCounts,
} from "@/lib/utils";
import type {
  Company,
  Commitment,
  Priority,
  Profile,
  Quarter,
  SfaProgressRow,
  StrategicFocusArea,
} from "@/lib/types";

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
  openCount: number;
  keptCount: number;
  missedCount: number;
  carriedCount: number;
  keepRate: number | null;
};

export type DashboardData = {
  company: Company;
  openQuarter: Quarter | null;
  headline: {
    executionPercent: number | null;
    keepRatePercent: number | null;
    onTrack: { good: number; total: number };
    thisWeekOpen: number;
  };
  sfas: DashboardSfa[];
  orphanGoalCount: number;
  keepRateTrend: WeeklyKeepRatePoint[]; // last 12 weeks, oldest → newest
  people: DashboardPerson[];
};

export async function getDashboardData(
  companyId: string
): Promise<DashboardData | null> {
  const supabase = await createSupabaseServerClient();

  const { data: company } = await supabase
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .maybeSingle<Company>();
  if (!company) return null;

  const openQuarter = await getCurrentQuarter(companyId);

  // Focus areas + sponsors + progress percent.
  const { data: sfaRows } = await supabase
    .from("strategic_focus_areas")
    .select("*")
    .eq("company_id", companyId)
    .eq("archived", false)
    .order("sort_order")
    .order("created_at");
  const sfas = (sfaRows ?? []) as StrategicFocusArea[];

  const sponsorIds = Array.from(
    new Set(sfas.map((s) => s.sponsor_id).filter((x): x is string => Boolean(x)))
  );
  const { data: sponsorRows } = sponsorIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", sponsorIds)
    : { data: [] };
  const sponsorById = new Map(
    (sponsorRows ?? []).map((p) => [p.id, p as Pick<Profile, "id" | "full_name">])
  );

  const { data: sfaProgress } = sfas.length
    ? await supabase
        .from("sfa_progress")
        .select("*")
        .in(
          "sfa_id",
          sfas.map((s) => s.id)
        )
    : { data: [] };
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

  // Orphan goals count for the muted footnote row.
  const { data: orphanGoalRows } = await supabase
    .from("annual_goals")
    .select("id")
    .eq("company_id", companyId)
    .is("sfa_id", null)
    .eq("archived", false);
  const orphanGoalCount = orphanGoalRows?.length ?? 0;

  // On Track + priority set (used by both on-track and later keep-rate math).
  let onTrackGood = 0;
  let onTrackTotal = 0;
  let openQuarterPriorityIds: string[] = [];
  if (openQuarter) {
    const { data: pRows } = await supabase
      .from("priorities")
      .select("id, status, archived")
      .eq("company_id", companyId)
      .eq("quarter_id", openQuarter.id)
      .eq("archived", false);
    const priorities = (pRows ?? []) as Pick<
      Priority,
      "id" | "status" | "archived"
    >[];
    onTrackTotal = priorities.length;
    onTrackGood = priorities.filter(
      (p) => p.status === "on_track" || p.status === "complete"
    ).length;
    openQuarterPriorityIds = priorities.map((p) => p.id);
  }

  // Commitments in the open quarter (for keep-rate and person stats).
  let quarterCommitments: Commitment[] = [];
  if (openQuarterPriorityIds.length > 0) {
    const { data: cRows } = await supabase
      .from("commitments")
      .select("*")
      .in("priority_id", openQuarterPriorityIds);
    quarterCommitments = (cRows ?? []) as Commitment[];
  }

  const keepRatePercent = computeFollowThroughRate(
    quarterCommitments.map((c) => c.status)
  );

  // This Week — count of open commitments due this week.
  const tz = company.timezone ?? "America/Anchorage";
  const thisFri = thisFriday(tz);
  const { data: thisWeekRows } = await supabase
    .from("commitments")
    .select("id")
    .eq("company_id", companyId)
    .eq("status", "open")
    .eq("week_ending", thisFri);
  const thisWeekOpen = thisWeekRows?.length ?? 0;

  // Keep-rate trend: last 12 weeks ending this Friday.
  const trendWeeks: string[] = [];
  for (let i = 11; i >= 0; i -= 1) {
    trendWeeks.push(addDays(thisFri, -7 * i));
  }
  const oldestWeek = trendWeeks[0];
  const { data: trendRows } = await supabase
    .from("commitments")
    .select("week_ending, status")
    .eq("company_id", companyId)
    .gte("week_ending", oldestWeek)
    .lte("week_ending", thisFri);
  const trendByWeek = new Map<string, { kept: number; missed: number }>();
  for (const row of (trendRows ?? []) as Pick<Commitment, "week_ending" | "status">[]) {
    if (row.status !== "kept" && row.status !== "missed") continue;
    const bucket = trendByWeek.get(row.week_ending) ?? { kept: 0, missed: 0 };
    if (row.status === "kept") bucket.kept += 1;
    else bucket.missed += 1;
    trendByWeek.set(row.week_ending, bucket);
  }
  const keepRateTrend: WeeklyKeepRatePoint[] = trendWeeks.map((week) => {
    const bucket = trendByWeek.get(week);
    return {
      weekEnding: week,
      keepRate: bucket ? computeRateFromCounts(bucket.kept, bucket.missed) : null,
      isCurrentWeek: week === thisFri,
    };
  });

  // People — per-owner counts in the OPEN QUARTER (Section 8.2).
  const { data: people } = await supabase
    .from("profiles")
    .select("id, full_name, position")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("full_name");
  const roster = (people ?? []) as Pick<
    Profile,
    "id" | "full_name" | "position"
  >[];

  // Group commitments by owner for the quarter's kept/missed/carried and
  // the overall open count (open uses today's snapshot, not just the
  // quarter — spec says "Open (count)" without qualifying window; using
  // "open right now in this company" is the fairest read).
  const { data: openRows } = await supabase
    .from("commitments")
    .select("owner_id")
    .eq("company_id", companyId)
    .eq("status", "open");
  const openByOwner = new Map<string, number>();
  for (const row of (openRows ?? []) as Pick<Commitment, "owner_id">[]) {
    openByOwner.set(row.owner_id, (openByOwner.get(row.owner_id) ?? 0) + 1);
  }

  const perOwner = new Map<
    string,
    { kept: number; missed: number; carried: number }
  >();
  for (const c of quarterCommitments) {
    const bucket = perOwner.get(c.owner_id) ?? {
      kept: 0,
      missed: 0,
      carried: 0,
    };
    if (c.status === "kept") bucket.kept += 1;
    else if (c.status === "missed") bucket.missed += 1;
    else if (c.status === "carried") bucket.carried += 1;
    perOwner.set(c.owner_id, bucket);
  }

  const dashboardPeople: DashboardPerson[] = roster.map((person) => {
    const counts = perOwner.get(person.id) ?? { kept: 0, missed: 0, carried: 0 };
    return {
      id: person.id,
      full_name: person.full_name,
      position: person.position ?? null,
      openCount: openByOwner.get(person.id) ?? 0,
      keptCount: counts.kept,
      missedCount: counts.missed,
      carriedCount: counts.carried,
      keepRate: computeRateFromCounts(counts.kept, counts.missed),
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
    },
    sfas: enrichedSfas,
    orphanGoalCount,
    keepRateTrend,
    people: dashboardPeople,
  };
}
