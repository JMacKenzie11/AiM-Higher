import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireProfile } from "@/lib/auth/current-user";
import {
  isAdminForCompany,
  transcriptSourcesAllowed,
} from "@/lib/auth/permissions";
import { exchangeCodeAndPersist } from "@/lib/transcripts/providers/google-drive";
import { APP_URL } from "@/lib/supabase/env";

// Handles Google's redirect back after user consents. Verifies the
// state cookie, extracts the target company id (embedded in state
// by /api/oauth/google/start), exchanges the code for tokens,
// persists the refresh token in oauth_credentials against that
// company, and sends the operator back to the company page with a
// success or error flash query param.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_COOKIE = "google_oauth_state";

export async function GET(req: NextRequest): Promise<Response> {
  const session = await requireProfile();
  if (!transcriptSourcesAllowed(session.profile)) {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const cookieStore = await cookies();
  const stored = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  // Fallback landing if state is missing/tampered (no company id to
  // route back to). The overview page still shows the flash.
  const fallback = `${APP_URL()}/admin/companies`;

  if (error) {
    return NextResponse.redirect(
      `${fallback}?oauth_error=${encodeURIComponent(error)}`
    );
  }
  if (!code || !state || !stored || state !== stored) {
    return NextResponse.redirect(
      `${fallback}?oauth_error=invalid_state`
    );
  }

  const companyId = state.split(".")[1] ?? "";
  if (!companyId) {
    return NextResponse.redirect(
      `${fallback}?oauth_error=missing_company`
    );
  }
  // /start checked the caller admins this company before minting
  // the state cookie, but the cookie lives in the caller's own
  // browser and can be rewritten. Re-check here, on the value we're
  // about to persist against: without this a company_admin could
  // bind their Google account to another tenant's Drive ingest.
  if (!isAdminForCompany(session.profile, companyId)) {
    return NextResponse.redirect(`${fallback}?oauth_error=forbidden`);
  }
  const destination = `${APP_URL()}/admin/companies/${companyId}`;

  try {
    const email = await exchangeCodeAndPersist(code, companyId);
    return NextResponse.redirect(
      `${destination}?oauth_connected=${encodeURIComponent(email)}`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "connect_failed";
    return NextResponse.redirect(
      `${destination}?oauth_error=${encodeURIComponent(message)}`
    );
  }
}
