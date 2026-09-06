import type { InstanceConfig } from "./types";

// What middleware does with a resolution result.
//
// Kept as a pure function so the routing rule can be unit-tested
// without a NextRequest, the same way scope-request.ts holds the
// auto-scope rule.

// Public, unauthenticated, and deliberately outside every route
// group: it renders on hostnames that resolve to no database at all,
// so it cannot depend on a layout that reads one.
export const INSTANCE_NOT_FOUND_PATH = "/instance-not-found";

export type InstanceRouting =
  // Resolved. Carry this config through the request.
  | { action: "proceed"; instance: InstanceConfig }
  // Unresolved. Show the not-found page instead of anything else.
  | { action: "rewrite"; to: string }
  // Already on the not-found page. Render it without resolving, or
  // an unknown hostname would rewrite to it forever.
  | { action: "passthrough" };

export function routeForInstance({
  pathname,
  instance,
}: {
  pathname: string;
  instance: InstanceConfig | null;
}): InstanceRouting {
  if (pathname === INSTANCE_NOT_FOUND_PATH) return { action: "passthrough" };
  if (!instance) return { action: "rewrite", to: INSTANCE_NOT_FOUND_PATH };
  return { action: "proceed", instance };
}

// ---- Paths that never resolve an instance ---------------------
//
// Scheduled jobs. Vercel invokes these on a schedule, not on behalf
// of a visitor, so the hostname it happens to use says nothing about
// which database the job is for. Running them through resolution
// would be worse than useless: today the production hostname is one
// registry row, so every cron would either be rewritten to
// /instance-not-found and silently return a 200 having done nothing,
// or quietly run against whichever instance the scheduler's URL
// pointed at.
//
// So they are excluded here and pick their own instance explicitly
// through getCurrentInstanceConfig()'s fallback, which throws by name
// when it has not been told which database to use. A cron that cannot
// tell must stop, not guess.
//
// Nothing else belongs in this list. These routes carry their own
// authorization (a CRON_SECRET bearer check) and never read a session
// cookie, which is why skipping the session refresh costs nothing.
const CRON_PREFIX = "/api/cron/";

export function isInstanceExemptPath(pathname: string): boolean {
  return pathname === "/api/cron" || pathname.startsWith(CRON_PREFIX);
}
