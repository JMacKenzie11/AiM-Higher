import "server-only";

import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Opening a nudge: the one place a Guide invitation turns into a
// conversation. Shared by the nudge page (/guide/nudge/[id], which
// redirects to the result) and Aimee's panel (which shows it in
// place), so the two cannot open an invitation differently.
//
// SWITCHED OFF (0329; Jason, 2026-11-23). Aimee no longer sends debrief
// invitations and the champion seat is gone. An invitation that was
// already opened still lands on its conversation, which is the
// recipient's record of it; one that never was says the invitations
// have stopped and opens nothing.
//
// WHO MAY OPEN IT: the recipient, and nobody else. RLS says the same
// thing: the update policy in 0235 is recipient-only.

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
  // a direct link, which marks nothing on the way. The recipient's own
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

  // Not opened yet: the invitation is retired. Debrief invitations
  // were switched off with the champion seat (0329; Jason,
  // 2026-11-23), and an old link should say so rather than start a
  // conversation nobody is expecting. Nothing is written.
  return {
    ok: false,
    message: "Aimee no longer sends these invitations. Company admins and coaches can still debrief a meeting on Ask Aimee.",
  };
}
