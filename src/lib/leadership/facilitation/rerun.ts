"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { companyHasFeature } from "@/lib/subscriptions/service";
import {
  loadCompanyContext,
  formatCompanyContext,
} from "@/lib/transcripts/analyze";
import { analyzeMeetingFacilitation } from "./analyze";

// Re-run ONLY the facilitation review pass for an existing meeting
// analysis. Skips the summarizer + extractor entirely so commitments
// never get duplicated — this pass writes only to
// meeting_analyses.facilitation_review_json.
//
// Overwrites in place: there is exactly one facilitation review per
// meeting, so re-running replaces whatever was there (usually null,
// or a stale v1 review superseded by a v2 prompt bump).

export async function rerunFacilitationReviewAction(
  meetingId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await requireProfile();

  const admin = createSupabaseAdminClient();

  // Load the meeting + its analysis row.
  const { data: meeting } = await admin
    .from("meetings")
    .select("id, company_id, transcript_text, status")
    .eq("id", meetingId)
    .maybeSingle<{
      id: string;
      company_id: string | null;
      transcript_text: string | null;
      status: string;
    }>();
  if (!meeting) return { ok: false, message: "Meeting not found." };
  if (!meeting.company_id) {
    return { ok: false, message: "Meeting isn't routed to a company." };
  }

  // Authz: only admins for the meeting's company can trigger this.
  if (!isAdminForCompany(session.profile, meeting.company_id)) {
    return { ok: false, message: "Not authorized." };
  }

  // Feature gate — same rule as the initial pipeline.
  const enabled = await companyHasFeature(
    meeting.company_id,
    "meeting_facilitation_review"
  );
  if (!enabled) {
    return {
      ok: false,
      message: "Meeting Facilitation Review isn't enabled for this company.",
    };
  }

  // Must have a transcript AND an existing analysis row (otherwise
  // there's nothing to update — the row is written by the main
  // analyzer pipeline, not by this action).
  if (!meeting.transcript_text) {
    return { ok: false, message: "Meeting has no transcript to analyze." };
  }
  const { data: analysisRow } = await admin
    .from("meeting_analyses")
    .select("id")
    .eq("meeting_id", meetingId)
    .maybeSingle<{ id: string }>();
  if (!analysisRow) {
    return {
      ok: false,
      message:
        "No analysis row yet for this meeting — run the full analyzer first.",
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, message: "ANTHROPIC_API_KEY is not set." };
  const client = new Anthropic({ apiKey });

  const context = await loadCompanyContext(admin, meeting.company_id);
  const companyBlock = formatCompanyContext(context);

  let review;
  try {
    review = await analyzeMeetingFacilitation(client, {
      transcript: meeting.transcript_text,
      companyContextBlock: companyBlock,
    });
  } catch (err) {
    return {
      ok: false,
      message: `Facilitation review failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!review) {
    return {
      ok: false,
      message: "The model returned no facilitation review (empty tool call).",
    };
  }

  const { error } = await admin
    .from("meeting_analyses")
    .update({ facilitation_review_json: review })
    .eq("meeting_id", meetingId);
  if (error) {
    return { ok: false, message: `DB update failed: ${error.message}` };
  }

  // Refresh the meeting detail page + the leadership list (the chip
  // needs to appear on the list too).
  revalidatePath(`/leadership/meetings/${meetingId}`);
  revalidatePath("/leadership");
  return { ok: true };
}
