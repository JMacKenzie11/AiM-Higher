import { isServable, type InstanceConfig } from "./types";

// What middleware does with a resolution result.
//
// Kept as a pure function so the routing rule can be unit-tested
// without a NextRequest, the same way scope-request.ts holds the
// auto-scope rule.

// Public, unauthenticated, and deliberately outside every route
// group: it renders on hostnames that resolve to no database at all,
// so it cannot depend on a layout that reads one.
export const INSTANCE_NOT_FOUND_PATH = "/instance-not-found";

// Same constraints as the not-found page, and reached for the
// opposite reason: this hostname IS a registered instance, we simply
// are not serving it. Suspension is a registry column, so taking an
// instance offline is one row update and no infrastructure change.
// See the status contract in ./types.ts.
export const INSTANCE_SUSPENDED_PATH = "/instance-suspended";

export type InstanceRouting =
  // Resolved AND servable. Carry this config through the request.
  | { action: "proceed"; instance: InstanceConfig }
  // Unresolved, or resolved but not being served. Show the matching
  // boundary page instead of anything else.
  | { action: "rewrite"; to: string }
  // Already on one of those boundary pages. Render it without
  // resolving, or the hostname would rewrite to it forever.
  | { action: "passthrough" };

const BOUNDARY_PATHS: readonly string[] = [
  INSTANCE_NOT_FOUND_PATH,
  INSTANCE_SUSPENDED_PATH,
];

export function routeForInstance({
  pathname,
  instance,
}: {
  pathname: string;
  instance: InstanceConfig | null;
}): InstanceRouting {
  if (BOUNDARY_PATHS.includes(pathname)) return { action: "passthrough" };
  if (!instance) return { action: "rewrite", to: INSTANCE_NOT_FOUND_PATH };
  // Resolved, but the registry says do not serve it. Rewriting here
  // means no session is refreshed and the instance's database is
  // never opened on this request: the suspension is enforced before
  // anything downstream can assume an instance it can use.
  //
  // Every path, including /sign-in. A suspension that still let
  // people authenticate would be a broken app rather than a paused
  // one, and the person hitting it deserves the notice, not a login
  // form that fails afterwards.
  if (!isServable(instance.status)) {
    return { action: "rewrite", to: INSTANCE_SUSPENDED_PATH };
  }
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
