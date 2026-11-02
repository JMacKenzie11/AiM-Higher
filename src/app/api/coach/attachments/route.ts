import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth/current-user";
import { getAccessForConversation } from "@/lib/coach/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { extractAttachment } from "@/lib/coach/attachment-extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/coach/attachments  (multipart: conversationId, file)
//
// Reads a file a leader is attaching in an agent conversation and
// hands back its text (lib/coach/attachments.ts). Nothing is stored
// here: the text is saved when the message carrying it is sent,
// through /api/coach, as part of that message.
//
// The same gate as sending: the conversation's owner or a sharee with
// Collaborate access, and only in an agent conversation (practice_id
// set); plain Aimee chats do not take files (Jason, 2026-11-02).
export async function POST(req: Request): Promise<Response> {
  const session = await requireProfile();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const conversationId = form.get("conversationId");
  const file = form.get("file");
  if (typeof conversationId !== "string" || !conversationId || !(file instanceof File)) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: convo } = await supabase
    .from("coaching_conversations")
    .select("id, practice_id")
    .eq("id", conversationId)
    .maybeSingle<{ id: string; practice_id: string | null }>();
  if (!convo) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const access = await getAccessForConversation(conversationId, session.profile.id);
  if (access !== "owner" && access !== "write") {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }
  if (!convo.practice_id) {
    return NextResponse.json({ error: "Files can be attached in agent conversations only." }, { status: 400 });
  }

  const result = await extractAttachment({
    name: file.name,
    type: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: 422 });
  return NextResponse.json({ name: result.name, text: result.text, truncated: result.truncated });
}
