"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fridayOf } from "@/lib/dates";
import { trackAfter } from "@/lib/analytics/track";
import type { Commitment, Issue } from "@/lib/types";

// Routing actions for the meeting summary page. Called when the
// company has automatic_commitment_tracking OFF (the "review
// before adding" mode) and the reader wants to promote an
// extracted commitment or issue into the real system.
//
// Every action carries the meeting id so the created row is
// linked back to its source via source_meeting_id. This is what
// the "already added" done-state check keys off — if a row with
// this source + this text already exists, the button flips to
// a disabled done state rather than firing again.

export type RoutingResult =
  | { ok: true }
  | { ok: false; message: string };

// ---- Extracted issue → new issue in the open list -----------
export async function addExtractedIssueToOpenIssuesAction(
  meetingId: string,
  title: string
): Promise<RoutingResult> {
  const session = await requireProfile();
  const trimmed = title.trim();
  if (!trimmed) return { ok: false, message: "Issue title is empty." };
  if (trimmed.length > 200) {
    return { ok: false, message: "Issue title is too long." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, company_id")
    .eq("id", meetingId)
    .maybeSingle<{ id: string; company_id: string }>();
  if (!meeting) return { ok: false, message: "Meeting not found." };
  if (!isAdminForCompany(session.profile, meeting.company_id)) {
    // Same permission as other meeting-summary write actions —
    // only admins + guides can promote extractions into the
    // real system.
    return { ok: false, message: "Only admins and guides can add issues from a meeting." };
  }

  // Idempotency: if an issue with this exact title + source
  // meeting already exists, don't insert a second.
  const { data: existing } = await supabase
    .from("issues")
    .select("id")
    .eq("source_meeting_id", meetingId)
    .eq("title", trimmed)
    .maybeSingle<{ id: string }>();
  if (existing) {
    return { ok: true };
  }

  const { data: rankRow } = await supabase
    .from("issues")
    .select("rank")
    .eq("company_id", meeting.company_id)
    .eq("status", "open")
    .order("rank", { ascending: false })
    .limit(1)
    .maybeSingle<{ rank: number }>();
  const nextRank = (rankRow?.rank ?? -1) + 1;

  const { data, error } = await supabase
    .from("issues")
    .insert({
      company_id: meeting.company_id,
      title: trimmed,
      rank: nextRank,
      source_meeting_id: meetingId,
      created_by: session.profile.id,
    })
    .select("id")
    .single<Pick<Issue, "id">>();
  if (error || !data) {
    return { ok: false, message: "Couldn't add that issue." };
  }

  revalidatePath("/issues");
  revalidatePath(`/leadership/meetings/${meetingId}`);
  trackAfter(
    session.profile.id,
    "issue.added_from_meeting",
    {},
    { company: meeting.company_id }
  );
  return { ok: true };
}

// ---- Extracted issue → already-resolved issue --------------
// "Resolved in Meeting" shortcut on the meeting summary. Creates
// the issue row already closed — no desired outcome, no
// commitment, no owner. resolved_at is stamped so the resolved
// section of /issues shows it immediately with the meeting date
// as its close mark.
//
// Idempotent against source_meeting_id + title exactly like
// addExtractedIssueToOpenIssuesAction, so a double-click doesn't
// create twins. If the row already exists in an "open" state
// from a prior click, this path does NOT flip it to resolved —
// the two shortcuts are mutually exclusive by first click.
export async function addExtractedIssueAsResolvedAction(
  meetingId: string,
  title: string
): Promise<RoutingResult> {
  const session = await requireProfile();
  const trimmed = title.trim();
  if (!trimmed) return { ok: false, message: "Issue title is empty." };
  if (trimmed.length > 200) {
    return { ok: false, message: "Issue title is too long." };
  }

  const supabase = await createSupabaseServerClient();

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, company_id")
    .eq("id", meetingId)
    .maybeSingle<{ id: string; company_id: string }>();
  if (!meeting) return { ok: false, message: "Meeting not found." };
  if (!isAdminForCompany(session.profile, meeting.company_id)) {
    return {
      ok: false,
      message: "Only admins and guides can add issues from a meeting.",
    };
  }

  const { data: existing } = await supabase
    .from("issues")
    .select("id")
    .eq("source_meeting_id", meetingId)
    .eq("title", trimmed)
    .maybeSingle<{ id: string }>();
  if (existing) return { ok: true };

  // Resolved rows don't need a rank — the /issues page ranks the
  // open list, resolved sits in a separate table below. Still
  // set 0 so the not-null column has a value.
  const { error } = await supabase
    .from("issues")
    .insert({
      company_id: meeting.company_id,
      title: trimmed,
      rank: 0,
      status: "resolved",
      resolved_at: new Date().toISOString(),
      source_meeting_id: meetingId,
      created_by: session.profile.id,
    });
  if (error) return { ok: false, message: "Couldn't add that issue." };

  revalidatePath("/issues");
  revalidatePath(`/leadership/meetings/${meetingId}`);
  trackAfter(
    session.profile.id,
    "issue.resolved_from_meeting",
    {},
    { company: meeting.company_id }
  );
  return { ok: true };
}

// ---- Extracted commitment → commitment (with chosen link) ----
export type ExtractedCommitmentTarget =
  | { type: "priority"; id: string }
  | { type: "functional_area"; id: string }
  | { type: "none" };

export async function addExtractedCommitmentAction(input: {
  meetingId: string;
  description: string;
  dueDate: string | null;
  ownerId: string | null;
  target: ExtractedCommitmentTarget;
}): Promise<RoutingResult> {
  const session = await requireProfile();
  const description = input.description.trim();
  if (!description) return { ok: false, message: "Description is empty." };

  const supabase = await createSupabaseServerClient();

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, company_id, created_at")
    .eq("id", input.meetingId)
    .maybeSingle<{ id: string; company_id: string; created_at: string }>();
  if (!meeting) return { ok: false, message: "Meeting not found." };
  if (!isAdminForCompany(session.profile, meeting.company_id)) {
    return {
      ok: false,
      message: "Only admins and guides can add commitments from a meeting.",
    };
  }

  // Idempotency: same source meeting + same description = already
  // added. Prevents a stray double-click from creating twins.
  const { data: existing } = await supabase
    .from("commitments")
    .select("id")
    .eq("source_meeting_id", input.meetingId)
    .eq("description", description)
    .is("deleted_at", null)
    .maybeSingle<{ id: string }>();
  if (existing) return { ok: true };

  // Link validation: priority must belong to the same company +
  // open quarter; functional area must belong to same company.
  let priorityId: string | null = null;
  let functionalAreaId: string | null = null;
  if (input.target.type === "priority") {
    const { data: priority } = await supabase
      .from("priorities")
      .select("id, company_id, quarter_id")
      .eq("id", input.target.id)
      .maybeSingle<{ id: string; company_id: string; quarter_id: string }>();
    if (!priority || priority.company_id !== meeting.company_id) {
      return { ok: false, message: "That priority isn't in this company." };
    }
    const { data: quarter } = await supabase
      .from("quarters")
      .select("status")
      .eq("id", priority.quarter_id)
      .maybeSingle<{ status: string }>();
    if (quarter?.status !== "open") {
      return { ok: false, message: "Only open-quarter priorities can be linked." };
    }
    priorityId = input.target.id;
  } else if (input.target.type === "functional_area") {
    const { data: fn } = await supabase
      .from("functions")
      .select("id, company_id, archived")
      .eq("id", input.target.id)
      .maybeSingle<{ id: string; company_id: string; archived: boolean }>();
    if (!fn || fn.company_id !== meeting.company_id || fn.archived) {
      return { ok: false, message: "That functional area isn't accessible." };
    }
    functionalAreaId = input.target.id;
  }

  const dueDate = input.dueDate ?? meeting.created_at.slice(0, 10);
  const weekEnding = fridayOf(dueDate);
  const ownerId = input.ownerId ?? null;

  const { error } = await supabase.from("commitments").insert({
    company_id: meeting.company_id,
    priority_id: priorityId,
    functional_area_id: functionalAreaId,
    owner_id: ownerId,
    description,
    week_ending: weekEnding,
    due_date: dueDate,
    status: "open",
    source_meeting_id: input.meetingId,
  });
  if (error) return { ok: false, message: "Couldn't add that commitment." };

  revalidatePath("/commitments");
  revalidatePath(`/leadership/meetings/${input.meetingId}`);
  trackAfter(
    session.profile.id,
    "commitment.added_from_meeting",
    { link_type: input.target.type },
    { company: meeting.company_id }
  );
  return { ok: true };
}

// ---- Extracted commitment → new issue (not a commitment) ----
// "Convert to issue" on an extracted commitment. Creates an issue
// with title=description and does NOT create a commitment. Useful
// when the extraction was action-shaped but the underlying thing
// is really an unresolved question the team should sit with.
export async function convertExtractedCommitmentToIssueAction(
  meetingId: string,
  description: string
): Promise<RoutingResult> {
  const session = await requireProfile();
  const title = description.trim().slice(0, 200);
  if (!title) return { ok: false, message: "Description is empty." };

  const supabase = await createSupabaseServerClient();

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, company_id")
    .eq("id", meetingId)
    .maybeSingle<{ id: string; company_id: string }>();
  if (!meeting) return { ok: false, message: "Meeting not found." };
  if (!isAdminForCompany(session.profile, meeting.company_id)) {
    return {
      ok: false,
      message: "Only admins and guides can convert extractions to issues.",
    };
  }

  // Idempotency: same source + same title = already converted.
  const { data: existing } = await supabase
    .from("issues")
    .select("id")
    .eq("source_meeting_id", meetingId)
    .eq("title", title)
    .maybeSingle<{ id: string }>();
  if (existing) return { ok: true };

  const { data: rankRow } = await supabase
    .from("issues")
    .select("rank")
    .eq("company_id", meeting.company_id)
    .eq("status", "open")
    .order("rank", { ascending: false })
    .limit(1)
    .maybeSingle<{ rank: number }>();
  const nextRank = (rankRow?.rank ?? -1) + 1;

  const { error } = await supabase.from("issues").insert({
    company_id: meeting.company_id,
    title,
    rank: nextRank,
    source_meeting_id: meetingId,
    created_by: session.profile.id,
  });
  if (error) return { ok: false, message: "Couldn't create that issue." };

  revalidatePath("/issues");
  revalidatePath(`/leadership/meetings/${meetingId}`);
  trackAfter(
    session.profile.id,
    "issue.converted_from_extraction",
    {},
    { company: meeting.company_id }
  );
  return { ok: true };
}
