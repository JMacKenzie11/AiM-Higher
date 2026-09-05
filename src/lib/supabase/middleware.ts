import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { InstanceConfig } from "@/lib/instances/types";
import {
  INSTANCE_HEADER,
  serializeInstance,
} from "@/lib/instances/request";

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
  instance: InstanceConfig,
  opts: { checkPending?: boolean } = {}
): Promise<{
  response: NextResponse;
  isAuthenticated: boolean;
  isPending: boolean;
  // Role is populated only when the profile query runs (i.e. when
  // opts.checkPending is true — same query, one more column). Callers
  // that route based on role should ensure checkPending is true for
  // that path.
  role: string | null;
}> {
  // The resolved instance rides down to the render as a request
  // header. It has to be attached here rather than in the caller,
  // because every NextResponse.next() below re-derives the request
  // and only the object passed at construction time is what the
  // render actually sees.
  //
  // Derived fresh each time from request.headers so cookie rotations
  // applied to request.cookies just above are carried along too.
  const withInstance = () => {
    const headers = new Headers(request.headers);
    headers.set(INSTANCE_HEADER, serializeInstance(instance));
    return NextResponse.next({ request: { headers } });
  };

  let response = withInstance();

  const supabase = createServerClient(
    instance.supabaseUrl,
    instance.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = withInstance();
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

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
  let role: string | null = null;
  if (isAuthenticated && opts.checkPending) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("status, role")
      .eq("id", data.user!.id)
      .maybeSingle<{ status: string; role: string }>();
    isPending = profile?.status === "pending";
    role = profile?.role ?? null;
  }

  return { response, isAuthenticated, isPending, role };
}
