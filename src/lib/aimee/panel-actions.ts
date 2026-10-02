"use server";

import { requireProfile } from "@/lib/auth/current-user";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { getCompanyFeatures } from "@/lib/subscriptions/service";
import { openablePatternsFor } from "@/lib/pages/registry";
import { createGeneralConversation } from "@/lib/coach/create-general";
import {
  getAccessForConversation,
  getConversation,
  getMessages,
  getMessageSenders,
  listSharesForConversation,
  type CoachingConversation,
  type ConversationAccess,
} from "@/lib/coach/service";
import { resolveAgent } from "@/lib/practices/resolve";
import { resolveRuntimeConfig } from "@/lib/practices/version-config";
import type { Practice } from "@/lib/practices/registry";
import { openNudge } from "@/lib/guide/open-nudge";
import { isAimeeNotification } from "@/lib/notifications/kinds";
import type { NotificationKind } from "@/lib/notifications/service";
import { recordPanelEvent } from "./panel";

// THE PANEL'S CONVERSATION, loaded on demand by the panel (the page
// underneath is somebody else's, so none of this rides on its render).
//
// The panel reopens the person's last conversation STARTED IN THE
// PANEL: plain Aimee (no agent), their own, in the company they are
// working in, not archived. Started in the panel rather than any plain
// conversation, so the memory rule a person meets in the panel is
// always the same one: a page conversation continued here would keep
// remember_this and be swept, and one opened here would not. The page
// conversations are all still on the Aimee page.
//
// Everything is read under the person's own session, so the rows are
// the ones RLS gives them and nothing else.

export type PanelChat = {
  conversation: CoachingConversation;
  // Owner for the panel's own conversations; a shared chat carries
  // the access it was shared with.
  access: ConversationAccess;
  // The agent, for a debrief opened from an invitation: only the
  // client-safe fields, from the version pinned to the conversation,
  // exactly as the Aimee page overlays them.
  practice: Practice | null;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    created_at: string;
    created_by: string;
  }>;
  senders: Record<string, { full_name: string; avatar_url: string | null }>;
  currentUserId: string;
  // For the panel's greeting and its questions for the page.
  firstName: string | null;
  role: Parameters<typeof openablePatternsFor>[0];
  // The pages this person can open, for the link check in replies.
  openablePatterns: string[];
};

export type PanelChatResult = { ok: true; chat: PanelChat } | { ok: false; message: string };

async function bundle(
  conversation: CoachingConversation,
  userId: string,
  role: Parameters<typeof openablePatternsFor>[0],
  access: ConversationAccess,
  fullName: string | null
): Promise<PanelChat> {
  const messages = await getMessages(conversation.id);
  // Owner, sharees and anyone whose messages are in the thread, so a
  // shared chat shows who said what, as on the Aimee page.
  const ids = new Set<string>([userId, conversation.created_by]);
  for (const m of messages) ids.add(m.created_by);
  if (access !== "owner" || conversation.created_by !== userId) {
    for (const sh of await listSharesForConversation(conversation.id)) ids.add(sh.profile_id);
  }
  const senderInfo = await getMessageSenders([...ids]);
  const senders: PanelChat["senders"] = {};
  for (const [id, info] of senderInfo) senders[id] = info;

  const registryAgent = await resolveAgent(conversation.practice_id);
  const runtime = registryAgent ? await resolveRuntimeConfig(registryAgent, conversation.agent_version_id ?? null) : null;
  const practice =
    registryAgent && runtime
      ? {
          ...registryAgent,
          chips: runtime.chips,
          skipSetup: runtime.skipSetup,
          firstTurn: runtime.firstTurn ?? undefined,
          scriptedOpener: runtime.scriptedOpener ?? undefined,
        }
      : registryAgent;

  return {
    conversation,
    access,
    practice: practice ?? null,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
      created_by: m.created_by,
    })),
    senders,
    currentUserId: userId,
    firstName: fullName?.trim().split(/\s+/)[0] || null,
    role,
    openablePatterns: openablePatternsFor(role, await getCompanyFeatures(conversation.company_id)),
  };
}

export async function openPanelChatAction(): Promise<PanelChatResult> {
  const session = await requireProfile();
  const companyId = await getEffectiveCompanyId(session);
  if (!companyId) {
    return { ok: false, message: "Choose a company first. Aimee works in the company you are looking at." };
  }
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: last } = await supabase
    .from("coaching_conversations")
    .select("*")
    .eq("created_by", session.profile.id)
    .eq("company_id", companyId)
    .eq("mode", "general")
    .eq("origin", "panel")
    .eq("archived", false)
    .is("practice_id", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<CoachingConversation>();
  if (last) return { ok: true, chat: await bundle(last, session.profile.id, session.profile.role, "owner", session.profile.full_name) };
  return newPanelChatAction();
}

export async function newPanelChatAction(): Promise<PanelChatResult> {
  const session = await requireProfile();
  const created = await createGeneralConversation({ origin: "panel" });
  if (!created.ok) return created;
  return { ok: true, chat: await bundle(created.item, session.profile.id, session.profile.role, "owner", session.profile.full_name) };
}

// Counted from the browser: the panel opening. Help searches are
// counted by the chat route, where they happen. Nothing but the kind
// is accepted.
export async function recordPanelEventAction(kind: "opened"): Promise<void> {
  if (kind !== "opened") return;
  const session = await requireProfile();
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  await recordPanelEvent(supabase, {
    companyId: await getEffectiveCompanyId(session),
    profileId: session.profile.id,
    role: session.profile.role,
    kind,
  });
}

// An Aimee conversation in the panel by id: a shared chat, or the
// debrief an invitation opened. Only what the person can open (RLS on
// the conversation, then their access to it), and only Aimee-page
// conversations: one about a person lives on that person's coaching
// page, so the panel links there instead (`href`).
export type PanelOpenResult = PanelChatResult | { ok: false; message: string; href: string };

export async function openPanelConversationAction(conversationId: string): Promise<PanelOpenResult> {
  const session = await requireProfile();
  const conversation = await getConversation(conversationId);
  if (!conversation) return { ok: false, message: "That conversation isn't available to you." };
  if (conversation.mode !== "general") {
    return {
      ok: false,
      message: "This conversation is about a person, so it opens on their coaching page.",
      href: conversation.subject_profile_id
        ? `/coach/${conversation.subject_profile_id}/${conversation.id}`
        : "/ask-aimee",
    };
  }
  const access = await getAccessForConversation(conversation.id, session.profile.id);
  if (!access) return { ok: false, message: "That conversation isn't available to you." };
  return { ok: true, chat: await bundle(conversation, session.profile.id, session.profile.role, access, session.profile.full_name) };
}

// Opening one of Aimee's notifications in the panel. The client names
// the NOTIFICATION, never a nudge or a conversation: both come from
// the row, which RLS lets only its recipient read, so there is nothing
// on the client to change into somebody else's. A nudge opens through
// openNudge, the same as the nudge page (recipient only, marked
// opened and read); a shared chat is marked read and opened.
export async function openAimeeNotificationAction(notificationId: string): Promise<PanelOpenResult> {
  const session = await requireProfile();
  const db = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: row } = await db
    .from("notifications")
    .select("id, kind, href, payload")
    .eq("id", notificationId)
    .eq("recipient_id", session.profile.id)
    .maybeSingle<{ id: string; kind: NotificationKind; href: string; payload: Record<string, unknown> | null }>();
  if (!row || !isAimeeNotification(row.kind)) return { ok: false, message: "That notification is gone." };

  let conversationId: string | null = null;
  if (row.kind === "guide-nudge") {
    const nudgeId = typeof row.payload?.nudge_id === "string" ? row.payload.nudge_id : null;
    if (!nudgeId) return { ok: false, message: "That invitation is gone." };
    const opened = await openNudge(nudgeId);
    if (!opened.ok) return opened;
    conversationId = opened.conversationId;
  } else {
    conversationId = typeof row.payload?.conversation_id === "string" ? row.payload.conversation_id : null;
    await db
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("recipient_id", session.profile.id)
      .is("read_at", null);
  }
  if (!conversationId) return { ok: false, message: "That conversation is gone." };
  return openPanelConversationAction(conversationId);
}
