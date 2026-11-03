import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireProfile } from "@/lib/auth/current-user";
import { currentRequestOrigin } from "@/lib/instances/origin";
import { googleDocsConfigured } from "@/lib/google-docs/config";
import { exchangeGoogleDocsCode, saveGoogleDocsSecret } from "@/lib/google-docs/connection";
import { safeReturnPath } from "@/lib/google-docs/return-path";
import { loadVisionForCaller } from "@/lib/foundation/vivid-vision-source";
import { saveVisionToGoogleDoc } from "@/lib/google-docs/save-vision";

// Google's redirect back after the person allows Save to Google Docs
// (0318). Verifies the state cookie, exchanges the code, stores the
// tokens against the SESSION's profile, and sends them back to where
// they pressed the button. When the press named a vision, it is
// saved here, on the server, before the redirect: the page reloads
// showing the doc's link, with gdoc_saved=1 (or gdoc_error) for the
// card's message. (2026-11-03: leaving the save to the page after it
// loaded did not run in the first real test.)

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
  let conversationId: string | null = null;
  let messageId: string | null = null;
  try {
    const p = JSON.parse(Buffer.from(state.split(".")[1] ?? "", "base64url").toString("utf8")) as { back?: string; c?: string | null; m?: string | null };
    back = safeReturnPath(p.back);
    conversationId = p.c ?? null;
    messageId = p.m ?? null;
  } catch {
    back = "/ask-aimee";
  }
  const mark = (path: string) => (messageId ? withParam(path, "gdoc", messageId) : path);
  if (denied || !code) return NextResponse.redirect(`${origin}${withParam(mark(back), "gdoc_error", denied ?? "no_code")}`);

  try {
    const { secret, email } = await exchangeGoogleDocsCode(code, origin);
    await saveGoogleDocsSecret(session.profile.id, secret, email);
  } catch (err) {
    const message = err instanceof Error ? err.message : "connect_failed";
    return NextResponse.redirect(`${origin}${withParam(mark(back), "gdoc_error", message.slice(0, 80))}`);
  }
  if (!conversationId || !messageId) return NextResponse.redirect(`${origin}${back}`);

  // Read as the person, as the button's own save does.
  try {
    const vision = await loadVisionForCaller(conversationId, messageId);
    if (!vision) return NextResponse.redirect(`${origin}${withParam(mark(back), "gdoc_error", "not_found")}`);
    const saved = await saveVisionToGoogleDoc({ profileId: session.profile.id, conversationId, origin, ...vision });
    return NextResponse.redirect(`${origin}${withParam(mark(back), saved.ok ? "gdoc_saved" : "gdoc_error", saved.ok ? "1" : "connect")}`);
  } catch (err) {
    console.error("[google-docs] save after connecting failed", { conversationId, message: err instanceof Error ? err.message : String(err) });
    return NextResponse.redirect(`${origin}${withParam(mark(back), "gdoc_error", "save_failed")}`);
  }
}
