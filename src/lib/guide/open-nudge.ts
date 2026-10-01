import "server-only";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { resolveAgent } from "@/lib/practices/resolve";
import { practiceGate } from "@/lib/practices/gate";
import { createPracticeConversation } from "@/lib/practices/create";
import { DEBRIEF_AGENT_ID } from "./nudges";
import { isAimsChampion } from "./champion";

// Opening a nudge: the one place a Guide invitation turns into a
// conversation. Shared by the nudge page (/guide/nudge/[id], which
// redirects to the result) and Aimee's panel (which shows it in
// place), so the two cannot open an invitation differently.
//
// The card and Aimee's first message are written when the nudge is
// RAISED (headline.ts), and checked then. The conversation starts here, under the champion's own session, on their own
// client, which is what makes the agent's tools return what THEY can
// see rather than what a background job could.
//
// ---- AIMEE'S FIRST MESSAGE WAS WRITTEN WITH THE CARD ---------------
//
// The nudge's `opener` (0241) is handed to createPracticeConversation
// and persisted with no model call, the same way an agent's scripted
// opener is. It adds what the card could not: the moment, a quote,
// why it matters, one question (Jason, 2026-09-29). It used to be the
// headline itself; generating an opener HERE kept repeating the line,
// leaving its subject, or breaking the voice rules (dev, 2026-09-28),
// which is why it is written and checked with the card instead.
//
// A nudge with no opener (raised before 0241, or one whose opener
// failed its checks) opens on the card's own words: the headline and
// the invitation, which ends with the question they are answering.
//
// ---- OPENING TWICE ---------------------------------------------
//
// The second open is normal, not an edge case. It lands on the
// conversation that already exists. Creating a second one would
// split a debrief across two chats and count one invitation as two
// opens in the measurement.
//
// ---- WHO MAY OPEN IT -------------------------------------------
//
// The recipient, and nobody else. A company_admin can reach the
// debrief AGENT from the picker — it is their meeting too — but a
// nudge is addressed to a person, and opening somebody else's would
// mark THEIR invitation as taken up. RLS says the same thing: the
// update policy in 0235 is recipient-only.

export type OpenNudgeResult = { ok: true; conversationId: string } | { ok: false; message: string };

export async function openNudge(nudgeId: string): Promise<OpenNudgeResult> {
  const session = await requireProfile();
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());

  const { data: nudge } = await db
    .from("guide_nudges")
    .select("id, company_id, recipient_profile_id, meeting_id, state, conversation_id, headline, invitation, opener")
    .eq("id", nudgeId)
    .maybeSingle<{
      id: string;
      company_id: string;
      recipient_profile_id: string;
      meeting_id: string | null;
      state: string;
      conversation_id: string | null;
      headline: string | null;
      invitation: string | null;
      opener: string | null;
    }>();

  // The select policy lets admins read these, so "found" is not the
  // same question as "yours". Both answers are the same refusal.
  if (!nudge || nudge.recipient_profile_id !== session.profile.id) {
    return { ok: false, message: "That invitation isn't yours to open." };
  }

  // Opened is read, however they got here: the bell or the panel, or
  // a direct link, which marks nothing on the way. The champion's own
  // row, under their session (RLS: recipient only).
  const markRead = () =>
    db
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("kind", "guide-nudge")
      .eq("recipient_id", session.profile.id)
      .eq("payload->>nudge_id", nudge.id)
      .is("read_at", null);

  // Already open: go where it went.
  if (nudge.conversation_id) {
    await markRead();
    return { ok: true, conversationId: nudge.conversation_id };
  }

  // The seat moved since the invitation was sent. Said plainly, rather
  // than as the agent gate's refusal, which names a "practice" and
  // does not say why.
  if (!nudge.conversation_id && !(await isAimsChampion(session.profile.id, nudge.company_id))) {
    return {
      ok: false,
      message: "This invitation was for your company's AiMS champion, and that's no longer you.",
    };
  }

  if (nudge.state === "dismissed") {
    return { ok: false, message: "You waved that one away. Aimee will be in touch after the next meeting." };
  }

  const practice = await resolveAgent(DEBRIEF_AGENT_ID);
  if (!practice) return { ok: false, message: "That agent isn't available." };

  const gate = await practiceGate(practice, session.profile, nudge.company_id);
  if (!gate.ok) return { ok: false, message: gate.message };

  let conversationId: string;
  try {
    const result = await createPracticeConversation(practice.id, {
      debriefingMeetingId: nudge.meeting_id ?? undefined,
      opener: firstMessage(nudge) ?? undefined,
    });
    if (!result.ok) return { ok: false, message: result.message };
    conversationId = result.item.id;
  } catch (err) {
    if (isRedirectError(err)) throw err;
    console.error("[guide] opening nudge failed", err);
    return { ok: false, message: "Couldn't start that chat." };
  }

  // Recorded AFTER the conversation exists, so a failure above
  // leaves the nudge pending and openable rather than marking it
  // opened with nowhere to go.
  //
  // The write is not checked, on purpose: the champion is about to
  // land in a working conversation, and refusing them that because
  // a measurement row did not update would be the tail wagging the
  // dog. A lost update costs one number.
  const { error } = await db
    .from("guide_nudges")
    .update({
      state: "opened",
      opened_at: new Date().toISOString(),
      conversation_id: conversationId,
    })
    .eq("id", nudge.id);
  if (error) {
    console.error(`[guide] nudge ${nudge.id} opened but not recorded:`, error.message);
  }

  await markRead();
  return { ok: true, conversationId };
}

export function firstMessage(nudge: {
  headline: string | null;
  invitation?: string | null;
  opener?: string | null;
}): string | null {
  if (nudge.opener) return nudge.opener;
  const card = [nudge.headline, nudge.invitation].filter(Boolean).join(" ");
  return card || null;
}
