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

// Paths where a pending (not-yet-accepted) user IS allowed to be
// while signed in. Everywhere else, they get bounced back to
// /accept-invite so the /auth/callback → verifyOtp session that
// was created for the invite exchange can't be used to browse the
// app before a password lands. See updateSession for the profile
// check that drives this.
const PENDING_ALLOWED_PATHS: readonly string[] = [
  "/accept-invite",
  "/sign-in",
  "/forgot-password",
  "/reset-password",
];
function pendingAllowsPath(pathname: string): boolean {
  if (pathname.startsWith("/auth/")) return true;
  return PENDING_ALLOWED_PATHS.includes(pathname);
}

export async function middleware(request: NextRequest) {
  const match = request.nextUrl.pathname.match(COMPANY_ADMIN_PATH);
  const targetScope = match ? match[1] : null;
  const currentScope = request.cookies.get(SCOPE_COOKIE_NAME)?.value ?? null;
  const shouldSetScope = targetScope !== null && targetScope !== currentScope;

  // /hq is the "home base" surface — always unscoped. Clearing the
  // scope cookie here (mutating request cookies so the current render
  // sees the clean state, and response cookies so it sticks) keeps
  // the sidebar honest: no company-scoped nav items like Dashboard
  // or Chart while the user is at their home base. Clicking a
  // company from Your Companies re-scopes via the auto-scope branch
  // above.
  //
  // Server components can't mutate cookies from within their render
  // — this is the only correct place to do it.
  const onHqSurface = request.nextUrl.pathname.startsWith("/hq");
  const shouldClearScope = onHqSurface && currentScope !== null;

  if (shouldSetScope && targetScope) {
    request.cookies.set(SCOPE_COOKIE_NAME, targetScope);
  }
  if (shouldClearScope) {
    request.cookies.delete(SCOPE_COOKIE_NAME);
  }

  const path = request.nextUrl.pathname;
  const needsPendingCheck = !pendingAllowsPath(path);
  const { response, isAuthenticated, isPending, role } = await updateSession(
    request,
    { checkPending: needsPendingCheck }
  );

  // Pending users have a session (from the invite OTP exchange) but
  // haven't set a password. They must not be allowed anywhere except
  // the accept-invite surface until they do — otherwise abandoning
  // the invite flow would leak the app to whoever holds the browser.
  if (isPending && needsPendingCheck) {
    return NextResponse.redirect(new URL("/accept-invite", request.url));
  }

  // Authenticated visitors don't see the marketing page. Cross-tenant
  // roles (system_admin, aims_guide) land on /hq — their home base
  // across every assigned company. Everyone else lands on /dashboard
  // which resolves to their own tenant. Root-URL routing deliberately
  // ignores the scope cookie so typing aims-hq.com/ doesn't strand a
  // sysadmin inside whichever company they last scoped into.
  if (request.nextUrl.pathname === "/" && isAuthenticated) {
    const home =
      role === "system_admin" || role === "aims_guide" ? "/hq" : "/dashboard";
    return NextResponse.redirect(new URL(home, request.url));
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
  if (shouldClearScope) {
    response.cookies.set({
      name: SCOPE_COOKIE_NAME,
      value: "",
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 0,
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
