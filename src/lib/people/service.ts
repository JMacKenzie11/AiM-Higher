import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentQuarter } from "@/lib/quarters/service";
import { addDays, thisFriday, todayInTimezone } from "@/lib/dates";
import { computeRateFromCounts } from "@/lib/utils";
import type {
  Commitment,
  Invitation,
  Priority,
  Profile,
} from "@/lib/types";
import type { ResultsProfile } from "@/lib/strengths/types";
import type { KeepRateBar } from "@/components/charts/KeepRateBarChart";

// Roster + person-scorecard read models — Section 8.6.

export type PeopleRosterRow = Profile & {
  openCount: number;
  keepRate: number | null; // 0-100 across the open quarter
};

export type PeopleRoster = {
  people: PeopleRosterRow[];
  pendingInvitations: Invitation[];
};

export async function getPeopleRoster(
  companyId: string
): Promise<PeopleRoster> {
  const supabase = await createSupabaseServerClient();

  const [{ data: profiles }, { data: invitations }] = await Promise.all([
    supabase
      .from("profiles")
      .select("*")
      .eq("company_id", companyId)
      .order("full_name"),
    supabase
      .from("invitations")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);

  const roster = (profiles ?? []) as Profile[];
  const openQuarter = await getCurrentQuarter(companyId);

  // "Open" counts EVERY still-open commitment for the person (not
  // just this-week), matching the dashboard's read of the same signal.
  const { data: openRows } = await supabase
    .from("commitments")
    .select("owner_id")
    .eq("company_id", companyId)
    .eq("status", "open");
  const openByOwner = new Map<string, number>();
  for (const row of (openRows ?? []) as Pick<Commitment, "owner_id">[]) {
    openByOwner.set(row.owner_id, (openByOwner.get(row.owner_id) ?? 0) + 1);
  }

  // Keep rate for the open quarter (kept / (kept+missed)) per person.
  const keepRateByOwner = new Map<string, number | null>();
  if (openQuarter) {
    const { data: priorityRows } = await supabase
      .from("priorities")
      .select("id")
      .eq("company_id", companyId)
      .eq("quarter_id", openQuarter.id);
    const priorityIds = (priorityRows ?? []).map((row) => row.id);
    if (priorityIds.length > 0) {
      const { data: cRows } = await supabase
        .from("commitments")
        .select("owner_id, status")
        .in("priority_id", priorityIds);
      const buckets = new Map<string, { kept: number; missed: number }>();
      for (const row of (cRows ?? []) as Pick<
        Commitment,
        "owner_id" | "status"
      >[]) {
        if (row.status !== "kept" && row.status !== "missed") continue;
        const b = buckets.get(row.owner_id) ?? { kept: 0, missed: 0 };
        if (row.status === "kept") b.kept += 1;
        else b.missed += 1;
        buckets.set(row.owner_id, b);
      }
      for (const [ownerId, b] of buckets.entries()) {
        keepRateByOwner.set(ownerId, computeRateFromCounts(b.kept, b.missed));
      }
    }
  }

  const people: PeopleRosterRow[] = roster.map((profile) => ({
    ...profile,
    openCount: openByOwner.get(profile.id) ?? 0,
    keepRate: keepRateByOwner.get(profile.id) ?? null,
  }));

  return {
    people,
    pendingInvitations: (invitations ?? []) as Invitation[],
  };
}

// ================ People strengths overlay ================
// Same roster shape as getPeopleRoster, but each row carries a
// snapshot of the person's latest strengths results so /people can
// render a directory-style "who leans thinking / who's a signature
// on Building Trust" view without one round-trip per person.

export type PersonStrengthsOverlay = {
  id: string;
  full_name: string;
  position: string | null;
  assessmentStatus: "not_started" | "in_progress" | "completed";
  // Empty when the assessment isn't complete — the UI renders a
  // status chip in that case rather than chips/bars.
  topStrengths: string[]; // top 3 sub_strength ids by energy
  dimensionEnergy: Record<"thinking" | "influence" | "execution" | "relating", number | null>;
};

export async function getPeopleStrengthsOverlay(
  companyId: string
): Promise<PersonStrengthsOverlay[]> {
  const supabase = await createSupabaseServerClient();

  const [{ data: profiles }, { data: assessments }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, position")
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("full_name"),
    supabase
      .from("strengths_assessments")
      .select("id, user_id, status, version")
      .eq("company_id", companyId)
      .order("version", { ascending: false }),
  ]);

  const roster = (profiles ?? []) as Pick<
    Profile,
    "id" | "full_name" | "position"
  >[];
  const assessmentRows = (assessments ?? []) as Array<{
    id: string;
    user_id: string;
    status: string;
    version: number;
  }>;

  // Pick the latest assessment row per user (rows are already sorted
  // by version desc, so first-wins).
  const latestByUser = new Map<string, (typeof assessmentRows)[number]>();
  for (const row of assessmentRows) {
    if (!latestByUser.has(row.user_id)) latestByUser.set(row.user_id, row);
  }

  const completedAssessmentIds = Array.from(latestByUser.values())
    .filter((a) => a.status === "completed")
    .map((a) => a.id);

  const resultsByAssessmentId = new Map<string, ResultsProfile>();
  if (completedAssessmentIds.length > 0) {
    const { data: results } = await supabase
      .from("strengths_results")
      .select("assessment_id, profile")
      .in("assessment_id", completedAssessmentIds);
    for (const row of (results ?? []) as Array<{
      assessment_id: string;
      profile: unknown;
    }>) {
      resultsByAssessmentId.set(row.assessment_id, row.profile as ResultsProfile);
    }
  }

  return roster.map((p) => {
    const assessment = latestByUser.get(p.id);
    const status: PersonStrengthsOverlay["assessmentStatus"] = !assessment
      ? "not_started"
      : assessment.status === "completed"
        ? "completed"
        : "in_progress";
    const profile =
      assessment && status === "completed"
        ? resultsByAssessmentId.get(assessment.id) ?? null
        : null;

    const topStrengths = profile
      ? [...profile.sub_strengths]
          .sort((a, b) => b.energy - a.energy)
          .slice(0, 3)
          .map((s) => s.sub_strength)
      : [];

    const dimensionEnergy = {
      thinking: null,
      influence: null,
      execution: null,
      relating: null,
    } as PersonStrengthsOverlay["dimensionEnergy"];
    if (profile) {
      for (const dim of profile.dimensions) {
        dimensionEnergy[dim.dimension] = dim.energy_avg;
      }
    }

    return {
      id: p.id,
      full_name: p.full_name,
      position: p.position,
      assessmentStatus: status,
      topStrengths,
      dimensionEnergy,
    };
  });
}

// ================ Person scorecard ================

export type PersonCommitmentRow = Commitment & {
  priority: Pick<Priority, "id" | "title"> | null;
};

export type PersonWeekGroup = {
  weekEnding: string;
  commitments: PersonCommitmentRow[];
};

export type PersonScorecard = {
  profile: Profile;
  company: { id: string; name: string; timezone: string };
  stats: {
    keepRate: number | null;
    keptCount: number;
    missedCount: number;
  };
  keepRateTrend: KeepRateBar[];
  openCommitments: PersonCommitmentRow[];
  history: PersonWeekGroup[];
  todayIso: string; // for "past due" comparisons
};

export async function getPersonScorecard(
  personId: string
): Promise<PersonScorecard | null> {
  const supabase = await createSupabaseServerClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", personId)
    .maybeSingle<Profile>();
  if (!profile || !profile.company_id) return null;

  const { data: companyRow } = await supabase
    .from("companies")
    .select("id, name, timezone")
    .eq("id", profile.company_id)
    .maybeSingle<{ id: string; name: string; timezone: string }>();
  if (!companyRow) return null;

  const openQuarter = await getCurrentQuarter(profile.company_id);
  const timezone = companyRow.timezone ?? "America/Anchorage";
  const today = todayInTimezone(timezone).iso;
  const thisFri = thisFriday(timezone);

  // Quarter stats — kept/missed counts for this person, derived from
  // week_ending falling inside the quarter window so operational
  // commitments count identically to strategic ones.
  let keptCount = 0;
  let missedCount = 0;
  if (openQuarter) {
    const { data: cRows } = await supabase
      .from("commitments")
      .select("status")
      .eq("owner_id", personId)
      .eq("company_id", profile.company_id)
      .gte("week_ending", openQuarter.start_date)
      .lte("week_ending", openQuarter.end_date);
    for (const row of (cRows ?? []) as Pick<Commitment, "status">[]) {
      if (row.status === "kept") keptCount += 1;
      else if (row.status === "missed") missedCount += 1;
    }
  }
  const keepRate = computeRateFromCounts(keptCount, missedCount);

  // 12-week trend for this person.
  const trendWeeks: string[] = [];
  for (let i = 11; i >= 0; i -= 1) {
    trendWeeks.push(addDays(thisFri, -7 * i));
  }
  const oldestWeek = trendWeeks[0];
  const { data: trendRows } = await supabase
    .from("commitments")
    .select("week_ending, status")
    .eq("owner_id", personId)
    .gte("week_ending", oldestWeek)
    .lte("week_ending", thisFri);
  const trendByWeek = new Map<string, { kept: number; missed: number }>();
  for (const row of (trendRows ?? []) as Pick<
    Commitment,
    "week_ending" | "status"
  >[]) {
    if (row.status !== "kept" && row.status !== "missed") continue;
    const b = trendByWeek.get(row.week_ending) ?? { kept: 0, missed: 0 };
    if (row.status === "kept") b.kept += 1;
    else b.missed += 1;
    trendByWeek.set(row.week_ending, b);
  }
  const keepRateTrend: KeepRateBar[] = trendWeeks.map((week) => {
    const bucket = trendByWeek.get(week);
    return {
      weekEnding: week,
      keepRate: bucket ? computeRateFromCounts(bucket.kept, bucket.missed) : null,
      isCurrentWeek: week === thisFri,
    };
  });

  // Open commitments (all-time, still open).
  const { data: openRows } = await supabase
    .from("commitments")
    .select("*")
    .eq("owner_id", personId)
    .eq("status", "open")
    .order("due_date", { ascending: true });
  const openCommitments = (openRows ?? []) as Commitment[];

  // History — all NON-open commitments for this person, grouped by
  // week descending. Also includes the still-open history rows from
  // earlier weeks so the timeline is complete. We render the "open"
  // ones separately, so we exclude them here.
  const { data: historyRows } = await supabase
    .from("commitments")
    .select("*")
    .eq("owner_id", personId)
    .neq("status", "open")
    .order("week_ending", { ascending: false })
    .order("created_at", { ascending: true });
  const historyCommitments = (historyRows ?? []) as Commitment[];

  // Priority titles for all rows we're rendering.
  const allIds = Array.from(
    new Set([
      ...openCommitments.map((c) => c.priority_id),
      ...historyCommitments.map((c) => c.priority_id),
    ])
  );
  const priorityById = new Map<string, Pick<Priority, "id" | "title">>();
  if (allIds.length > 0) {
    const { data: pRows } = await supabase
      .from("priorities")
      .select("id, title")
      .in("id", allIds);
    for (const row of (pRows ?? []) as Pick<Priority, "id" | "title">[]) {
      priorityById.set(row.id, row);
    }
  }

  function enrich(commitment: Commitment): PersonCommitmentRow {
    return {
      ...commitment,
      priority: commitment.priority_id
        ? priorityById.get(commitment.priority_id) ?? null
        : null,
    };
  }

  const enrichedOpen = openCommitments.map(enrich);

  // Group history by week_ending desc.
  const grouped = new Map<string, PersonCommitmentRow[]>();
  for (const commitment of historyCommitments) {
    if (!grouped.has(commitment.week_ending)) {
      grouped.set(commitment.week_ending, []);
    }
    grouped.get(commitment.week_ending)!.push(enrich(commitment));
  }
  const history: PersonWeekGroup[] = Array.from(grouped.entries()).map(
    ([weekEnding, commitments]) => ({ weekEnding, commitments })
  );

  return {
    profile,
    company: companyRow,
    stats: {
      keepRate,
      keptCount,
      missedCount,
    },
    keepRateTrend,
    openCommitments: enrichedOpen,
    history,
    todayIso: today,
  };
}
