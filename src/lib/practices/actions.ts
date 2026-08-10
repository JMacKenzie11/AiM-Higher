"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { getScopedCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CoachingConversation } from "@/lib/coach/service";
import type { Profile } from "@/lib/types";
import { findPractice } from "./registry";

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

// Create a new practice conversation for the given practice id. The
// partner picker lives on the empty-chat setup step, so this action
// creates the conversation with partner_profile_id=null; a follow-up
// action attaches the partner once the participant chooses one.
export async function createPracticeConversationAction(
  practiceId: string
): Promise<PracticeActionResult<CoachingConversation>> {
  const practice = findPractice(practiceId);
  if (!practice) {
    return { ok: false, message: "That practice isn't available." };
  }

  const session = await requireProfile();

  let companyId: string | null = session.profile.company_id;
  if (!companyId && session.profile.role === "system_admin") {
    companyId = await getScopedCompanyId();
  }
  if (!companyId) {
    return {
      ok: false,
      message:
        "Scope into a company first — practices run against a company's context.",
    };
  }

  const supabase = await createSupabaseServerClient();
  // The stored title is just the date. The Ask Aimee list renderer
  // prepends the practice title as a muted prefix, so a stored
  // "Prepare a hard conversation · Aug 10" would double up ("Prepare
  // a hard conversation · Prepare a hard conversation · Aug 10").
  // Bare "Aug 10" reads as the muted prefix + date in the list, and
  // matches the auto-title default pattern so it gets replaced with
  // a real summary once the conversation has a few exchanges.
  const title = defaultDateLabel();
  const { data, error } = await supabase
    .from("coaching_conversations")
    .insert({
      company_id: companyId,
      subject_profile_id: null,
      created_by: session.profile.id,
      title,
      context_kind: "execution",
      mode: "general",
      practice_id: practice.id,
    })
    .select("*")
    .single<CoachingConversation>();
  if (error || !data) {
    console.error("createPracticeConversationAction insert failed", error);
    return { ok: false, message: "Couldn't start that practice." };
  }

  revalidatePath("/ask-aimee");
  return { ok: true, item: data };
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
