import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Server-side auth callback. All admin-issued invite / magic-link /
// recovery links now redirect through here first (via ?next=/target
// on the redirectTo). This route exchanges the ?code= (PKCE) or
// verifies the ?token_hash=&type= (OTP) server-side, sets cookies
// via @supabase/ssr's server client, then forwards to the intended
// page (/accept-invite or /reset-password) with a session already
// established.
//
// This eliminates the client-side race that produced intermittent
// "Auth session missing!" errors on those pages: the browser
// Supabase client's URL detection runs asynchronously while
// getSession() reads local state, and any race — or a link shape
// we didn't explicitly handle — would let the form render without
// a session, so the eventual updateUser() call would die.
//
// Old links already in inboxes still land on /accept-invite or
// /reset-password directly, so those pages keep their client-side
// fallback bootstrap for legacy URLs.

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") ?? "/dashboard";

  // Guard against open-redirect: only allow same-origin absolute paths.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  const supabase = await createSupabaseServerClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(new URL(safeNext, request.url));
    }
    return redirectWithError(request, safeNext, error.message);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(safeNext, request.url));
    }
    return redirectWithError(request, safeNext, error.message);
  }

  // No auth material at all — likely a truncated link, an email
  // scanner that stripped the tokens, or a manual hit.
  return redirectWithError(
    request,
    safeNext,
    "Missing authentication token."
  );
}

function redirectWithError(
  request: NextRequest,
  next: string,
  message: string
) {
  const target = new URL(next, request.url);
  // Match the hash-error format the target-page bootstraps in
  // AcceptInviteForm.readHashError and ResetPasswordForm.readHashError
  // already parse — so failures surface as the same friendly
  // "expired/invalid, ask for a fresh link" message users see today
  // when Supabase redirects with #error_code=otp_expired.
  const params = new URLSearchParams({
    error: "access_denied",
    error_code: "otp_expired",
    error_description: message,
  });
  target.hash = params.toString();
  return NextResponse.redirect(target);
}
