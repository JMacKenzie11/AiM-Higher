import { headers } from "next/headers";
import { hostnameFromHeaders } from "./request";
import { APP_URL } from "@/lib/supabase/env";

// The origin an auth link must point back at.
//
// NOT `NEXT_PUBLIC_APP_URL`. Every instance is served by ONE Vercel
// deployment, with middleware resolving the database from the
// hostname, so that variable is a single build-time value and cannot
// be correct for more than one instance. Any auth link built from it
// sends every instance's users to the primary host.
//
// That is not a cosmetic redirect. The instance decides which
// Supabase project the request opens, and a token minted by one
// project does not exist in another — so an invite generated on
// promiseone, delivered as a link to the primary host, hits
// `verifyOtp` against a database that has never heard of it. The
// user is told the link is invalid or has expired, immediately, and
// it never worked for a second.
//
// The request's own host is the right answer by construction: an
// admin inviting somebody is, by definition, on the instance they
// are inviting them into.
export async function currentRequestOrigin(): Promise<string> {
  try {
    const store = await headers();
    const host = hostnameFromHeaders(store, "");
    if (!host) return APP_URL();
    // x-forwarded-proto is what the proxy in front of us saw. Falling
    // back on the hostname keeps `next dev` on http without hardcoding
    // a port, and anything else on https.
    const proto =
      store.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
      (/^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? "http" : "https");
    return `${proto}://${host}`;
  } catch {
    // headers() throws outside a request scope. Background work has
    // no host to read, and APP_URL is the only answer available.
    return APP_URL();
  }
}
