import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireProfile } from "@/lib/auth/current-user";
import { isAdminForCompany } from "@/lib/auth/permissions";
import { buildMicrosoftConsentUrl, microsoftConfigured } from "@/lib/connections/microsoft";

// Starts the Microsoft 365 sign-in for a company's Teams transcripts.
// The same shape as /api/oauth/google/start, and the same rule for who:
// whoever may manage this company's connections (isAdminForCompany,
// can_manage_connections() in the database, 0257). The company travels
// in the state, checked against a short-lived cookie by the callback.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_COOKIE = "microsoft_oauth_state";
const STATE_MAX_AGE_SECONDS = 60 * 10;
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

  const state = `${randomBytes(24).toString("hex")}.${companyId}`;
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: STATE_MAX_AGE_SECONDS,
    path: "/",
  });

  return NextResponse.redirect(buildMicrosoftConsentUrl(state));
}
