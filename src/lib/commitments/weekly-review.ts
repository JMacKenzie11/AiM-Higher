import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentQuarter } from "@/lib/quarters/service";
import { lastFriday, thisFriday } from "@/lib/dates";
import { computeFollowThroughRate } from "@/lib/utils";
import type { Commitment, Priority, Profile, Quarter } from "@/lib/types";

// Shape returned to the /weekly-review page. Keeping this in one place
// so the page + client subcomponents stay in sync.

export type CommitmentWithMeta = Commitment & {
  owner: Pick<Profile, "id" | "full_name" | "position"> | null;
  priority: Pick<Priority, "id" | "title"> | null;
};

export type OwnerGroup = {
  owner: Pick<Profile, "id" | "full_name" | "position"> | null;
  commitments: CommitmentWithMeta[];
};

export type WeeklyReviewData = {
  timezone: string;
  thisFriday: string;
  lastFriday: string;
  openQuarter: Quarter | null;
  thisWeekGroups: OwnerGroup[];
  lastWeekGroups: OwnerGroup[]; // includes still-open earlier commitments
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  roster: Array<Pick<Profile, "id" | "full_name">>;
  keepRate: number | null; // 0-100 for the open quarter, null if no resolved commitments
  stats: {
    toReview: number;
    resolvedSoFar: number;
  };
};

function groupByOwner(rows: CommitmentWithMeta[]): OwnerGroup[] {
  const map = new Map<string, OwnerGroup>();
  for (const row of rows) {
    const key = row.owner?.id ?? "__unowned";
    if (!map.has(key)) {
      map.set(key, { owner: row.owner, commitments: [] });
    }
    map.get(key)!.commitments.push(row);
  }
  return Array.from(map.values()).sort((a, b) => {
    const an = a.owner?.full_name ?? "zzz";
    const bn = b.owner?.full_name ?? "zzz";
    return an.localeCompare(bn);
  });
}

export async function getWeeklyReview(
  companyId: string
): Promise<WeeklyReviewData> {
  const supabase = await createSupabaseServerClient();

  // Company timezone drives which Friday is "this" and "last".
  const { data: company } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle<{ timezone: string }>();
  const timezone = company?.timezone ?? "America/Anchorage";
  const thisFri = thisFriday(timezone);
  const lastFri = lastFriday(timezone);

  const openQuarter = await getCurrentQuarter(companyId);

  // Roster for owner pickers + display names.
  const { data: roster } = await supabase
    .from("profiles")
    .select("id, full_name, position")
    .eq("company_id", companyId)
    .order("full_name");
  const people = (roster ?? []) as Pick<
    Profile,
    "id" | "full_name" | "position"
  >[];
  const peopleById = new Map(people.map((p) => [p.id, p]));

  // Open-quarter priorities feed the composer picker and let us
  // display "priority title" against every commitment we load.
  const priorityOptions = openQuarter
    ? await loadOpenPriorities(supabase, companyId, openQuarter.id)
    : [];

  // Pull every commitment we might render on this page in one query:
  //   1. week_ending = this Friday
  //   2. week_ending = last Friday
  //   3. status = 'open' with week_ending < last Friday (still open earlier)
  // Cover all three via an OR filter.
  const { data: relevant } = await supabase
    .from("commitments")
    .select("*")
    .eq("company_id", companyId)
    .or(
      [
        `week_ending.eq.${thisFri}`,
        `week_ending.eq.${lastFri}`,
        `and(status.eq.open,week_ending.lt.${lastFri})`,
      ].join(",")
    );

  const commitments = (relevant ?? []) as Commitment[];
  const priorityIds = Array.from(new Set(commitments.map((c) => c.priority_id)));
  const priorityMap = new Map<string, Pick<Priority, "id" | "title">>();
  if (priorityIds.length > 0) {
    const { data: priorityRows } = await supabase
      .from("priorities")
      .select("id, title")
      .in("id", priorityIds);
    for (const row of (priorityRows ?? []) as Priority[]) {
      priorityMap.set(row.id, { id: row.id, title: row.title });
    }
  }

  const enriched: CommitmentWithMeta[] = commitments.map((c) => ({
    ...c,
    owner: peopleById.get(c.owner_id) ?? null,
    priority: priorityMap.get(c.priority_id) ?? null,
  }));

  const thisWeekRows = enriched.filter((c) => c.week_ending === thisFri);
  const lastWeekRows = enriched.filter((c) => c.week_ending !== thisFri);

  // Header stat trio.
  const toReview = enriched.filter(
    (c) => c.status === "open" && c.week_ending <= lastFri
  ).length;
  const resolvedSoFar = enriched.filter(
    (c) => c.status !== "open" && c.week_ending === lastFri
  ).length;

  const keepRate = openQuarter
    ? await computeKeepRate(supabase, companyId, openQuarter.id)
    : null;

  return {
    timezone,
    thisFriday: thisFri,
    lastFriday: lastFri,
    openQuarter,
    thisWeekGroups: groupByOwner(thisWeekRows),
    lastWeekGroups: groupByOwner(lastWeekRows),
    priorityOptions,
    roster: people.map((p) => ({ id: p.id, full_name: p.full_name })),
    keepRate,
    stats: { toReview, resolvedSoFar },
  };
}

async function loadOpenPriorities(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  companyId: string,
  quarterId: string
) {
  const { data } = await supabase
    .from("priorities")
    .select("id, title")
    .eq("company_id", companyId)
    .eq("quarter_id", quarterId)
    .eq("archived", false)
    .order("title");
  return (data ?? []) as Array<Pick<Priority, "id" | "title">>;
}

async function computeKeepRate(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  companyId: string,
  quarterId: string
): Promise<number | null> {
  // Priorities in the open quarter → their commitments → count kept/missed.
  const { data: priorityIdsData } = await supabase
    .from("priorities")
    .select("id")
    .eq("company_id", companyId)
    .eq("quarter_id", quarterId);
  const priorityIds = (priorityIdsData ?? []).map((row) => row.id);
  if (priorityIds.length === 0) return null;

  const { data: commitmentsForQuarter } = await supabase
    .from("commitments")
    .select("status")
    .in("priority_id", priorityIds);

  const statuses = ((commitmentsForQuarter ?? []) as Array<{ status: string }>).map(
    (row) => row.status
  );
  return computeFollowThroughRate(statuses);
}
