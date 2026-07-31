import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireProfile } from "@/lib/auth/current-user";
import { transcriptSourcesAllowed } from "@/lib/auth/permissions";
import { exchangeCodeAndPersist } from "@/lib/transcripts/providers/google-drive";
import { APP_URL } from "@/lib/supabase/env";

// Handles Google's redirect back after user consents. Verifies the
// state cookie, exchanges the code for tokens, persists the refresh
// token in oauth_credentials, and sends the operator back to the
// Companies page with a success or error flash query param. Must
// point directly at /admin/companies — going through
// /admin/transcripts strips the query string on redirect and the
// flash message is lost.

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

  const destination = `${APP_URL()}/admin/companies`;

  if (error) {
    return NextResponse.redirect(
      `${destination}?oauth_error=${encodeURIComponent(error)}`
    );
  }
  if (!code || !state || !stored || state !== stored) {
    return NextResponse.redirect(
      `${destination}?oauth_error=invalid_state`
    );
  }

  try {
    const email = await exchangeCodeAndPersist(code);
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
