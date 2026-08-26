import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadCompanyScorecard } from "@/lib/maturity/service";
import type {
  Commitment,
  Priority,
  Profile,
  Quarter,
} from "@/lib/types";
import type { CommitmentWithMeta } from "@/lib/commitments/service";

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
  const supabase = await createSupabaseServerClient();
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
  const supabase = await createSupabaseServerClient();

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

// Per-company summary row for the "Your companies" section. Reads a
// small fixed set of numbers per company; scorecard is a live compute
// so this scales with N (single-digit for a typical caseload).
export type CompanyRollup = {
  id: string;
  name: string;
  scorecardOverall: number | null;
  followThroughRate: number | null;
  openQuarterLabel: string | null;
  lastMet: string | null;
};

export async function loadCompanyRollups(
  companyIds: string[]
): Promise<CompanyRollup[]> {
  if (companyIds.length === 0) return [];
  const supabase = await createSupabaseServerClient();

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const ftrStart = new Date(now - 30 * DAY).toISOString();

  const [
    { data: companies },
    { data: quarters },
    { data: commitmentRows },
    { data: meetings },
  ] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", companyIds),
    supabase
      .from("quarters")
      .select("id, company_id, label")
      .in("company_id", companyIds)
      .eq("status", "open"),
    supabase
      .from("commitments")
      .select("company_id, status, completed_at, deleted_at, parked_at")
      .in("company_id", companyIds)
      .gte("completed_at", ftrStart),
    supabase
      .from("meetings")
      .select("company_id, created_at")
      .in("company_id", companyIds)
      .eq("status", "complete")
      .order("created_at", { ascending: false }),
  ]);

  const nameById = new Map(
    ((companies ?? []) as Array<{ id: string; name: string }>).map(
      (c) => [c.id, c.name] as const
    )
  );
  const openQuarterByCompany = new Map<string, Pick<Quarter, "label">>();
  for (const q of (quarters ?? []) as Array<{
    company_id: string;
    label: string;
  }>) {
    openQuarterByCompany.set(q.company_id, { label: q.label });
  }

  const ftrTallies = new Map<
    string,
    { kept_on_time: number; kept_late: number; missed: number }
  >();
  for (const c of (commitmentRows ?? []) as Array<{
    company_id: string;
    status: string;
    completed_at: string | null;
    deleted_at: string | null;
    parked_at: string | null;
  }>) {
    if (c.deleted_at || c.parked_at || !c.completed_at) continue;
    if (c.status === "open") continue;
    const s = ftrTallies.get(c.company_id) ?? {
      kept_on_time: 0,
      kept_late: 0,
      missed: 0,
    };
    if (c.status === "kept_on_time") s.kept_on_time += 1;
    else if (c.status === "kept_late") s.kept_late += 1;
    else if (c.status === "missed") s.missed += 1;
    ftrTallies.set(c.company_id, s);
  }

  const lastMetByCompany = new Map<string, string>();
  for (const m of (meetings ?? []) as Array<{
    company_id: string | null;
    created_at: string;
  }>) {
    if (!m.company_id) continue;
    if (lastMetByCompany.has(m.company_id)) continue;
    lastMetByCompany.set(m.company_id, m.created_at);
  }

  const rollups = await Promise.all(
    companyIds.map(async (cid) => {
      let scorecardOverall: number | null = null;
      try {
        const sc = await loadCompanyScorecard(cid);
        scorecardOverall = sc.overall.score;
      } catch {
        scorecardOverall = null;
      }
      const t = ftrTallies.get(cid);
      const denom = t
        ? t.kept_on_time + t.kept_late + t.missed
        : 0;
      const ftr =
        t && denom > 0 ? Math.round((t.kept_on_time / denom) * 100) : null;
      return {
        id: cid,
        name: nameById.get(cid) ?? "(unnamed)",
        scorecardOverall,
        followThroughRate: ftr,
        openQuarterLabel: openQuarterByCompany.get(cid)?.label ?? null,
        lastMet: lastMetByCompany.get(cid) ?? null,
      };
    })
  );

  return rollups.sort((a, b) => a.name.localeCompare(b.name));
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
  const supabase = await createSupabaseServerClient();

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: companies }, { data: meetings }, { data: quarters }] =
    await Promise.all([
      supabase.from("companies").select("id, name").in("id", companyIds),
      supabase
        .from("meetings")
        .select("id, company_id, status, meeting_title, file_name, updated_at")
        .in("company_id", companyIds)
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
    const { data: analyses } = await supabase
      .from("meeting_analyses")
      .select("meeting_id, facilitation_review_json, updated_at")
      .in("meeting_id", meetingIds);
    for (const a of (analyses ?? []) as Array<{
      meeting_id: string;
      facilitation_review_json: {
        overall: number | null;
        insufficient_transcript: boolean;
      } | null;
      updated_at: string;
    }>) {
      if (!a.facilitation_review_json) continue;
      facilitationByMeeting.set(a.meeting_id, {
        overall: a.facilitation_review_json.overall ?? null,
        insufficient:
          Boolean(a.facilitation_review_json.insufficient_transcript) ?? false,
        when: a.updated_at,
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
