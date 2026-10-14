// WHICH OUTSIDE ASSISTANTS ARE APPROVED (0280).
//
// With open client registration anyone can register a client and call it
// "Claude". What cannot be faked is where Supabase sends the person back
// with the authorization code: a code delivered to https://claude.ai/...
// is usable only by Claude. So a client is approved only if EVERY
// redirect address it registered is on this list.
//
// The database holds the authoritative copy (mcp_redirect_trusted,
// 0280), which the consent page, the token hook and the database gate
// all ask. This mirror is for showing the person a domain and for
// tests; trusted-clients.test.ts fails if the two lists disagree.

export const TRUSTED_REDIRECTS: readonly string[] = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  "https://chatgpt.com/connector_platform_oauth_redirect",
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
