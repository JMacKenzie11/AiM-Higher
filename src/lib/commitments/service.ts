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
  summarizeKeepRate,
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
  commitments: CommitmentWithMeta[];
};

// --------------------------------------------------------------
// Priority detail page — commitment history + everything the inline
// management panel needs (roster, dates, quarter gate) so a single
// server call replaces what would otherwise be three round trips.
// --------------------------------------------------------------

export type PriorityCommitmentPanelData = {
  history: WeekGroup[];
  todayIso: string;
  thisFriday: string;
  quarterCoversThisWeek: boolean;
  noQuarterMessage: string;
  roster: Array<Pick<Profile, "id" | "full_name" | "position">>;
};

export async function getPriorityCommitmentPanelData(
  priorityId: string,
  viewerIsAdmin: boolean
): Promise<PriorityCommitmentPanelData | null> {
  const supabase = await createSupabaseServerClient();

  const { data: priority } = await supabase
    .from("priorities")
    .select("id, title, company_id")
    .eq("id", priorityId)
    .maybeSingle<Pick<Priority, "id" | "title" | "company_id">>();
  if (!priority) return null;

  const companyId = priority.company_id;
  const priorityMeta: Pick<Priority, "id" | "title"> = {
    id: priority.id,
    title: priority.title,
  };

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
  const noQuarterMessage = viewerIsAdmin
    ? "No quarter is open for this week — open one to start adding commitments."
    : "No quarter is open for this week. Ask your company admin to open one.";

  // Roster mirrors /commitments: active company members + system
  // admins appended so a coach can be selected as owner too.
  const [rosterRes, coachesRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, position")
      .eq("company_id", companyId)
      .neq("status", "inactive")
      .order("full_name"),
    supabase
      .from("profiles")
      .select("id, full_name, position")
      .eq("role", "system_admin")
      .neq("status", "inactive")
      .order("full_name"),
  ]);
  const companyMembers = (rosterRes.data ?? []) as Array<
    Pick<Profile, "id" | "full_name" | "position">
  >;
  const coaches = (
    (coachesRes.data ?? []) as Array<Pick<Profile, "id" | "full_name" | "position">>
  ).filter((c) => !companyMembers.some((m) => m.id === c.id));
  const roster: Array<Pick<Profile, "id" | "full_name" | "position">> = [
    ...companyMembers,
    ...coaches,
  ];
  const rosterById = new Map(roster.map((p) => [p.id, p]));

  // Ascending by week_ending and due_date so the history reads as
  // a timeline: earliest week at the top, earliest due date first
  // within each week. Parked + soft-deleted rows stay out.
  const { data: commitments } = await supabase
    .from("commitments")
    .select("*")
    .eq("priority_id", priorityId)
    .is("deleted_at", null)
    .is("parked_at", null)
    .order("week_ending", { ascending: true })
    .order("due_date", { ascending: true });

  const rows = (commitments ?? []) as Commitment[];

  const grouped = new Map<string, CommitmentWithMeta[]>();
  for (const row of rows) {
    const enriched: CommitmentWithMeta = {
      ...row,
      owner: row.owner_id ? rosterById.get(row.owner_id) ?? null : null,
      priority: priorityMeta,
    };
    if (!grouped.has(row.week_ending)) grouped.set(row.week_ending, []);
    grouped.get(row.week_ending)!.push(enriched);
  }

  const history: WeekGroup[] = Array.from(grouped.entries()).map(
    ([weekEnding, commitments]) => ({ weekEnding, commitments })
  );

  return {
    history,
    todayIso,
    thisFriday: thisFri,
    quarterCoversThisWeek,
    noQuarterMessage,
    roster,
  };
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
    .is("deleted_at", null)
    .is("parked_at", null)
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
  status: "all" | "open" | "kept" | "kept_late" | "missed";
  type: "all" | "strategic" | "operational";
};

export type CommitmentPriorWeek = {
  weekEnding: string;
  weekRange: string;
  keptOnTimeCount: number;
  keptLateCount: number;
  missedCount: number;
  keepRate: number | null;
  commitments: CommitmentWithMeta[]; // resolved-only; empty until expanded client-side
};

export type CommitmentsPageData = {
  timezone: string;
  todayIso: string;
  thisFriday: string;
  openQuarter: Quarter | null;
  quarterCoversThisWeek: boolean;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  roster: Array<Pick<Profile, "id" | "full_name" | "position">>;
  // Single flat list: past-week still-open + this-week rows (open and
  // resolved), sorted overdue-open → upcoming-open → resolved. Weekly
  // grouping only surfaces in the collapsed prior-weeks section below.
  mainList: CommitmentWithMeta[];
  // Flat list of rows scheduled for a week AFTER this Friday — one
  // "Future weeks" section on the page so nothing a human deliberately
  // deferred (or the meeting-analyzer landed forward) can go invisible.
  // Sorted by due date so the soonest surfaces first.
  futureList: CommitmentWithMeta[];
  priorWeeks: CommitmentPriorWeek[];
  // Parking lot: commitments with parked_at set. Excluded from every
  // metric + weekly flow; rendered as its own section at the bottom
  // of the page so a user knows what's been set aside.
  parkedList: CommitmentWithMeta[];
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

  // Status. The "kept" pill collapses kept_on_time + kept_late into
  // a single "did the work" filter — users want to see both kinds
  // together, not force a choice between the two.
  if (filters.status !== "all") {
    if (filters.status === "kept") {
      if (
        commitment.status !== "kept_on_time" &&
        commitment.status !== "kept_late"
      ) {
        return false;
      }
    } else if (commitment.status !== filters.status) {
      return false;
    }
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
  // Pending users show up alongside active — an admin can pre-assign
  // commitments to someone who hasn't accepted their invite yet.
  // System admins (AiMS coaches) are appended so they can be picked
  // as owners even though they don't belong to the client company.
  const [rosterRes, coachesRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, position")
      .eq("company_id", companyId)
      .neq("status", "inactive")
      .order("full_name"),
    supabase
      .from("profiles")
      .select("id, full_name, position")
      .eq("role", "system_admin")
      .neq("status", "inactive")
      .order("full_name"),
  ]);
  const companyMembers = (rosterRes.data ?? []) as Array<
    Pick<Profile, "id" | "full_name" | "position">
  >;
  const coaches = (
    (coachesRes.data ?? []) as Array<Pick<Profile, "id" | "full_name" | "position">>
  ).filter((c) => !companyMembers.some((m) => m.id === c.id));
  const roster: Array<Pick<Profile, "id" | "full_name" | "position">> = [
    ...companyMembers,
    ...coaches,
  ];
  const rosterById = new Map(roster.map((p) => [p.id, p]));

  // Open-quarter priorities feed the priority picker.
  const priorityOptions: Array<Pick<Priority, "id" | "title">> = openQuarter
    ? await loadOpenPriorityOptions(supabase, companyId, openQuarter.id)
    : [];

  // Fetch commitments in a wide window: from the start of the open
  // quarter (or 12 weeks back if no open quarter) through 26 weeks
  // forward. Prior-week resolved rows before that window are
  // considered stale history for this page's purposes; the forward
  // side gives Future Weeks 6 months of headroom, plenty for the
  // AiMS weekly cadence without loading the world.
  const windowStart = openQuarter?.start_date ?? addDays(thisFri, -84);
  const windowEnd = addDays(thisFri, 26 * 7);
  // Filter out soft-deleted and parked rows in every query — they
  // don't belong in any list, count, or metric on this page. Parked
  // rows come back through their own dedicated query below.
  const { data: rawRows } = await supabase
    .from("commitments")
    .select("*")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .is("parked_at", null)
    .gte("week_ending", windowStart)
    .lte("week_ending", windowEnd)
    .order("due_date", { ascending: true });

  // Also pull past-week still-open rows from BEFORE the window so the
  // "Needs attention" bucket never loses a row that fell off the edge.
  // Bounded to a one-year lookback so genuinely abandoned rows (open
  // commitments from 2024, forgotten but never resolved) don't grow
  // this fetch without limit — a stale row from more than 12 months
  // ago is history, not a "needs attention" today.
  const strandedFloor = addDays(windowStart, -365);
  const { data: strandedRows } = await supabase
    .from("commitments")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "open")
    .is("deleted_at", null)
    .is("parked_at", null)
    .lt("week_ending", windowStart)
    .gte("week_ending", strandedFloor);

  // Parking lot: everything with parked_at set, no date window.
  // Displayed as its own muted section at the bottom of the page.
  const { data: parkedRows } = await supabase
    .from("commitments")
    .select("*")
    .eq("company_id", companyId)
    .is("deleted_at", null)
    .not("parked_at", "is", null)
    .order("parked_at", { ascending: false });

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
    owner: c.owner_id ? rosterById.get(c.owner_id) ?? null : null,
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

  // Everything currently in play: past-week open (would've been "Needs
  // Attention") plus this-week open + resolved. One list, sorted so
  // commitments group by owner and, within each owner, sit in
  // earliest-due-date-first order. Unassigned commitments fall to
  // the end.
  const mainList = filtered
    .filter(
      (c) =>
        (c.week_ending < thisFri && c.status === "open") ||
        c.week_ending === thisFri
    )
    .map(enrich)
    .sort(byOwnerThenDue);

  // Future rows: everything week_ending > thisFri. In practice these
  // are all open (a resolved row dated in the future would be
  // strange), but we include any status so nothing hides regardless
  // of how it got there. Each row's due_date is visible in the UI,
  // so a single ascending list beats week-by-week grouping here.
  const futureList = filtered
    .filter((c) => c.week_ending > thisFri)
    .map(enrich)
    .sort((a, b) => {
      if (a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1;
      return byOwnerThenDue(a, b);
    });

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
      const summary = summarizeKeepRate(commitments.map((c) => c.status));
      return {
        weekEnding,
        weekRange: formatWeekRange(weekEnding),
        keptOnTimeCount: summary.keptOnTime,
        keptLateCount: summary.keptLate,
        missedCount: summary.missed,
        keepRate: summary.keepRate,
        commitments,
      };
    });

  const parkedList = ((parkedRows ?? []) as Commitment[])
    .map(enrich)
    .sort((a, b) => {
      const aParked = a.parked_at ?? "";
      const bParked = b.parked_at ?? "";
      return aParked < bParked ? 1 : aParked > bParked ? -1 : 0;
    });

  return {
    timezone,
    todayIso,
    thisFriday: thisFri,
    openQuarter,
    quarterCoversThisWeek,
    priorityOptions,
    roster,
    mainList,
    futureList,
    priorWeeks,
    parkedList,
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

// Sort by owner name, then earliest due date. Unassigned rows
// sink to the end so an assigned list doesn't get split by a null.
function byOwnerThenDue(a: CommitmentWithMeta, b: CommitmentWithMeta): number {
  const aName = a.owner?.full_name ?? "";
  const bName = b.owner?.full_name ?? "";
  // Empty string sorts last (unassigned to the bottom).
  if (aName === "" && bName !== "") return 1;
  if (bName === "" && aName !== "") return -1;
  const nameCmp = aName.localeCompare(bName, undefined, { sensitivity: "base" });
  if (nameCmp !== 0) return nameCmp;
  return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
}
