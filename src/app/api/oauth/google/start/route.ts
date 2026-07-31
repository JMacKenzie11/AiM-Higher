import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireProfile } from "@/lib/auth/current-user";
import { transcriptSourcesAllowed } from "@/lib/auth/permissions";
import { buildConsentUrl } from "@/lib/transcripts/providers/google-drive";

// Starts the Google OAuth handshake. Gated to system_admin because
// the resulting refresh token becomes the platform's Drive identity.
// A short-lived state cookie protects the callback from CSRF; the
// callback route verifies the query state matches the cookie.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_COOKIE = "google_oauth_state";
const STATE_MAX_AGE_SECONDS = 60 * 10; // 10 minutes

export async function GET(_req: NextRequest): Promise<Response> {
  const session = await requireProfile();
  if (!transcriptSourcesAllowed(session.profile)) {
    return new Response("Forbidden", { status: 403 });
  }

  const state = randomBytes(24).toString("hex");
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
