import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { visionYear, vividVisionInMessage } from "@/lib/foundation/vivid-vision";
import { renderVividVisionPdf, vividVisionFileName } from "@/lib/foundation/vivid-vision-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/vivid-vision/pdf?conversation=<id>&message=<id>
//
// The Vivid Vision Coach's finished document as a PDF (Jason,
// 2026-11-02). Read from the saved message under the caller's own
// session, so RLS on coaching_conversations and coaching_messages is
// the gate: whoever can see the card (the person who started the
// conversation, and anyone it is shared with) can download it, as
// they can copy it. It reads; nothing is written. The company name
// and the year come from the conversation and the message, never
// from the caller.
export async function GET(request: Request) {
  await requireProfile();
  const url = new URL(request.url);
  const conversationId = url.searchParams.get("conversation") ?? "";
  const messageId = url.searchParams.get("message") ?? "";
  if (!conversationId || !messageId) return new NextResponse("Not found", { status: 404 });

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: convo } = await supabase
    .from("coaching_conversations")
    .select("id, company_id")
    .eq("id", conversationId)
    .maybeSingle<{ id: string; company_id: string | null }>();
  if (!convo) return new NextResponse("Not found", { status: 404 });

  const { data: message } = await supabase
    .from("coaching_messages")
    .select("role, content, created_at")
    .eq("id", messageId)
    .eq("conversation_id", conversationId)
    .maybeSingle<{ role: string; content: string; created_at: string }>();
  const vision = message?.role === "assistant" ? vividVisionInMessage(message.content) : null;
  if (!message || !vision) return new NextResponse("Not found", { status: 404 });

  const { data: company } = convo.company_id
    ? await supabase.from("companies").select("name").eq("id", convo.company_id).maybeSingle<{ name: string | null }>()
    : { data: null };
  const companyName = company?.name?.trim() || "Our Company";
  const year = visionYear(message.created_at);

  const pdf = await renderVividVisionPdf(vision.doc, companyName, year);
  const name = vividVisionFileName(companyName, year);
  // ?view opens it in the browser tab; otherwise it downloads.
  const disposition = url.searchParams.has("view") ? "inline" : "attachment";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${name.replace(/[^\w .()-]/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
