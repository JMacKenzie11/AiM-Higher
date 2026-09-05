import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { resolveInstance } from "@/lib/instances/resolve";
import { lookupInstance } from "@/lib/instances/registry";
import {
  isInstanceExemptPath,
  routeForInstance,
} from "@/lib/instances/middleware-decision";
import { hostnameFromHeaders } from "@/lib/instances/request";
import {
  SCOPE_COOKIE_NAME,
  SCOPE_COOKIE_MAX_AGE,
} from "@/lib/admin/scope";
import {
  autoScopeTarget,
  isPrefetchRequest,
  roleCanAutoScope,
} from "@/lib/admin/scope-request";

// Middleware handles four concerns per request:
//   0. Instance resolution (first, for everything except the cron
//      routes, which are excluded outright). The hostname decides
//      which database this request belongs to. A hostname that
//      resolves to nothing is rewritten to /instance-not-found and
//      never touches Supabase at all — no session refresh, no
//      routing, no app route reachable. Everything after this point
//      assumes an instance exists.
//   1. Supabase session refresh (always).
//   2. "/" routing — unauthenticated visitors see the marketing
//      landing page; authenticated visitors go to /dashboard, whose
//      own logic routes cross-tenant roles onward to /admin/companies
//      when no company is scoped. Keeping the routing here (not in a
//      root page.tsx) lets the landing page render statically without
//      a session fetch.
//   3. Auto-scope for /admin/companies/[id] — mutate request cookies
//      so the current render sees the new scope, and set the response
//      cookie so subsequent clicks keep it. Skipped for prefetch
//      requests (a Link scrolling into view is not the user choosing
//      a company) and only persisted for cross-tenant roles. See
//      scope-request.ts for the incident this guards against.
//
// The cookie-mutation pattern uses NextResponse.next({request}) —
// mirrors the supabase session refresh helper so both moves compose.

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
  // Scheduled jobs first, before anything else looks at the request.
  // They are not a visitor's request: no hostname worth resolving, no
  // session to refresh, no scope to set. They choose their own
  // instance explicitly and fail loudly if they cannot. See
  // isInstanceExemptPath.
  if (isInstanceExemptPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const currentScope = request.cookies.get(SCOPE_COOKIE_NAME)?.value ?? null;
  const targetScope = autoScopeTarget({
    pathname: request.nextUrl.pathname,
    currentScope,
    isPrefetch: isPrefetchRequest(request.headers),
  });
  const shouldSetScope = targetScope !== null;
  // NOTE: /hq deliberately does NOT clear the scope cookie. Preserving
  // it lets Dashboard/Chart/Plan (hidden from the sidebar while on /hq,
  // see Sidebar) still navigate back to the last-scoped company when
  // reached directly. Sidebar.tsx hides company-scoped items based on
  // pathname; the cookie stays put.

  if (shouldSetScope && targetScope) {
    request.cookies.set(SCOPE_COOKIE_NAME, targetScope);
  }

  const path = request.nextUrl.pathname;

  // One resolution per request, before anything else. resolveInstance
  // is pure — env and the registry lookup are injected — so the order
  // here is the whole rule: local override, then preview, then the
  // registry, then nothing.
  //
  // The hostname comes from the request headers, not nextUrl: see
  // hostnameFromHeaders for why nextUrl.hostname cannot be trusted.
  const resolved = await resolveInstance(
    hostnameFromHeaders(request.headers, request.nextUrl.hostname),
    process.env,
    lookupInstance
  );
  const routing = routeForInstance({ pathname: path, instance: resolved });

  if (routing.action === "rewrite") {
    // Deliberately before the session refresh. There is no database
    // to check a session against, so nothing here may touch Supabase.
    return NextResponse.rewrite(new URL(routing.to, request.url));
  }
  if (routing.action === "passthrough") {
    // Already on the not-found page. Render it without resolving, or
    // an unknown hostname would rewrite to it forever.
    return NextResponse.next();
  }

  const needsPendingCheck = !pendingAllowsPath(path);
  const { response, isAuthenticated, isPending, role } = await updateSession(
    request,
    routing.instance,
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

  // Persist the scope only for roles that use it. The request-cookie
  // mutation above is inert for company users (the resolver reads
  // their profile first), so it's fine that it ran before the role
  // was known; the response cookie is what would survive.
  if (shouldSetScope && targetScope && roleCanAutoScope(role)) {
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
