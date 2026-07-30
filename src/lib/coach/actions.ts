"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { getScopedCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { companyHasFeature } from "@/lib/subscriptions/service";
import type { Profile } from "@/lib/types";
import type { CoachingConversation, CoachingContextKind } from "./service";

// Coaching-specific server actions. Access checks live here AND in
// RLS — never trust one alone.

export type CoachActionResult<T> =
  | { ok: true; item: T }
  | { ok: false; message: string };

export type SimpleResult = { ok: true } | { ok: false; message: string };

// ---- Create an ABOUT conversation (person-specific) ------------
// Admin coaches anyone in their reach; manager coaches a direct
// report. Self-coaching is retired — general conversations (Ask
// Aimee) go through createGeneralConversationAction below.
export async function createConversationAction(
  subjectProfileId: string,
  contextKind: CoachingContextKind = "execution"
): Promise<CoachActionResult<CoachingConversation>> {
  const session = await requireProfile();

  if (subjectProfileId === session.profile.id) {
    return {
      ok: false,
      message:
        "Use Ask Aimee for general reflection — this flow is for coaching about someone else.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data: subject } = await supabase
    .from("profiles")
    .select("id, company_id, reports_to")
    .eq("id", subjectProfileId)
    .maybeSingle<Pick<Profile, "id" | "company_id" | "reports_to">>();
  if (!subject) {
    return { ok: false, message: "That person isn't accessible." };
  }

  const isSystemAdmin = session.profile.role === "system_admin";
  const isCompanyAdmin =
    session.profile.role === "company_admin" &&
    session.profile.company_id === subject.company_id;
  const isManager = subject.reports_to === session.profile.id;

  // Matches migration 0105 RLS insert policy for mode='about'.
  if (!isSystemAdmin && !isCompanyAdmin && !isManager) {
    return {
      ok: false,
      message:
        "You can only coach your direct reports or people in your company as an admin.",
    };
  }

  if (!subject.company_id) {
    return { ok: false, message: "That person isn't in a company yet." };
  }

  // Feature gate: strengths coaching requires the company entitlement.
  if (contextKind === "strengths") {
    const enabled = await companyHasFeature(subject.company_id, "strengths");
    if (!enabled) {
      return {
        ok: false,
        message: "Strengths coaching isn't enabled for this company.",
      };
    }
  }

  const title = defaultTitleForToday();
  const { data, error } = await supabase
    .from("coaching_conversations")
    .insert({
      company_id: subject.company_id,
      subject_profile_id: subject.id,
      created_by: session.profile.id,
      title,
      context_kind: contextKind,
      mode: "about",
    })
    .select("*")
    .single<CoachingConversation>();
  if (error || !data) {
    return { ok: false, message: "Couldn't start that conversation." };
  }

  revalidatePath(`/coach/${subject.id}`);
  return { ok: true, item: data };
}

// ---- Create a GENERAL conversation (Ask Aimee) ----------------
// Any active member of a company can start one. System admins fall
// back to their scoped company. The subject stays null; the user
// brings the situation in-thread.
export async function createGeneralConversationAction(): Promise<
  CoachActionResult<CoachingConversation>
> {
  const session = await requireProfile();

  let companyId: string | null = session.profile.company_id;
  if (!companyId && session.profile.role === "system_admin") {
    companyId = await getScopedCompanyId();
  }
  if (!companyId) {
    return {
      ok: false,
      message:
        "Scope into a company first — coaching runs against a company's context.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const title = defaultTitleForToday();
  const { data, error } = await supabase
    .from("coaching_conversations")
    .insert({
      company_id: companyId,
      subject_profile_id: null,
      created_by: session.profile.id,
      title,
      context_kind: "execution",
      mode: "general",
    })
    .select("*")
    .single<CoachingConversation>();
  if (error || !data) {
    // Surface the underlying DB message during rollout — the two most
    // likely causes are the mode check constraint or the NOT NULL on
    // subject_profile_id (both cleared by migration 0105).
    console.error("createGeneralConversationAction insert failed", error);
    const detail = error?.message ? ` (${error.message})` : "";
    return { ok: false, message: `Couldn't start that conversation.${detail}` };
  }

  revalidatePath("/ask-aimee");
  return { ok: true, item: data };
}

// ---- Archive ----------------------------------------------------
export async function archiveConversationAction(
  conversationId: string
): Promise<SimpleResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const { data: convo, error: readError } = await supabase
    .from("coaching_conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle<CoachingConversation>();
  if (readError || !convo) {
    return { ok: false, message: "Conversation not found." };
  }
  if (convo.created_by !== session.profile.id) {
    return { ok: false, message: "Not yours to archive." };
  }

  const { error } = await supabase
    .from("coaching_conversations")
    .update({ archived: true })
    .eq("id", conversationId);
  if (error) return { ok: false, message: "Couldn't archive that." };

  if (convo.mode === "general") {
    revalidatePath("/ask-aimee");
  } else if (convo.subject_profile_id) {
    revalidatePath(`/coach/${convo.subject_profile_id}`);
  }
  return { ok: true };
}

// ---- Rename -----------------------------------------------------
export async function renameConversationAction(
  conversationId: string,
  title: string
): Promise<SimpleResult> {
  const session = await requireProfile();
  const trimmed = title.trim();
  if (!trimmed) return { ok: false, message: "Title can't be empty." };

  const supabase = await createSupabaseServerClient();
  const { data: convo } = await supabase
    .from("coaching_conversations")
    .select("id, created_by, subject_profile_id, mode")
    .eq("id", conversationId)
    .maybeSingle<
      Pick<CoachingConversation, "id" | "created_by" | "subject_profile_id" | "mode">
    >();
  if (!convo) return { ok: false, message: "Conversation not found." };
  if (convo.created_by !== session.profile.id) {
    return { ok: false, message: "Not yours to rename." };
  }

  const { error } = await supabase
    .from("coaching_conversations")
    .update({ title: trimmed.slice(0, 120) })
    .eq("id", conversationId);
  if (error) return { ok: false, message: "Couldn't rename that." };

  if (convo.mode === "general") {
    revalidatePath(`/ask-aimee/${conversationId}`);
  } else if (convo.subject_profile_id) {
    revalidatePath(`/coach/${convo.subject_profile_id}/${conversationId}`);
  }
  return { ok: true };
}

// ---- Helpers ----------------------------------------------------
function defaultTitleForToday(): string {
  const now = new Date();
  const label = now.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `Coaching · ${label}`;
}
