"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// "Not now."
//
// Two rows move, and the difference between them is the point:
//
//   notifications  the champion stops seeing it. Housekeeping.
//   guide_nudges   the champion SAID no. That is a finding.
//
// Without the second write, a declined invitation and an ignored one
// look identical in the measurement, and they mean opposite things
// about whether the Guide is worth keeping. An ignored nudge is a
// nudge that missed; a dismissed one landed and was declined.
//
// RLS is the boundary on both (0152 for notifications, 0235 for
// nudges, both recipient-only). The `eq` on recipient here is a
// friendlier refusal, not the guard.

export type DismissResult = { ok: true } | { ok: false; message: string };

export async function dismissGuideNudgeAction(
  notificationId: string
): Promise<DismissResult> {
  const session = await requireProfile();
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());

  // The nudge id travels in the notification's payload rather than
  // as an argument. The caller is a tray item that knows its own
  // notification id and nothing else, and a nudge id accepted
  // straight off the client would be a nudge id somebody could
  // change — RLS would refuse it, but not being able to name one is
  // better than being refused.
  const { data: notification } = await db
    .from("notifications")
    .select("id, payload")
    .eq("id", notificationId)
    .eq("recipient_id", session.profile.id)
    .maybeSingle<{ id: string; payload: { nudge_id?: string } | null }>();
  if (!notification) {
    return { ok: false, message: "That notification is gone." };
  }

  const nudgeId = notification.payload?.nudge_id;
  if (nudgeId) {
    const { error } = await db
      .from("guide_nudges")
      .update({ state: "dismissed", dismissed_at: new Date().toISOString() })
      .eq("id", nudgeId)
      .eq("state", "pending");
    if (error) {
      console.error(`[guide] dismissing nudge ${nudgeId} failed:`, error.message);
    }
  }

  const { error } = await db
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("recipient_id", session.profile.id)
    .is("read_at", null);
  if (error) return { ok: false, message: "Couldn't put that away." };

  revalidatePath("/", "layout");
  return { ok: true };
}
