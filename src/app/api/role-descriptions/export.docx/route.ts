import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { getAccessForConversation } from "@/lib/coach/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentInstanceConfig } from "@/lib/instances/current";
import { parseRoleDescription } from "@/lib/role-descriptions/parse-document";
import { buildRoleDescriptionDocxFromDoc } from "@/lib/role-descriptions/docx-from-doc";

// POST /api/role-descriptions/export.docx
//
// The .docx for a document the agent just produced, saved or not.
//
// A POST carrying the document rather than a GET against a stored
// id, because Download has to work BEFORE Save. A leader who wants
// the file and not the record should not have to create the record
// to get the file, and making them would quietly turn Save into
// something they press for the wrong reason.
//
// The same two gates the Save action uses, for the same reasons:
// the company comes from the CONVERSATION and never from the
// caller's scope cookie, and a read-only sharee can see the card
// without acting on it. Downloading is not a write, but it is
// handing somebody a file built from a company's own material, and
// "can see the card" is exactly the right threshold for that.

export async function POST(req: Request): Promise<Response> {
  const session = await requireProfile();

  let payload: { document?: unknown; conversationId?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const raw =
    typeof payload.document === "string"
      ? payload.document
      : JSON.stringify(payload.document ?? null);
  const conversationId =
    typeof payload.conversationId === "string" ? payload.conversationId : "";

  const doc = parseRoleDescription(raw);
  if (!doc) {
    return NextResponse.json(
      { error: "That role description isn't in the right shape." },
      { status: 400 }
    );
  }
  if (!conversationId) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const admin = await createSupabaseAdminClient(getCurrentInstanceConfig());
  const { data: convo } = await admin
    .from("coaching_conversations")
    .select("id, company_id")
    .eq("id", conversationId)
    .maybeSingle<{ id: string; company_id: string }>();
  if (!convo) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const access = await getAccessForConversation(
    conversationId,
    session.profile.id
  );
  if (access === null) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (!isAdminForCompany(session.profile, convo.company_id)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  const { data: company } = await admin
    .from("companies")
    .select("name")
    .eq("id", convo.company_id)
    .maybeSingle<{ name: string | null }>();

  const buffer = await buildRoleDescriptionDocxFromDoc({
    doc,
    companyName: company?.name ?? null,
  });

  const filename = `${doc.title.replace(/[^\w\s-]/g, "").trim() || "role-description"}.docx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
