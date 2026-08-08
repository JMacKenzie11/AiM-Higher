import { NextResponse, type NextRequest } from "next/server";

// Legacy pass-through for auth links generated before we switched
// to the token-as-form-submit pattern. Old inbox links look like
//   /auth/callback?token_hash=…&type=…&next=/accept-invite
// (or /reset-password). New links go straight to the target page
// with the token in the query — verifyOtp only fires when the user
// submits the password form, so scanners / link previewers that
// GET the URL never consume the one-shot token.
//
// This route now just forwards the token to the target page. No
// exchange, so it's safe for scanners to follow. Kept around so
// links already sitting in inboxes keep working during the
// transition window.
//
// TODO: delete once every previously-issued link (24h expiry) has
// aged out and nothing in the wild still hits this path.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/accept-invite";

  // Guard against open-redirect: only allow same-origin absolute paths.
  const safeNext =
    next.startsWith("/") && !next.startsWith("//") ? next : "/accept-invite";

  const target = new URL(safeNext, request.url);
  if (tokenHash) target.searchParams.set("token_hash", tokenHash);
  if (type) target.searchParams.set("type", type);
  if (code) target.searchParams.set("code", code);

  return NextResponse.redirect(target);
}
