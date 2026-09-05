"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { processPendingMeetings } from "@/lib/transcripts/ingest";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Admin/guide-only reanalyze action. Wipes the meeting's downstream
// artifacts (analysis row + auto-created commitments + issues added
// from it), resets meeting.status to 'pending', then fires the
// analysis pipeline out-of-band via after() so the response returns
// quickly and the model call runs on the server without holding
// the action open.
//
// after() lets the serverless function continue running past the
// response — the user can refresh the summary in ~30-90s to see
// the fresh output. If after() isn't available in this runtime
// (test / older Next), we fall back to fire-and-forget; the
// transcripts cron will pick up the pending meeting on its next
// scheduled run either way, so the meeting always eventually
// re-analyzes.

export type ReanalyzeResult =
  | { ok: true; deletedCommitments: number; deletedIssues: number }
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
  if (!isAdminForCompany(session.profile, meeting.company_id)) {
    return {
      ok: false,
      message: "Only admins and guides can reanalyze a meeting.",
    };
  }

  const admin = createSupabaseAdminClient(getCurrentInstanceConfig());

  // Wipe downstream artifacts. Hard delete rather than soft so a
  // reanalyze test doesn't leave zombie rows behind. Counts flow
  // back to the caller so the confirm dialog / result message can
  // say what happened.
  const [{ data: deletedCommitments }, { data: deletedIssues }] =
    await Promise.all([
      admin
        .from("commitments")
        .delete()
        .eq("source_meeting_id", meetingId)
        .select("id"),
      admin
        .from("issues")
        .delete()
        .eq("source_meeting_id", meetingId)
        .select("id"),
    ]);

  await admin
    .from("meeting_analyses")
    .delete()
    .eq("meeting_id", meetingId);

  await admin
    .from("meetings")
    .update({ status: "pending", error: null })
    .eq("id", meetingId);

  // Kick off the analysis without blocking the response. after() is
  // Vercel's supported way to run post-response work on the same
  // serverless invocation. If the runtime lacks it (older Next,
  // test env), fall back to a fire-and-forget promise; the
  // transcripts cron will still process the pending row within
  // 15 min as a safety net.
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
  return {
    ok: true,
    deletedCommitments: (deletedCommitments ?? []).length,
    deletedIssues: (deletedIssues ?? []).length,
  };
}
