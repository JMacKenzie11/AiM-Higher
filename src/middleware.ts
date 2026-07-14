import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Middleware refreshes the Supabase auth session on every request.
//
// We used to clear the aims_scope_company cookie here whenever a
// system_admin visited /admin/companies, but that fought the render
// pipeline: middleware set the delete instruction on the response,
// but the layout still saw the cookie in the same request's cookies,
// so the nav rendered with the full app link set. Clicking any of
// those links landed on a page that then had NO scope (cookie was
// gone by then) and got bounced back to /admin/companies.
//
// Solution: the scope only clears explicitly, via the "Exit company"
// button in the sub-band. That button calls exitCompanyScopeAction,
// which clears the cookie and redirects — one intent, one transition,
// no cross-request ambiguity.

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip static and image assets; only run for real routes.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|brand/.*\\.(?:png|jpg|jpeg|svg|gif|webp)$).*)",
  ],
};
