import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays } from "@/lib/dates";
import { ReadFailed } from "./reads";
import type { VisibleCompany } from "./company";

// MEETINGS FOR AI APPS (0327; Jason, 2026-11-18).
//
// list_meetings: a company's team meetings by date, with whether each
// analysis is ready to build from (complete and not cut off).
//
// get_meeting: one meeting. Everyone who can read it gets the summary,
// who was marked present, and the commitments it produced and the ones
// completed in the week before it. The transcript with speaker names,
// the facilitation review and the scores come back only for the
// company's assigned AiMS Coach or a system admin: the database
// decides (assistant_meeting_full returns them null for anyone else),
// and this file only reports which it was.
//
// Coaching calls never: both functions read kind = 'team' only.
//
// Every read is on the assistant's token, as the person; the two
// functions read as the caller. meetings.test.ts holds this file to
// the two functions and the two menu tables below.

type Ctx = { db: SupabaseClient; userId: string; company: VisibleCompany };

function must<T>(res: { data: T | null; error: { code?: string } | null }): T {
  if (res.error) throw new ReadFailed(res.error.code ?? "unknown");
  return (res.data ?? ([] as unknown)) as T;
}

type ListRow = {
  meeting_id: string;
  meeting_title: string | null;
  held_at: string;
  status: string;
  analysed_at: string | null;
  truncated: boolean;
  analysis_ready: boolean;
};

export type MeetingFilter = { from?: string; to?: string; since?: string; limit?: number };

export async function listMeetings({ db, company }: Ctx, f: MeetingFilter) {
  const rows = must(
    await db.rpc("assistant_meetings", {
      p_company_id: company.id,
      p_from: f.from ?? null,
      p_to: f.to ?? null,
      p_since: f.since ?? null,
      p_limit: f.limit ?? 20,
    })
  ) as ListRow[];
  return {
    company: company.name,
    meetings: rows.map((r) => ({
      id: r.meeting_id,
      title: r.meeting_title,
      held_on: r.held_at.slice(0, 10),
      status: r.status,
      analysed_at: r.analysed_at,
      analysis_ready: r.analysis_ready,
      analysis_state: analysisState(r),
    })),
  };
}

// One line a reader can act on. "ready" is the only state to build from.
export function analysisState(r: { status: string; analysed_at: string | null; truncated: boolean }): string {
  if (r.status === "pending" || r.status === "analyzing") return "in progress";
  if (r.status === "failed") return "failed";
  if (!r.analysed_at) return "not analysed";
  if (r.truncated) return "cut off: the summary stops early, ask the AiMS team to re-run it";
  return "ready";
}

export type StoredSpeaker = { label: string; name: string | null; confidence: string };

// "Speaker 3:" at the start of a turn becomes "Ashley Moore (Speaker 3):"
// when the analyzer was sure enough (high or medium), the same bar the
// summary uses. The label stays, so a reader can check it. Pure.
export function nameSpeakers(transcript: string, map: readonly StoredSpeaker[] | null): string {
  const named = new Map<string, string>();
  for (const s of map ?? []) {
    if (s.name && (s.confidence === "high" || s.confidence === "medium")) named.set(s.label.trim().toLowerCase(), s.name);
  }
  if (named.size === 0) return transcript;
  return transcript.replace(/^([ \t]*)(Speaker[ \t]+\d+)\b/gim, (whole, lead: string, label: string) => {
    const name = named.get(label.replace(/\s+/g, " ").toLowerCase());
    return name ? `${lead}${name} (${label})` : whole;
  });
}

type FullRow = ListRow & {
  summary: string | null;
  extracted_commitments: unknown;
  week_ending: string | null;
  attendees: unknown;
  full_access: boolean;
  transcript: string | null;
  speaker_map: unknown;
  facilitation_review: unknown;
  scores: unknown;
};

type CommitmentRow = {
  id: string;
  owner_id: string | null;
  description: string;
  due_date: string;
  status: string;
  completed_at: string | null;
};

export async function getMeeting({ db, company }: Ctx, meetingId: string) {
  const rows = must(
    await db.rpc("assistant_meeting_full", { p_company_id: company.id, p_meeting_id: meetingId })
  ) as FullRow[];
  const m = rows[0];
  if (!m) return { company: company.name, meeting: null, note: "No team meeting with that id in this company." };

  const heldOn = m.held_at.slice(0, 10);
  const weekBefore = addDays(heldOn, -7);
  const [made, completed, people] = await Promise.all([
    db
      .from("commitments")
      .select("id, owner_id, description, due_date, status, completed_at")
      .eq("company_id", company.id)
      .eq("source_meeting_id", m.meeting_id)
      .is("deleted_at", null)
      .order("due_date")
      .then((res) => must(res) as CommitmentRow[]),
    db
      .from("commitments")
      .select("id, owner_id, description, due_date, status, completed_at")
      .eq("company_id", company.id)
      .in("status", ["kept_on_time", "kept_late"])
      .gte("completed_at", weekBefore)
      .lte("completed_at", m.held_at)
      .is("deleted_at", null)
      .order("completed_at")
      .then((res) => must(res) as CommitmentRow[]),
    db
      .from("profiles")
      .select("id, full_name")
      .eq("company_id", company.id)
      .then((res) => must(res) as Array<{ id: string; full_name: string | null }>),
  ]);
  const names = new Map(people.map((p) => [p.id, p.full_name ?? "Unnamed"]));
  const shape = (c: CommitmentRow) => ({
    id: c.id,
    owner: c.owner_id ? names.get(c.owner_id) ?? null : null,
    description: c.description,
    due_date: c.due_date,
    status: c.status,
    completed_at: c.completed_at,
  });

  const speakers = Array.isArray(m.speaker_map) ? (m.speaker_map as StoredSpeaker[]) : null;
  const meeting = {
    id: m.meeting_id,
    title: m.meeting_title,
    held_on: heldOn,
    week_ending: m.week_ending,
    analysis_ready: m.analysis_ready,
    analysis_state: analysisState(m),
    summary: m.summary,
    attendees_marked_present: Array.isArray(m.attendees) ? m.attendees : [],
    commitments_made: made.map(shape),
    commitments_completed_in_the_week_before: completed.map(shape),
    full_access: m.full_access,
    ...(m.full_access
      ? {
          speakers: speakers
            ? speakers.map((s) => ({ label: s.label, name: s.name, confidence: s.confidence }))
            : null,
          speakers_note: speakers
            ? null
            : "Speaker names weren't recorded for this analysis. Labels in the transcript are as the recording gave them; a re-run of the analysis records them.",
          transcript: m.transcript === null ? null : nameSpeakers(m.transcript, speakers),
          facilitation_review: m.facilitation_review,
          scores: m.scores,
        }
      : {
          access_note:
            "The transcript, speaker names and facilitation review are for the company's AiMS Coach and AiMS system admins.",
        }),
  };
  return { company: company.name, meeting };
}

// ---- people ------------------------------------------------------------

// A company's people with their sign-in emails (0327; Jason,
// 2026-11-18). The database decides each email exactly as the person
// page does (profile_email, 0253): null where the caller couldn't see
// it in the app.
export async function companyPeople({ db, company }: Ctx) {
  const rows = must(await db.rpc("assistant_company_people", { p_company_id: company.id })) as Array<{
    profile_id: string;
    full_name: string | null;
    job_title: string | null;
    role: string;
    status: string;
    email: string | null;
  }>;
  return {
    company: company.name,
    people: rows.map((r) => ({
      id: r.profile_id,
      name: r.full_name,
      job_title: r.job_title,
      role: r.role,
      invited_not_yet_joined: r.status === "pending",
      email: r.email,
    })),
  };
}
