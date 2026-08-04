import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  SCOPE_COOKIE_NAME,
  SCOPE_COOKIE_MAX_AGE,
} from "@/lib/admin/scope";

// Middleware handles three concerns per request:
//   1. Supabase session refresh (always).
//   2. "/" routing — unauthenticated visitors see the marketing
//      landing page; authenticated visitors go to /dashboard, whose
//      own logic routes cross-tenant roles onward to /admin/companies
//      when no company is scoped. Keeping the routing here (not in a
//      root page.tsx) lets the landing page render statically without
//      a session fetch.
//   3. Auto-scope for /admin/companies/[id] — mutate request cookies
//      so the current render sees the new scope, and set the response
//      cookie so subsequent clicks keep it.
//
// The cookie-mutation pattern uses NextResponse.next({request}) —
// mirrors the supabase session refresh helper so both moves compose.

const COMPANY_ADMIN_PATH = /^\/admin\/companies\/([0-9a-f-]{36})(?:\/|$)/i;

export async function middleware(request: NextRequest) {
  const match = request.nextUrl.pathname.match(COMPANY_ADMIN_PATH);
  const targetScope = match ? match[1] : null;
  const currentScope = request.cookies.get(SCOPE_COOKIE_NAME)?.value ?? null;
  const shouldSetScope = targetScope !== null && targetScope !== currentScope;

  if (shouldSetScope && targetScope) {
    request.cookies.set(SCOPE_COOKIE_NAME, targetScope);
  }

  const { response, isAuthenticated } = await updateSession(request);

  // Authenticated visitors don't see the marketing page. /dashboard is
  // the universal landing surface for authed roles; it internally
  // redirects to /admin/companies when the caller has no effective
  // company (unscoped sysadmin, guide with multiple assignments).
  if (request.nextUrl.pathname === "/" && isAuthenticated) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (shouldSetScope && targetScope) {
    response.cookies.set({
      name: SCOPE_COOKIE_NAME,
      value: targetScope,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: SCOPE_COOKIE_MAX_AGE,
    });
  }

  return response;
}

export const config = {
  // Skip static and image assets; only run for real routes.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|brand/.*\\.(?:png|jpg|jpeg|svg|gif|webp)$).*)",
  ],
};
