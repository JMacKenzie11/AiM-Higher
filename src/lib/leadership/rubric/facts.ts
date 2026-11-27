import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { addDays, fridayOf } from "@/lib/dates";
import { meetingDateIn } from "@/lib/transcripts/due-phrase";
import { loadHeadlineFunctions } from "@/lib/transcripts/headlines";
import { computeStatus } from "@/lib/measures/board";
import { isDueForWeek } from "@/lib/measures/frequency";
import { targetInForce, type TargetHistoryRow } from "@/lib/measures/target-history";
import type { UpdateFrequency } from "@/lib/types";
import { DATE_RULE } from "./rubric";
import type { RubricFacts } from "./types";

type Admin = Awaited<ReturnType<typeof createSupabaseAdminClient>>;

// THE MEETING'S FACTS, FROM AIMS HQ. Everything the rubric can check
// without reading the conversation: which goals and commitments
// the meeting had to review, which measures were due and in, and which
// areas sent a headline ahead. Reads only.
//
// THE MEETING'S DATE is its row's created_at in the company's
// timezone: when the transcript arrived, usually the meeting's own day.
//
// LAST WEEK'S COMMITMENTS are those due after the company's previous
// team meeting and up to this one, made before this one. With no
// previous meeting on record, the seven days before.
//
// THE NUMBERS REVIEWED are the week that last closed: the Friday on or
// before the meeting.

export type NewCommitmentRow = {
  owner_id: string | null;
  priority_id: string | null;
  due_date_defaulted: boolean;
  description: string;
};

export async function loadRubricFacts(
  admin: Admin,
  args: {
    meetingId: string;
    companyId: string;
    createdAt: string;
    timezone: string;
    // This meeting's commitments, from the extraction in hand. Read from
    // the commitments it created when not given (the eval).
    newCommitments?: NewCommitmentRow[];
    issuesRaised?: number;
  }
): Promise<RubricFacts> {
  const meetingDate = meetingDateIn(args.createdAt, args.timezone);

  const [goals, prior, fresh, measures, areas, issues] = await Promise.all([
    loadGoals(admin, args.companyId, meetingDate),
    loadPriorCommitments(admin, args, meetingDate),
    args.newCommitments ? Promise.resolve(args.newCommitments) : loadNewCommitments(admin, args.meetingId),
    loadMeasures(admin, args.companyId, meetingDate),
    loadAreas(admin, args.companyId, args.createdAt, fridayOf(meetingDate)),
    args.issuesRaised !== undefined ? Promise.resolve(args.issuesRaised) : loadIssueCount(admin, args.meetingId),
  ]);

  return {
    goals,
    priorCommitments: prior,
    newCommitments: fresh.map((c) => ({
      description: c.description,
      hasOwner: c.owner_id !== null,
      dateNamed: !c.due_date_defaulted || DATE_RULE.nextMeetingCountsAsDate,
      linkedToPriority: c.priority_id !== null,
    })),
    measures,
    headlineAreas: areas,
    issuesRaised: issues,
  };
}

// The goals over this quarter's live priorities (see RubricFacts.goals).
async function loadGoals(admin: Admin, companyId: string, meetingDate: string) {
  const { data: quarter } = await admin
    .from("quarters")
    .select("id")
    .eq("company_id", companyId)
    .lte("start_date", meetingDate)
    .gte("end_date", meetingDate)
    .maybeSingle<{ id: string }>();
  if (!quarter) return [];
  const { data } = await admin
    .from("priorities")
    .select("annual_goal_id, sfa_id")
    .eq("company_id", companyId)
    .eq("quarter_id", quarter.id)
    .eq("archived", false)
    .neq("status", "complete");
  const rows = (data ?? []) as Array<{ annual_goal_id: string | null; sfa_id: string | null }>;
  const goalIds = [...new Set(rows.map((r) => r.annual_goal_id).filter((id): id is string => !!id))];
  const areaIds = [...new Set(rows.filter((r) => !r.annual_goal_id).map((r) => r.sfa_id).filter((id): id is string => !!id))];
  const [goals, areas] = await Promise.all([
    goalIds.length ? admin.from("annual_goals").select("id, title").in("id", goalIds) : Promise.resolve({ data: [] }),
    areaIds.length ? admin.from("strategic_focus_areas").select("id, title").in("id", areaIds) : Promise.resolve({ data: [] }),
  ]);
  return [...((goals.data ?? []) as Array<{ id: string; title: string }>), ...((areas.data ?? []) as Array<{ id: string; title: string }>)].map(
    (g) => ({ id: g.id, title: g.title })
  );
}

async function loadPriorCommitments(
  admin: Admin,
  args: { meetingId: string; companyId: string; createdAt: string },
  meetingDate: string
) {
  const { data: prev } = await admin
    .from("meetings")
    .select("created_at")
    .eq("company_id", args.companyId)
    .eq("kind", "team")
    .lt("created_at", args.createdAt)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string }>();
  const from = prev ? prev.created_at.slice(0, 10) : addDays(meetingDate, -7);
  const { data } = await admin
    .from("commitments")
    .select("id, description, owner_id, priority_id, source_meeting_id, created_at")
    .eq("company_id", args.companyId)
    .gt("due_date", from)
    .lte("due_date", meetingDate)
    .lt("created_at", args.createdAt);
  const rows = ((data ?? []) as Array<{
    id: string;
    description: string;
    owner_id: string | null;
    priority_id: string | null;
    source_meeting_id: string | null;
  }>).filter((c) => c.source_meeting_id !== args.meetingId);
  const ownerIds = [...new Set(rows.map((r) => r.owner_id).filter((id): id is string => !!id))];
  const names = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: people } = await admin.from("profiles").select("id, full_name").in("id", ownerIds);
    for (const p of (people ?? []) as Array<{ id: string; full_name: string }>) names.set(p.id, p.full_name);
  }
  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    owner: r.owner_id ? names.get(r.owner_id) ?? null : null,
    linkedToPriority: r.priority_id !== null,
  }));
}

async function loadNewCommitments(admin: Admin, meetingId: string): Promise<NewCommitmentRow[]> {
  const { data } = await admin
    .from("commitments")
    .select("owner_id, priority_id, due_date_defaulted, description")
    .eq("source_meeting_id", meetingId);
  return (data ?? []) as NewCommitmentRow[];
}

async function loadIssueCount(admin: Admin, meetingId: string): Promise<number> {
  // meetings-kind: keyed by the one meeting being scored, a team meeting.
  const { data } = await admin
    .from("meeting_analyses")
    .select("issues_json")
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ issues_json: unknown }>();
  return Array.isArray(data?.issues_json) ? data.issues_json.length : 0;
}

// Measures due for the week that last closed, each updated or not and
// on or off track. Null when the company keeps no measures.
async function loadMeasures(admin: Admin, companyId: string, meetingDate: string) {
  const fri = fridayOf(meetingDate);
  const week = fri === meetingDate ? fri : addDays(fri, -7);
  const { data: fns } = await admin
    .from("functions")
    .select("id")
    .eq("company_id", companyId)
    .eq("archived", false);
  const fnIds = ((fns ?? []) as Array<{ id: string }>).map((f) => f.id);
  if (fnIds.length === 0) return null;
  const { data: ms } = await admin
    .from("success_measures")
    .select("id, description, update_frequency, created_at")
    .in("function_id", fnIds)
    .eq("archived", false);
  const measures = (ms ?? []) as Array<{
    id: string;
    description: string;
    update_frequency: UpdateFrequency | null;
    created_at: string;
  }>;
  if (measures.length === 0) return null;
  const ids = measures.map((m) => m.id);
  const [{ data: targets }, { data: entries }] = await Promise.all([
    admin
      .from("success_measure_targets")
      .select("measure_id, target, value_type, target_direction, effective_from")
      .in("measure_id", ids),
    admin
      .from("success_measure_entries")
      .select("measure_id, value_number, value_text")
      .in("measure_id", ids)
      .eq("week_ending", week),
  ]);
  const entryBy = new Map(
    ((entries ?? []) as Array<{ measure_id: string; value_number: number | null; value_text: string | null }>).map(
      (e) => [e.measure_id, { number: e.value_number, text: e.value_text }]
    )
  );
  const targetRows = (targets ?? []) as TargetHistoryRow[];
  const out: NonNullable<RubricFacts["measures"]> = [];
  for (const m of measures) {
    const entry = entryBy.get(m.id) ?? null;
    const due = isDueForWeek({
      frequency: m.update_frequency ?? "weekly",
      weekEndingFriday: week,
      anchorFriday: fridayOf(m.created_at.slice(0, 10)),
    });
    if (!due && !entry) continue;
    const t = targetInForce(
      targetRows.filter((r) => r.measure_id === m.id),
      week
    );
    const status = t
      ? computeStatus({ target: t.target, valueType: t.valueType, direction: t.targetDirection }, entry)
      : entry
        ? "no_target"
        : "unlogged";
    out.push({ id: m.id, name: m.description, updated: entry !== null, offTrack: status === "off" });
  }
  return out;
}

async function loadAreas(admin: Admin, companyId: string, createdAt: string, weekEnding: string) {
  const fns = await loadHeadlineFunctions(admin, companyId);
  if (fns.length === 0) return [];
  const { data } = await admin
    .from("meeting_headlines")
    .select("function_id, body, created_at, source_meeting_id")
    .eq("company_id", companyId)
    .eq("week_ending", weekEnding);
  const ahead = new Set(
    ((data ?? []) as Array<{ function_id: string; body: string; created_at: string; source_meeting_id: string | null }>)
      .filter((h) => h.body.trim() !== "" && h.source_meeting_id === null && h.created_at < createdAt)
      .map((h) => h.function_id)
  );
  return fns.map((f) => ({ id: f.id, title: f.title, sentAhead: ahead.has(f.id) }));
}
