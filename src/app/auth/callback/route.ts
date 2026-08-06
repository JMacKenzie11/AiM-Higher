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
  const safeNext =
    next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  const supabase = await createSupabaseServerClient();

  // Diagnostic — surface what Supabase actually redirected with so
  // failures aren't a black box on Vercel logs. Redact the token
  // values (only their lengths + presence flags matter for debugging).
  const shape = {
    has_code: Boolean(code),
    has_token_hash: Boolean(tokenHash),
    type,
    next: safeNext,
  };

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(new URL(safeNext, request.url));
    }
    console.error("auth/callback verifyOtp failed", {
      ...shape,
      status: (error as { status?: number }).status,
      code: (error as { code?: string }).code,
      message: error.message,
    });
    return redirectWithError(request, safeNext, error);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(safeNext, request.url));
    }
    console.error("auth/callback exchangeCodeForSession failed", {
      ...shape,
      status: (error as { status?: number }).status,
      code: (error as { code?: string }).code,
      message: error.message,
    });
    return redirectWithError(request, safeNext, error);
  }

  console.warn("auth/callback hit with no token", {
    ...shape,
    raw_query: url.search,
  });
  return redirectWithError(request, safeNext, {
    message: "The link didn't include an authentication token.",
  });
}

function redirectWithError(
  request: NextRequest,
  next: string,
  error: { message: string; code?: string }
) {
  const target = new URL(next, request.url);
  // Map only truly-expired errors to error_code=otp_expired so the
  // target-page bootstrap surfaces its "ask for a fresh link" copy.
  // Everything else passes the raw error_description through, so
  // fresh-link callbacks that fail for other reasons (missing
  // code_verifier, invalid token, config drift) show a message that
  // actually reflects what went wrong instead of always saying
  // "expired".
  const rawMessage = error.message ?? "Authentication failed.";
  const looksExpired =
    error.code === "otp_expired" ||
    /expired|already been used|invalid_token/i.test(rawMessage);
  const params = new URLSearchParams({
    error: "access_denied",
    error_code: looksExpired ? "otp_expired" : "callback_failed",
    error_description: rawMessage,
  });
  target.hash = params.toString();
  return NextResponse.redirect(target);
}
