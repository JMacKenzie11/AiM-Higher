"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { companyHasFeature } from "@/lib/subscriptions/service";
import { trackAfter } from "@/lib/analytics/track";
import { insertNotification } from "@/lib/notifications/service";
import type { Profile } from "@/lib/types";
import {
  listShareCandidatesForConversation,
  type CoachingConversation,
  type CoachingContextKind,
  type ShareCandidate,
} from "./service";
import { findPractice, type Practice } from "@/lib/practices/registry";
import { practiceRoleGate } from "@/lib/practices/gate";
import { cleanGeneratedTitle } from "./title";
import { logCoachTokenUsage } from "./usage";

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
  trackAfter(
    session.profile.id,
    "coach.thread_opened",
    { mode: "about", context_kind: contextKind },
    { company: subject.company_id! }
    );
  return { ok: true, item: data };
}

// ---- Create a GENERAL conversation (Ask Aimee) ----------------
// Any active member of a company can start one. System admins and
// guides use their currently scoped company. The subject stays null;
// the user brings the situation in-thread.
export async function createGeneralConversationAction(): Promise<
  CoachActionResult<CoachingConversation>
> {
  const session = await requireProfile();

  // Single-source-of-truth resolver: regular members return their
  // own company_id, system_admins their scope cookie, aims_guides
  // cookie-or-single-assignment. The old version here only handled
  // system_admin, so a guide would fail with "scope into a company
  // first" even with a valid scope set.
  const companyId = await getEffectiveCompanyId(session);
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
  trackAfter(
    session.profile.id,
    "coach.thread_opened",
    { mode: "general", context_kind: "execution" },
    { company: companyId }
    );
  return { ok: true, item: data };
}

// ---- Attach / detach an agent to a general conversation --------
// The unified /ask-aimee entry lets a leader start a plain chat
// and *then* choose an agent (or pick one via the composer's
// picker after the fact, as long as they haven't sent a user turn
// yet). This action is the single write path for that choice.
//
// Lock semantic: once the leader has sent ANY user-role message
// to this thread, the agent slot is frozen for the life of the
// conversation. Downstream — prompt selection, output-card
// rendering, per-turn context — trusts that practice_id is
// stable from turn one forward. The action refuses to change it
// after that lock lands.
//
// Opener replacement: before the lock, any assistant messages on
// the conversation are by definition auto-inserted openers from a
// previous agent selection (or none at all). The action wipes
// them before installing the new agent's scripted opener so a
// leader who tries three agents in a row doesn't end up with
// three stacked greetings.
export type SetAgentResult =
  | {
      ok: true;
      // When true, the client should fire /api/coach with
      // generateOpener:true to stream the practice's dynamic
      // opener. Set for practices with firstTurn='generate'.
      runGenerateOpener: boolean;
      // The scripted opener that was persisted (if any). Returned
      // so the client can seed its optimistic message list —
      // router.refresh() alone doesn't sync client useState, and
      // the modal path always follows agent selection with a
      // client-side state update anyway.
      openerContent: string | null;
      // Echo the resolved practice id back so the client can
      // reconcile its `practice` prop without a full page reload.
      practiceId: string | null;
    }
  | { ok: false; message: string };

export async function setConversationAgentAction(
  conversationId: string,
  agentId: string | null
): Promise<SetAgentResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const { data: convo } = await supabase
    .from("coaching_conversations")
    .select("id, company_id, created_by, mode, practice_id")
    .eq("id", conversationId)
    .maybeSingle<
      Pick<
        CoachingConversation,
        "id" | "company_id" | "created_by" | "mode" | "practice_id"
      >
    >();
  if (!convo) return { ok: false, message: "Conversation not found." };
  if (convo.created_by !== session.profile.id) {
    return { ok: false, message: "Only the owner can change the agent." };
  }
  if (convo.mode !== "general") {
    return {
      ok: false,
      message: "Agents only attach to general conversations.",
    };
  }

  // Lock check — count user-role messages. Any prior assistant
  // messages are openers we'll wipe below, so they don't count as
  // "started."
  const { count: userTurns } = await supabase
    .from("coaching_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("role", "user");
  if ((userTurns ?? 0) > 0) {
    return {
      ok: false,
      message: "This conversation is already underway — the agent is locked.",
    };
  }

  // Validate + role-gate the target agent (null = clear back to
  // plain Ask Aimee).
  let nextPractice: Practice | null = null;
  if (agentId !== null) {
    const candidate = findPractice(agentId);
    if (!candidate) {
      return { ok: false, message: "That agent isn't available." };
    }
    const gate = practiceRoleGate(
      candidate,
      session.profile,
      convo.company_id
    );
    if (!gate.ok) return gate;
    nextPractice = candidate;
  }

  // Wipe any prior auto-openers. Safe because we're pre-lock —
  // by definition no user message exists, so every assistant row
  // is an opener.
  await supabase
    .from("coaching_messages")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("role", "assistant");

  const { error: updateErr } = await supabase
    .from("coaching_conversations")
    .update({ practice_id: nextPractice?.id ?? null })
    .eq("id", conversationId);
  if (updateErr) {
    console.error("setConversationAgentAction update failed", updateErr);
    return { ok: false, message: "Couldn't attach that agent." };
  }

  // Persist the scripted opener when applicable. The "generate"
  // path is deferred to the client, which fires /api/coach with
  // generateOpener=true immediately after this action returns —
  // that keeps the streaming UX identical to a normal turn.
  let runGenerateOpener = false;
  let openerContent: string | null = null;
  if (nextPractice) {
    if (nextPractice.firstTurn === "scripted" && nextPractice.scriptedOpener) {
      const { error: openerErr } = await supabase
        .from("coaching_messages")
        .insert({
          conversation_id: conversationId,
          created_by: session.profile.id,
          role: "assistant",
          content: nextPractice.scriptedOpener,
        });
      if (openerErr) {
        console.error(
          "setConversationAgentAction opener insert failed",
          openerErr
        );
      } else {
        openerContent = nextPractice.scriptedOpener;
      }
    } else if (nextPractice.firstTurn === "generate") {
      runGenerateOpener = true;
    }
  }

  trackAfter(
    session.profile.id,
    "coach.agent_set",
    { agent: nextPractice?.id ?? null },
    { company: convo.company_id }
  );

  revalidatePath(`/ask-aimee/${conversationId}`);
  return {
    ok: true,
    runGenerateOpener,
    openerContent,
    practiceId: nextPractice?.id ?? null,
  };
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
    .select("id, title, created_by, subject_profile_id, mode, company_id")
    .eq("id", conversationId)
    .maybeSingle<
      Pick<
        CoachingConversation,
        | "id"
        | "title"
        | "created_by"
        | "subject_profile_id"
        | "mode"
        | "company_id"
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

  // Fire when the client has completed at least two exchanges (four
  // messages). Loading up to six gives the model enough context to
  // pick a specific topic instead of paraphrasing the opening chip.
  const { data: rows } = await supabase
    .from("coaching_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(6);
  const messages = (rows ?? []) as Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  if (messages.length < 4) return { ok: true, title: null };

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
        "You produce short, specific titles for coaching conversations. Return 4–8 words of plain text that capture the topic. No quotes, no trailing punctuation, no markdown formatting (no asterisks, underscores, backticks, or hash marks). Prefer concrete nouns and verbs over generic labels.",
      messages: [
        {
          role: "user",
          content: `Give this coaching conversation a short title (4–8 words).\n\n${transcript}`,
        },
      ],
    });
    if (response.usage) {
      void logCoachTokenUsage({
        conversationId: convo.id,
        companyId: convo.company_id,
        purpose: "title",
        model: "claude-haiku-4-5",
        usage: response.usage,
      });
    }
    const text = cleanGeneratedTitle(
      response.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("")
    );
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
// Matches "Coaching · Aug 10" (default for about + general threads)
// OR "Aug 10" (default for practice threads — the practice title
// carries the context, so the stored title doesn't need to repeat
// it). Auto-title only fires when the title still looks like one
// of these defaults; a user rename to anything else is respected.
const DEFAULT_TITLE_PATTERN =
  /^(?:Coaching · )?[A-Z][a-z]+ \d{1,2}$/;

function defaultTitleForToday(): string {
  const now = new Date();
  const label = now.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `Coaching · ${label}`;
}

// ==============================================================
// Sharing — grant / revoke / change / leave
// ==============================================================
// Cross-tenant rule (non-negotiable): the sharee's profile.company_id
// MUST equal the conversation's company_id. Enforced in three
// places — the friendly check below, the RLS insert policy, and
// the before-insert trigger from migration 0150. This action does
// the friendly check first so users see a legible error instead of
// a raw Postgres exception.

export type ShareAccessInput = "read" | "write";

export async function shareConversationAction(
  conversationId: string,
  shareeProfileId: string,
  access: ShareAccessInput
): Promise<SimpleResult> {
  if (access !== "read" && access !== "write") {
    return { ok: false, message: "Access must be read or write." };
  }
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const { data: convo } = await supabase
    .from("coaching_conversations")
    .select("id, company_id, created_by, mode, subject_profile_id, title, practice_id")
    .eq("id", conversationId)
    .maybeSingle<{
      id: string;
      company_id: string;
      created_by: string;
      mode: "about" | "general";
      subject_profile_id: string | null;
      title: string;
      practice_id: string | null;
    }>();
  if (!convo) return { ok: false, message: "Conversation not found." };
  if (convo.created_by !== session.profile.id) {
    return { ok: false, message: "Only the owner can share this." };
  }
  if (shareeProfileId === convo.created_by) {
    return { ok: false, message: "You already own this conversation." };
  }

  const { data: sharee } = await supabase
    .from("profiles")
    .select("id, company_id, status")
    .eq("id", shareeProfileId)
    .maybeSingle<{
      id: string;
      company_id: string | null;
      status: "pending" | "active" | "inactive";
    }>();
  if (!sharee) {
    return { ok: false, message: "That person isn't accessible." };
  }
  if (sharee.status !== "active") {
    return { ok: false, message: "That person isn't active." };
  }
  // Same-company check with an assignment fallback. A member's own
  // company must match the conversation's; anyone else qualifies
  // when they hold a guide_assignments row for the conversation's
  // company. Role doesn't factor in — a system_admin carrying a
  // caseload uses the same guide_assignments table as an
  // aims_guide (see AssignSysadminForm on /admin/companies). Trigger
  // + RLS reinforce the same shape via profile_is_in_company
  // (migrations 0153 + 0154).
  let sharableSameCompany = sharee.company_id === convo.company_id;
  if (!sharableSameCompany) {
    const { data: assignment } = await supabase
      .from("guide_assignments")
      .select("guide_id")
      .eq("guide_id", shareeProfileId)
      .eq("company_id", convo.company_id)
      .maybeSingle<{ guide_id: string }>();
    sharableSameCompany = assignment !== null;
  }
  if (!sharableSameCompany) {
    return {
      ok: false,
      message:
        "You can only share with people in the same company (or a guide/system admin assigned to it).",
    };
  }

  const { error } = await supabase
    .from("coaching_conversation_shares")
    .insert({
      conversation_id: conversationId,
      profile_id: shareeProfileId,
      access,
      created_by: session.profile.id,
    });
  if (error) {
    console.error("shareConversationAction insert failed", error);
    const detail = error.message ? ` (${error.message})` : "";
    return { ok: false, message: `Couldn't share that conversation.${detail}` };
  }

  trackAfter(
    session.profile.id,
    "coach.thread_shared",
    { access, mode: convo.mode },
    { company: convo.company_id }
  );

  // Fire the recipient's notification. Best-effort: a notification
  // failure never rolls back the share (the share is authoritative;
  // the ping is a convenience). insertNotification logs its own
  // errors, so `void` here keeps this path free of nested error
  // handling that would just re-log the same message.
  const href =
    convo.mode === "general"
      ? `/ask-aimee/${conversationId}`
      : convo.subject_profile_id
        ? `/coach/${convo.subject_profile_id}/${conversationId}`
        : `/ask-aimee/${conversationId}`;
  const senderName = session.profile.full_name?.trim() || "A teammate";
  const conversationLabel = convo.title?.trim() || "a coaching thread";
  void insertNotification({
    recipientId: shareeProfileId,
    companyId: convo.company_id,
    kind: "chat_shared",
    eyebrow:
      access === "write" ? "Shared · Collaborate" : "Shared · Read-only",
    title: `${senderName} shared "${conversationLabel}" with you`,
    href,
    payload: {
      conversation_id: conversationId,
      access,
      shared_by_id: session.profile.id,
      shared_by_name: senderName,
      mode: convo.mode,
      practice_id: convo.practice_id,
    },
    createdBy: session.profile.id,
  });

  if (convo.mode === "general") {
    revalidatePath(`/ask-aimee/${conversationId}`);
    revalidatePath("/ask-aimee");
  } else if (convo.subject_profile_id) {
    revalidatePath(`/coach/${convo.subject_profile_id}/${conversationId}`);
  }
  return { ok: true };
}

export async function updateShareAccessAction(
  conversationId: string,
  shareeProfileId: string,
  access: ShareAccessInput
): Promise<SimpleResult> {
  if (access !== "read" && access !== "write") {
    return { ok: false, message: "Access must be read or write." };
  }
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const { data: convo } = await supabase
    .from("coaching_conversations")
    .select("id, created_by, mode, subject_profile_id")
    .eq("id", conversationId)
    .maybeSingle<
      Pick<CoachingConversation, "id" | "created_by" | "mode" | "subject_profile_id">
    >();
  if (!convo) return { ok: false, message: "Conversation not found." };
  if (convo.created_by !== session.profile.id) {
    return { ok: false, message: "Only the owner can change access." };
  }

  const { error } = await supabase
    .from("coaching_conversation_shares")
    .update({ access })
    .eq("conversation_id", conversationId)
    .eq("profile_id", shareeProfileId);
  if (error) return { ok: false, message: "Couldn't update that access level." };

  if (convo.mode === "general") {
    revalidatePath(`/ask-aimee/${conversationId}`);
  } else if (convo.subject_profile_id) {
    revalidatePath(`/coach/${convo.subject_profile_id}/${conversationId}`);
  }
  return { ok: true };
}

export async function unshareConversationAction(
  conversationId: string,
  shareeProfileId: string
): Promise<SimpleResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const { data: convo } = await supabase
    .from("coaching_conversations")
    .select("id, created_by, mode, subject_profile_id")
    .eq("id", conversationId)
    .maybeSingle<
      Pick<CoachingConversation, "id" | "created_by" | "mode" | "subject_profile_id">
    >();
  if (!convo) return { ok: false, message: "Conversation not found." };
  if (convo.created_by !== session.profile.id) {
    return { ok: false, message: "Only the owner can remove people." };
  }

  const { error } = await supabase
    .from("coaching_conversation_shares")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("profile_id", shareeProfileId);
  if (error) return { ok: false, message: "Couldn't remove that access." };

  if (convo.mode === "general") {
    revalidatePath(`/ask-aimee/${conversationId}`);
    revalidatePath("/ask-aimee");
  } else if (convo.subject_profile_id) {
    revalidatePath(`/coach/${convo.subject_profile_id}/${conversationId}`);
  }
  return { ok: true };
}

// Candidates for the share modal — active members of the
// conversation's company, minus the owner and anyone already
// shared. Owner-only because non-owners have no reason to invite
// (they can only leave). Returns an empty array on any auth miss
// so the client's autocomplete degrades to "nobody" rather than
// leaking a distinct error surface for a probe attempt.
export async function listShareCandidatesAction(
  conversationId: string
): Promise<{ ok: true; items: ShareCandidate[] } | { ok: false; message: string }> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const { data: convo } = await supabase
    .from("coaching_conversations")
    .select("id, created_by")
    .eq("id", conversationId)
    .maybeSingle<{ id: string; created_by: string }>();
  if (!convo) return { ok: false, message: "Conversation not found." };
  if (convo.created_by !== session.profile.id) {
    return { ok: false, message: "Only the owner can invite people." };
  }

  const items = await listShareCandidatesForConversation(conversationId);
  return { ok: true, items };
}

// Self-leave for sharees. Distinct from unshareConversationAction
// so the UI can render a "Leave this chat" button that a non-owner
// can click without an ownership check tripping first.
export async function leaveSharedConversationAction(
  conversationId: string
): Promise<SimpleResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient();

  const { data: share } = await supabase
    .from("coaching_conversation_shares")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("profile_id", session.profile.id)
    .maybeSingle<{ conversation_id: string }>();
  if (!share) {
    return { ok: false, message: "You don't have access to this chat." };
  }

  const { error } = await supabase
    .from("coaching_conversation_shares")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("profile_id", session.profile.id);
  if (error) return { ok: false, message: "Couldn't leave that chat." };

  revalidatePath("/ask-aimee");
  return { ok: true };
}
