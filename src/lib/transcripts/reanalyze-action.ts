"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { processPendingMeetings } from "@/lib/transcripts/ingest";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { canManageCompanyMeetings, canRetryFailedMeeting } from "./retry";

// Reanalyze: regenerate a meeting's analysis from scratch.
//
// ---- IT NO LONGER TOUCHES ANYBODY'S WORK ------------------------
//
// It used to hard-delete every commitment and issue the meeting had
// created, and their weekly history with them (commitment_occurrences
// cascades), then recreate a fresh open set with new ids. On a meeting
// whose commitments were live, that erased completions, rescheduled
// dates, reassignments and reworded descriptions underneath the people
// working from them. Jason closed it on 2026-09-25, before any
// production re-analysis of Benson.
//
// Now it is refused outright for any meeting with a commitment or an
// issue sourced from it, soft-deleted ones included, and it deletes
// neither: with none present there is nothing to delete, which makes
// "it cannot destroy work" structural rather than a check that could
// drift. It still suits the case it exists for, a meeting whose
// analysis failed or produced nothing. Regenerating the summary of a
// meeting with live work is scripts/resummarize-once.ts, on a go.
//
// Two doors into the same path:
//
// - reanalyzeMeetingAction, the meeting page's Reanalyze meeting:
//   system_admin only, on a meeting that is complete or failed.
// - retryFailedMeetingAction, Meeting Summaries' Try again: the people
//   who manage the company's meetings (system_admin, the company's own
//   company_admin, an assigned aims_guide; the same set as every other
//   transcript action, canManageCompanyMeetings in ./retry),
//   and only on a FAILED meeting. A meeting someone dismissed is not
//   offered again: dismissing was a decision, not a failure.
//
// Both write through the service-role client, so the checks here ARE
// the boundary, not a courtesy (no RLS sits behind them). Each passes
// the meeting's own company_id, so a company admin or guide can retry
// a meeting in a company they admin and no other.
//
// ONE RUN AT A TIME. The reset to pending is a compare-and-set on the
// status the caller saw allowed (failed, or complete/failed), so a
// double click, a second tab or a retry while the first is still
// analyzing matches no row and is refused before the analysis is
// touched or a model call is started. analyzeMeeting itself also
// refuses anything not pending.
//
// after() lets the serverless function continue past the response;
// if it is unavailable the transcripts cron picks the pending meeting
// up on its next run.

export type ReanalyzeResult =
  | { ok: true }
  | { ok: false; message: string };

type RerunMeeting = {
  id: string;
  company_id: string;
  status: string;
  error: string | null;
};

export async function reanalyzeMeetingAction(
  meetingId: string
): Promise<ReanalyzeResult> {
  const session = await requireProfile();
  const meeting = await loadMeeting(meetingId);
  if (!meeting) return { ok: false, message: "Meeting not found." };
  if (
    session.profile.role !== "system_admin" ||
    !isAdminForCompany(session.profile, meeting.company_id)
  ) {
    return { ok: false, message: "Only a system admin can reanalyze a meeting." };
  }
  return rerunMeeting(meeting, ["complete", "failed"]);
}

export async function retryFailedMeetingAction(
  meetingId: string
): Promise<ReanalyzeResult> {
  const session = await requireProfile();
  const meeting = await loadMeeting(meetingId);
  if (!meeting) return { ok: false, message: "Meeting not found." };
  if (!canManageCompanyMeetings(session.profile, meeting.company_id)) {
    return { ok: false, message: "Not your meeting to manage." };
  }
  if (!canRetryFailedMeeting(meeting)) {
    return { ok: false, message: "Only a failed meeting can be tried again." };
  }
  const result = await rerunMeeting(meeting, ["failed"]);
  if (result.ok) revalidatePath("/leadership");
  return result;
}

// Read through the caller's own client: a meeting RLS hides from them
// reads as not found.
async function loadMeeting(meetingId: string): Promise<RerunMeeting | null> {
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data } = await supabase
    .from("meetings")
    .select("id, company_id, status, error")
    .eq("id", meetingId)
    .maybeSingle<RerunMeeting>();
  return data ?? null;
}

async function rerunMeeting(
  meeting: RerunMeeting,
  fromStatuses: string[]
): Promise<ReanalyzeResult> {
  const meetingId = meeting.id;
  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());

  // Counted with the admin client, so RLS cannot hide a row and let
  // the check pass. Soft-deleted rows count: they are still history.
  const [{ count: commitmentCount, error: cErr }, { count: issueCount, error: iErr }] =
    await Promise.all([
      admin
        .from("commitments")
        .select("id", { count: "exact", head: true })
        .eq("source_meeting_id", meetingId),
      admin
        .from("issues")
        .select("id", { count: "exact", head: true })
        .eq("source_meeting_id", meetingId),
    ]);
  if (cErr || iErr || commitmentCount === null || issueCount === null) {
    // Fail closed: unable to prove there is no work to destroy.
    return { ok: false, message: "Couldn't check this meeting's commitments and issues." };
  }
  if (commitmentCount > 0 || issueCount > 0) {
    return {
      ok: false,
      message:
        "This meeting has commitments or issues created from it, so it can't be reanalyzed.",
    };
  }

  // Claim first: only one caller gets the row back. Everyone else
  // (a double click, a run already pending or analyzing) stops here,
  // before the analysis row is touched or a model call is made.
  const { data: claimed, error: claimErr } = await admin
    .from("meetings")
    .update({ status: "pending", error: null })
    .eq("id", meetingId)
    .in("status", fromStatuses)
    .select("id");
  if (claimErr) return { ok: false, message: "Couldn't start the analysis." };
  if ((claimed?.length ?? 0) === 0) {
    return { ok: false, message: "This meeting is already being analyzed." };
  }

  await admin
    .from("meeting_analyses")
    .delete()
    .eq("meeting_id", meetingId);

  try {
    after(async () => {
      try {
        await processPendingMeetings({ meetingId });
      } catch (err) {
        console.error(
          `[reanalyze] post-response processing failed for ${meetingId}:`,
          err
        );
      }
    });
  } catch {
    void processPendingMeetings({ meetingId }).catch((err) => {
      console.error(
        `[reanalyze] fire-and-forget processing failed for ${meetingId}:`,
        err
      );
    });
  }

  revalidatePath(`/leadership/meetings/${meetingId}`);
  return { ok: true };
}
