import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireProfile } from "@/lib/auth/current-user";
import {
  isAdminForCompany,
} from "@/lib/auth/permissions";
import { buildConsentUrl } from "@/lib/transcripts/providers/google-drive";

// Starts the Google OAuth handshake. Gated to system_admin because
// the resulting refresh token becomes a company's Drive identity.
// The target company id travels through the OAuth state so the
// callback knows which company to persist under and redirect back
// to. A short-lived state cookie protects the callback from CSRF;
// the callback route verifies the query state matches the cookie.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_COOKIE = "google_oauth_state";
const STATE_MAX_AGE_SECONDS = 60 * 10; // 10 minutes
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest): Promise<Response> {
  const session = await requireProfile();
  // Only these roles can ever manage a company's connections; the
  // company check below decides which company.
  if (!["system_admin", "company_admin", "aims_guide", "portfolio_admin"].includes(session.profile.role)) {
    return new Response("Forbidden", { status: 403 });
  }

  const companyId = new URL(req.url).searchParams.get("company_id") ?? "";
  if (!UUID_RE.test(companyId)) {
    return new Response("Missing or invalid company_id", { status: 400 });
  }
  // The caller must manage THIS company's connections (external
  // connections plan, decision 3): a system admin, its company admin,
  // an assigned guide, or a portfolio admin switched on for it. The
  // same rule as can_manage_connections() in the database (0257).
  // Without the company check a company_admin could pass another
  // company's id in the query string and pin their account to it.
  if (!isAdminForCompany(session.profile, companyId)) {
    return new Response("Forbidden", { status: 403 });
  }

  // State value is nonce|company_id. The nonce guards CSRF; the
  // company_id tells the callback which row to upsert. The whole
  // string is echoed back by Google and re-verified against the
  // cookie so an attacker can't pin someone else's company.
  const nonce = randomBytes(24).toString("hex");
  const state = `${nonce}.${companyId}`;

  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: STATE_MAX_AGE_SECONDS,
    path: "/",
  });

  return NextResponse.redirect(buildConsentUrl(state));
}
