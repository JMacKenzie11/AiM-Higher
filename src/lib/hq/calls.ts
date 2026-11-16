import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { attendeesFromSummary } from "@/lib/transcripts/attendees";
import {
  DAY_MS,
  FTR_WINDOW_DAYS,
  followThroughLine,
  ftrInWindow,
  leftOffLines,
  oneSentenceSummary,
  overdueSince,
  sectionBody,
  sinceDate,
  type FtrRow,
  type PriorityLite,
} from "./derive";
import { loadFacilitationScores } from "./service";

// COACH HQ'S COACHING CALLS TAB: the call summaries list and the
// "Your next session with {company}" card.
//
// Every read is on the coach's own client, so RLS decides who sees a
// coaching call (meetings_select_coaching: the company's assigned
// coaches and its AiMS Champion). Coach HQ admits only aims_guide and
// system_admin, and lists only the caller's assigned companies, so in
// practice the reader is the company's coach. Nothing here is a model
// call: every sentence is cut from what the analysis already stored.

export type CallSummaryRow = {
  id: string;
  companyId: string;
  companyName: string;
  title: string;
  heldOn: string;
  analysing: boolean;
  sentence: string | null;
  // What the search box matches against: the title, the sentence and
  // the call's Purpose section, lower-cased.
  searchText: string;
};

const LIST_LIMIT = 100;

export async function loadCallSummaries(
  companies: ReadonlyArray<{ id: string; name: string }>
): Promise<CallSummaryRow[]> {
  if (companies.length === 0) return [];
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const nameOf = new Map(companies.map((c) => [c.id, c.name] as const));
  const { data: calls } = await db
    .from("meetings")
    .select("id, company_id, meeting_title, file_name, status, created_at")
    .in("company_id", companies.map((c) => c.id))
    // The coach's calls with their companies; failed and set-aside
    // ones are not calls to read.
    .eq("kind", "coaching")
    .in("status", ["pending", "analyzing", "complete"])
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  const rows = (calls ?? []) as Array<{
    id: string;
    company_id: string;
    meeting_title: string | null;
    file_name: string;
    status: string;
    created_at: string;
  }>;
  const done = rows.filter((r) => r.status === "complete").map((r) => r.id);
  const markdownById = new Map<string, string>();
  if (done.length > 0) {
    // meetings-kind: ids from the coaching-only read above, on the
    // coach's own client.
    const { data: analyses } = await db
      .from("meeting_analyses")
      .select("meeting_id, analysis_markdown")
      .in("meeting_id", done);
    for (const a of (analyses ?? []) as Array<{ meeting_id: string; analysis_markdown: string | null }>) {
      if (a.analysis_markdown) markdownById.set(a.meeting_id, a.analysis_markdown);
    }
  }
  return rows.map((r) => {
    const md = markdownById.get(r.id) ?? null;
    const title = r.meeting_title ?? r.file_name;
    const sentence = oneSentenceSummary(md);
    const purpose = md ? sectionBody(md, /^(?:Purpose of the Call|Summary|Purpose)\b/i) ?? "" : "";
    return {
      id: r.id,
      companyId: r.company_id,
      companyName: nameOf.get(r.company_id) ?? "",
      title,
      heldOn: r.created_at,
      analysing: r.status !== "complete",
      sentence,
      searchText: `${title} ${sentence ?? ""} ${purpose}`.toLowerCase().slice(0, 2000),
    };
  });
}

// ---- Your next session with {company} ---------------------------------

export type SinceTeamMeeting = {
  id: string;
  heldOn: string;
  commitments: number;
  issues: number;
  facilitation: number | null;
};

export type SessionCard = {
  companyId: string;
  companyName: string;
  lastCall: { id: string; title: string; heldOn: string; attendees: string[] } | null;
  since: { iso: string; fromCall: boolean };
  followThrough: { tone: "up" | "down" | "same"; text: string } | null;
  overdue: Array<{ id: string; title: string; dueDate: string }>;
  teamMeetings: SinceTeamMeeting[];
  newOpenIssues: number;
  leftOff: { kind: "decisions" | "summary"; lines: string[] } | null;
};

export async function loadSessionCard(company: { id: string; name: string }): Promise<SessionCard> {
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const nowMs = Date.now();
  const todayIso = new Date(nowMs).toISOString().slice(0, 10);

  const { data: call } = await db
    .from("meetings")
    .select("id, meeting_title, file_name, created_at")
    .eq("company_id", company.id)
    // The company's most recent coaching call that has been read.
    .eq("kind", "coaching")
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; meeting_title: string | null; file_name: string; created_at: string }>();

  let callMarkdown: string | null = null;
  if (call) {
    // meetings-kind: keyed by the coaching-call read above.
    const { data: analysis } = await db
      .from("meeting_analyses")
      .select("analysis_markdown")
      .eq("meeting_id", call.id)
      .maybeSingle<{ analysis_markdown: string | null }>();
    callMarkdown = analysis?.analysis_markdown ?? null;
  }

  const since = sinceDate(call?.created_at ?? null, nowMs);
  const sinceMs = Date.parse(since.iso);
  const ftrFrom = new Date(Math.min(sinceMs, nowMs) - FTR_WINDOW_DAYS * DAY_MS).toISOString();

  const [{ data: commitments }, { data: quarter }, { data: meetings }, { count: issueCount }] = await Promise.all([
    db
      .from("commitments")
      .select("status, completed_at, deleted_at, parked_at")
      .eq("company_id", company.id)
      .gte("completed_at", ftrFrom),
    db
      .from("quarters")
      .select("id")
      .eq("company_id", company.id)
      .eq("status", "open")
      .limit(1)
      .maybeSingle<{ id: string }>(),
    db
      .from("meetings")
      .select("id, created_at")
      .eq("company_id", company.id)
      // Team meetings held since the call, never another call.
      .eq("kind", "team")
      .eq("status", "complete")
      .gte("created_at", since.iso)
      .order("created_at", { ascending: false })
      .limit(6),
    db
      .from("issues")
      .select("id", { count: "exact", head: true })
      .eq("company_id", company.id)
      .eq("status", "open")
      .gte("created_at", since.iso),
  ]);

  const ftrRows = (commitments ?? []) as FtrRow[];
  const ftrThen = ftrInWindow(ftrRows, sinceMs - FTR_WINDOW_DAYS * DAY_MS, sinceMs);
  const ftrNow = ftrInWindow(ftrRows, nowMs - FTR_WINDOW_DAYS * DAY_MS, nowMs + 1);

  let overdue: SessionCard["overdue"] = [];
  if (quarter) {
    const { data: prios } = await db
      .from("priorities")
      .select("id, title, status, due_date, archived")
      .eq("quarter_id", quarter.id);
    overdue = overdueSince(
      (prios ?? []) as Array<PriorityLite & { id: string; title: string }>,
      since.iso,
      todayIso
    ).map((p) => ({ id: p.id, title: p.title, dueDate: p.due_date as string }));
  }

  const teamRows = (meetings ?? []) as Array<{ id: string; created_at: string }>;
  const teamIds = teamRows.map((m) => m.id);
  const counts = new Map<string, { commitments: number; issues: number }>();
  if (teamIds.length > 0) {
    // meetings-kind: ids from the team-only read above.
    const { data: analyses } = await db
      .from("meeting_analyses")
      .select("meeting_id, commitments_json, issues_json")
      .in("meeting_id", teamIds);
    for (const a of (analyses ?? []) as Array<{
      meeting_id: string;
      commitments_json: unknown[] | null;
      issues_json: unknown[] | null;
    }>) {
      counts.set(a.meeting_id, {
        commitments: Array.isArray(a.commitments_json) ? a.commitments_json.length : 0,
        issues: Array.isArray(a.issues_json) ? a.issues_json.length : 0,
      });
    }
  }
  const scores = await loadFacilitationScores(db, teamIds);

  return {
    companyId: company.id,
    companyName: company.name,
    lastCall: call
      ? {
          id: call.id,
          title: call.meeting_title ?? call.file_name,
          heldOn: call.created_at,
          attendees: callMarkdown ? attendeesFromSummary(callMarkdown).slice(0, 4) : [],
        }
      : null,
    since,
    followThrough: followThroughLine(ftrThen, ftrNow),
    overdue,
    teamMeetings: teamRows.map((m) => ({
      id: m.id,
      heldOn: m.created_at,
      commitments: counts.get(m.id)?.commitments ?? 0,
      issues: counts.get(m.id)?.issues ?? 0,
      facilitation: scores.get(m.id) ?? null,
    })),
    newOpenIssues: issueCount ?? 0,
    leftOff: leftOffLines(callMarkdown),
  };
}
