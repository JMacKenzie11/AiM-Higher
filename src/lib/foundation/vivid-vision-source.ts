import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { visionYear, vividVisionInMessage, type VividVisionDoc } from "./vivid-vision";

// A finished Vivid Vision, read from its saved message under the
// caller's own session, for the PDF and for Save to Google Docs. RLS
// on coaching_conversations and coaching_messages is the gate:
// whoever can see the card can have the document. The company name
// and the year come from the conversation and the message, never from
// the caller.
export async function loadVisionForCaller(
  conversationId: string,
  messageId: string
): Promise<{ doc: VividVisionDoc; companyName: string; year: number } | null> {
  if (!conversationId || !messageId) return null;
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: convo } = await supabase
    .from("coaching_conversations")
    .select("id, company_id")
    .eq("id", conversationId)
    .maybeSingle<{ id: string; company_id: string | null }>();
  if (!convo) return null;

  const { data: message } = await supabase
    .from("coaching_messages")
    .select("role, content, created_at")
    .eq("id", messageId)
    .eq("conversation_id", conversationId)
    .maybeSingle<{ role: string; content: string; created_at: string }>();
  const vision = message?.role === "assistant" ? vividVisionInMessage(message.content) : null;
  if (!message || !vision) return null;

  const { data: company } = convo.company_id
    ? await supabase.from("companies").select("name").eq("id", convo.company_id).maybeSingle<{ name: string | null }>()
    : { data: null };
  return { doc: vision.doc, companyName: company?.name?.trim() || "Our Company", year: visionYear(message.created_at) };
}
