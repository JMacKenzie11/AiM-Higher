"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { processPendingMeetings } from "@/lib/transcripts/ingest";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

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
// system_admin only. A company admin or guide can no longer run it.
//
// after() lets the serverless function continue past the response;
// if it is unavailable the transcripts cron picks the pending meeting
// up on its next run.

export type ReanalyzeResult =
  | { ok: true }
  | { ok: false; message: string };

export async function reanalyzeMeetingAction(
  meetingId: string
): Promise<ReanalyzeResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, company_id")
    .eq("id", meetingId)
    .maybeSingle<{ id: string; company_id: string }>();
  if (!meeting) return { ok: false, message: "Meeting not found." };
  if (
    session.profile.role !== "system_admin" ||
    !isAdminForCompany(session.profile, meeting.company_id)
  ) {
    return { ok: false, message: "Only a system admin can reanalyze a meeting." };
  }

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

  await admin
    .from("meeting_analyses")
    .delete()
    .eq("meeting_id", meetingId);

  await admin
    .from("meetings")
    .update({ status: "pending", error: null })
    .eq("id", meetingId);

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
