import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireProfile } from "@/lib/auth/current-user";
import { transcriptSourcesAllowed } from "@/lib/auth/permissions";
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
  if (!transcriptSourcesAllowed(session.profile)) {
    return new Response("Forbidden", { status: 403 });
  }

  const companyId = new URL(req.url).searchParams.get("company_id") ?? "";
  if (!UUID_RE.test(companyId)) {
    return new Response("Missing or invalid company_id", { status: 400 });
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
