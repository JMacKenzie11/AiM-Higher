"use server";

import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { createCommitment } from "@/lib/commitments/create";
import { getCommitmentLinkOptions } from "@/lib/commitments/service";
import { dueLabel } from "@/lib/commitments/due-label";
import type { Commitment, Priority } from "@/lib/types";
import { COMMITMENT_DRAFT_TAG } from "./commitment-draft";

// SAVING AIMEE'S COMMITMENT DRAFT (0255).
//
// The leader's own action, under their own session: the conversation
// has to be one they started, the message one of Aimee's in it holding
// a draft, and the commitment is created by commitments/create.ts with
// the conversation's company, so the Commitments page's rules and the
// insert rules on commitments apply unchanged. The message id makes it
// once: a unique column, and a trigger that refuses a message that is
// not the caller's (0255).

export type DraftCardState = {
  // Set once the draft has been saved.
  saved: { id: string; description: string; due: string } | null;
  priorityOptions: Array<Pick<Priority, "id" | "title">>;
  functionalAreaOptions: Array<{ id: string; title: string }>;
};

export type SaveDraftResult =
  | { ok: true; saved: NonNullable<DraftCardState["saved"]> }
  | { ok: false; message: string };

type Db = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// The conversation's company when the caller started it and the message
// is Aimee's draft in it; otherwise null.
async function draftCompany(
  supabase: Db,
  profileId: string,
  conversationId: string,
  messageId: string
): Promise<string | null> {
  const { data: convo } = await supabase
    .from("coaching_conversations")
    .select("id, company_id, created_by")
    .eq("id", conversationId)
    .maybeSingle<{ id: string; company_id: string | null; created_by: string }>();
  if (!convo || convo.created_by !== profileId || !convo.company_id) return null;
  const { data: message } = await supabase
    .from("coaching_messages")
    .select("id, role, content")
    .eq("id", messageId)
    .eq("conversation_id", conversationId)
    .maybeSingle<{ id: string; role: string; content: string }>();
  if (!message || message.role !== "assistant" || !message.content.includes("```" + COMMITMENT_DRAFT_TAG)) {
    return null;
  }
  return convo.company_id;
}

function savedShape(c: Pick<Commitment, "id" | "description" | "due_date" | "due_date_defaulted">) {
  return { id: c.id, description: c.description, due: dueLabel(c) };
}

async function savedFor(supabase: Db, messageId: string) {
  const { data } = await supabase
    .from("commitments")
    .select("id, description, due_date, due_date_defaulted")
    .eq("coaching_message_id", messageId)
    .is("deleted_at", null)
    .maybeSingle<Pick<Commitment, "id" | "description" | "due_date" | "due_date_defaulted">>();
  return data ? savedShape(data) : null;
}

export async function getDraftCardStateAction(
  conversationId: string,
  messageId: string
): Promise<DraftCardState | null> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const companyId = await draftCompany(supabase, session.profile.id, conversationId, messageId);
  if (!companyId) return null;
  const [saved, options] = await Promise.all([savedFor(supabase, messageId), getCommitmentLinkOptions(companyId)]);
  return { saved, ...options };
}

export async function saveCommitmentDraftAction(input: {
  conversationId: string;
  messageId: string;
  description: string;
  dueDate: string | null;
  priorityId: string | null;
  functionalAreaId: string | null;
}): Promise<SaveDraftResult> {
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const companyId = await draftCompany(supabase, session.profile.id, input.conversationId, input.messageId);
  if (!companyId) {
    return { ok: false, message: "Only the person who started this conversation can save its commitment." };
  }
  const already = await savedFor(supabase, input.messageId);
  if (already) return { ok: true, saved: already };

  const result = await createCommitment(session, {
    description: input.description,
    dueDate: input.dueDate,
    priorityId: input.priorityId,
    functionalAreaId: input.functionalAreaId,
    companyId,
    coachingMessageId: input.messageId,
  });
  if (!result.ok) {
    // Two saves at once: the second meets the unique column, and the
    // first one's commitment is the answer to both.
    const raced = await savedFor(supabase, input.messageId);
    return raced ? { ok: true, saved: raced } : result;
  }
  return { ok: true, saved: savedShape(result.commitment) };
}
