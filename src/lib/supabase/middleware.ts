import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

// Session refresh on every request. Follows the @supabase/ssr recipe:
// build a NextResponse, wire cookie get/set to both the request and
// response objects, then call getUser() so Supabase rotates the token
// when it's near expiry.
//
// The RESULT of getUser() is intentionally not used here — routing
// decisions happen inside route handlers / server components where
// createSupabaseServerClient() reads the same rotated cookies.

export async function updateSession(request: NextRequest) {
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

  await supabase.auth.getUser();
  return response;
}
