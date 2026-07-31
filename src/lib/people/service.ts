import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentQuarter } from "@/lib/quarters/service";
import { addDays, thisFriday, todayInTimezone } from "@/lib/dates";
import { bucketKeepRates, computeRateFromCounts } from "@/lib/utils";
import type {
  Commitment,
  Priority,
  Profile,
} from "@/lib/types";
import type { KeepRateBar } from "@/components/charts/KeepRateBarChart";

// Roster + person-scorecard read models — Section 8.6.

export type PeopleRosterRow = Profile & {
  openCount: number;
  keepRate: number | null; // 0-100 across the open quarter
};

export type PeopleRoster = {
  people: PeopleRosterRow[];
};

export async function getPeopleRoster(
  companyId: string
): Promise<PeopleRoster> {
  const supabase = await createSupabaseServerClient();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("*")
    .eq("company_id", companyId)
    .order("full_name");

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
    // Person open-count skips unassigned rows — they show under the
    // "Unassigned" section on /commitments and roll up at the
    // company level, not any individual's page.
    if (!row.owner_id) continue;
    openByOwner.set(row.owner_id, (openByOwner.get(row.owner_id) ?? 0) + 1);
  }

  // Keep rate for the open quarter (kept / (kept+missed)) per person.
  // Same rule as above: unassigned commitments are excluded from
  // any individual's keep rate.
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
      const rows = ((cRows ?? []) as Pick<Commitment, "owner_id" | "status">[])
        .filter((row) => row.owner_id !== null);
      const buckets = bucketKeepRates(rows, (row) => row.owner_id as string);
      for (const [ownerId, bucket] of buckets) {
        keepRateByOwner.set(ownerId, bucket.keepRate);
      }
    }
  }

  const people: PeopleRosterRow[] = roster.map((profile) => ({
    ...profile,
    openCount: openByOwner.get(profile.id) ?? 0,
    keepRate: keepRateByOwner.get(profile.id) ?? null,
  }));

  return { people };
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
  const trendByWeek = bucketKeepRates(
    (trendRows ?? []) as Pick<Commitment, "week_ending" | "status">[],
    (row) => row.week_ending
  );
  const keepRateTrend: KeepRateBar[] = trendWeeks.map((week) => ({
    weekEnding: week,
    keepRate: trendByWeek.get(week)?.keepRate ?? null,
    isCurrentWeek: week === thisFri,
  }));

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
