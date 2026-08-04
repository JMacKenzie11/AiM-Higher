import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

// Session refresh on every request. Follows the @supabase/ssr recipe:
// build a NextResponse, wire cookie get/set to both the request and
// response objects, then call getUser() so Supabase rotates the token
// when it's near expiry.
//
// Returns the refreshed NextResponse AND a boolean indicating whether
// the request is authenticated. The auth signal is used by middleware
// to route "/" (landing page for anons, redirect to /dashboard for
// authed users). Routing anywhere else stays inside server components
// via createSupabaseServerClient().

export async function updateSession(
  request: NextRequest
): Promise<{ response: NextResponse; isAuthenticated: boolean }> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL(), SUPABASE_ANON_KEY(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  return { response, isAuthenticated: Boolean(data.user) };
}
