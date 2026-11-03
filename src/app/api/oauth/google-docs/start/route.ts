import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireProfile } from "@/lib/auth/current-user";
import { currentRequestOrigin } from "@/lib/instances/origin";
import { GOOGLE_DOCS_SCOPES, googleDocsConfigured, googleDocsOAuthClient } from "@/lib/google-docs/config";
import { safeReturnPath } from "@/lib/google-docs/return-path";

// Starts Save to Google Docs' sign-in (0318). Any signed-in person may
// connect THEIR OWN Google account: the callback stores it against the
// session's profile, never one named in the request. A short-lived
// state cookie guards the callback against CSRF, as /api/oauth/google.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GOOGLE_DOCS_STATE_COOKIE = "google_docs_oauth_state";

export async function GET(req: NextRequest): Promise<Response> {
  await requireProfile();
  if (!googleDocsConfigured()) return new Response("Not found", { status: 404 });

  const q = new URL(req.url).searchParams;
  const back = safeReturnPath(q.get("return"));
  // The vision to save once connected: the callback saves it on the
  // server, so nothing depends on the page finishing the job.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const c = q.get("conversation") ?? "";
  const m = q.get("message") ?? "";
  const nonce = randomBytes(24).toString("hex");
  const payload = { back, c: UUID.test(c) ? c : null, m: UUID.test(m) ? m : null };
  const state = `${nonce}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;

  const store = await cookies();
  store.set(GOOGLE_DOCS_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });

  const url = googleDocsOAuthClient(await currentRequestOrigin()).generateAuthUrl({
    access_type: "offline",
    // Always ask, so Google returns a refresh token even for an
    // account that connected before.
    prompt: "consent",
    scope: GOOGLE_DOCS_SCOPES,
    include_granted_scopes: false,
    state,
  });
  return NextResponse.redirect(url);
}
