import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentQuarter } from "@/lib/quarters/service";
import {
  addDays,
  formatWeekRange,
  thisFriday,
  todayInTimezone,
} from "@/lib/dates";
import {
  computeFollowThroughRate,
  computeRateFromCounts,
} from "@/lib/utils";
import type {
  Commitment,
  Priority,
  Profile,
  Quarter,
} from "@/lib/types";

// --------------------------------------------------------------
// Shared row shapes for commitments pages.
// --------------------------------------------------------------

export type CommitmentWithOwner = Commitment & {
  owner: Pick<Profile, "id" | "full_name"> | null;
};

export type CommitmentWithMeta = Commitment & {
  owner: Pick<Profile, "id" | "full_name" | "position"> | null;
  priority: Pick<Priority, "id" | "title"> | null;
};

export type WeekGroup = {
  weekEnding: string;
  commitments: CommitmentWithOwner[];
};

// --------------------------------------------------------------
// Priority detail page — full commitment history grouped by week.
// --------------------------------------------------------------

export async function getCommitmentHistoryForPriority(
  priorityId: string
): Promise<WeekGroup[]> {
  const supabase = await createSupabaseServerClient();

  const { data: commitments } = await supabase
    .from("commitments")
    .select("*")
    .eq("priority_id", priorityId)
    .order("week_ending", { ascending: false })
    .order("created_at", { ascending: true });

  const rows = (commitments ?? []) as Commitment[];
  if (rows.length === 0) return [];

  const ownerIds = Array.from(new Set(rows.map((row) => row.owner_id)));
  const { data: owners } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", ownerIds);
  const ownerById = new Map(
    (owners ?? []).map((owner) => [owner.id, owner as Pick<Profile, "id" | "full_name">])
  );

  const grouped = new Map<string, CommitmentWithOwner[]>();
  for (const row of rows) {
    const enriched: CommitmentWithOwner = {
      ...row,
      owner: ownerById.get(row.owner_id) ?? null,
    };
    if (!grouped.has(row.week_ending)) grouped.set(row.week_ending, []);
    grouped.get(row.week_ending)!.push(enriched);
  }

  return Array.from(grouped.entries()).map(([weekEnding, commitments]) => ({
    weekEnding,
    commitments,
  }));
}

// --------------------------------------------------------------
// Quarter keep rate — derived purely from week_ending falling inside
// the quarter window. Operational (unlinked) commitments count here
// too; the priority link only matters for plan progress.
// --------------------------------------------------------------

export async function computeQuarterKeepRate(
  companyId: string,
  quarter: Pick<Quarter, "start_date" | "end_date">
): Promise<number | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("commitments")
    .select("status")
    .eq("company_id", companyId)
    .gte("week_ending", quarter.start_date)
    .lte("week_ending", quarter.end_date);
  const statuses = ((data ?? []) as Array<{ status: string }>).map((r) => r.status);
  return computeFollowThroughRate(statuses);
}

// --------------------------------------------------------------
// /commitments page loader.
// --------------------------------------------------------------

export type CommitmentFilters = {
  owner: "all" | "me" | string;
  // "missed" is labelled "Closed" in the UI (closed after due date).
  status: "all" | "open" | "kept" | "missed";
  type: "all" | "strategic" | "operational";
};

export type CommitmentPriorWeek = {
  weekEnding: string;
  weekRange: string;
  keptCount: number;
  missedCount: number;
  keepRate: number | null;
  commitments: CommitmentWithMeta[]; // resolved-only; empty until expanded client-side
};

export type CommitmentThisWeek = {
  weekEnding: string;
  weekRange: string;
  commitments: CommitmentWithMeta[];
};

export type CommitmentsPageData = {
  timezone: string;
  todayIso: string;
  thisFriday: string;
  openQuarter: Quarter | null;
  quarterCoversThisWeek: boolean;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  roster: Array<Pick<Profile, "id" | "full_name" | "position">>;
  needsAttention: CommitmentWithMeta[];
  thisWeek: CommitmentThisWeek;
  priorWeeks: CommitmentPriorWeek[];
  headerStats: {
    openThisWeek: number;
    needsAttentionCount: number;
    keepRateThisQuarter: number | null;
  };
};

function matchesFilters(
  commitment: Commitment,
  filters: CommitmentFilters,
  currentUserId: string
): boolean {
  // Owner
  if (filters.owner === "me") {
    if (commitment.owner_id !== currentUserId) return false;
  } else if (filters.owner !== "all") {
    if (commitment.owner_id !== filters.owner) return false;
  }

  // Status
  if (filters.status !== "all" && commitment.status !== filters.status) {
    return false;
  }

  // Type
  if (filters.type === "strategic" && commitment.priority_id === null) return false;
  if (filters.type === "operational" && commitment.priority_id !== null) return false;

  return true;
}

export async function getCommitmentsPageData(
  companyId: string,
  currentUserId: string,
  filters: CommitmentFilters
): Promise<CommitmentsPageData> {
  const supabase = await createSupabaseServerClient();

  const { data: company } = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle<{ timezone: string }>();
  const timezone = company?.timezone ?? "America/Anchorage";
  const { iso: todayIso } = todayInTimezone(timezone);
  const thisFri = thisFriday(timezone);

  const openQuarter = await getCurrentQuarter(companyId);
  const quarterCoversThisWeek = Boolean(
    openQuarter &&
      openQuarter.start_date <= thisFri &&
      openQuarter.end_date >= thisFri
  );

  // Roster for owner filter + display and owner picker in the add row.
  const { data: rosterRows } = await supabase
    .from("profiles")
    .select("id, full_name, position")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("full_name");
  const roster = (rosterRows ?? []) as Array<
    Pick<Profile, "id" | "full_name" | "position">
  >;
  const rosterById = new Map(roster.map((p) => [p.id, p]));

  // Open-quarter priorities feed the priority picker.
  const priorityOptions: Array<Pick<Priority, "id" | "title">> = openQuarter
    ? await loadOpenPriorityOptions(supabase, companyId, openQuarter.id)
    : [];

  // Fetch commitments in a wide window: from the start of the open
  // quarter (or 12 weeks back if no open quarter) through this Friday.
  // Prior-week resolved rows before that window are considered stale
  // history for this page's purposes.
  const windowStart = openQuarter?.start_date ?? addDays(thisFri, -84);
  const { data: rawRows } = await supabase
    .from("commitments")
    .select("*")
    .eq("company_id", companyId)
    .gte("week_ending", windowStart)
    .lte("week_ending", thisFri)
    .order("due_date", { ascending: true });

  // Also pull past-week still-open rows from BEFORE the window so the
  // "Needs attention" bucket never loses a row that fell off the edge.
  const { data: strandedRows } = await supabase
    .from("commitments")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "open")
    .lt("week_ending", windowStart);

  const allRows = [
    ...((rawRows ?? []) as Commitment[]),
    ...((strandedRows ?? []) as Commitment[]),
  ];

  // Enrich once; filter downstream.
  const priorityIds = Array.from(
    new Set(
      allRows
        .map((r) => r.priority_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const priorityMap = new Map<string, Pick<Priority, "id" | "title">>();
  if (priorityIds.length > 0) {
    const { data: prows } = await supabase
      .from("priorities")
      .select("id, title")
      .in("id", priorityIds);
    for (const row of (prows ?? []) as Priority[]) {
      priorityMap.set(row.id, { id: row.id, title: row.title });
    }
  }

  const enrich = (c: Commitment): CommitmentWithMeta => ({
    ...c,
    owner: rosterById.get(c.owner_id) ?? null,
    priority: c.priority_id ? priorityMap.get(c.priority_id) ?? null : null,
  });

  // ---- Header stats (filter-independent so the shape of "what's open"
  // stays trustworthy regardless of what the user is looking at). ----
  const openThisWeek = allRows.filter(
    (c) => c.week_ending === thisFri && c.status === "open"
  ).length;
  const needsAttentionRaw = allRows.filter(
    (c) => c.week_ending < thisFri && c.status === "open"
  );
  const keepRateThisQuarter = openQuarter
    ? await computeQuarterKeepRate(companyId, openQuarter)
    : null;

  // ---- Filtered slices for display. ----
  const filtered = allRows.filter((c) =>
    matchesFilters(c, filters, currentUserId)
  );

  const needsAttention = filtered
    .filter((c) => c.week_ending < thisFri && c.status === "open")
    .map(enrich)
    .sort(compareByDueThenOverdueFirst(todayIso));

  const thisWeekRows = filtered
    .filter((c) => c.week_ending === thisFri)
    .map(enrich)
    .sort(byOpenFirstThenDue(todayIso));

  // Prior-week groups contain ONLY resolved rows by definition — open
  // rows in past weeks live in Needs Attention above.
  const priorRows = filtered.filter(
    (c) => c.week_ending < thisFri && c.status !== "open"
  );
  const byWeek = new Map<string, CommitmentWithMeta[]>();
  for (const c of priorRows) {
    const bucket = byWeek.get(c.week_ending) ?? [];
    bucket.push(enrich(c));
    byWeek.set(c.week_ending, bucket);
  }

  const priorWeeks: CommitmentPriorWeek[] = Array.from(byWeek.entries())
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([weekEnding, commitments]) => {
      let kept = 0;
      let missed = 0;
      for (const c of commitments) {
        if (c.status === "kept") kept += 1;
        else if (c.status === "missed") missed += 1;
      }
      return {
        weekEnding,
        weekRange: formatWeekRange(weekEnding),
        keptCount: kept,
        missedCount: missed,
        keepRate: computeRateFromCounts(kept, missed),
        commitments,
      };
    });

  return {
    timezone,
    todayIso,
    thisFriday: thisFri,
    openQuarter,
    quarterCoversThisWeek,
    priorityOptions,
    roster,
    needsAttention,
    thisWeek: {
      weekEnding: thisFri,
      weekRange: formatWeekRange(thisFri),
      commitments: thisWeekRows,
    },
    priorWeeks,
    headerStats: {
      openThisWeek,
      needsAttentionCount: needsAttentionRaw.length,
      keepRateThisQuarter,
    },
  };
}

async function loadOpenPriorityOptions(
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

// Sort helpers. "Overdue first" means: within open rows, overdue asc,
// then non-overdue asc. Resolved rows always render at the bottom of
// their group (60% opacity, per spec) so we handle that in the row order
// rather than filtering here.
function compareByDueThenOverdueFirst(todayIso: string) {
  return (a: Commitment, b: Commitment) => {
    const aOver = a.due_date < todayIso ? 0 : 1;
    const bOver = b.due_date < todayIso ? 0 : 1;
    if (aOver !== bOver) return aOver - bOver;
    return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
  };
}

function byOpenFirstThenDue(todayIso: string) {
  return (a: Commitment, b: Commitment) => {
    // Open above resolved.
    const aOpen = a.status === "open" ? 0 : 1;
    const bOpen = b.status === "open" ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;

    // Within open: overdue first, then due date asc.
    if (aOpen === 0) {
      return compareByDueThenOverdueFirst(todayIso)(a, b);
    }

    // Within resolved: newest completed_at first, falling back to due date.
    const aCompleted = a.completed_at ?? "";
    const bCompleted = b.completed_at ?? "";
    if (aCompleted !== bCompleted) return aCompleted < bCompleted ? 1 : -1;
    return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
  };
}
