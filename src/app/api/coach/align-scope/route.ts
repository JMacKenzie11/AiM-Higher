import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConversation } from "@/lib/coach/service";
import { setScopedCompanyCookie } from "@/lib/admin/scope";
import { getCurrentInstanceConfig } from "@/lib/instances/current";

// GET /api/coach/align-scope?conversation=<id>&next=<path>
//
// Server components can't mutate cookies. This route lets a chat
// page redirect a sysadmin (or aims_guide with an assignment
// covering the chat's company) into the chat's tenant, then bounce
// them back to the same URL so the whole layout re-renders with
// the correct scope.
//
// Only chat-page redirects should hit this endpoint. It won't
// broaden anyone's access — a company_admin or team_member ignores
// the scope cookie entirely, and a guide is bounced to the picker
// if the chat's company isn't in their assignments.

export const dynamic = "force-dynamic";

const ALLOWED_NEXT_PREFIXES = ["/ask-aimee/", "/coach/"];

export async function GET(request: NextRequest): Promise<Response> {
  const session = await requireProfile();
  const url = request.nextUrl;
  const conversationId = url.searchParams.get("conversation");
  const nextParam = url.searchParams.get("next") ?? "/ask-aimee";

  // Refuse open redirects. Only the two chat surfaces are legit
  // destinations for a scope-align bounce.
  const safeNext = ALLOWED_NEXT_PREFIXES.some((p) => nextParam.startsWith(p))
    ? nextParam
    : "/ask-aimee";

  if (!conversationId) {
    return NextResponse.redirect(new URL(safeNext, url));
  }

  const role = session.profile.role;
  if (role !== "system_admin" && role !== "aims_guide") {
    // No cookie-based scoping for these roles — their scope is
    // their own profile row. Nothing to align.
    return NextResponse.redirect(new URL(safeNext, url));
  }

  const conversation = await getConversation(conversationId);
  if (!conversation) {
    return NextResponse.redirect(new URL(safeNext, url));
  }

  if (role === "aims_guide") {
    const assignments = session.profile.guide_company_ids ?? [];
    if (!assignments.includes(conversation.company_id)) {
      // Guide has no business viewing this tenant. Kick to picker.
      return NextResponse.redirect(new URL("/admin/companies", url));
    }
  }

  // Break potential redirect loops: if the chat's tenant is
  // soft-deleted (companies_hide_deleted returns null), setting the
  // cookie here would fail the freshness check in getEffectiveCompanyId
  // on the next render and bounce us right back. Send the caller to
  // the picker instead — they'll see there's nowhere valid to go.
  const supabase = await createSupabaseServerClient(getCurrentInstanceConfig());
  const { data: liveCompany } = await supabase
    .from("companies")
    .select("id")
    .eq("id", conversation.company_id)
    .maybeSingle<{ id: string }>();
  if (!liveCompany) {
    return NextResponse.redirect(new URL("/admin/companies", url));
  }

  await setScopedCompanyCookie(conversation.company_id, role);
  return NextResponse.redirect(new URL(safeNext, url));
}
