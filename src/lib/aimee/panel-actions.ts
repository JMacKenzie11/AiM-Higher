"use server";

import { requireProfile } from "@/lib/auth/current-user";
import { seesAimeePanel } from "@/lib/aimee/panel-audience";
import { getEffectiveCompanyId } from "@/lib/admin/scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { getCompanyFeatures } from "@/lib/subscriptions/service";
import { openablePatternsFor } from "@/lib/pages/registry";
import { createGeneralConversation } from "@/lib/coach/create-general";
import { getMessages, getMessageSenders, type CoachingConversation } from "@/lib/coach/service";
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
  fullName: string | null
): Promise<PanelChat> {
  const messages = await getMessages(conversation.id);
  const senderInfo = await getMessageSenders([userId]);
  const senders: PanelChat["senders"] = {};
  for (const [id, info] of senderInfo) senders[id] = info;
  return {
    conversation,
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

// The panel's audience is decided on the server too, not only by
// whether the layout draws the icon (panel-audience.ts).
const NOT_YET: PanelChatResult = { ok: false, message: "Aimee's panel isn't open to your role yet." };

export async function openPanelChatAction(): Promise<PanelChatResult> {
  const session = await requireProfile();
  if (!seesAimeePanel(session.profile.role)) return NOT_YET;
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
  if (last) return { ok: true, chat: await bundle(last, session.profile.id, session.profile.role, session.profile.full_name) };
  return newPanelChatAction();
}

export async function newPanelChatAction(): Promise<PanelChatResult> {
  const session = await requireProfile();
  if (!seesAimeePanel(session.profile.role)) return NOT_YET;
  const created = await createGeneralConversation({ origin: "panel" });
  if (!created.ok) return created;
  return { ok: true, chat: await bundle(created.item, session.profile.id, session.profile.role, session.profile.full_name) };
}

// Counted from the browser: the panel opening, and a click on
// "Continue on the Aimee page". Help searches are counted by the chat
// route, where they happen. Nothing but the kind is accepted.
export async function recordPanelEventAction(kind: "opened" | "continue_on_page"): Promise<void> {
  if (kind !== "opened" && kind !== "continue_on_page") return;
  const session = await requireProfile();
  if (!seesAimeePanel(session.profile.role)) return;
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  await recordPanelEvent(supabase, {
    companyId: await getEffectiveCompanyId(session),
    profileId: session.profile.id,
    role: session.profile.role,
    kind,
  });
}
