"use server";

import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { resolveAgent } from "@/lib/practices/resolve";
import { practiceGate } from "@/lib/practices/gate";
import { createPracticeConversation } from "@/lib/practices/create";
import { trackAfter } from "@/lib/analytics/track";
import { findSessionOffer } from "./session-offer-block";

// THE OFFER CARD'S TWO ACTIONS (Jason, 2026-10-05).
//
// The browser names a MESSAGE and nothing else. The session and the
// summary come from that message as saved, read under the person's own
// session, so nothing on the page can change what is started or what
// is carried into it. Every check the card's buttons imply is made
// again here:
//
//   - the message is Aimee's, in an open conversation (no agent) that
//     this person owns;
//   - they are working in that conversation's company;
//   - they could start the session: practiceGate, as at every launch.
//
// Allowed: whoever owns the conversation the offer is in, and only
// for themselves. The new conversation is theirs, under
// coaching_conversations_insert (0261), with offered_in_message_id
// unique per person (0263).

export type OfferState =
  | { ok: true; title: string; startedConversationId: string | null }
  | { ok: false; message: string };

export type StartResult =
  | { ok: true; conversationId: string }
  | { ok: false; message: string };

type Loaded =
  | { ok: false; message: string }
  | {
      ok: true;
      profileId: string;
      companyId: string;
      session: string;
      summary: string;
      title: string;
      existing: string | null;
    };

async function load(messageId: string): Promise<Loaded> {
  const session = await requireProfile();
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());

  const { data: message } = await db
    .from("coaching_messages")
    .select("id, role, content, conversation_id")
    .eq("id", messageId)
    .maybeSingle<{ id: string; role: string; content: string; conversation_id: string }>();
  if (!message || message.role !== "assistant") {
    return { ok: false, message: "That offer is gone." };
  }
  const offer = findSessionOffer(message.content);
  if (!offer) return { ok: false, message: "That offer is gone." };

  const { data: convo } = await db
    .from("coaching_conversations")
    .select("id, company_id, created_by, mode, practice_id")
    .eq("id", message.conversation_id)
    .maybeSingle<{
      id: string;
      company_id: string;
      created_by: string;
      mode: string;
      practice_id: string | null;
    }>();
  if (!convo || convo.created_by !== session.profile.id) {
    return { ok: false, message: "Only the person who had this conversation can start it." };
  }
  if (convo.mode !== "general" || convo.practice_id) {
    return { ok: false, message: "That offer is gone." };
  }

  const agent = await resolveAgent(offer.session);
  if (!agent || agent.archived) {
    return { ok: false, message: "That session isn't available any more." };
  }
  const gate = await practiceGate(agent, session.profile, convo.company_id);
  if (!gate.ok) return { ok: false, message: "That session isn't available to you." };

  const { data: started } = await db
    .from("coaching_conversations")
    .select("id")
    .eq("created_by", session.profile.id)
    .eq("offered_in_message_id", message.id)
    .maybeSingle<{ id: string }>();

  return {
    ok: true,
    profileId: session.profile.id,
    companyId: convo.company_id,
    session: agent.id,
    summary: offer.summary,
    title: agent.title,
    existing: started?.id ?? null,
  };
}

// What the card shows: the session's name as this company calls it,
// and whether this offer already started one.
export async function getSessionOfferAction(messageId: string): Promise<OfferState> {
  const loaded = await load(messageId);
  if (!loaded.ok) return loaded;
  return { ok: true, title: loaded.title, startedConversationId: loaded.existing };
}

// Talk it through. Opens the session this offer already started, if
// there is one; otherwise starts it with the summary carried over.
export async function startOfferedSessionAction(messageId: string): Promise<StartResult> {
  const loaded = await load(messageId);
  if (!loaded.ok) return loaded;
  if (loaded.existing) return { ok: true, conversationId: loaded.existing };

  // A session runs against the company the person is working in, and
  // createPracticeConversation reads that from their scope. A system
  // admin or guide who has moved to another company since would start
  // it in the wrong one, so they are asked to move back instead.
  const session = await requireProfile();
  const scoped = await getEffectiveCompanyId(session);
  if (scoped !== loaded.companyId) {
    return {
      ok: false,
      message: "Switch back to the company this conversation is in, then start it.",
    };
  }

  const created = await createPracticeConversation(loaded.session, {
    handoffSummary: loaded.summary,
    offeredInMessageId: messageId,
  });
  if (!created.ok) {
    // Two clicks at once: the second insert hits the unique index
    // (0263) and fails. The first one's session is the answer.
    const again = await load(messageId);
    if (again.ok && again.existing) return { ok: true, conversationId: again.existing };
    return created;
  }

  trackAfter(
    loaded.profileId,
    "aimee.session_offer_started",
    { agent: loaded.session },
    { company: loaded.companyId }
  );
  revalidatePath("/ask-aimee");
  return { ok: true, conversationId: created.item.id };
}
