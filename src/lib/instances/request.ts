import type { InstanceConfig } from "./types";

// How the resolved instance travels from middleware to the rest of
// the request.
//
// Middleware resolves the hostname once and attaches the result as a
// request header via NextResponse.next({ request: { headers } }),
// which is the established Next.js way to pass computed state down to
// server components. Server-side callers read it back through
// getCurrentInstanceConfig().
//
// Two things make this safe to trust:
//
//   * it is a REQUEST header, set on the inbound request as Next
//     hands it to the render. It is never part of the response and
//     never reaches a browser.
//   * middleware overwrites it on every request it handles, and its
//     matcher covers every non-static path, so a client that sends
//     its own x-aims-instance header has that value replaced before
//     any application code sees it. An inbound one can never be
//     honoured.
//
// It carries the service-role key, because the admin client needs it
// and re-deriving it downstream would mean a second registry lookup
// on a different code path. Never log this header, and never copy it
// onto an outbound request.

export const INSTANCE_HEADER = "x-aims-instance";

export function serializeInstance(instance: InstanceConfig): string {
  return JSON.stringify(instance);
}

// Returns null for anything that isn't a well-formed config, so a
// malformed header falls through to the env fallback rather than
// producing a client with undefined credentials.
export function parseInstanceHeader(
  raw: string | null | undefined,
): InstanceConfig | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const c = parsed as Record<string, unknown>;
    if (
      typeof c.subdomain !== "string" ||
      typeof c.displayName !== "string" ||
      typeof c.supabaseUrl !== "string" ||
      typeof c.supabaseAnonKey !== "string" ||
      typeof c.supabaseServiceKey !== "string" ||
      (c.status !== "active" && c.status !== "suspended")
    ) {
      return null;
    }
    return {
      subdomain: c.subdomain,
      displayName: c.displayName,
      supabaseUrl: c.supabaseUrl,
      supabaseAnonKey: c.supabaseAnonKey,
      supabaseServiceKey: c.supabaseServiceKey,
      status: c.status,
    };
  } catch {
    return null;
  }
}

// ---- Which hostname was this request made to? -----------------
//
// Deliberately NOT request.nextUrl.hostname. Under `next dev` that
// property reports "localhost" for every request no matter what Host
// the client actually sent, so a subdomain cannot be exercised on a
// developer machine at all: every hostname would resolve to nothing
// and the whole app would sit behind /instance-not-found locally.
// The headers carry the real value in dev and in production alike.
//
// x-forwarded-host first, because that is what the proxy in front of
// us saw and is what Vercel sets. Falling back to Host covers a
// direct connection with nothing in front.
//
// Both headers are ultimately client-supplied, so a caller can ask to
// be resolved as any instance they like. That is not a way in: the
// instance only selects which database to open, and a session cookie
// minted by one Supabase project is signed with that project's secret
// and fails verification against any other. A spoofed host gets an
// unauthenticated request against someone else's database, which is
// exactly what an unauthenticated request always gets.
export function hostnameFromHeaders(
  headers: Headers,
  fallback: string,
): string {
  // x-forwarded-host can be a comma-separated chain; the first entry
  // is the host the client originally asked for.
  const forwarded = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = headers.get("host")?.trim();
  return forwarded || host || fallback;
}
