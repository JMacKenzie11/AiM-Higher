// Pure helpers behind the middleware's URL-driven scope-in. Kept
// free of "server-only" and next/headers so they run in the edge
// runtime AND under vitest.
//
// Background: middleware rewrites the aims_scope_company cookie
// whenever a request lands on /admin/companies/<id>, so that page
// behaves as if you're inside that company. The original version
// fired on EVERY request to that path, including Next.js Link
// prefetches. In production a <Link> prefetches when it scrolls
// into view or is hovered, each prefetch is a real request through
// middleware, and the response Set-Cookie switched the operator's
// scope to whichever company happened to be prefetched last.
// Landing on /hq (five company links in the viewport) and then
// clicking Dashboard was enough to end up in the wrong tenant.
//
// Two guards now sit in front of the cookie write:
//   1. The request must be a real navigation, not a prefetch.
//   2. The caller must be a cross-tenant role. Company users
//      ignore the cookie anyway (see scope.ts), but we shouldn't
//      hand them one at all.

const COMPANY_ADMIN_PATH = /^\/admin\/companies\/([0-9a-f-]{36})(?:\/|$)/i;

// Company id embedded in an /admin/companies/<uuid> path, else null.
export function companyIdFromPath(pathname: string): string | null {
  const match = pathname.match(COMPANY_ADMIN_PATH);
  return match ? match[1] : null;
}

// True when the request was issued by a prefetcher rather than a
// user navigation. Next.js's app router sends `Next-Router-Prefetch:
// 1` on its own prefetches; browsers send `Purpose: prefetch` or
// `Sec-Purpose: prefetch` for <link rel=prefetch> / speculation
// rules. Any of these means "the user did not choose this URL".
export function isPrefetchRequest(headers: Headers): boolean {
  if (headers.get("next-router-prefetch") === "1") return true;
  if (headers.get("purpose") === "prefetch") return true;
  const secPurpose = headers.get("sec-purpose") ?? "";
  if (secPurpose.split(";").some((p) => p.trim() === "prefetch")) return true;
  return false;
}

// Only cross-tenant roles ever carry a scope cookie.
export function roleCanAutoScope(role: string | null): boolean {
  return role === "system_admin" || role === "aims_guide";
}

// Decide whether this request should rewrite the scope cookie, and
// to what. Returns the target company id, or null to leave the
// cookie alone.
export function autoScopeTarget(args: {
  pathname: string;
  currentScope: string | null;
  isPrefetch: boolean;
}): string | null {
  if (args.isPrefetch) return null;
  const target = companyIdFromPath(args.pathname);
  if (!target) return null;
  if (target === args.currentScope) return null;
  return target;
}
