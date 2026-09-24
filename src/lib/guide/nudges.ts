import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { generateHeadline } from "./headline";

// RAISING A NUDGE, AND NEVER NAGGING TWICE.
//
// The Guide's one action in this phase: after a meeting is analysed,
// invite the company's champion to debrief it. No conversation
// happens here — see the header in 0235. A notification is raised
// and the conversation starts when the champion opens it, under
// their own session.
//
// ---- FAILURE IS ISOLATED ---------------------------------------
//
// Everything here is best effort and nothing here may break the
// analysis. A meeting summary is load-bearing; an invitation to chat
// about it is not. Every path returns rather than throws, and says
// what happened in the log.

export const TRIGGER_MEETING_ANALYZED = "meeting_analyzed";

// The agent a debrief opens. Named here rather than typed as a
// string literal at the open path, so the registry entry, the seed
// in 0235 and the route cannot drift apart silently.
export const DEBRIEF_AGENT_ID = "guide-meeting-debrief";

export type RaiseResult =
  | { raised: true; nudgeId: string; superseded: number }
  | { raised: false; reason: string };

export async function raiseMeetingDebriefNudge(
  admin: SupabaseClient,
  client: Anthropic,
  input: {
    model: string;
    companyId: string;
    meetingId: string;
    meetingDateIso: string;
    analysisMarkdown: string;
    strengths: string[];
  }
): Promise<RaiseResult> {
  try {
    const { data: company } = await admin
      .from("companies")
      .select("name, aims_champion_profile_id")
      .eq("id", input.companyId)
      .maybeSingle<{ name: string; aims_champion_profile_id: string | null }>();

    // NO CHAMPION, NO NUDGE. Said out loud once rather than silently
    // skipped: a company getting no nudges should be explainable
    // from the logs without reading this file.
    if (!company?.aims_champion_profile_id) {
      console.log(
        `[guide] no nudge for meeting ${input.meetingId}: ` +
          `${company?.name ?? input.companyId} has no AiMS champion set.`
      );
      return { raised: false, reason: "no champion" };
    }

    const headline = await generateHeadline(client, {
      model: input.model,
      meetingDate: input.meetingDateIso,
      companyName: company.name,
      analysisMarkdown: input.analysisMarkdown,
      strengths: input.strengths,
    });

    // ---- one active nudge per company -------------------------
    //
    // A champion who ignored last week's invitation does not get two
    // sitting there this week. The older one is marked superseded,
    // not deleted: it is still true that the Guide raised it and
    // nobody opened it, and that is the number worth watching.
    //
    // Before the insert, so a failure here cannot leave two pending.
    const { data: bumped } = await admin
      .from("guide_nudges")
      .update({ state: "superseded" })
      .eq("company_id", input.companyId)
      .eq("state", "pending")
      .select("id");

    const { data: nudge, error } = await admin
      .from("guide_nudges")
      .insert({
        company_id: input.companyId,
        recipient_profile_id: company.aims_champion_profile_id,
        trigger_kind: TRIGGER_MEETING_ANALYZED,
        meeting_id: input.meetingId,
        headline,
      })
      .select("id")
      .single<{ id: string }>();
    if (error || !nudge) {
      console.error(
        `[guide] nudge insert failed for meeting ${input.meetingId}:`,
        error?.message
      );
      return { raised: false, reason: error?.message ?? "insert failed" };
    }

    // The notification the champion actually sees. Same admin-client
    // path the table was designed for (0152): no user may create one.
    const { error: notifyError } = await admin.from("notifications").insert({
      recipient_id: company.aims_champion_profile_id,
      company_id: input.companyId,
      kind: "guide-nudge",
      title: headline,
      eyebrow: "Aimee",
      href: `/guide/nudge/${nudge.id}`,
      payload: { nudge_id: nudge.id, meeting_id: input.meetingId },
    });
    if (notifyError) {
      // The nudge row exists and the notification does not, so the
      // champion will never see it. Worth a loud line: the row will
      // sit pending forever and look like an ignored invitation
      // rather than one that was never delivered.
      console.error(
        `[guide] nudge ${nudge.id} raised but its notification failed:`,
        notifyError.message
      );
    }

    console.log(
      `[guide] nudge ${nudge.id} raised for meeting ${input.meetingId}` +
        `${(bumped ?? []).length > 0 ? `, superseding ${(bumped ?? []).length}` : ""}`
    );
    return {
      raised: true,
      nudgeId: nudge.id,
      superseded: (bumped ?? []).length,
    };
  } catch (err) {
    // The analysis completes regardless. This is the whole point of
    // the try: an invitation to chat must never cost somebody their
    // meeting summary.
    console.error(
      `[guide] raising a nudge failed for meeting ${input.meetingId}:`,
      err instanceof Error ? err.message : err
    );
    return { raised: false, reason: "threw" };
  }
}
