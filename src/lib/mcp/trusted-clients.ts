// WHICH OUTSIDE ASSISTANTS ARE APPROVED (0280).
//
// With open client registration anyone can register a client and call it
// "Claude". What cannot be faked is where Supabase sends the person back
// with the authorization code: a code delivered to https://claude.ai/...
// is usable only by Claude. So a client is approved only if EVERY
// redirect address it registered is on this list.
//
// The database holds the authoritative copy (mcp_redirect_trusted,
// 0280; Grok Bot added in 0301), which the consent page, the token hook and the database gate
// all ask. This mirror is for showing the person a domain and for
// tests; trusted-clients.test.ts fails if the two lists disagree.

export const TRUSTED_REDIRECTS: readonly string[] = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  "https://chatgpt.com/connector_platform_oauth_redirect",
  // Grok Bot (0301, Jason 2026-10-25). One registration carries all six,
  // and Cursor, the code editor, shares it. The last three return to a
  // program on the person's own computer; see returnsToThisComputer.
  "https://grok.com/connectors-oauth-exchange-code/",
  "https://www.cursor.com/bot/mcp/oauth/callback",
  "https://www.cursor.com/agents/mcp/oauth/callback",
  "cursor://anysphere.cursor-mcp/oauth/callback",
  "http://localhost:8787/callback",
  "http://127.0.0.1:8787/callback",
];
export const TRUSTED_REDIRECT_PATTERNS: readonly RegExp[] = [/^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/];

export function isTrustedRedirect(uri: string): boolean {
  return TRUSTED_REDIRECTS.includes(uri) || TRUSTED_REDIRECT_PATTERNS.some((p) => p.test(uri));
}

// "Claude (claude.ai)": the name the client gave, and the domain the
// person will be sent back to, which is the part that cannot be faked.
export function assistantLabel(name: string | null | undefined, redirectUri: string): string {
  let host = redirectUri;
  try {
    host = new URL(redirectUri).host || redirectUri;
  } catch {
    // Not a URL; show it as given.
  }
  return `${(name ?? "").trim() || "An AI app"} (${host})`;
}

// True when the person is sent back to a program on their own computer
// rather than to a website: a loopback address or an app's own scheme
// (cursor://). Any program there could be listening, so the consent
// page says so (0301).
export function returnsToThisComputer(redirectUri: string): boolean {
  try {
    const u = new URL(redirectUri);
    if (u.protocol !== "https:" && u.protocol !== "http:") return true;
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  } catch {
    return false;
  }
}
