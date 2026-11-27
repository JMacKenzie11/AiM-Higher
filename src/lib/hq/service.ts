import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  loadCompanyScorecardScores,
  loadOverallSnapshotsAsOf,
} from "@/lib/maturity/service";
import { compareOverall } from "@/lib/maturity/compute";
import { scoreForRow, type StoredScoreRow } from "@/lib/leadership/facilitation/score";
import {
  changeBetween,
  COMPARE_DAYS,
  DAY_MS,
  FTR_WINDOW_DAYS,
  ftrNowAndThen,
  priorityCounts,
  type Change,
  type FtrRow,
  type PriorityLite,
} from "./derive";
import type {
  Commitment,
  Priority,
  Profile,
  Quarter,
} from "@/lib/types";
import type { CommitmentWithMeta } from "@/lib/commitments/service";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Guide HQ data loaders. Every function scopes to the caller unless
// noted; a sysadmin viewing another guide's HQ passes the guide's id
// explicitly.

export type CaseloadCompany = {
  id: string;
  name: string;
};

// Companies the caller (or the specified guide) coaches. The row set
// comes from guide_assignments regardless of role: a system_admin
// with three assignment rows sees exactly those three, not every
// company on the platform. Zero rows = zero caseload, not a fallback
// to global scope — that difference is the whole point of the empty
// state.
export async function loadCaseload(
  guideId: string
): Promise<CaseloadCompany[]> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data } = await supabase
    .from("guide_assignments")
    .select("company_id, companies!inner(id, name)")
    .eq("guide_id", guideId)
    .order("companies(name)", { ascending: true });

  type Row = {
    company_id: string;
    companies: { id: string; name: string } | { id: string; name: string }[] | null;
  };
  const rows = (data ?? []) as Row[];
  return rows.map((r) => {
    const c = Array.isArray(r.companies) ? r.companies[0] : r.companies;
    return { id: c?.id ?? r.company_id, name: c?.name ?? "(unnamed)" };
  });
}

// Commitments owned by the caller across every company. Relies on the
// commitments_select_owner RLS policy (migration 0141) — a caller sees
// every commitment they own, even across companies where they hold no
// tenant access. Paints the "My commitments" section on /hq.
export type MyCommitmentRow = CommitmentWithMeta & {
  companyName: string;
};

export async function loadMyCommitments(
  ownerId: string
): Promise<MyCommitmentRow[]> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  const { data: commitmentRows } = await supabase
    .from("commitments")
    .select("*")
    .eq("owner_id", ownerId)
    .is("deleted_at", null)
    .order("due_date", { ascending: true });

  const commitments = (commitmentRows ?? []) as Commitment[];
  if (commitments.length === 0) return [];

  const priorityIds = Array.from(
    new Set(commitments.map((c) => c.priority_id).filter(Boolean) as string[])
  );
  const issueIds = Array.from(
    new Set(commitments.map((c) => c.issue_id).filter(Boolean) as string[])
  );
  const functionalAreaIds = Array.from(
    new Set(
      commitments.map((c) => c.functional_area_id).filter(Boolean) as string[]
    )
  );
  const companyIds = Array.from(new Set(commitments.map((c) => c.company_id)));

  const [
    { data: profile },
    { data: priorityRows },
    { data: issueRows },
    { data: functionRows },
    { data: companyRows },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, position")
      .eq("id", ownerId)
      .maybeSingle(),
    priorityIds.length > 0
      ? supabase
          .from("priorities")
          .select("id, title")
          .in("id", priorityIds)
      : Promise.resolve({ data: [] as Pick<Priority, "id" | "title">[] }),
    issueIds.length > 0
      ? supabase
          .from("issues")
          .select("id, title, status")
          .in("id", issueIds)
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            title: string;
            status: "open" | "resolved";
          }>,
        }),
    functionalAreaIds.length > 0
      ? supabase
          .from("functions")
          .select("id, title")
          .in("id", functionalAreaIds)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string }> }),
    supabase.from("companies").select("id, name").in("id", companyIds),
  ]);

  const owner = (profile ?? null) as Pick<
    Profile,
    "id" | "full_name" | "position"
  > | null;
  const priorityById = new Map<string, Pick<Priority, "id" | "title">>();
  for (const p of (priorityRows ?? []) as Pick<Priority, "id" | "title">[]) {
    priorityById.set(p.id, p);
  }
  const issueById = new Map<
    string,
    { id: string; title: string; status: "open" | "resolved" }
  >();
  for (const i of (issueRows ?? []) as Array<{
    id: string;
    title: string;
    status: "open" | "resolved";
  }>) {
    issueById.set(i.id, i);
  }
  const functionalAreaById = new Map<string, { id: string; title: string }>();
  for (const f of (functionRows ?? []) as Array<{
    id: string;
    title: string;
  }>) {
    functionalAreaById.set(f.id, f);
  }
  const companyNameById = new Map<string, string>();
  for (const c of (companyRows ?? []) as Array<{ id: string; name: string }>) {
    companyNameById.set(c.id, c.name);
  }

  return commitments.map((c) => ({
    ...c,
    owner,
    priority: c.priority_id ? priorityById.get(c.priority_id) ?? null : null,
    issue: c.issue_id ? issueById.get(c.issue_id) ?? null : null,
    functionalArea: c.functional_area_id
      ? functionalAreaById.get(c.functional_area_id) ?? null
      : null,
    companyName: companyNameById.get(c.company_id) ?? "(unknown company)",
  }));
}

// Per-company row for the "Your companies" table. Reads a small fixed
// set of numbers per company; the scorecard is a live compute, so this
// scales with N (single-digit for a typical caseload). Each number that
// carries an arrow is compared with four weeks ago (derive.ts); a side
// with no data gives no arrow.
export type CompanyRollup = {
  id: string;
  name: string;
  scorecardOverall: number | null;
  scorecardChange: Change | null;
  followThroughRate: number | null;
  followThroughChange: Change | null;
  openQuarterLabel: string | null;
  // The open quarter's end date has passed. Nothing breaks when it
  // does, but its priorities have stopped matching the period the
  // team is working, and across a caseload nobody would otherwise
  // notice.
  openQuarterLapsed: boolean;
  priorities: { onTrack: number; overdue: number } | null;
  // The last TEAM meeting and its facilitation score, never a call.
  lastMet: string | null;
  lastMetFacilitation: number | null;
  // The last coaching call, read on the caller's own client: RLS shows
  // it only to the company's coaches, so anyone else gets null.
  lastCoachingCall: string | null;
};

export async function loadCompanyRollups(
  companyIds: string[]
): Promise<CompanyRollup[]> {
  if (companyIds.length === 0) return [];
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  const now = Date.now();
  const ftrStart = new Date(
    now - (COMPARE_DAYS + FTR_WINDOW_DAYS) * DAY_MS
  ).toISOString();
  const todayIso = new Date(now).toISOString().slice(0, 10);
  const compareIso = new Date(now - COMPARE_DAYS * DAY_MS).toISOString();

  const [
    { data: companies },
    { data: quarters },
    { data: commitmentRows },
    { data: meetings },
    { data: calls },
    priorSnapshots,
  ] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", companyIds),
    supabase
      .from("quarters")
      // end_date so a LAPSED quarter can be told apart from a live
      // one. Across a caseload this is the only place a guide would
      // notice a company still carrying last quarter's priorities.
      .select("id, company_id, label, end_date")
      .in("company_id", companyIds)
      .eq("status", "open"),
    supabase
      .from("commitments")
      .select("company_id, status, completed_at, deleted_at, parked_at")
      .in("company_id", companyIds)
      .gte("completed_at", ftrStart),
    supabase
      .from("meetings")
      .select("id, company_id, created_at")
      .in("company_id", companyIds)
      // "Last meeting" is the last team meeting, never a coaching
      // call (0326).
      .eq("kind", "team")
      .eq("status", "complete")
      .order("created_at", { ascending: false }),
    supabase
      .from("meetings")
      .select("company_id, created_at")
      .in("company_id", companyIds)
      // The coaching column only: the date of the last call, nothing
      // of what was said. The caller's own client, so RLS decides.
      .eq("kind", "coaching")
      .neq("status", "failed")
      .order("created_at", { ascending: false }),
    loadOverallSnapshotsAsOf(companyIds, compareIso),
  ]);

  const nameById = new Map(
    ((companies ?? []) as Array<{ id: string; name: string }>).map(
      (c) => [c.id, c.name] as const
    )
  );
  const openQuarterByCompany = new Map<
    string,
    { id: string; label: string; lapsed: boolean }
  >();
  for (const q of (quarters ?? []) as Array<{
    id: string;
    company_id: string;
    label: string;
    end_date: string;
  }>) {
    openQuarterByCompany.set(q.company_id, {
      id: q.id,
      label: q.label,
      lapsed: q.end_date < todayIso,
    });
  }

  const openQuarterIds = Array.from(openQuarterByCompany.values()).map((q) => q.id);
  const { data: priorityRows } = openQuarterIds.length
    ? await supabase
        .from("priorities")
        .select("company_id, status, due_date, archived")
        .in("quarter_id", openQuarterIds)
    : { data: [] };
  const prioritiesByCompany = new Map<string, PriorityLite[]>();
  for (const p of (priorityRows ?? []) as Array<PriorityLite & { company_id: string }>) {
    const list = prioritiesByCompany.get(p.company_id) ?? [];
    list.push(p);
    prioritiesByCompany.set(p.company_id, list);
  }

  const ftrRowsByCompany = new Map<string, FtrRow[]>();
  for (const c of (commitmentRows ?? []) as Array<FtrRow & { company_id: string }>) {
    const list = ftrRowsByCompany.get(c.company_id) ?? [];
    list.push(c);
    ftrRowsByCompany.set(c.company_id, list);
  }

  const lastMeetingByCompany = new Map<string, { id: string; at: string }>();
  for (const m of (meetings ?? []) as Array<{
    id: string;
    company_id: string | null;
    created_at: string;
  }>) {
    if (!m.company_id || lastMeetingByCompany.has(m.company_id)) continue;
    lastMeetingByCompany.set(m.company_id, { id: m.id, at: m.created_at });
  }
  const lastCallByCompany = new Map<string, string>();
  for (const c of (calls ?? []) as Array<{ company_id: string | null; created_at: string }>) {
    if (!c.company_id || lastCallByCompany.has(c.company_id)) continue;
    lastCallByCompany.set(c.company_id, c.created_at);
  }

  const lastMeetingIds = Array.from(lastMeetingByCompany.values()).map((m) => m.id);
  const facilitationByMeeting = await loadFacilitationScores(supabase, lastMeetingIds);

  const rollups = await Promise.all(
    companyIds.map(async (cid) => {
      let scorecardOverall: number | null = null;
      let scorecardChange: Change | null = null;
      try {
        // Live scores only: this rollup has no use for history beyond
        // the one snapshot four weeks back.
        const sc = await loadCompanyScorecardScores(cid);
        scorecardOverall = sc.overall.score;
        const prior = priorSnapshots.get(cid);
        // Like for like, over the disciplines both points scored
        // (compareOverall): see the attention queue for why.
        const cmp = prior ? compareOverall(prior.scores, sc.disciplines) : null;
        scorecardChange = cmp ? changeBetween(cmp.then, cmp.now, 1) : null;
      } catch {
        scorecardOverall = null;
      }
      const ftr = ftrNowAndThen(ftrRowsByCompany.get(cid) ?? [], now);
      const quarter = openQuarterByCompany.get(cid);
      const lastMeeting = lastMeetingByCompany.get(cid);
      return {
        id: cid,
        name: nameById.get(cid) ?? "(unnamed)",
        scorecardOverall,
        scorecardChange,
        followThroughRate: ftr.now,
        followThroughChange: changeBetween(ftr.then, ftr.now),
        openQuarterLabel: quarter?.label ?? null,
        openQuarterLapsed: quarter?.lapsed ?? false,
        priorities: quarter
          ? priorityCounts(prioritiesByCompany.get(cid) ?? [], todayIso)
          : null,
        lastMet: lastMeeting?.at ?? null,
        lastMetFacilitation: lastMeeting
          ? facilitationByMeeting.get(lastMeeting.id) ?? null
          : null,
        lastCoachingCall: lastCallByCompany.get(cid) ?? null,
      };
    })
  );

  return rollups.sort((a, b) => a.name.localeCompare(b.name));
}

// The facilitation score each meeting shows on its own page
// (scoreForRow), rounded as the meetings list rounds it. Callers pass
// ids from a team-only read.
export async function loadFacilitationScores(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  meetingIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (meetingIds.length === 0) return out;
  // meetings-kind: ids from a team-only read by the caller.
  const { data } = await supabase
    .from("meeting_analyses")
    .select(
      "meeting_id, created_at, facilitation_review_json, score_positive_framing, score_rhythm, score_accountability, score_alignment, score_agenda, score_weights"
    )
    .in("meeting_id", meetingIds);
  for (const row of (data ?? []) as Array<
    StoredScoreRow & {
      meeting_id: string;
      facilitation_review_json: { insufficient_transcript?: boolean; overall?: number | null; rubric?: unknown } | null;
    }
  >) {
    const review = row.facilitation_review_json;
    const score = scoreForRow(
      row,
      review
        ? {
            insufficient_transcript: Boolean(review.insufficient_transcript),
            overall: review.overall ?? null,
            rubric: review.rubric,
          }
        : null
    );
    if (!score) continue;
    out.set(
      row.meeting_id,
      score.kind === "computed" ? score.score.rounded : Math.round(score.value)
    );
  }
  return out;
}

// Recent activity feed. Merges a small number of event kinds into a
// single chronological stream capped at ~6 items. Deliberately unfiltered
// and unpaginated per spec: the feed is a "what's changed in the last
// few days" ambient signal, not a full audit log.
export type RecentActivityItem =
  | {
      kind: "meeting_analyzed";
      when: string;
      companyId: string;
      companyName: string;
      meetingId: string;
      title: string;
    }
  | {
      kind: "facilitation_review";
      when: string;
      companyId: string;
      companyName: string;
      meetingId: string;
      overall: number | null;
      insufficient: boolean;
    }
  | {
      kind: "quarter_opened";
      when: string;
      companyId: string;
      companyName: string;
      quarterLabel: string;
    }
  | {
      kind: "quarter_closed";
      when: string;
      companyId: string;
      companyName: string;
      quarterLabel: string;
    };

const RECENT_LIMIT = 6;

export async function loadRecentActivity(
  companyIds: string[]
): Promise<RecentActivityItem[]> {
  if (companyIds.length === 0) return [];
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: companies }, { data: meetings }, { data: quarters }] =
    await Promise.all([
      supabase.from("companies").select("id, name").in("id", companyIds),
      supabase
        .from("meetings")
        .select("id, company_id, status, meeting_title, file_name, updated_at")
        .in("company_id", companyIds)
        // Team meetings only (0326).
        .eq("kind", "team")
        .eq("status", "complete")
        .gte("updated_at", since)
        .order("updated_at", { ascending: false })
        .limit(RECENT_LIMIT * 2),
      supabase
        .from("quarters")
        .select("id, company_id, label, status, updated_at, created_at")
        .in("company_id", companyIds)
        .gte("updated_at", since)
        .order("updated_at", { ascending: false })
        .limit(RECENT_LIMIT * 2),
    ]);

  const nameById = new Map(
    ((companies ?? []) as Array<{ id: string; name: string }>).map(
      (c) => [c.id, c.name] as const
    )
  );

  const meetingIds = ((meetings ?? []) as Array<{ id: string }>).map(
    (m) => m.id
  );
  const facilitationByMeeting = new Map<
    string,
    { overall: number | null; insufficient: boolean; when: string }
  >();
  if (meetingIds.length > 0) {
    // meeting_analyses has no updated_at: a reanalysis deletes the row
    // and writes a new one, so created_at is when the review was written.
    // meetings-kind: ids from the team-only read above.
    const { data: analyses, error: analysesErr } = await supabase
      .from("meeting_analyses")
      .select("meeting_id, facilitation_review_json, created_at")
      .in("meeting_id", meetingIds);
    if (analysesErr) {
      console.error("loadRecentActivity: analyses query failed", analysesErr);
    }
    for (const a of (analyses ?? []) as Array<{
      meeting_id: string;
      facilitation_review_json: {
        overall: number | null;
        insufficient_transcript: boolean;
      } | null;
      created_at: string;
    }>) {
      if (!a.facilitation_review_json) continue;
      facilitationByMeeting.set(a.meeting_id, {
        overall: a.facilitation_review_json.overall ?? null,
        insufficient:
          Boolean(a.facilitation_review_json.insufficient_transcript) ?? false,
        when: a.created_at,
      });
    }
  }

  const items: RecentActivityItem[] = [];

  for (const m of (meetings ?? []) as Array<{
    id: string;
    company_id: string | null;
    meeting_title: string | null;
    file_name: string;
    updated_at: string;
  }>) {
    if (!m.company_id) continue;
    const companyName = nameById.get(m.company_id) ?? "(unknown)";
    items.push({
      kind: "meeting_analyzed",
      when: m.updated_at,
      companyId: m.company_id,
      companyName,
      meetingId: m.id,
      title: m.meeting_title ?? m.file_name,
    });
    const fac = facilitationByMeeting.get(m.id);
    if (fac) {
      items.push({
        kind: "facilitation_review",
        when: fac.when,
        companyId: m.company_id,
        companyName,
        meetingId: m.id,
        overall: fac.overall,
        insufficient: fac.insufficient,
      });
    }
  }

  for (const q of (quarters ?? []) as Array<{
    company_id: string;
    label: string;
    status: string;
    updated_at: string;
    created_at: string;
  }>) {
    const companyName = nameById.get(q.company_id) ?? "(unknown)";
    if (q.status === "open") {
      items.push({
        kind: "quarter_opened",
        when: q.created_at,
        companyId: q.company_id,
        companyName,
        quarterLabel: q.label,
      });
    } else if (q.status === "closed") {
      items.push({
        kind: "quarter_closed",
        when: q.updated_at,
        companyId: q.company_id,
        companyName,
        quarterLabel: q.label,
      });
    }
  }

  return items
    .sort((a, b) => (a.when < b.when ? 1 : -1))
    .slice(0, RECENT_LIMIT);
}
