import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireProfile } from "@/lib/auth/current-user";
import { currentRequestOrigin } from "@/lib/instances/origin";
import { googleDocsConfigured } from "@/lib/google-docs/config";
import { exchangeGoogleDocsCode, saveGoogleDocsSecret } from "@/lib/google-docs/connection";
import { safeReturnPath } from "@/lib/google-docs/return-path";

// Google's redirect back after the person allows Save to Google Docs
// (0318). Verifies the state cookie, exchanges the code, stores the
// tokens against the SESSION's profile, and sends them back to where
// they pressed the button with gdoc_connected=1 (or gdoc_error), so
// the card finishes the save.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_COOKIE = "google_docs_oauth_state";

const withParam = (path: string, key: string, value: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;

export async function GET(req: NextRequest): Promise<Response> {
  const session = await requireProfile();
  const origin = await currentRequestOrigin();
  if (!googleDocsConfigured()) return new Response("Not found", { status: 404 });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");

  const store = await cookies();
  const stored = store.get(STATE_COOKIE)?.value;
  store.delete(STATE_COOKIE);

  if (!state || !stored || state !== stored) {
    return NextResponse.redirect(`${origin}${withParam("/ask-aimee", "gdoc_error", "invalid_state")}`);
  }
  let back = "/ask-aimee";
  try {
    back = safeReturnPath(Buffer.from(state.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    back = "/ask-aimee";
  }
  if (denied || !code) return NextResponse.redirect(`${origin}${withParam(back, "gdoc_error", denied ?? "no_code")}`);

  try {
    const { secret, email } = await exchangeGoogleDocsCode(code, origin);
    await saveGoogleDocsSecret(session.profile.id, secret, email);
    return NextResponse.redirect(`${origin}${withParam(back, "gdoc_connected", "1")}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "connect_failed";
    return NextResponse.redirect(`${origin}${withParam(back, "gdoc_error", message.slice(0, 80))}`);
  }
}
