"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import type { CoachingConversation } from "./service";

// Coaching-specific server actions. Access checks live here AND in
// RLS — never trust one alone.

export type CoachActionResult<T> =
  | { ok: true; item: T }
  | { ok: false; message: string };

export type SimpleResult = { ok: true } | { ok: false; message: string };

// ---- Create -----------------------------------------------------
// A conversation is scoped to (creator, subject). Admins may coach
// anyone in their reach; team members may only coach themselves.
export async function createConversationAction(
  subjectProfileId: string
): Promise<CoachActionResult<CoachingConversation>> {
  const session = await requireProfile();

  const supabase = await createSupabaseServerClient();
  const { data: subject } = await supabase
    .from("profiles")
    .select("id, company_id")
    .eq("id", subjectProfileId)
    .maybeSingle<Pick<Profile, "id" | "company_id">>();
  if (!subject || !subject.company_id) {
    return { ok: false, message: "That person isn't accessible." };
  }

  const isSelf = subject.id === session.profile.id;
  const isSystemAdmin = session.profile.role === "system_admin";
  const isCompanyAdmin =
    session.profile.role === "company_admin" &&
    session.profile.company_id === subject.company_id;

  if (!isSelf && !isSystemAdmin && !isCompanyAdmin) {
    return {
      ok: false,
      message: "You can only coach yourself unless you're an admin.",
    };
  }

  const title = defaultTitleForToday();
  const { data, error } = await supabase
    .from("coaching_conversations")
    .insert({
      company_id: subject.company_id,
      subject_profile_id: subject.id,
      created_by: session.profile.id,
      title,
    })
    .select("*")
    .single<CoachingConversation>();
  if (error || !data) {
    return { ok: false, message: "Couldn't start that conversation." };
  }

  revalidatePath(`/coach/${subject.id}`);
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

  revalidatePath(`/coach/${convo.subject_profile_id}`);
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
    .select("id, created_by, subject_profile_id")
    .eq("id", conversationId)
    .maybeSingle<
      Pick<CoachingConversation, "id" | "created_by" | "subject_profile_id">
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

  revalidatePath(`/coach/${convo.subject_profile_id}/${conversationId}`);
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
