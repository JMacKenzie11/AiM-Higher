import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Server-side auth callback. All admin-issued invite / magic-link /
// recovery links redirect through here (via ?next=/target on the
// redirectTo). This route exchanges the ?code= (PKCE) or verifies
// the ?token_hash=&type= (OTP) server-side, sets cookies via
// @supabase/ssr's server client, then forwards to the intended page
// (/accept-invite or /reset-password) with a session established.
//
// Old links already in inboxes still land on /accept-invite or
// /reset-password directly, so those pages keep their client-side
// fallback bootstrap for legacy URLs.
//
// Scanner guard: magic-link tokens are one-shot. If ANYTHING hits
// this endpoint before the real user does — Microsoft SafeLinks,
// Barracuda, Mimecast, Proofpoint, Slackbot/Slack-ImgProxy,
// facebookexternalhit for iMessage previews, generic crawlers — the
// token gets consumed and the real click returns "expired." Very
// common when the admin uses the Copy invite link feature and
// pastes the URL into a message channel that unfurls links.
//
// We sniff the user-agent for known preview bots + generic crawler
// signatures. If it looks like one, we return a plain safe-looking
// HTML page and DON'T touch the token. Real user landing there
// (unlikely — either a false positive or a genuinely careful email
// client) sees a Continue button that re-issues the request with
// ?force=1, which bypasses the scanner check.

const SCANNER_UA_PATTERNS: readonly RegExp[] = [
  // Microsoft ecosystem previewers (SafeLinks + Office/Outlook clients)
  /safelinks/i,
  /outlook.*preview/i,
  /microsoft.?office/i,
  /office\/\d/i,
  /skypeuripreview/i,
  /bingpreview/i,
  // Email security gateways
  /barracuda/i,
  /mimecast/i,
  /proofpoint/i,
  /symantec/i,
  /trend.?micro/i,
  /forcepoint/i,
  /webroot/i,
  // Chat / social link unfurlers
  /slackbot/i,
  /slack-imgproxy/i,
  /discordbot/i,
  /telegrambot/i,
  /whatsapp/i,
  /facebookexternalhit/i,
  /twitterbot/i,
  /linkedinbot/i,
  // Search / safety crawlers
  /google-safety/i,
  /googlebot/i,
  /applebot/i,
  /yandexbot/i,
  /duckduckbot/i,
  // Automation / scripting agents
  /headlesschrome/i,
  /phantomjs/i,
  /python-requests/i,
  /^curl\//i,
  /^wget/i,
  // Generic catch-all — real browsers don't include these tokens.
  /\bbot\b/i,
  /crawler/i,
  /spider/i,
  /scanner/i,
];

function looksLikeScanner(ua: string | null): boolean {
  if (!ua) return true; // no UA at all is almost always automation
  return SCANNER_UA_PATTERNS.some((rx) => rx.test(ua));
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") ?? "/dashboard";
  const force = url.searchParams.get("force") === "1";

  // Guard against open-redirect: only allow same-origin absolute paths.
  const safeNext =
    next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  const ua = request.headers.get("user-agent");
  const ip =
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    null;

  // Log every hit — user-agent, IP, and what token shape arrived.
  // Token values themselves are redacted (length only) so we don't
  // leak them into Vercel logs. Grep for "auth/callback" to see the
  // trail of hits per invitation link.
  console.log("auth/callback hit", {
    ua,
    ip,
    force,
    has_code: Boolean(code),
    code_len: code?.length ?? null,
    has_token_hash: Boolean(tokenHash),
    token_hash_len: tokenHash?.length ?? null,
    type,
    next: safeNext,
    referer: request.headers.get("referer"),
  });

  // Scanner defer path — return a real HTML page but don't touch
  // the token. The scanner sees 200 OK and moves on; the real user
  // sees a Continue button that re-issues the request with force=1.
  if (!force && looksLikeScanner(ua)) {
    console.log("auth/callback deferred for scanner UA", { ua, ip });
    return renderScannerPage(request);
  }

  const supabase = await createSupabaseServerClient();

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
      console.log("auth/callback exchange ok (token_hash)", { type, next: safeNext });
      return NextResponse.redirect(new URL(safeNext, request.url));
    }
    console.error("auth/callback verifyOtp failed", {
      ...shape,
      status: (error as { status?: number }).status,
      code: (error as { code?: string }).code,
      message: error.message,
      ua,
    });
    return redirectWithError(request, safeNext, error);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      console.log("auth/callback exchange ok (code)", { next: safeNext });
      return NextResponse.redirect(new URL(safeNext, request.url));
    }
    console.error("auth/callback exchangeCodeForSession failed", {
      ...shape,
      status: (error as { status?: number }).status,
      code: (error as { code?: string }).code,
      message: error.message,
      ua,
    });
    return redirectWithError(request, safeNext, error);
  }

  console.warn("auth/callback hit with no token", {
    ...shape,
    raw_query: url.search,
    ua,
  });
  return redirectWithError(request, safeNext, {
    message: "The link didn't include an authentication token.",
  });
}

// Plain-HTML page returned to link scanners / preview bots. Real
// users who accidentally land here (false positive on the UA check)
// can click Continue to bypass and consume the token themselves.
function renderScannerPage(request: NextRequest): Response {
  const forced = new URL(request.url);
  forced.searchParams.set("force", "1");
  const forcedUrl = forced.toString();
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Continue to AiMSHigher</title>
</head>
<body style="margin: 0; padding: 0; background: #f5f2e8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 480px; margin: 0 auto; padding: 48px 24px; text-align: center;">
    <div style="font-weight: 800; font-size: 20px; letter-spacing: -0.01em; color: #142647; margin-bottom: 24px;">AiMS<span style="color:#0057ff;">Higher</span></div>
    <h1 style="font-size: 20px; color: #142647; margin: 0 0 8px;">Continue to your invitation</h1>
    <p style="color: #465470; line-height: 1.55; font-size: 14px;">Click below to open your invitation and set your password.</p>
    <p><a href="${escapeAttr(forcedUrl)}" style="display: inline-block; margin-top: 20px; background: #0057ff; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 999px; font-weight: 600; font-size: 14px;">Continue</a></p>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Robots-Tag": "noindex",
    },
  });
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function redirectWithError(
  request: NextRequest,
  next: string,
  error: { message: string; code?: string }
) {
  const target = new URL(next, request.url);
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
