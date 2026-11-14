import "server-only";

import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CoachingMessage } from "@/lib/coach/service";

// The conversation's first assistant message: its opener, when there
// is one.
export async function firstAssistantMessage(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  conversationId: string
): Promise<CoachingMessage | null> {
  const { data } = await supabase
    .from("coaching_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<CoachingMessage>();
  return data ?? null;
}
