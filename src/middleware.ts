import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// The system_admin "scope" cookie is what makes /dashboard, /plan, etc.
// resolve to a specific company's data. We clear it whenever the user
// lands on the top-level /admin/companies list so that clicking
// "Companies" in the nav implicitly "leaves" the currently-scoped
// company. If they want to work inside a company they Open it again.
const SCOPE_COOKIE_NAME = "aims_scope_company";

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);
  if (request.nextUrl.pathname === "/admin/companies") {
    response.cookies.delete(SCOPE_COOKIE_NAME);
  }
  return response;
}

export const config = {
  // Skip static and image assets; only run for real routes.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|brand/.*\\.(?:png|jpg|jpeg|svg|gif|webp)$).*)",
  ],
};
