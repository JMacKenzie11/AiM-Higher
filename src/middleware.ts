import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import {
  SCOPE_COOKIE_NAME,
  SCOPE_COOKIE_MAX_AGE,
} from "@/lib/admin/scope";

// Middleware refreshes the Supabase auth session on every request.
//
// It also auto-scopes cross-company roles (system_admin, aims_guide)
// to the company they're viewing on /admin/companies/[id]. Two moves:
//   1. Mutate request.cookies so the current request's layout sees
//      the new scope and renders the "inside this company" nav.
//   2. Set the response cookie so subsequent clicks (Dashboard, Plan,
//      etc.) resolve to the same company.
// Non-admin callers ignore this cookie entirely (see getEffectiveCompanyId
// in lib/admin/scope.ts), so writing it for them is inert.
//
// We used to clear the cookie in middleware whenever a system_admin
// visited /admin/companies. Same pattern in reverse fights the render
// pipeline unless we use NextResponse.next({request}) — hence the
// pattern below, borrowed from the supabase session refresh.

const COMPANY_ADMIN_PATH = /^\/admin\/companies\/([0-9a-f-]{36})(?:\/|$)/i;

export async function middleware(request: NextRequest) {
  const match = request.nextUrl.pathname.match(COMPANY_ADMIN_PATH);
  const targetScope = match ? match[1] : null;
  const currentScope = request.cookies.get(SCOPE_COOKIE_NAME)?.value ?? null;
  const shouldSetScope = targetScope !== null && targetScope !== currentScope;

  if (shouldSetScope && targetScope) {
    // Make the current request's server components see the new scope.
    request.cookies.set(SCOPE_COOKIE_NAME, targetScope);
  }

  const response = await updateSession(request);

  if (shouldSetScope && targetScope) {
    // Persist the new scope on the browser so the next navigation keeps it.
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
