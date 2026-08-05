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

// ---- Auto-title from first exchange -----------------------------
// After the assistant streams its first response, ChatView fires
// this to swap the boilerplate "Coaching · Jul 30" title for a
// short summary of what the thread is actually about. The user can
// still rename anytime — we detect that by only touching titles
// that still match the default pattern.
export type GenerateTitleResult =
  | { ok: true; title: string | null }
  | { ok: false; message: string };

export async function generateConversationTitleAction(
  conversationId: string
): Promise<GenerateTitleResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const { data: convo } = await supabase
    .from("coaching_conversations")
    .select("id, title, created_by, subject_profile_id, mode")
    .eq("id", conversationId)
    .maybeSingle<
      Pick<
        CoachingConversation,
        "id" | "title" | "created_by" | "subject_profile_id" | "mode"
      >
    >();
  if (!convo) return { ok: false, message: "Conversation not found." };
  if (convo.created_by !== session.profile.id) {
    return { ok: false, message: "Not yours." };
  }

  // Only auto-title if the user hasn't renamed it. Default titles
  // look like "Coaching · Jul 30" — if the current title doesn't
  // match, treat that as a manual edit and leave it alone.
  if (!DEFAULT_TITLE_PATTERN.test(convo.title)) {
    return { ok: true, title: null };
  }

  const { data: rows } = await supabase
    .from("coaching_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(2);
  const messages = (rows ?? []) as Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  if (messages.length < 2) return { ok: true, title: null };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, message: "Model not configured." };

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const transcript = messages
    .map((m) => `${m.role === "user" ? "User" : "Coach"}: ${m.content}`)
    .join("\n\n");

  let generated: string | null = null;
  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 40,
      system:
        "You produce short, specific titles for coaching conversations. Return 4–8 words that capture the topic, no quotes, no trailing punctuation. Prefer concrete nouns and verbs over generic labels.",
      messages: [
        {
          role: "user",
          content: `Give this coaching conversation a short title (4–8 words).\n\n${transcript}`,
        },
      ],
    });
    const text = response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim()
      .replace(/^["'`]|["'`]$/g, "")
      .replace(/[.!?]+$/, "");
    if (text) generated = text.slice(0, 120);
  } catch (err) {
    console.error("generateConversationTitleAction: model call failed", err);
    return { ok: false, message: "Couldn't summarize the conversation." };
  }

  if (!generated) return { ok: true, title: null };

  // Re-check the title right before writing — if the user renamed
  // during the ~1s model call, don't stomp on them.
  const { data: fresh } = await supabase
    .from("coaching_conversations")
    .select("title")
    .eq("id", conversationId)
    .maybeSingle<{ title: string }>();
  if (!fresh || !DEFAULT_TITLE_PATTERN.test(fresh.title)) {
    return { ok: true, title: null };
  }

  const { error } = await supabase
    .from("coaching_conversations")
    .update({ title: generated })
    .eq("id", conversationId);
  if (error) return { ok: false, message: "Couldn't save the title." };

  if (convo.mode === "general") {
    revalidatePath("/ask-aimee");
    revalidatePath(`/ask-aimee/${conversationId}`);
  } else if (convo.subject_profile_id) {
    revalidatePath(`/coach/${convo.subject_profile_id}`);
    revalidatePath(`/coach/${convo.subject_profile_id}/${conversationId}`);
  }

  return { ok: true, title: generated };
}

// ---- Helpers ----------------------------------------------------
const DEFAULT_TITLE_PATTERN = /^Coaching · [A-Z][a-z]+ \d{1,2}$/;

function defaultTitleForToday(): string {
  const now = new Date();
  const label = now.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `Coaching · ${label}`;
}
