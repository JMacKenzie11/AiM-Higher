"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// Server actions for the notifications system. Read-side pulls
// live in lib/notifications/service.ts; this file is the caller-
// facing write path (mark read, mark all read, dismiss).
//
// RLS on public.notifications restricts UPDATE to recipient_id =
// auth.uid(), so the auth check here is UX polish (friendly result)
// rather than the security boundary. The DB will reject the update
// anyway if the caller doesn't own the row.

export type NotificationActionResult =
  | { ok: true }
  | { ok: false; message: string };

// Mark a single notification read. Fires when the user clicks a
// bell item; the client can dispatch this in parallel with the
// navigation without waiting for its response. Idempotent — a
// second call on an already-read row is a no-op.
export async function markNotificationReadAction(
  notificationId: string
): Promise<NotificationActionResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("recipient_id", session.profile.id)
    .is("read_at", null);
  if (error) return { ok: false, message: "Couldn't mark that read." };

  // Refresh the layout so the bell recount picks it up next paint.
  // The header lives in (app)/layout.tsx, so a root revalidate is
  // the right hammer here.
  revalidatePath("/", "layout");
  return { ok: true };
}

// Clear every unread notification for the caller in one action.
// Used by a "Clear all" affordance in the bell tray footer (if we
// add one). Kept separate from single-mark so we don't need to
// enumerate ids in the client.
export async function markAllNotificationsReadAction(): Promise<NotificationActionResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", session.profile.id)
    .is("read_at", null);
  if (error) return { ok: false, message: "Couldn't clear notifications." };
  revalidatePath("/", "layout");
  return { ok: true };
}
