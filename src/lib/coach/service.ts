import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

// Read-side helpers for the /coach surface. RLS scopes everything to
// the current admin's created_by; server helpers here just return the
// rows the caller is allowed to see.

export type CoachingContextKind = "execution" | "strengths";

export type CoachingConversation = {
  id: string;
  company_id: string;
  subject_profile_id: string;
  created_by: string;
  title: string;
  archived: boolean;
  // Which module owns the coaching context — drives prompt selection
  // and person-context assembly. Defaults to 'execution' on old rows
  // (migration 0018).
  context_kind: CoachingContextKind;
  created_at: string;
  updated_at: string;
};

export type CoachingMessage = {
  id: string;
  conversation_id: string;
  created_by: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type ConversationWithSnippet = CoachingConversation & {
  lastMessageSnippet: string | null;
};

export async function listConversationsForSubject(
  subjectProfileId: string,
  includeArchived = false
): Promise<ConversationWithSnippet[]> {
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("coaching_conversations")
    .select("*")
    .eq("subject_profile_id", subjectProfileId)
    .order("updated_at", { ascending: false });
  if (!includeArchived) query = query.eq("archived", false);

  const { data: convos } = await query;
  const rows = (convos ?? []) as CoachingConversation[];
  if (rows.length === 0) return [];

  // One extra query to pull the last message of each conversation for
  // the snippet. v1 volumes are tiny; if this ever gets hot we can
  // move it into a view or a lateral join.
  const { data: messages } = await supabase
    .from("coaching_messages")
    .select("conversation_id, content, created_at")
    .in("conversation_id", rows.map((r) => r.id))
    .order("created_at", { ascending: false });
  const bySnippet = new Map<string, string>();
  for (const m of (messages ?? []) as Array<{
    conversation_id: string;
    content: string;
    created_at: string;
  }>) {
    if (!bySnippet.has(m.conversation_id)) {
      bySnippet.set(
        m.conversation_id,
        m.content.length > 120 ? `${m.content.slice(0, 117)}…` : m.content
      );
    }
  }

  return rows.map((r) => ({
    ...r,
    lastMessageSnippet: bySnippet.get(r.id) ?? null,
  }));
}

export async function getConversation(
  conversationId: string
): Promise<CoachingConversation | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("coaching_conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle<CoachingConversation>();
  return data ?? null;
}

export async function getMessages(
  conversationId: string
): Promise<CoachingMessage[]> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("coaching_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  return (data ?? []) as CoachingMessage[];
}
