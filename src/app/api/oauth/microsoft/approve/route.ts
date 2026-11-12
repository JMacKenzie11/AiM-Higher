import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { adminConsentUrl, microsoftConfigured } from "@/lib/connections/microsoft";

// Step 1 of connecting Microsoft 365 (Jason, 2026-11-12): sends the
// person to Microsoft to approve AiMS HQ for their organisation,
// signed in as its Microsoft 365 admin. The same who-and-which-company
// checks as /start; the state ends ".approve" so the callback knows
// which trip came back.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_COOKIE = "microsoft_oauth_state";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest): Promise<Response> {
  const session = await requireProfile();
  if (!["system_admin", "company_admin", "aims_guide", "portfolio_admin"].includes(session.profile.role)) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!microsoftConfigured()) {
    return new Response("Microsoft 365 isn't set up for AiMS yet.", { status: 404 });
  }
  const companyId = new URL(req.url).searchParams.get("company_id") ?? "";
  if (!UUID_RE.test(companyId)) {
    return new Response("Missing or invalid company_id", { status: 400 });
  }
  if (!isAdminForCompany(session.profile, companyId)) {
    return new Response("Forbidden", { status: 403 });
  }

  const state = `${randomBytes(24).toString("hex")}.${companyId}.approve`;
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  return NextResponse.redirect(adminConsentUrl(state));
}
