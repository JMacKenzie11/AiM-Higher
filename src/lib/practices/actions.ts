"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CoachingConversation } from "@/lib/coach/service";
import type { Profile } from "@/lib/types";
import { createPracticeConversation } from "./create";

// Server actions for guided practices. Practices are a subtype of
// general (Ask Aimee) conversations: mode stays 'general' and
// subject_profile_id stays null so the existing RLS + shape
// constraints on coaching_conversations (see migration 0105) hold.
// The differentiators are practice_id (mandatory) and
// partner_profile_id (optional).

export type PracticeActionResult<T> =
  | { ok: true; item: T }
  | { ok: false; message: string };

export type SimpleResult = { ok: true } | { ok: false; message: string };

// Thin server-action wrapper around createPracticeConversation. Adds
// revalidatePath so a click from the PracticeCards on /ask-aimee
// refreshes the recent-conversations list. The launch page at
// /ask-aimee/new calls createPracticeConversation directly — Next.js
// 15 forbids revalidatePath during a render pass, so the launch
// path skips it (redirect to the new conversation makes it moot).
export async function createPracticeConversationAction(
  practiceId: string
): Promise<PracticeActionResult<CoachingConversation>> {
  const result = await createPracticeConversation(practiceId);
  if (result.ok) {
    revalidatePath("/ask-aimee");
    return { ok: true, item: result.item };
  }
  return result;
}


// Attach or clear a partner on an existing practice conversation.
// Partner must be in the caller's company and cannot be the caller
// themselves. Clearing (partnerProfileId === null) is always allowed.
export async function setPracticePartnerAction(
  conversationId: string,
  partnerProfileId: string | null
): Promise<SimpleResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const { data: convo } = await supabase
    .from("coaching_conversations")
    .select("id, created_by, company_id, practice_id")
    .eq("id", conversationId)
    .maybeSingle<
      Pick<
        CoachingConversation,
        "id" | "created_by" | "company_id" | "practice_id"
      >
    >();
  if (!convo) return { ok: false, message: "Conversation not found." };
  if (convo.created_by !== session.profile.id) {
    return { ok: false, message: "Not yours to edit." };
  }
  if (!convo.practice_id) {
    return { ok: false, message: "This conversation isn't a practice." };
  }

  if (partnerProfileId) {
    if (partnerProfileId === session.profile.id) {
      return {
        ok: false,
        message:
          "You can't be your own partner. Pick someone else or leave it blank.",
      };
    }
    const { data: partner } = await supabase
      .from("profiles")
      .select("id, company_id")
      .eq("id", partnerProfileId)
      .maybeSingle<Pick<Profile, "id" | "company_id">>();
    if (!partner || partner.company_id !== convo.company_id) {
      return {
        ok: false,
        message: "That person isn't in your company.",
      };
    }
  }

  const { error } = await supabase
    .from("coaching_conversations")
    .update({ partner_profile_id: partnerProfileId })
    .eq("id", conversationId);
  if (error) {
    console.error("setPracticePartnerAction update failed", error);
    return { ok: false, message: "Couldn't save that." };
  }

  revalidatePath(`/ask-aimee/${conversationId}`);
  return { ok: true };
}

function defaultDateLabel(): string {
  const now = new Date();
  return now.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
