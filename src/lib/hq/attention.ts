import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  loadCompanyScorecardScores,
  loadLatestOverallSnapshots,
} from "@/lib/maturity/service";
import type { FacilitationReview } from "@/lib/leadership/facilitation/types";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Guide HQ attention queue. Computes, for a caseload of companies,
// which ones deserve the guide's focus this week and why. Each
// trigger carries the numbers the reason line will render — the UI
// never re-derives them so the "why is this company here" is
// verifiable at a glance.
//
// Not paginated. Ranked by severity (weighted trigger count),
// tiebroken alphabetically for stability.

// Threshold constants — single source of truth. Adjust here to
// tune the whole platform's attention behavior.
export const FTR_THRESHOLD = 60;
export const FACILITATION_LOW_THRESHOLD = 5;
export const PRIORITY_OVERDUE_DAYS = 14;
export const FTR_WINDOW_DAYS = 30;

export type AttentionTrigger =
  | {
      kind: "scorecard_dropped";
      from: number;
      to: number;
      priorDate: string;
    }
  | { kind: "ftr_low"; rate: number; threshold: number }
  | { kind: "ftr_declining"; from: number; to: number }
  | { kind: "facilitation_low"; overall: number; meetingId: string }
  | { kind: "facilitation_insufficient"; meetingId: string }
  | { kind: "priority_overdue"; count: number; oldestDays: number }
  | { kind: "unrouted_transcript"; count: number };

export type CompanyAttention = {
  companyId: string;
  companyName: string;
  triggers: AttentionTrigger[];
  severity: number;
};

const SEVERITY_WEIGHT: Record<AttentionTrigger["kind"], number> = {
  scorecard_dropped: 4,
  ftr_low: 3,
  facilitation_low: 3,
  ftr_declining: 2,
  facilitation_insufficient: 2,
  priority_overdue: 2,
  unrouted_transcript: 1,
};

function severityOf(triggers: AttentionTrigger[]): number {
  return triggers.reduce((sum, t) => sum + SEVERITY_WEIGHT[t.kind], 0);
}

// Human-facing reason for a single trigger. Rendered as one line
// per trigger in the Needs-your-attention list.
export function reasonPhrase(trigger: AttentionTrigger): string {
  switch (trigger.kind) {
    case "scorecard_dropped":
      return `Scorecard overall dropped ${trigger.from} to ${trigger.to} since ${trigger.priorDate}`;
    case "ftr_low":
      return `Follow-Through Rate ${trigger.rate}% (below ${trigger.threshold}%)`;
    case "ftr_declining":
      return `Follow-Through Rate trending down (${trigger.from}% to ${trigger.to}%)`;
    case "facilitation_low":
      return `Latest facilitation review scored ${trigger.overall}/10`;
    case "facilitation_insufficient":
      return "Latest meeting transcript wasn't scoreable for facilitation";
    case "priority_overdue": {
      const noun = trigger.count === 1 ? "priority" : "priorities";
      return `${trigger.count} ${noun} more than ${PRIORITY_OVERDUE_DAYS} days past due (oldest: ${trigger.oldestDays} days)`;
    }
    case "unrouted_transcript": {
      const noun = trigger.count === 1 ? "transcript" : "transcripts";
      return `${trigger.count} unrouted ${noun} matching this company's alias`;
    }
  }
}

type CommitmentRow = {
  company_id: string;
  status: string;
  completed_at: string | null;
  deleted_at: string | null;
  parked_at: string | null;
};

type PriorityRow = {
  company_id: string;
  due_date: string | null;
  status: string;
  archived: boolean;
};

type MeetingRow = {
  id: string;
  company_id: string | null;
};

type AnalysisRow = {
  meeting_id: string;
  facilitation_review_json: FacilitationReview | null;
};

type AliasRow = { company_id: string; alias: string };

// Batches every non-per-company query; the scorecard delta has to run
// per-company because loadCompanyScorecard is a per-tenant live
// compute. Caseloads are typically single-digit, so N sequential
// calls (via Promise.all) is fine.
export async function computeAttentionForCompanies(
  companyIds: string[]
): Promise<CompanyAttention[]> {
  if (companyIds.length === 0) return [];

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const ftrPriorWindowStart = new Date(
    now - 2 * FTR_WINDOW_DAYS * DAY
  ).toISOString();
  const priorityCutoff = new Date(now - PRIORITY_OVERDUE_DAYS * DAY)
    .toISOString()
    .slice(0, 10);

  const [
    { data: companies },
    { data: commitmentRows },
    { data: openQuarters },
    { data: meetings },
    { data: aliases },
    { data: unrouted },
  ] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", companyIds),
    supabase
      .from("commitments")
      .select("company_id, status, completed_at, deleted_at, parked_at")
      .in("company_id", companyIds)
      .gte("completed_at", ftrPriorWindowStart),
    supabase
      .from("quarters")
      .select("id, company_id")
      .in("company_id", companyIds)
      .eq("status", "open"),
    supabase
      .from("meetings")
      .select("id, company_id")
      .in("company_id", companyIds)
      .eq("status", "complete")
      .order("created_at", { ascending: false }),
    supabase
      .from("transcript_aliases")
      .select("company_id, alias")
      .in("company_id", companyIds),
    supabase
      .from("meetings")
      .select("file_name")
      .eq("status", "unrouted"),
  ]);

  const nameById = new Map(
    ((companies ?? []) as Array<{ id: string; name: string }>).map(
      (c) => [c.id, c.name] as const
    )
  );

  // ---- FTR now vs prior window ----
  const ftrNow = new Map<
    string,
    { kept_on_time: number; kept_late: number; missed: number }
  >();
  const ftrPrior = new Map<
    string,
    { kept_on_time: number; kept_late: number; missed: number }
  >();
  for (const c of (commitmentRows ?? []) as CommitmentRow[]) {
    if (c.deleted_at || c.parked_at) continue;
    if (!c.completed_at) continue;
    if (c.status === "open") continue;
    const compTs = new Date(c.completed_at).getTime();
    const bucket = compTs >= now - FTR_WINDOW_DAYS * DAY ? ftrNow : ftrPrior;
    const stats = bucket.get(c.company_id) ?? {
      kept_on_time: 0,
      kept_late: 0,
      missed: 0,
    };
    if (c.status === "kept_on_time") stats.kept_on_time += 1;
    else if (c.status === "kept_late") stats.kept_late += 1;
    else if (c.status === "missed") stats.missed += 1;
    bucket.set(c.company_id, stats);
  }
  const ftrPct = (
    s:
      | { kept_on_time: number; kept_late: number; missed: number }
      | undefined
  ): number | null => {
    if (!s) return null;
    const denom = s.kept_on_time + s.kept_late + s.missed;
    if (denom === 0) return null;
    return Math.round((s.kept_on_time / denom) * 100);
  };

  // ---- Priorities more than N days past due, in open quarter ----
  const openQuarterIds = ((openQuarters ?? []) as Array<{ id: string }>).map(
    (q) => q.id
  );
  const overdueByCompany = new Map<
    string,
    { count: number; oldestDays: number }
  >();
  if (openQuarterIds.length > 0) {
    const { data: prios } = await supabase
      .from("priorities")
      .select("company_id, due_date, status, archived")
      .in("quarter_id", openQuarterIds)
      .lt("due_date", priorityCutoff)
      .not("status", "eq", "complete");
    for (const p of (prios ?? []) as PriorityRow[]) {
      if (p.archived) continue;
      if (!p.due_date) continue;
      const daysPast = Math.floor(
        (now - new Date(p.due_date).getTime()) / DAY
      );
      const cur = overdueByCompany.get(p.company_id) ?? {
        count: 0,
        oldestDays: 0,
      };
      cur.count += 1;
      cur.oldestDays = Math.max(cur.oldestDays, daysPast);
      overdueByCompany.set(p.company_id, cur);
    }
  }

  // ---- Most-recent completed meeting per company + its review ----
  const latestMeetingByCompany = new Map<string, string>();
  for (const m of (meetings ?? []) as MeetingRow[]) {
    if (!m.company_id) continue;
    if (latestMeetingByCompany.has(m.company_id)) continue;
    latestMeetingByCompany.set(m.company_id, m.id);
  }
  const latestMeetingIds = Array.from(latestMeetingByCompany.values());
  const facilitationByMeeting = new Map<string, FacilitationReview | null>();
  if (latestMeetingIds.length > 0) {
    const { data: analyses } = await supabase
      .from("meeting_analyses")
      .select("meeting_id, facilitation_review_json")
      .in("meeting_id", latestMeetingIds);
    for (const a of (analyses ?? []) as AnalysisRow[]) {
      facilitationByMeeting.set(
        a.meeting_id,
        a.facilitation_review_json ?? null
      );
    }
  }

  // ---- Unrouted transcripts matching this company's aliases ----
  const aliasesByCompany = new Map<string, string[]>();
  for (const a of (aliases ?? []) as AliasRow[]) {
    const list = aliasesByCompany.get(a.company_id) ?? [];
    list.push(a.alias.toLowerCase());
    aliasesByCompany.set(a.company_id, list);
  }
  const unroutedByCompany = new Map<string, number>();
  if (aliasesByCompany.size > 0) {
    for (const m of (unrouted ?? []) as Array<{ file_name: string }>) {
      const lower = m.file_name.toLowerCase();
      for (const [cid, patterns] of aliasesByCompany.entries()) {
        if (patterns.some((p) => lower.includes(p))) {
          unroutedByCompany.set(
            cid,
            (unroutedByCompany.get(cid) ?? 0) + 1
          );
        }
      }
    }
  }

  // ---- Scorecard delta — live score vs the last snapshot ----
  // The prior snapshots come from ONE query for the whole caseload
  // rather than a full scorecard load per company, which used to drag
  // 26 weeks of every discipline's history along for a single number.
  const priorByCompany = await loadLatestOverallSnapshots(companyIds);
  const scorecardDeltas = await Promise.all(
    companyIds.map(async (cid) => {
      try {
        const sc = await loadCompanyScorecardScores(cid);
        const currentScore = sc.overall.score;
        if (currentScore === null) return { cid, drop: null };
        const priorSnap = priorByCompany.get(cid);
        if (!priorSnap || priorSnap.score === null) {
          return { cid, drop: null };
        }
        if (currentScore < priorSnap.score) {
          return {
            cid,
            drop: {
              from: priorSnap.score,
              to: currentScore,
              priorDate: priorSnap.date,
            },
          };
        }
        return { cid, drop: null };
      } catch {
        return { cid, drop: null };
      }
    })
  );
  const dropByCompany = new Map(
    scorecardDeltas.map((d) => [d.cid, d.drop] as const)
  );

  // ---- Assemble ----
  const out: CompanyAttention[] = [];
  for (const cid of companyIds) {
    const triggers: AttentionTrigger[] = [];

    const drop = dropByCompany.get(cid);
    if (drop) {
      triggers.push({
        kind: "scorecard_dropped",
        from: drop.from,
        to: drop.to,
        priorDate: drop.priorDate,
      });
    }

    const ftrNowPct = ftrPct(ftrNow.get(cid));
    const ftrPriorPct = ftrPct(ftrPrior.get(cid));
    if (ftrNowPct !== null && ftrNowPct < FTR_THRESHOLD) {
      triggers.push({
        kind: "ftr_low",
        rate: ftrNowPct,
        threshold: FTR_THRESHOLD,
      });
    } else if (
      ftrNowPct !== null &&
      ftrPriorPct !== null &&
      ftrNowPct < ftrPriorPct
    ) {
      triggers.push({
        kind: "ftr_declining",
        from: ftrPriorPct,
        to: ftrNowPct,
      });
    }

    const latestMeetingId = latestMeetingByCompany.get(cid);
    if (latestMeetingId) {
      const review = facilitationByMeeting.get(latestMeetingId);
      if (review) {
        if (review.insufficient_transcript) {
          triggers.push({
            kind: "facilitation_insufficient",
            meetingId: latestMeetingId,
          });
        } else if (
          typeof review.overall === "number" &&
          review.overall < FACILITATION_LOW_THRESHOLD
        ) {
          triggers.push({
            kind: "facilitation_low",
            overall: review.overall,
            meetingId: latestMeetingId,
          });
        }
      }
    }

    const overdue = overdueByCompany.get(cid);
    if (overdue) {
      triggers.push({
        kind: "priority_overdue",
        count: overdue.count,
        oldestDays: overdue.oldestDays,
      });
    }

    const unroutedCount = unroutedByCompany.get(cid);
    if (unroutedCount && unroutedCount > 0) {
      triggers.push({
        kind: "unrouted_transcript",
        count: unroutedCount,
      });
    }

    if (triggers.length === 0) continue;
    out.push({
      companyId: cid,
      companyName: nameById.get(cid) ?? "(unknown)",
      triggers,
      severity: severityOf(triggers),
    });
  }

  out.sort(
    (a, b) =>
      b.severity - a.severity || a.companyName.localeCompare(b.companyName)
  );
  return out;
}

// Count of the caller's assigned companies currently on the attention
// queue. Powers the "Attention" column on the sysadmin Guides panel.
// The caller passes assigned company IDs so we don't re-query the
// assignment table here.
export async function countCompaniesInAttention(
  companyIds: string[]
): Promise<number> {
  const rows = await computeAttentionForCompanies(companyIds);
  return rows.length;
}
