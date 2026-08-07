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
  request: NextRequest,
  opts: { checkPending?: boolean } = {}
): Promise<{
  response: NextResponse;
  isAuthenticated: boolean;
  isPending: boolean;
}> {
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
  const isAuthenticated = Boolean(data.user);

  // A magiclink OTP exchange (invite flow) creates a real session
  // BEFORE the user has set a password. If they abandon
  // /accept-invite mid-flow, that session cookie stays valid — so
  // navigating anywhere else would land them into the app as a
  // pending user with no password on file. Fetch profile.status
  // here so the outer middleware can redirect them back to the
  // password screen. Skipped when the caller already knows the
  // current path is one where pending users are allowed (avoids
  // a per-request profiles read on /accept-invite itself).
  let isPending = false;
  if (isAuthenticated && opts.checkPending) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", data.user!.id)
      .maybeSingle<{ status: string }>();
    isPending = profile?.status === "pending";
  }

  return { response, isAuthenticated, isPending };
}
